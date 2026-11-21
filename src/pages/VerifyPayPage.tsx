import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowSquareOut,
  Check,
  Copy,
  CurrencyBtc,
  Key,
  MagnifyingGlass,
  PaperPlaneTilt,
  ShieldCheck,
  ShieldWarning,
  Wallet,
} from '@phosphor-icons/react';
import type { Event as NostrEvent, EventTemplate } from 'nostr-tools';
import { NotarySeal } from '../components/NotarySeal';
import {
  broadcastBchTransaction,
  fetchBchAddressInfo,
  fetchBchTransaction,
  formatSatoshis,
  formatSatsToBch,
  scanBchAddressCommitments,
  type BchScannedCommitment,
  type BchTxInfo,
} from '../lib/bchApi';
import {
  buildSignedBchTransaction,
  buildUnsignedBchTransaction,
  DUST_LIMIT_SATS,
} from '../lib/bchTx';
import { discoverBindingsFromRelays } from '../lib/nostrNetwork';
import {
  createAuthChallenge,
  createSignedBindingBundle,
  formatNpub,
  generateBchIdentity,
  generateNostrIdentity,
  importBchWif,
  importNostrNsec,
  normalizeCashAddress,
  normalizeNostrPubkey,
  signAuthChallengeWithBch,
  signAuthChallengeWithNostr,
  verifyAuthChallengeResponse,
  verifyBindingBundle,
  verifyOnChainCommitment,
  type AuthChallenge,
  type AuthChallengeProof,
  type CashBindBundle,
} from '../lib/protocol';
import { loadLocalBundles, saveLocalBundle } from '../lib/storage';
import { useWizardWallet } from '../lib/wizardConnect';

interface WindowWithNostr extends Window {
  nostr?: {
    getPublicKey: () => Promise<string>;
    signEvent: (event: EventTemplate) => Promise<NostrEvent>;
  };
}

export function VerifyPayPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    state: walletState,
    connectedAddress,
    connect: connectWallet,
    signTransactionWithWallet,
  } = useWizardWallet();

  const [localBundles, setLocalBundles] = useState<CashBindBundle[]>(() => loadLocalBundles());
  const [resolverInput, setResolverInput] = useState(
    () => searchParams.get('hash') || searchParams.get('q') || '',
  );
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [bundle, setBundle] = useState<CashBindBundle | null>(null);
  const [tamperSimulated, setTamperSimulated] = useState(false);

  // On-chain OP_RETURN verification state
  const [txidInput, setTxidInput] = useState('');
  const [checkingChain, setCheckingChain] = useState(false);
  const [txAudit, setTxAudit] = useState<{
    txInfo?: BchTxInfo;
    matched: boolean;
    scanned?: BchScannedCommitment[];
    error?: string;
  } | null>(null);

  // Stateless challenge-response auth state
  const [authDomain, setAuthDomain] = useState(() =>
    typeof window !== 'undefined' ? window.location.host || 'cashbind.app' : 'cashbind.app',
  );
  const [challenge, setChallenge] = useState<AuthChallenge | null>(null);
  const [authMethod, setAuthMethod] = useState<'nostr' | 'bch'>('nostr');
  const [authSecretInput, setAuthSecretInput] = useState('');
  const [authSignatureInput, setAuthSignatureInput] = useState('');
  const [authVerdict, setAuthVerdict] = useState<{ valid: boolean; reason: string } | null>(null);

  // Direct BCH Mainnet Payment state
  const [paySats, setPaySats] = useState('1000');
  const [showLocalSender, setShowLocalSender] = useState(false);
  const [senderWif, setSenderWif] = useState('');
  const [sendingPayment, setSendingPayment] = useState(false);
  const [paymentResult, setPaymentResult] = useState<{
    txid: string;
    node: string;
    explorerUrl: string;
    feeSats: number;
  } | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const inspectOnChainTx = useCallback(async (txid: string, expectedHash: string) => {
    setCheckingChain(true);
    try {
      const txInfo = await fetchBchTransaction(txid.trim());
      const match = verifyOnChainCommitment(
        txInfo.outputs.map((o) => ({
          scriptPubKeyHex: o.scriptPubKeyHex,
          valueSats: o.valueSats,
        })),
        expectedHash,
      );
      setTxAudit({ txInfo, matched: match.matched });
    } catch (err) {
      setTxAudit({
        matched: false,
        error: err instanceof Error ? err.message : 'Unable to fetch transaction from Fulcrum.',
      });
    } finally {
      setCheckingChain(false);
    }
  }, []);

  const selectBundle = useCallback(
    (target: CashBindBundle) => {
      setBundle(target);
      setTamperSimulated(false);
      setResolveError(null);
      setAuthVerdict(null);
      setPaymentError(null);
      setPaymentResult(null);
      setTxAudit(null);
      if (target.anchorTxid) {
        setTxidInput(target.anchorTxid);
        void inspectOnChainTx(target.anchorTxid, target.bindingHash);
      } else {
        setTxidInput('');
      }
    },
    [inspectOnChainTx],
  );

  const resolveIdentifier = useCallback(
    async (rawQuery: string) => {
      const q = rawQuery.trim();
      if (!q) return;

      setResolving(true);
      setResolveError(null);

      try {
        // 1. Pasted raw CashBind JSON bundle
        if (q.startsWith('{')) {
          const parsed = JSON.parse(q) as CashBindBundle;
          if (!parsed.payload || !parsed.nostrEvent || !parsed.bchSignature) {
            throw new Error('JSON does not match the CashBind bundle structure.');
          }
          selectBundle(parsed);
          setResolving(false);
          return;
        }

        // 2. Check local vault first
        const vault = loadLocalBundles();
        setLocalBundles(vault);
        const lower = q.toLowerCase();
        const localMatch = vault.find((b) => {
          const npub = formatNpub(b.payload.nostrPubkey).toLowerCase();
          return (
            b.bindingHash.toLowerCase() === lower ||
            b.payload.bchAddress.toLowerCase() === lower ||
            b.payload.nostrPubkey.toLowerCase() === lower ||
            npub === lower ||
            b.payload.handle.toLowerCase() === lower ||
            (b.anchorTxid && b.anchorTxid.toLowerCase() === lower)
          );
        });
        if (localMatch) {
          selectBundle(localMatch);
          setResolving(false);
          return;
        }

        // 3. Query public Nostr relays based on identifier shape
        if (q.startsWith('npub1')) {
          const pubkey = normalizeNostrPubkey(q);
          const discovered = await discoverBindingsFromRelays({ authorPubkey: pubkey });
          if (discovered.bundles.length > 0) {
            selectBundle(discovered.bundles[0]);
            setResolving(false);
            return;
          }
        } else if (q.toLowerCase().startsWith('bitcoincash:') || q.toLowerCase().startsWith('q')) {
          const normalized = normalizeCashAddress(q);
          const discovered = await discoverBindingsFromRelays({ bchAddress: normalized });
          if (discovered.bundles.length > 0) {
            selectBundle(discovered.bundles[0]);
            setResolving(false);
            return;
          }
        } else if (/^[0-9a-fA-F]{64}$/.test(q)) {
          // Could be binding hash, Nostr hex pubkey, or BCH txid
          const byHash = await discoverBindingsFromRelays({ bindingHash: lower });
          if (byHash.bundles.length > 0) {
            selectBundle(byHash.bundles[0]);
            setResolving(false);
            return;
          }
          const byAuthor = await discoverBindingsFromRelays({ authorPubkey: lower });
          if (byAuthor.bundles.length > 0) {
            selectBundle(byAuthor.bundles[0]);
            setResolving(false);
            return;
          }
          // Try fetching BCH txid to extract OP_RETURN hash and look up relay proof
          try {
            const txInfo = await fetchBchTransaction(lower);
            const commitOut = txInfo.outputs.find((o) => o.cashBindCommitment);
            if (commitOut?.cashBindCommitment) {
              const foundByCommit = await discoverBindingsFromRelays({
                bindingHash: commitOut.cashBindCommitment.bindingHash,
              });
              if (foundByCommit.bundles.length > 0) {
                const withTx = { ...foundByCommit.bundles[0], anchorTxid: lower };
                selectBundle(withTx);
                setResolving(false);
                return;
              }
              throw new Error(
                `Found BCH mainnet OP_RETURN commitment ${commitOut.cashBindCommitment.bindingHash.slice(0, 16)}… in tx ${lower.slice(0, 12)}…, but no matching Nostr binding event was returned by public relays.`,
              );
            }
          } catch (txErr) {
            if (txErr instanceof Error && txErr.message.includes('OP_RETURN')) {
              throw txErr;
            }
          }
        }

        throw new Error(
          'No matching CashBind proof was found in local vault or on public Nostr relays. Paste a CashBind JSON bundle or create one on the Bind page.',
        );
      } catch (err) {
        setResolveError(err instanceof Error ? err.message : 'Resolution failed.');
      } finally {
        setResolving(false);
      }
    },
    [selectBundle],
  );

  // Auto-resolve query param or pick most recent local bundle on first load
  useEffect(() => {
    const paramHash = searchParams.get('hash') || searchParams.get('q');
    if (paramHash) {
      setResolverInput(paramHash);
      void resolveIdentifier(paramHash);
      return;
    }
    const existing = loadLocalBundles();
    if (existing.length > 0) {
      selectBundle(existing[0]);
    }
  }, [searchParams, resolveIdentifier, selectBundle]);

  const auditedBundle = useMemo<CashBindBundle | null>(() => {
    if (!bundle) return null;
    if (!tamperSimulated) return bundle;
    return {
      ...bundle,
      payload: {
        ...bundle.payload,
        handle: `${bundle.payload.handle}-tampered`,
      },
    };
  }, [bundle, tamperSimulated]);

  const verificationReport = useMemo(
    () => (auditedBundle ? verifyBindingBundle(auditedBundle) : null),
    [auditedBundle],
  );

  const handleResolveSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!resolverInput.trim()) return;
    if (!resolverInput.trim().startsWith('{')) {
      setSearchParams({ q: resolverInput.trim() });
    }
    void resolveIdentifier(resolverInput);
  };

  const handleScanAddressOnChain = async () => {
    if (!auditedBundle) return;
    setCheckingChain(true);
    try {
      const scan = await scanBchAddressCommitments(auditedBundle.payload.bchAddress);
      const matchedCommit = scan.commitments.find(
        (c) => c.commitment.bindingHash === auditedBundle.bindingHash,
      );
      setTxAudit({
        matched: Boolean(matchedCommit),
        scanned: scan.commitments,
      });
      if (matchedCommit) {
        setTxidInput(matchedCommit.txid);
      }
    } catch (err) {
      setTxAudit({
        matched: false,
        error: err instanceof Error ? err.message : 'Unable to scan address history.',
      });
    } finally {
      setCheckingChain(false);
    }
  };

  const handleCreateDemoBundle = () => {
    const bch = generateBchIdentity();
    const nostr = generateNostrIdentity();
    const created = createSignedBindingBundle({
      bchPrivateKeyHex: bch.privateKeyHex,
      nostrPrivateKeyHex: nostr.privateKeyHex,
      handle: `verify-${bch.address.slice(-4)}.bch`,
      merchantNote: 'Live dual-signed test identity for cryptographic verification and auth.',
    });
    const next = saveLocalBundle(created);
    setLocalBundles(next);
    selectBundle(created);
  };

  const handleGenerateChallenge = () => {
    setChallenge(createAuthChallenge(authDomain.trim() || 'cashbind.app', 300));
    setAuthVerdict(null);
    setAuthSignatureInput('');
  };

  const handleSignChallengeLocal = () => {
    if (!challenge || !auditedBundle) return;
    setAuthVerdict(null);
    try {
      let proof: AuthChallengeProof;
      if (authMethod === 'nostr') {
        const imported = importNostrNsec(authSecretInput);
        proof = signAuthChallengeWithNostr(challenge, imported.privateKeyHex);
      } else {
        const imported = importBchWif(authSecretInput);
        proof = signAuthChallengeWithBch(challenge, imported.privateKeyHex, imported.address);
      }
      const verdict = verifyAuthChallengeResponse(challenge, proof, auditedBundle);
      setAuthVerdict(verdict);
    } catch (err) {
      setAuthVerdict({
        valid: false,
        reason: err instanceof Error ? err.message : 'Could not sign challenge with provided key.',
      });
    }
  };

  const handleSignChallengeNip07 = async () => {
    if (!challenge || !auditedBundle) return;
    const nostrExt = (window as WindowWithNostr).nostr;
    if (!nostrExt) {
      setAuthVerdict({
        valid: false,
        reason: 'No NIP-07 browser extension detected. Use a local nsec key or BCH signature instead.',
      });
      return;
    }
    try {
      const signedEvent = await nostrExt.signEvent({
        kind: 22242,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['domain', challenge.domain],
          ['challenge', challenge.nonce],
        ],
        content: challenge.message,
      });
      const verdict = verifyAuthChallengeResponse(
        challenge,
        {
          method: 'nostr',
          nonce: challenge.nonce,
          signer: signedEvent.pubkey,
          signature: signedEvent.sig,
          nostrEvent: signedEvent,
        },
        auditedBundle,
      );
      setAuthVerdict(verdict);
    } catch (err) {
      setAuthVerdict({
        valid: false,
        reason: err instanceof Error ? err.message : 'NIP-07 challenge signing rejected.',
      });
    }
  };

  const handleVerifyExternalBchChallengeSig = () => {
    if (!challenge || !auditedBundle) return;
    const verdict = verifyAuthChallengeResponse(
      challenge,
      {
        method: 'bch',
        nonce: challenge.nonce,
        signer: auditedBundle.payload.bchAddress,
        signature: authSignatureInput.trim(),
      },
      auditedBundle,
    );
    setAuthVerdict(verdict);
  };

  const satoshiAmount = Number.parseInt(paySats, 10);
  const amountValid = Number.isInteger(satoshiAmount) && satoshiAmount >= DUST_LIMIT_SATS;

  const bip21Uri = useMemo(() => {
    if (!auditedBundle || !verificationReport?.valid) return '';
    const amountBch = amountValid ? (satoshiAmount / 1e8).toFixed(8).replace(/0+$/, '').replace(/\.$/, '') : '';
    const params = new URLSearchParams();
    if (amountBch) params.set('amount', amountBch);
    params.set('label', auditedBundle.payload.handle);
    return `${auditedBundle.payload.bchAddress}?${params.toString()}`;
  }, [auditedBundle, verificationReport, amountValid, satoshiAmount]);

  const handlePayViaWizardConnect = async () => {
    if (!auditedBundle || !verificationReport?.valid || !amountValid) return;
    if (walletState !== 'connected' || !connectedAddress) {
      connectWallet();
      return;
    }
    setSendingPayment(true);
    setPaymentError(null);
    setPaymentResult(null);
    try {
      const senderInfo = await fetchBchAddressInfo(connectedAddress);
      if (senderInfo.utxos.length === 0) {
        throw new Error(`Connected address ${connectedAddress} has no spendable BCH mainnet UTXOs.`);
      }
      const plan = buildUnsignedBchTransaction({
        senderAddress: connectedAddress,
        utxos: senderInfo.utxos,
        outputs: [{ address: auditedBundle.payload.bchAddress, satoshis: satoshiAmount }],
      });
      const signedHex = await signTransactionWithWallet(
        plan,
        `Pay ${formatSatoshis(satoshiAmount)} to verified CashBind handle ${auditedBundle.payload.handle}`,
      );
      const res = await broadcastBchTransaction(signedHex);
      setPaymentResult({ ...res, feeSats: plan.feeSats });
    } catch (err) {
      setPaymentError(err instanceof Error ? err.message : 'WizardConnect payment failed.');
    } finally {
      setSendingPayment(false);
    }
  };

  const handlePayViaLocalWif = async () => {
    if (!auditedBundle || !verificationReport?.valid || !amountValid) return;
    setSendingPayment(true);
    setPaymentError(null);
    setPaymentResult(null);
    try {
      const sender = importBchWif(senderWif);
      const senderInfo = await fetchBchAddressInfo(sender.address);
      if (senderInfo.utxos.length === 0) {
        throw new Error(`Sender address ${sender.address} has 0 spendable UTXOs on BCH mainnet.`);
      }
      const signed = buildSignedBchTransaction({
        senderAddress: sender.address,
        senderPrivateKeyHex: sender.privateKeyHex,
        utxos: senderInfo.utxos,
        outputs: [{ address: auditedBundle.payload.bchAddress, satoshis: satoshiAmount }],
      });
      const res = await broadcastBchTransaction(signed.rawTxHex);
      setPaymentResult({ ...res, feeSats: signed.feeSats });
    } catch (err) {
      setPaymentError(err instanceof Error ? err.message : 'Mainnet payment failed.');
    } finally {
      setSendingPayment(false);
    }
  };

  const handleCopy = async (id: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch {
      // ignore
    }
  };

  return (
    <div className="mx-auto max-w-[1320px] px-4 py-8 sm:px-6 lg:px-8 lg:py-10 space-y-8">
      {/* Header + Resolver Input */}
      <div className="space-y-4">
        <div className="max-w-3xl">
          <h1 className="font-display text-3xl sm:text-[36px] font-bold leading-tight tracking-tight text-ink">
            Verify, Authenticate &amp; Pay
          </h1>
          <p className="mt-2 text-[15px] text-ink-secondary">
            Independently verify any Nostr <code className="crypto-token text-[13px] text-ink">npub</code>,
            BCH CashAddress, mainnet anchor txid, or CashBind JSON bundle, then run stateless
            challenge authentication or send a live BCH mainnet payment to the verified address.
          </p>
        </div>

        <form onSubmit={handleResolveSubmit} className="flex flex-col gap-2.5 sm:flex-row">
          <div className="relative flex-1 min-w-0">
            <MagnifyingGlass
              size={16}
              weight="regular"
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted"
              aria-hidden="true"
            />
            <input
              type="text"
              value={resolverInput}
              onChange={(e) => setResolverInput(e.target.value)}
              placeholder="Paste npub1…, bitcoincash:q…, 64-char binding hash, BCH txid, or CashBind JSON"
              aria-label="Resolve CashBind identity"
              spellCheck={false}
              className="w-full h-12 pl-10 pr-3.5 crypto-token text-xs sm:text-sm bg-surface border border-hairline rounded-[4px] text-ink focus:border-emerald-notary"
            />
          </div>
          <button
            type="submit"
            disabled={resolving}
            className="press-tactile inline-flex min-h-12 items-center justify-center gap-2 rounded-[4px] bg-emerald-notary px-5 text-sm font-semibold text-white hover:bg-emerald-notary-hover disabled:opacity-60 cursor-pointer whitespace-nowrap"
          >
            <ShieldCheck size={16} weight="regular" aria-hidden="true" />
            <span>{resolving ? 'Resolving…' : 'Resolve & Verify'}</span>
          </button>
        </form>

        {localBundles.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-ink-muted font-medium">Saved Identities:</span>
            {localBundles.slice(0, 5).map((item) => (
              <button
                key={item.bindingHash}
                type="button"
                onClick={() => selectBundle(item)}
                className={`press-tactile min-h-8 rounded-[4px] px-2.5 font-semibold cursor-pointer ${
                  bundle?.bindingHash === item.bindingHash
                    ? 'bg-ink text-white'
                    : 'border border-hairline bg-surface text-ink-secondary hover:text-ink'
                }`}
              >
                {item.payload.handle}
              </button>
            ))}
          </div>
        ) : null}

        {resolveError ? (
          <div
            role="alert"
            className="rounded-[4px] border border-status-invalid/30 bg-status-invalid-bg px-4 py-3 text-sm text-status-invalid"
          >
            {resolveError}
          </div>
        ) : null}
      </div>

      {!auditedBundle || !verificationReport ? (
        <div className="border border-hairline bg-surface rounded-[6px] px-6 py-12 text-center space-y-4">
          <h2 className="font-display text-lg font-semibold text-ink">
            Select or Resolve a CashBind Identity to Audit
          </h2>
          <p className="mx-auto max-w-lg text-sm text-ink-secondary">
            Enter a Nostr npub, BCH CashAddress, or anchor txid above, bind your own keys, or
            generate a live cryptographic test bundle right here to inspect all 5 verification
            checks.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/bind"
              className="press-tactile inline-flex min-h-11 items-center gap-2 rounded-[4px] bg-emerald-notary px-4 text-sm font-semibold text-white hover:bg-emerald-notary-hover"
            >
              <span>Create Binding</span>
            </Link>
            <button
              type="button"
              onClick={handleCreateDemoBundle}
              className="press-tactile inline-flex min-h-11 items-center gap-2 rounded-[4px] border border-hairline bg-surface px-4 text-sm font-semibold text-ink hover:border-hairline-strong cursor-pointer"
            >
              <span>Generate Live Test Bundle</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-start">
          {/* Left Column (7 cols): Independent Cryptographic & On-Chain Audit */}
          <section className="lg:col-span-7 space-y-5" aria-label="Cryptographic verification report">
            <NotarySeal
              status={verificationReport.valid ? 'verified' : 'invalid'}
              title={
                verificationReport.valid
                  ? `Verified Identity: ${auditedBundle.payload.handle}`
                  : `Tampered or Invalid Proof: ${auditedBundle.payload.handle}`
              }
              subtitle={
                verificationReport.valid
                  ? 'All 5 zero-trust cryptographic checks passed locally in your browser.'
                  : 'One or more cryptographic checks failed. Payments to this identity are blocked.'
              }
            />

            <div className="border border-hairline bg-surface rounded-[6px] overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline bg-subtle/60 px-4 py-3">
                <h2 className="font-display text-sm font-semibold text-ink">
                  Independent Verification Checks
                </h2>
                <button
                  type="button"
                  onClick={() => setTamperSimulated((prev) => !prev)}
                  className={`press-tactile min-h-8 rounded-[4px] px-3 text-xs font-semibold cursor-pointer ${
                    tamperSimulated
                      ? 'bg-status-invalid text-white'
                      : 'border border-hairline bg-surface text-ink hover:border-hairline-strong'
                  }`}
                >
                  {tamperSimulated ? 'Restore Original Proof' : 'Simulate 1-Byte Tamper'}
                </button>
              </div>

              <div className="divide-y divide-hairline">
                {(
                  [
                    ['1. Distinct BCH & Nostr Keys', verificationReport.checks.distinctKeys],
                    ['2. BCH Pubkey to CashAddress', verificationReport.checks.bchAddressMatch],
                    ['3. BCH ECDSA Signed Message', verificationReport.checks.bchSignature],
                    ['4. Nostr NIP-78 Schnorr Proof', verificationReport.checks.nostrSignature],
                    ['5. Canonical Digest & Tags', verificationReport.checks.payloadHashMatch],
                  ] as const
                ).map(([label, check]) => (
                  <div
                    key={label}
                    className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink">{label}</p>
                      <p className="text-xs text-ink-secondary">{check.detail}</p>
                    </div>
                    <span
                      className={`inline-flex items-center gap-1 text-xs font-semibold whitespace-nowrap shrink-0 ${
                        check.ok ? 'text-emerald-notary' : 'text-status-invalid'
                      }`}
                    >
                      {check.ok ? (
                        <>
                          <Check size={14} weight="bold" aria-hidden="true" />
                          <span>PASS</span>
                        </>
                      ) : (
                        <>
                          <ShieldWarning size={14} weight="bold" aria-hidden="true" />
                          <span>FAIL</span>
                        </>
                      )}
                    </span>
                  </div>
                ))}

                {/* Check 6: Live BCH Mainnet OP_RETURN Commitment */}
                <div className="px-4 py-4 space-y-3 bg-subtle/35">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-ink">
                      6. BCH Mainnet OP_RETURN On-Chain Anchor
                    </p>
                    <span
                      className={`text-xs font-semibold ${
                        txAudit?.matched
                          ? 'text-emerald-notary'
                          : txAudit?.error
                            ? 'text-status-invalid'
                            : 'text-status-pending'
                      }`}
                    >
                      {txAudit?.matched
                        ? 'ON-CHAIN MATCHED'
                        : checkingChain
                          ? 'Querying Fulcrum…'
                          : 'Optional / Unverified'}
                    </span>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      type="text"
                      value={txidInput}
                      onChange={(e) => setTxidInput(e.target.value)}
                      placeholder="Enter BCH mainnet anchor txid (64 hex chars)"
                      aria-label="BCH mainnet anchor transaction ID"
                      spellCheck={false}
                      className="min-w-0 flex-1 h-10 px-3 crypto-token text-xs bg-surface border border-hairline rounded-[4px] text-ink focus:border-emerald-notary"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (txidInput.trim()) {
                          void inspectOnChainTx(txidInput, auditedBundle.bindingHash);
                        }
                      }}
                      disabled={!txidInput.trim() || checkingChain}
                      className="press-tactile h-10 px-3.5 text-xs font-semibold rounded-[4px] bg-ink text-white hover:bg-ink/90 disabled:opacity-50 cursor-pointer whitespace-nowrap"
                    >
                      Audit Txid
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void handleScanAddressOnChain();
                      }}
                      disabled={checkingChain}
                      className="press-tactile h-10 px-3.5 text-xs font-semibold rounded-[4px] border border-hairline bg-surface text-ink hover:border-hairline-strong disabled:opacity-50 cursor-pointer whitespace-nowrap"
                    >
                      Scan Address History
                    </button>
                  </div>

                  {txAudit ? (
                    <div className="text-xs">
                      {txAudit.error ? (
                        <p className="text-status-invalid">{txAudit.error}</p>
                      ) : txAudit.matched && txAudit.txInfo ? (
                        <div className="rounded-[4px] border border-emerald-notary/30 bg-emerald-soft px-3 py-2 space-y-1">
                          <p className="font-semibold text-emerald-notary">
                            Matched OP_RETURN CASHBIND v1 digest on BCH mainnet (
                            {txAudit.txInfo.confirmations} confirmation
                            {txAudit.txInfo.confirmations === 1 ? '' : 's'}) via{' '}
                            {txAudit.txInfo.node}.
                          </p>
                          <a
                            href={txAudit.txInfo.explorerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 crypto-token text-ink underline underline-offset-4"
                          >
                            <span>View on Blockchair</span>
                            <ArrowSquareOut size={13} weight="regular" aria-hidden="true" />
                          </a>
                        </div>
                      ) : txAudit.scanned ? (
                        <p className="text-ink-secondary">
                          Scanned address history: found {txAudit.scanned.length} CashBind OP_RETURN
                          commitment{txAudit.scanned.length === 1 ? '' : 's'}.{' '}
                          {txAudit.matched
                            ? 'Matched this binding digest.'
                            : 'None matched this binding digest yet.'}
                        </p>
                      ) : (
                        <p className="text-status-invalid">
                          Transaction did not contain a matching CashBind OP_RETURN commitment for
                          this binding digest.
                        </p>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            {/* Bound Identifiers Summary + Copy JSON */}
            <div className="border border-hairline bg-surface rounded-[6px] p-4 space-y-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-display text-sm font-semibold text-ink">
                  Verified Identity Endpoints
                </h3>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void handleCopy('bundle-json', JSON.stringify(auditedBundle, null, 2))}
                    className="inline-flex items-center gap-1 font-semibold text-ink hover:text-emerald-notary cursor-pointer"
                  >
                    {copiedId === 'bundle-json' ? (
                      <>
                        <Check size={13} weight="bold" aria-hidden="true" />
                        <span>Copied JSON</span>
                      </>
                    ) : (
                      <>
                        <Copy size={13} weight="regular" aria-hidden="true" />
                        <span>Copy Bundle JSON</span>
                      </>
                    )}
                  </button>
                  <Link
                    to={`/vault?hash=${encodeURIComponent(auditedBundle.bindingHash)}`}
                    className="font-semibold text-emerald-notary hover:underline underline-offset-4"
                  >
                    View Attestations &amp; DID
                  </Link>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <div>
                  <span className="text-ink-muted">BCH Mainnet Address</span>
                  <code className="mt-1 block crypto-token text-ink bg-subtle/65 border border-hairline rounded-[4px] px-2.5 py-2">
                    {auditedBundle.payload.bchAddress}
                  </code>
                </div>
                <div>
                  <span className="text-ink-muted">Nostr npub</span>
                  <code className="mt-1 block crypto-token text-ink bg-subtle/65 border border-hairline rounded-[4px] px-2.5 py-2">
                    {formatNpub(auditedBundle.payload.nostrPubkey)}
                  </code>
                </div>
              </div>

              {auditedBundle.payload.merchantNote ? (
                <p className="text-ink-secondary pt-1">
                  <span className="font-semibold text-ink">Payment Note:</span>{' '}
                  {auditedBundle.payload.merchantNote}
                </p>
              ) : null}
            </div>
          </section>

          {/* Right Column (5 cols): Direct BCH Payment + Stateless Auth */}
          <div className="lg:col-span-5 space-y-6">
            {/* Panel 1: Pay Verified BCH Identity (Mainnet) */}
            <section
              aria-label="Pay verified BCH identity on mainnet"
              className="border border-hairline bg-surface rounded-[6px] p-5 space-y-4"
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-lg font-semibold text-ink">
                  Pay Verified BCH Identity
                </h2>
                <CurrencyBtc size={20} weight="regular" className="text-emerald-notary" aria-hidden="true" />
              </div>

              {!verificationReport.valid ? (
                <div
                  role="alert"
                  className="rounded-[4px] border border-status-invalid/30 bg-status-invalid-bg px-3.5 py-3 text-xs font-semibold text-status-invalid"
                >
                  Payment execution is locked because this identity failed cryptographic
                  verification. Restore a valid proof before sending mainnet BCH.
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <label htmlFor="pay-sats" className="block text-xs font-semibold text-ink">
                      Amount in Satoshis (min {DUST_LIMIT_SATS} sats dust limit)
                    </label>
                    <input
                      id="pay-sats"
                      type="number"
                      min={DUST_LIMIT_SATS}
                      step={100}
                      value={paySats}
                      onChange={(e) => setPaySats(e.target.value)}
                      className="w-full h-11 px-3 crypto-token text-sm bg-surface border border-hairline rounded-[4px] text-ink focus:border-emerald-notary"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="crypto-token text-ink-secondary">
                        {amountValid ? formatSatsToBch(satoshiAmount) : `Enter at least ${DUST_LIMIT_SATS} sats`}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {[1000, 5000, 10000].map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => setPaySats(String(preset))}
                            className="rounded-[4px] border border-hairline bg-subtle px-2 py-0.5 text-[11px] font-semibold text-ink-secondary hover:text-ink cursor-pointer"
                          >
                            {preset.toLocaleString()}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Shareable BIP-21 Payment URI */}
                  <div className="text-xs">
                    <div className="flex items-center justify-between text-ink-muted">
                      <span>BIP-21 Payment URI</span>
                      <button
                        type="button"
                        onClick={() => void handleCopy('bip21', bip21Uri)}
                        className="inline-flex items-center gap-1 font-semibold text-ink hover:text-emerald-notary cursor-pointer"
                      >
                        {copiedId === 'bip21' ? 'Copied' : 'Copy URI'}
                      </button>
                    </div>
                    <code className="mt-1 block crypto-token text-[11px] text-ink-secondary bg-subtle/65 border border-hairline rounded-[4px] px-2.5 py-2">
                      {bip21Uri}
                    </code>
                  </div>

                  <div className="space-y-2.5 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        void handlePayViaWizardConnect();
                      }}
                      disabled={sendingPayment || !amountValid}
                      className="press-tactile w-full inline-flex min-h-11 items-center justify-center gap-2 rounded-[4px] bg-emerald-notary px-4 text-sm font-semibold text-white hover:bg-emerald-notary-hover disabled:opacity-50 cursor-pointer"
                    >
                      <Wallet size={16} weight="regular" aria-hidden="true" />
                      <span>
                        {walletState === 'connected'
                          ? sendingPayment
                            ? 'Signing & Broadcasting…'
                            : `Send ${amountValid ? formatSatoshis(satoshiAmount) : ''} via WizardConnect`
                          : 'Connect WizardConnect to Pay'}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowLocalSender((prev) => !prev)}
                      aria-expanded={showLocalSender}
                      className="w-full text-center text-xs font-semibold text-ink-secondary hover:text-ink underline underline-offset-4 cursor-pointer py-1"
                    >
                      {showLocalSender
                        ? 'Hide Local BCH WIF Payment Option'
                        : 'Or sign & broadcast with a local BCH WIF key'}
                    </button>

                    {showLocalSender ? (
                      <div className="space-y-2 border-t border-hairline pt-3">
                        <label htmlFor="sender-wif" className="block text-xs font-medium text-ink-secondary">
                          Sender BCH Mainnet WIF (signed locally in browser)
                        </label>
                        <input
                          id="sender-wif"
                          type="password"
                          value={senderWif}
                          onChange={(e) => setSenderWif(e.target.value)}
                          placeholder="K… or L…"
                          spellCheck={false}
                          className="w-full h-10 px-3 crypto-token text-xs bg-surface border border-hairline rounded-[4px] text-ink focus:border-emerald-notary"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            void handlePayViaLocalWif();
                          }}
                          disabled={sendingPayment || !senderWif.trim() || !amountValid}
                          className="press-tactile w-full inline-flex min-h-10 items-center justify-center gap-2 rounded-[4px] border border-hairline bg-surface px-4 text-xs font-semibold text-ink hover:border-hairline-strong disabled:opacity-50 cursor-pointer"
                        >
                          <PaperPlaneTilt size={14} weight="regular" aria-hidden="true" />
                          <span>Sign &amp; Broadcast Mainnet Payment</span>
                        </button>
                      </div>
                    ) : null}
                  </div>

                  {paymentError ? (
                    <div
                      role="alert"
                      className="rounded-[4px] border border-status-invalid/30 bg-status-invalid-bg px-3 py-2.5 text-xs text-status-invalid"
                    >
                      {paymentError}
                    </div>
                  ) : null}

                  {paymentResult ? (
                    <div className="rounded-[4px] border border-emerald-notary/30 bg-emerald-soft px-3.5 py-3 text-xs space-y-1">
                      <p className="font-semibold text-emerald-notary">
                        Mainnet Payment Broadcast ({formatSatoshis(paymentResult.feeSats)} miner fee)
                      </p>
                      <a
                        href={paymentResult.explorerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 crypto-token text-ink underline underline-offset-4"
                      >
                        <span>{paymentResult.txid}</span>
                        <ArrowSquareOut size={13} weight="regular" aria-hidden="true" />
                      </a>
                    </div>
                  ) : null}
                </>
              )}
            </section>

            {/* Panel 2: Stateless Challenge-Response Authentication */}
            <section
              aria-label="Stateless challenge-response authentication"
              className="border border-hairline bg-surface rounded-[6px] p-5 space-y-4"
            >
              <div>
                <h2 className="font-display text-lg font-semibold text-ink">
                  Stateless Challenge Authentication
                </h2>
                <p className="mt-1 text-xs text-ink-secondary">
                  Prove live control of either the bound Nostr key (NIP-42) or bound BCH key
                  (Bitcoin Signed Message) against a one-time expiring nonce.
                </p>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={authDomain}
                  onChange={(e) => setAuthDomain(e.target.value)}
                  aria-label="Authentication domain"
                  placeholder="cashbind.app"
                  className="min-w-0 flex-1 h-10 px-3 text-xs bg-surface border border-hairline rounded-[4px] text-ink focus:border-emerald-notary"
                />
                <button
                  type="button"
                  onClick={handleGenerateChallenge}
                  className="press-tactile h-10 px-3.5 rounded-[4px] bg-ink text-xs font-semibold text-white hover:bg-ink/90 cursor-pointer whitespace-nowrap"
                >
                  Generate Challenge
                </button>
              </div>

              {challenge ? (
                <div className="space-y-3 border-t border-hairline pt-3">
                  <div>
                    <div className="flex items-center justify-between text-xs text-ink-muted">
                      <span>Active Challenge (TTL 5 min)</span>
                      <button
                        type="button"
                        onClick={() => void handleCopy('auth-msg', challenge.message)}
                        className="font-semibold text-ink hover:text-emerald-notary cursor-pointer"
                      >
                        {copiedId === 'auth-msg' ? 'Copied' : 'Copy Message'}
                      </button>
                    </div>
                    <pre className="mt-1 overflow-x-auto crypto-token text-[11px] leading-relaxed text-ink bg-subtle/70 border border-hairline rounded-[4px] p-2.5">
                      {challenge.message}
                    </pre>
                  </div>

                  <div className="inline-flex rounded-[4px] border border-hairline bg-subtle p-0.5">
                    <button
                      type="button"
                      onClick={() => setAuthMethod('nostr')}
                      aria-pressed={authMethod === 'nostr'}
                      className={`px-2.5 py-1 text-xs font-semibold rounded-[3px] cursor-pointer ${
                        authMethod === 'nostr' ? 'bg-surface text-ink' : 'text-ink-secondary'
                      }`}
                    >
                      Nostr NIP-42 Auth
                    </button>
                    <button
                      type="button"
                      onClick={() => setAuthMethod('bch')}
                      aria-pressed={authMethod === 'bch'}
                      className={`px-2.5 py-1 text-xs font-semibold rounded-[3px] cursor-pointer ${
                        authMethod === 'bch' ? 'bg-surface text-ink' : 'text-ink-secondary'
                      }`}
                    >
                      BCH Signed Message
                    </button>
                  </div>

                  {authMethod === 'nostr' ? (
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={() => {
                          void handleSignChallengeNip07();
                        }}
                        className="press-tactile w-full min-h-10 rounded-[4px] border border-hairline bg-surface px-3 text-xs font-semibold text-ink hover:border-hairline-strong cursor-pointer"
                      >
                        Sign Challenge with NIP-07 Extension
                      </button>
                      <div className="flex gap-2">
                        <input
                          type="password"
                          value={authSecretInput}
                          onChange={(e) => setAuthSecretInput(e.target.value)}
                          placeholder="Or sign locally with bound nsec1…"
                          aria-label="Bound Nostr nsec for challenge signing"
                          spellCheck={false}
                          className="min-w-0 flex-1 h-10 px-3 crypto-token text-xs bg-surface border border-hairline rounded-[4px] text-ink"
                        />
                        <button
                          type="button"
                          onClick={handleSignChallengeLocal}
                          disabled={!authSecretInput.trim()}
                          className="press-tactile h-10 px-3 rounded-[4px] bg-emerald-notary text-xs font-semibold text-white disabled:opacity-50 cursor-pointer whitespace-nowrap"
                        >
                          Sign &amp; Verify
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={authSignatureInput}
                          onChange={(e) => setAuthSignatureInput(e.target.value)}
                          placeholder="Paste base64 BCH signature from wallet"
                          aria-label="BCH challenge signature"
                          spellCheck={false}
                          className="min-w-0 flex-1 h-10 px-3 crypto-token text-xs bg-surface border border-hairline rounded-[4px] text-ink"
                        />
                        <button
                          type="button"
                          onClick={handleVerifyExternalBchChallengeSig}
                          disabled={!authSignatureInput.trim()}
                          className="press-tactile h-10 px-3 rounded-[4px] bg-emerald-notary text-xs font-semibold text-white disabled:opacity-50 cursor-pointer whitespace-nowrap"
                        >
                          Verify Sig
                        </button>
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="password"
                          value={authSecretInput}
                          onChange={(e) => setAuthSecretInput(e.target.value)}
                          placeholder="Or sign locally with bound BCH WIF"
                          aria-label="Bound BCH WIF for challenge signing"
                          spellCheck={false}
                          className="min-w-0 flex-1 h-10 px-3 crypto-token text-xs bg-surface border border-hairline rounded-[4px] text-ink"
                        />
                        <button
                          type="button"
                          onClick={handleSignChallengeLocal}
                          disabled={!authSecretInput.trim()}
                          className="press-tactile h-10 px-3 rounded-[4px] border border-hairline bg-surface text-xs font-semibold text-ink disabled:opacity-50 cursor-pointer whitespace-nowrap"
                        >
                          <Key size={13} weight="regular" className="inline mr-1" aria-hidden="true" />
                          <span>Sign &amp; Verify</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {authVerdict ? (
                    <div
                      role="status"
                      className={`rounded-[4px] px-3.5 py-2.5 text-xs font-semibold ${
                        authVerdict.valid
                          ? 'border border-emerald-notary/30 bg-emerald-soft text-emerald-notary'
                          : 'border border-status-invalid/30 bg-status-invalid-bg text-status-invalid'
                      }`}
                    >
                      {authVerdict.valid ? 'Session Verified: ' : 'Auth Rejected: '}
                      {authVerdict.reason}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
