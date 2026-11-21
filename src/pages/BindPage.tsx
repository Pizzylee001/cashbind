import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  ArrowSquareOut,
  ArrowsClockwise,
  Broadcast,
  Check,
  Copy,
  Eye,
  EyeSlash,
  Key,
  LinkSimple,
  ShieldWarning,
  Wallet,
} from '@phosphor-icons/react';
import { binToHex } from '@bitauth/libauth';
import type { Event as NostrEvent, EventTemplate } from 'nostr-tools';
import { NotarySeal, type SealStatus } from '../components/NotarySeal';
import {
  broadcastBchTransaction,
  fetchBchAddressInfo,
  formatSatoshis,
  formatSatsToBch,
  type BchAddressInfo,
} from '../lib/bchApi';
import { buildSignedBchTransaction, buildUnsignedBchTransaction } from '../lib/bchTx';
import { publishEventToRelays, type RelayPublishOutcome } from '../lib/nostrNetwork';
import {
  areKeysDistinct,
  buildNostrBindingTemplate,
  canonicalizeBindingPayload,
  CASHBIND_DOMAIN,
  computeBindingHash,
  createBindingBundleFromExternalSignatures,
  createSignedBindingBundle,
  DEFAULT_NOSTR_RELAYS,
  encodeCashBindOpReturn,
  formatNpub,
  generateBchIdentity,
  generateNostrIdentity,
  importBchWif,
  importNostrNsec,
  normalizeCashAddress,
  signBchMessage,
  verifyBindingBundle,
  type BchIdentity,
  type CashBindBundle,
  type CashBindPayload,
  type NostrIdentity,
} from '../lib/protocol';
import { loadLocalBundles, saveLocalBundle, updateLocalBundleAnchor } from '../lib/storage';
import { useWizardWallet } from '../lib/wizardConnect';

type BchKeyMode = 'local' | 'external';
type NostrKeyMode = 'local' | 'nip07';

interface WindowWithNostr extends Window {
  nostr?: {
    getPublicKey: () => Promise<string>;
    signEvent: (event: EventTemplate) => Promise<NostrEvent>;
  };
}

export function BindPage() {
  const [searchParams] = useSearchParams();
  const {
    state: walletState,
    walletName,
    connectedAddress,
    connectedPubkeyHex,
    connect: connectWallet,
    signTransactionWithWallet,
  } = useWizardWallet();

  // BCH key state
  const [bchMode, setBchMode] = useState<BchKeyMode>('local');
  const [bchIdentity, setBchIdentity] = useState<BchIdentity>(() => generateBchIdentity());
  const [wifInput, setWifInput] = useState('');
  const [showWif, setShowWif] = useState(false);
  const [bchError, setBchError] = useState<string | null>(null);

  // External BCH wallet manual signature state (Paytaca / Electron Cash)
  const [extBchAddress, setExtBchAddress] = useState('');
  const [extBchPubkey, setExtBchPubkey] = useState('');
  const [extBchSignature, setExtBchSignature] = useState('');

  // Nostr key state
  const [nostrMode, setNostrMode] = useState<NostrKeyMode>('local');
  const [nostrIdentity, setNostrIdentity] = useState<NostrIdentity>(() => generateNostrIdentity());
  const [nsecInput, setNsecInput] = useState('');
  const [showNsec, setShowNsec] = useState(false);
  const [nostrError, setNostrError] = useState<string | null>(null);
  const [nip07Pubkey, setNip07Pubkey] = useState<string | null>(null);

  // Identity & rotation fields
  const [handle, setHandle] = useState('');
  const [merchantNote, setMerchantNote] = useState('');
  const [showRotation, setShowRotation] = useState(() => Boolean(searchParams.get('rotate')));
  const [prevBindingHash, setPrevBindingHash] = useState(() => searchParams.get('rotate') || '');
  const [prevTxid, setPrevTxid] = useState('');
  const [savedBundles, setSavedBundles] = useState<CashBindBundle[]>(() => loadLocalBundles());

  // Cross-sign & post-sign state
  const [activeBundle, setActiveBundle] = useState<CashBindBundle | null>(null);
  const [signError, setSignError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [reuseTestMessage, setReuseTestMessage] = useState<string | null>(null);

  // Nostr relay publish state
  const [publishingRelays, setPublishingRelays] = useState(false);
  const [relayOutcomes, setRelayOutcomes] = useState<RelayPublishOutcome[] | null>(null);

  // BCH mainnet UTXO & anchor broadcast state
  const [bchAddressInfo, setBchAddressInfo] = useState<BchAddressInfo | null>(null);
  const [loadingUtxos, setLoadingUtxos] = useState(false);
  const [utxoError, setUtxoError] = useState<string | null>(null);
  const [anchoring, setAnchoring] = useState(false);
  const [anchorResult, setAnchorResult] = useState<{
    txid: string;
    node: string;
    explorerUrl: string;
  } | null>(null);
  const [anchorError, setAnchorError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    if (connectedAddress && connectedPubkeyHex && bchMode === 'external' && !extBchAddress) {
      setExtBchAddress(connectedAddress);
      setExtBchPubkey(connectedPubkeyHex);
    }
  }, [connectedAddress, connectedPubkeyHex, bchMode, extBchAddress]);

  const activeBchAddress = bchMode === 'local' ? bchIdentity.address : extBchAddress.trim();
  const activeBchPubkey = bchMode === 'local' ? bchIdentity.publicKeyHex : extBchPubkey.trim();
  const activeNostrPubkey = nostrMode === 'local' ? nostrIdentity.publicKeyHex : nip07Pubkey || '';

  const keysDistinct = useMemo(() => {
    if (!activeBchPubkey || !activeNostrPubkey) return true;
    return areKeysDistinct(activeBchPubkey, activeNostrPubkey);
  }, [activeBchPubkey, activeNostrPubkey]);

  // Deterministic preview payload for External Wallet Signature mode
  const [draftIssuedAt] = useState(() => Math.floor(Date.now() / 1000));
  const externalCanonicalPreview = useMemo(() => {
    if (bchMode !== 'external' || !activeBchAddress || !activeBchPubkey || !activeNostrPubkey) {
      return null;
    }
    try {
      const payload: CashBindPayload = {
        version: 1,
        domain: CASHBIND_DOMAIN,
        nostrPubkey: activeNostrPubkey.toLowerCase(),
        bchAddress: normalizeCashAddress(activeBchAddress),
        bchPubkey: activeBchPubkey.toLowerCase(),
        handle: handle.trim() || 'merchant.bch',
        issuedAt: draftIssuedAt,
        ...(merchantNote.trim() ? { merchantNote: merchantNote.trim() } : {}),
        ...(prevBindingHash.trim() ? { prevBindingHash: prevBindingHash.trim().toLowerCase() } : {}),
        ...(prevTxid.trim() ? { prevTxid: prevTxid.trim().toLowerCase() } : {}),
      };
      return canonicalizeBindingPayload(payload);
    } catch {
      return null;
    }
  }, [
    bchMode,
    activeBchAddress,
    activeBchPubkey,
    activeNostrPubkey,
    handle,
    merchantNote,
    prevBindingHash,
    prevTxid,
    draftIssuedAt,
  ]);

  const handleCopy = async (id: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(id);
      setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  const handleImportWif = () => {
    setBchError(null);
    try {
      const imported = importBchWif(wifInput);
      setBchIdentity(imported);
      setWifInput('');
      setBchAddressInfo(null);
    } catch (err) {
      setBchError(err instanceof Error ? err.message : 'Invalid BCH WIF key.');
    }
  };

  const handleImportNsec = () => {
    setNostrError(null);
    try {
      const imported = importNostrNsec(nsecInput);
      setNostrIdentity(imported);
      setNsecInput('');
    } catch (err) {
      setNostrError(err instanceof Error ? err.message : 'Invalid Nostr nsec key.');
    }
  };

  const handleConnectNip07 = async () => {
    setNostrError(null);
    const nostrExt = (window as WindowWithNostr).nostr;
    if (!nostrExt) {
      setNostrError(
        'No NIP-07 browser extension (such as Alby or nos2x) was detected in this browser.',
      );
      return;
    }
    try {
      const pubkey = await nostrExt.getPublicKey();
      setNip07Pubkey(pubkey);
    } catch (err) {
      setNostrError(err instanceof Error ? err.message : 'NIP-07 extension rejected pubkey request.');
    }
  };

  const handleFetchUtxos = useCallback(async (addressToCheck: string) => {
    if (!addressToCheck) return;
    setLoadingUtxos(true);
    setUtxoError(null);
    try {
      const info = await fetchBchAddressInfo(addressToCheck);
      setBchAddressInfo(info);
    } catch (err) {
      setUtxoError(err instanceof Error ? err.message : 'Failed to fetch mainnet UTXOs.');
    } finally {
      setLoadingUtxos(false);
    }
  }, []);

  const handleTestKeyReuse = () => {
    try {
      createSignedBindingBundle({
        bchPrivateKeyHex: bchIdentity.privateKeyHex,
        nostrPrivateKeyHex: bchIdentity.privateKeyHex,
        handle: 'reuse-check.bch',
      });
      setReuseTestMessage('Unexpected: key reuse was not rejected.');
    } catch (err) {
      setReuseTestMessage(
        err instanceof Error
          ? `Protocol enforced: ${err.message}`
          : 'Protocol rejected reused keys.',
      );
    }
  };

  const handleCrossSign = async (event: FormEvent) => {
    event.preventDefault();
    setSignError(null);
    setRelayOutcomes(null);
    setAnchorResult(null);
    setAnchorError(null);
    setSigning(true);

    try {
      const cleanHandle = handle.trim() || `cashbind-${bchIdentity.address.slice(-5)}.bch`;

      if (bchMode === 'local' && nostrMode === 'local') {
        const bundle = createSignedBindingBundle({
          bchPrivateKeyHex: bchIdentity.privateKeyHex,
          nostrPrivateKeyHex: nostrIdentity.privateKeyHex,
          handle: cleanHandle,
          merchantNote: merchantNote.trim() || undefined,
          prevBindingHash: prevBindingHash.trim() || undefined,
          prevTxid: prevTxid.trim() || undefined,
        });
        const report = verifyBindingBundle(bundle);
        if (!report.valid) {
          throw new Error('Generated binding failed self-verification.');
        }
        setActiveBundle(bundle);
        setSavedBundles(saveLocalBundle(bundle));
      } else {
        if (!activeBchAddress || !activeBchPubkey) {
          throw new Error('Provide both the BCH CashAddress and compressed public key hex.');
        }
        if (!activeNostrPubkey) {
          throw new Error('Connect a NIP-07 Nostr extension or select a local Nostr key first.');
        }
        if (!areKeysDistinct(activeBchPubkey, activeNostrPubkey)) {
          throw new Error(
            'BCH and Nostr identities must use distinct cryptographic keys. Key reuse is prohibited.',
          );
        }

        const payload: CashBindPayload = {
          version: 1,
          domain: CASHBIND_DOMAIN,
          nostrPubkey: activeNostrPubkey.toLowerCase(),
          bchAddress: normalizeCashAddress(activeBchAddress),
          bchPubkey: activeBchPubkey.toLowerCase(),
          handle: cleanHandle,
          issuedAt: bchMode === 'external' ? draftIssuedAt : Math.floor(Date.now() / 1000),
          ...(merchantNote.trim() ? { merchantNote: merchantNote.trim() } : {}),
          ...(prevBindingHash.trim()
            ? { prevBindingHash: prevBindingHash.trim().toLowerCase() }
            : {}),
          ...(prevTxid.trim() ? { prevTxid: prevTxid.trim().toLowerCase() } : {}),
        };
        const canonicalPayload = canonicalizeBindingPayload(payload);
        const bindingHash = computeBindingHash(canonicalPayload);

        let bchSignature: string;
        if (bchMode === 'local') {
          bchSignature = signBchMessage(canonicalPayload, bchIdentity.privateKeyHex);
        } else {
          if (!extBchSignature.trim()) {
            throw new Error(
              'Paste the base64 Bitcoin Signed Message signature from Paytaca or Electron Cash.',
            );
          }
          bchSignature = extBchSignature.trim();
        }

        const template = buildNostrBindingTemplate({
          payload,
          canonicalPayload,
          bindingHash,
          bchSignature,
        });

        let signedNostrEvent: NostrEvent;
        if (nostrMode === 'nip07') {
          const nostrExt = (window as WindowWithNostr).nostr;
          if (!nostrExt) {
            throw new Error('NIP-07 extension is unavailable.');
          }
          signedNostrEvent = await nostrExt.signEvent(template);
        } else {
          const { finalizeEvent } = await import('nostr-tools');
          const { hexToBin } = await import('@bitauth/libauth');
          signedNostrEvent = finalizeEvent(template, hexToBin(nostrIdentity.privateKeyHex));
        }

        const bundle = createBindingBundleFromExternalSignatures({
          payload,
          bchSignature,
          nostrEvent: signedNostrEvent,
        });
        const report = verifyBindingBundle(bundle);
        if (!report.valid) {
          const failedCheck = Object.values(report.checks).find((c) => !c.ok);
          throw new Error(failedCheck?.detail || 'Cross-signed proof failed verification.');
        }
        setActiveBundle(bundle);
        setSavedBundles(saveLocalBundle(bundle));
      }
    } catch (err) {
      setSignError(err instanceof Error ? err.message : 'Unable to create cross-signed binding.');
    } finally {
      setSigning(false);
    }
  };

  const handlePublishRelays = async () => {
    if (!activeBundle) return;
    setPublishingRelays(true);
    try {
      let eventToPublish = activeBundle.nostrEvent;
      if (activeBundle.anchorTxid && nostrMode === 'local') {
        const { finalizeEvent } = await import('nostr-tools');
        const { hexToBin } = await import('@bitauth/libauth');
        const updatedTemplate = buildNostrBindingTemplate({
          payload: activeBundle.payload,
          canonicalPayload: activeBundle.canonicalPayload,
          bindingHash: activeBundle.bindingHash,
          bchSignature: activeBundle.bchSignature,
          anchorTxid: activeBundle.anchorTxid,
        });
        eventToPublish = finalizeEvent(updatedTemplate, hexToBin(nostrIdentity.privateKeyHex));
        const refreshedBundle: CashBindBundle = { ...activeBundle, nostrEvent: eventToPublish };
        setActiveBundle(refreshedBundle);
        setSavedBundles(saveLocalBundle(refreshedBundle));
      }
      const outcomes = await publishEventToRelays(eventToPublish, [...DEFAULT_NOSTR_RELAYS]);
      setRelayOutcomes(outcomes);
    } finally {
      setPublishingRelays(false);
    }
  };

  const opReturnHex = useMemo(() => {
    if (!activeBundle) return null;
    return binToHex(encodeCashBindOpReturn(activeBundle.bindingHash));
  }, [activeBundle]);

  const handleAnchorWithLocalKey = async () => {
    if (!activeBundle || !opReturnHex) return;
    setAnchoring(true);
    setAnchorError(null);
    try {
      const addrInfo = await fetchBchAddressInfo(bchIdentity.address);
      setBchAddressInfo(addrInfo);
      if (addrInfo.utxos.length === 0) {
        throw new Error(
          `Fund ${bchIdentity.address} with at least 1,000 sats on BCH mainnet to broadcast the OP_RETURN anchor.`,
        );
      }
      const signed = buildSignedBchTransaction({
        senderAddress: bchIdentity.address,
        senderPrivateKeyHex: bchIdentity.privateKeyHex,
        utxos: addrInfo.utxos,
        outputs: [],
        opReturnScriptHex: opReturnHex,
      });
      const broadcast = await broadcastBchTransaction(signed.rawTxHex);
      setAnchorResult(broadcast);
      const updated = updateLocalBundleAnchor(activeBundle.bindingHash, broadcast.txid);
      setSavedBundles(updated);
      setActiveBundle({ ...activeBundle, anchorTxid: broadcast.txid });
    } catch (err) {
      setAnchorError(err instanceof Error ? err.message : 'Mainnet anchor broadcast failed.');
    } finally {
      setAnchoring(false);
    }
  };

  const handleAnchorWithWizardConnect = async () => {
    if (!activeBundle || !opReturnHex) return;
    if (walletState !== 'connected' || !connectedAddress) {
      connectWallet();
      return;
    }
    setAnchoring(true);
    setAnchorError(null);
    try {
      const addrInfo = await fetchBchAddressInfo(connectedAddress);
      setBchAddressInfo(addrInfo);
      if (addrInfo.utxos.length === 0) {
        throw new Error(
          `Connected WizardConnect address ${connectedAddress} has no spendable UTXOs on BCH mainnet.`,
        );
      }
      const plan = buildUnsignedBchTransaction({
        senderAddress: connectedAddress,
        utxos: addrInfo.utxos,
        outputs: [],
        opReturnScriptHex: opReturnHex,
      });
      const signedHex = await signTransactionWithWallet(
        plan,
        `Anchor CashBind commitment ${activeBundle.bindingHash.slice(0, 12)}… on BCH mainnet`,
      );
      const broadcast = await broadcastBchTransaction(signedHex);
      setAnchorResult(broadcast);
      const updated = updateLocalBundleAnchor(activeBundle.bindingHash, broadcast.txid);
      setSavedBundles(updated);
      setActiveBundle({ ...activeBundle, anchorTxid: broadcast.txid });
    } catch (err) {
      setAnchorError(err instanceof Error ? err.message : 'WizardConnect anchor broadcast failed.');
    } finally {
      setAnchoring(false);
    }
  };

  const sealStatus: SealStatus = activeBundle ? 'verified' : signError ? 'invalid' : 'idle';

  return (
    <div className="mx-auto max-w-[1320px] px-4 py-8 sm:px-6 lg:px-8 lg:py-10 space-y-8">
      {/* Page Heading */}
      <div className="max-w-3xl">
        <h1 className="font-display text-3xl sm:text-[36px] font-bold leading-tight tracking-tight text-ink">
          Bind and Anchor Identity
        </h1>
        <p className="mt-2 text-[15px] text-ink-secondary">
          Cross-sign a canonical binding statement with a Bitcoin Cash mainnet key and a separate
          Nostr key, publish the proof to public Nostr relays, and anchor the 32-byte SHA-256
          commitment on BCH mainnet via <code className="crypto-token text-[13px] text-ink">OP_RETURN</code>.
        </p>
      </div>

      {/* Dual-Key Diptych */}
      <section
        aria-label="Dual cryptographic key configuration"
        className="grid grid-cols-1 lg:grid-cols-2 border border-hairline bg-surface rounded-[6px] divide-y lg:divide-y-0 lg:divide-x divide-hairline"
      >
        {/* Left Pane: Bitcoin Cash Mainnet Key */}
        <div className="p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-lg font-semibold text-ink">
              1. Bitcoin Cash Mainnet Key
            </h2>
            <div className="inline-flex rounded-[4px] border border-hairline bg-subtle p-0.5">
              <button
                type="button"
                onClick={() => setBchMode('local')}
                aria-pressed={bchMode === 'local'}
                className={`px-2.5 py-1 text-xs font-semibold rounded-[3px] cursor-pointer ${
                  bchMode === 'local' ? 'bg-surface text-ink' : 'text-ink-secondary hover:text-ink'
                }`}
              >
                Local Key / WIF
              </button>
              <button
                type="button"
                onClick={() => setBchMode('external')}
                aria-pressed={bchMode === 'external'}
                className={`px-2.5 py-1 text-xs font-semibold rounded-[3px] cursor-pointer ${
                  bchMode === 'external' ? 'bg-surface text-ink' : 'text-ink-secondary hover:text-ink'
                }`}
              >
                External Wallet Sig
              </button>
            </div>
          </div>

          {walletState === 'connected' && connectedAddress ? (
            <div className="rounded-[4px] border border-emerald-notary/30 bg-emerald-soft/60 px-3.5 py-2.5 text-xs text-ink flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="font-semibold text-emerald-notary">
                  WizardConnect Connected ({walletName || 'BCH Wallet'}):
                </span>{' '}
                <code className="crypto-token text-ink">{connectedAddress}</code>
              </div>
              <button
                type="button"
                onClick={() => {
                  setBchMode('external');
                  setExtBchAddress(connectedAddress);
                  if (connectedPubkeyHex) setExtBchPubkey(connectedPubkeyHex);
                }}
                className="font-semibold text-emerald-notary underline underline-offset-4 cursor-pointer whitespace-nowrap"
              >
                Use Connected Address
              </button>
            </div>
          ) : null}

          {bchMode === 'local' ? (
            <div className="space-y-3.5">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setBchIdentity(generateBchIdentity());
                    setBchAddressInfo(null);
                    setBchError(null);
                  }}
                  className="press-tactile inline-flex min-h-10 items-center gap-1.5 rounded-[4px] border border-hairline bg-surface px-3 text-xs font-semibold text-ink hover:border-hairline-strong cursor-pointer"
                >
                  <Key size={14} weight="regular" aria-hidden="true" />
                  <span>Generate Fresh BCH Key</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleFetchUtxos(bchIdentity.address);
                  }}
                  disabled={loadingUtxos}
                  className="press-tactile inline-flex min-h-10 items-center gap-1.5 rounded-[4px] border border-hairline bg-subtle/70 px-3 text-xs font-semibold text-ink hover:border-hairline-strong disabled:opacity-60 cursor-pointer"
                >
                  <ArrowsClockwise
                    size={14}
                    weight="regular"
                    className={loadingUtxos ? 'animate-spin' : ''}
                    aria-hidden="true"
                  />
                  <span>Check Mainnet UTXOs</span>
                </button>
              </div>

              <div>
                <div className="flex items-center justify-between text-xs font-medium text-ink-muted">
                  <span>BCH Mainnet CashAddress</span>
                  <button
                    type="button"
                    onClick={() => void handleCopy('bch-addr', bchIdentity.address)}
                    className="inline-flex items-center gap-1 text-ink hover:text-emerald-notary cursor-pointer"
                  >
                    {copiedKey === 'bch-addr' ? (
                      <>
                        <Check size={13} weight="bold" aria-hidden="true" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy size={13} weight="regular" aria-hidden="true" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
                <code
                  className="mt-1 block crypto-token text-xs text-ink bg-subtle/70 border border-hairline rounded-[4px] px-3 py-2"
                  translate="no"
                >
                  {bchIdentity.address}
                </code>
              </div>

              <div>
                <span className="block text-xs font-medium text-ink-muted">
                  Compressed secp256k1 Public Key (33 bytes)
                </span>
                <code
                  className="mt-1 block crypto-token text-[11px] text-ink-secondary bg-subtle/50 border border-hairline rounded-[4px] px-3 py-2"
                  translate="no"
                >
                  {bchIdentity.publicKeyHex}
                </code>
              </div>

              <div>
                <div className="flex items-center justify-between text-xs font-medium text-ink-muted">
                  <span>Private Key WIF (stays in browser memory only)</span>
                  <button
                    type="button"
                    onClick={() => setShowWif((prev) => !prev)}
                    className="inline-flex items-center gap-1 text-ink hover:text-emerald-notary cursor-pointer"
                  >
                    {showWif ? (
                      <>
                        <EyeSlash size={13} weight="regular" aria-hidden="true" />
                        <span>Hide</span>
                      </>
                    ) : (
                      <>
                        <Eye size={13} weight="regular" aria-hidden="true" />
                        <span>Reveal</span>
                      </>
                    )}
                  </button>
                </div>
                <input
                  type={showWif ? 'text' : 'password'}
                  readOnly
                  value={bchIdentity.wif}
                  aria-label="Current BCH WIF private key"
                  className="mt-1 w-full h-10 px-3 crypto-token text-xs text-ink bg-subtle/50 border border-hairline rounded-[4px]"
                />
              </div>

              <div className="pt-1 border-t border-hairline">
                <label htmlFor="import-wif" className="block text-xs font-medium text-ink-secondary">
                  Or import an existing BCH mainnet WIF key
                </label>
                <div className="mt-1.5 flex gap-2">
                  <input
                    id="import-wif"
                    type="password"
                    value={wifInput}
                    onChange={(e) => setWifInput(e.target.value)}
                    placeholder="K… or L… (compressed mainnet WIF)"
                    spellCheck={false}
                    className="min-w-0 flex-1 h-10 px-3 crypto-token text-xs bg-surface border border-hairline rounded-[4px] text-ink focus:border-emerald-notary"
                  />
                  <button
                    type="button"
                    onClick={handleImportWif}
                    disabled={!wifInput.trim()}
                    className="press-tactile h-10 px-3.5 text-xs font-semibold rounded-[4px] border border-hairline bg-surface text-ink hover:border-hairline-strong disabled:opacity-50 cursor-pointer"
                  >
                    Import WIF
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-ink-secondary">
                Sign the canonical binding message in Paytaca or Electron Cash (Tools &gt; Sign
                Message) without exposing your private key here.
              </p>
              <div>
                <label htmlFor="ext-bch-addr" className="block text-xs font-medium text-ink-muted">
                  BCH CashAddress
                </label>
                <input
                  id="ext-bch-addr"
                  type="text"
                  value={extBchAddress}
                  onChange={(e) => setExtBchAddress(e.target.value)}
                  placeholder="bitcoincash:q…"
                  spellCheck={false}
                  className="mt-1 w-full h-10 px-3 crypto-token text-xs bg-surface border border-hairline rounded-[4px] text-ink focus:border-emerald-notary"
                />
              </div>
              <div>
                <label htmlFor="ext-bch-pub" className="block text-xs font-medium text-ink-muted">
                  Compressed BCH Public Key (66 hex chars)
                </label>
                <input
                  id="ext-bch-pub"
                  type="text"
                  value={extBchPubkey}
                  onChange={(e) => setExtBchPubkey(e.target.value)}
                  placeholder="02… or 03…"
                  spellCheck={false}
                  className="mt-1 w-full h-10 px-3 crypto-token text-xs bg-surface border border-hairline rounded-[4px] text-ink focus:border-emerald-notary"
                />
              </div>
              {externalCanonicalPreview ? (
                <div>
                  <div className="flex items-center justify-between text-xs font-medium text-ink-muted">
                    <span>Message to Sign in External Wallet</span>
                    <button
                      type="button"
                      onClick={() => void handleCopy('ext-msg', externalCanonicalPreview)}
                      className="inline-flex items-center gap-1 text-emerald-notary font-semibold cursor-pointer"
                    >
                      {copiedKey === 'ext-msg' ? 'Copied' : 'Copy Exact Payload'}
                    </button>
                  </div>
                  <code className="mt-1 block crypto-token text-[11px] text-ink-secondary bg-subtle/70 border border-hairline rounded-[4px] p-2.5">
                    {externalCanonicalPreview}
                  </code>
                </div>
              ) : null}
              <div>
                <label htmlFor="ext-bch-sig" className="block text-xs font-medium text-ink-muted">
                  Base64 Bitcoin Signed Message Signature
                </label>
                <input
                  id="ext-bch-sig"
                  type="text"
                  value={extBchSignature}
                  onChange={(e) => setExtBchSignature(e.target.value)}
                  placeholder="Paste 65-byte base64 signature from Paytaca or Electron Cash"
                  spellCheck={false}
                  className="mt-1 w-full h-10 px-3 crypto-token text-xs bg-surface border border-hairline rounded-[4px] text-ink focus:border-emerald-notary"
                />
              </div>
            </div>
          )}

          {bchAddressInfo ? (
            <div className="rounded-[4px] border border-hairline bg-subtle/60 px-3.5 py-2.5 text-xs flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-semibold text-ink">
                  {formatSatoshis(bchAddressInfo.confirmedSats + bchAddressInfo.unconfirmedSats)}
                </span>{' '}
                <span className="text-ink-muted">
                  ({formatSatsToBch(bchAddressInfo.confirmedSats + bchAddressInfo.unconfirmedSats)})
                </span>
              </div>
              <span className="crypto-token text-ink-secondary">
                {bchAddressInfo.utxos.length} UTXO{bchAddressInfo.utxos.length === 1 ? '' : 's'} via{' '}
                {bchAddressInfo.node}
              </span>
            </div>
          ) : null}

          {bchError || utxoError ? (
            <p role="alert" className="text-xs font-medium text-status-invalid">
              {bchError || utxoError}
            </p>
          ) : null}
        </div>

        {/* Right Pane: Nostr Identity Key */}
        <div className="p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-lg font-semibold text-ink">
              2. Nostr Identity Key (Schnorr)
            </h2>
            <div className="inline-flex rounded-[4px] border border-hairline bg-subtle p-0.5">
              <button
                type="button"
                onClick={() => setNostrMode('local')}
                aria-pressed={nostrMode === 'local'}
                className={`px-2.5 py-1 text-xs font-semibold rounded-[3px] cursor-pointer ${
                  nostrMode === 'local' ? 'bg-surface text-ink' : 'text-ink-secondary hover:text-ink'
                }`}
              >
                Local Key / nsec
              </button>
              <button
                type="button"
                onClick={() => setNostrMode('nip07')}
                aria-pressed={nostrMode === 'nip07'}
                className={`px-2.5 py-1 text-xs font-semibold rounded-[3px] cursor-pointer ${
                  nostrMode === 'nip07' ? 'bg-surface text-ink' : 'text-ink-secondary hover:text-ink'
                }`}
              >
                NIP-07 Extension
              </button>
            </div>
          </div>

          {nostrMode === 'local' ? (
            <div className="space-y-3.5">
              <div>
                <button
                  type="button"
                  onClick={() => {
                    setNostrIdentity(generateNostrIdentity());
                    setNostrError(null);
                  }}
                  className="press-tactile inline-flex min-h-10 items-center gap-1.5 rounded-[4px] border border-hairline bg-surface px-3 text-xs font-semibold text-ink hover:border-hairline-strong cursor-pointer"
                >
                  <Key size={14} weight="regular" aria-hidden="true" />
                  <span>Generate Fresh Nostr Key</span>
                </button>
              </div>

              <div>
                <div className="flex items-center justify-between text-xs font-medium text-ink-muted">
                  <span>Nostr Public Identity (npub)</span>
                  <button
                    type="button"
                    onClick={() => void handleCopy('nostr-npub', nostrIdentity.npub)}
                    className="inline-flex items-center gap-1 text-ink hover:text-emerald-notary cursor-pointer"
                  >
                    {copiedKey === 'nostr-npub' ? (
                      <>
                        <Check size={13} weight="bold" aria-hidden="true" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy size={13} weight="regular" aria-hidden="true" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
                <code
                  className="mt-1 block crypto-token text-xs text-ink bg-subtle/70 border border-hairline rounded-[4px] px-3 py-2"
                  translate="no"
                >
                  {nostrIdentity.npub}
                </code>
              </div>

              <div>
                <span className="block text-xs font-medium text-ink-muted">
                  x-only Schnorr Public Key (32 bytes)
                </span>
                <code
                  className="mt-1 block crypto-token text-[11px] text-ink-secondary bg-subtle/50 border border-hairline rounded-[4px] px-3 py-2"
                  translate="no"
                >
                  {nostrIdentity.publicKeyHex}
                </code>
              </div>

              <div>
                <div className="flex items-center justify-between text-xs font-medium text-ink-muted">
                  <span>Private Key nsec (never leaves browser)</span>
                  <button
                    type="button"
                    onClick={() => setShowNsec((prev) => !prev)}
                    className="inline-flex items-center gap-1 text-ink hover:text-emerald-notary cursor-pointer"
                  >
                    {showNsec ? (
                      <>
                        <EyeSlash size={13} weight="regular" aria-hidden="true" />
                        <span>Hide</span>
                      </>
                    ) : (
                      <>
                        <Eye size={13} weight="regular" aria-hidden="true" />
                        <span>Reveal</span>
                      </>
                    )}
                  </button>
                </div>
                <input
                  type={showNsec ? 'text' : 'password'}
                  readOnly
                  value={nostrIdentity.nsec}
                  aria-label="Current Nostr nsec private key"
                  className="mt-1 w-full h-10 px-3 crypto-token text-xs text-ink bg-subtle/50 border border-hairline rounded-[4px]"
                />
              </div>

              <div className="pt-1 border-t border-hairline">
                <label htmlFor="import-nsec" className="block text-xs font-medium text-ink-secondary">
                  Or import an existing Nostr nsec1 or 64-char hex key
                </label>
                <div className="mt-1.5 flex gap-2">
                  <input
                    id="import-nsec"
                    type="password"
                    value={nsecInput}
                    onChange={(e) => setNsecInput(e.target.value)}
                    placeholder="nsec1… or 64-character hex private key"
                    spellCheck={false}
                    className="min-w-0 flex-1 h-10 px-3 crypto-token text-xs bg-surface border border-hairline rounded-[4px] text-ink focus:border-emerald-notary"
                  />
                  <button
                    type="button"
                    onClick={handleImportNsec}
                    disabled={!nsecInput.trim()}
                    className="press-tactile h-10 px-3.5 text-xs font-semibold rounded-[4px] border border-hairline bg-surface text-ink hover:border-hairline-strong disabled:opacity-50 cursor-pointer"
                  >
                    Import nsec
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3.5">
              <p className="text-xs text-ink-secondary">
                Connect an Alby, nos2x, or other NIP-07 browser signer to sign the{' '}
                <code className="crypto-token text-ink">kind:30078</code> Nostr binding event
                directly from your extension.
              </p>
              <button
                type="button"
                onClick={() => {
                  void handleConnectNip07();
                }}
                className="press-tactile inline-flex min-h-11 items-center gap-2 rounded-[4px] border border-hairline bg-surface px-4 text-xs font-semibold text-ink hover:border-hairline-strong cursor-pointer"
              >
                <LinkSimple size={15} weight="regular" aria-hidden="true" />
                <span>{nip07Pubkey ? 'Reconnect NIP-07 Signer' : 'Read Public Key from NIP-07'}</span>
              </button>
              {nip07Pubkey ? (
                <div>
                  <span className="block text-xs font-medium text-ink-muted">
                    Connected Extension npub
                  </span>
                  <code className="mt-1 block crypto-token text-xs text-ink bg-subtle/70 border border-hairline rounded-[4px] px-3 py-2">
                    {formatNpub(nip07Pubkey)}
                  </code>
                </div>
              ) : null}
            </div>
          )}

          {nostrError ? (
            <p role="alert" className="text-xs font-medium text-status-invalid">
              {nostrError}
            </p>
          ) : null}
        </div>
      </section>

      {/* Distinct-Key Separation Strip */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border border-hairline bg-subtle/65 rounded-[6px] px-4 py-3 text-xs">
        <div className="flex items-start sm:items-center gap-2.5">
          {keysDistinct ? (
            <Check size={16} weight="bold" className="text-emerald-notary shrink-0 mt-0.5 sm:mt-0" aria-hidden="true" />
          ) : (
            <ShieldWarning size={16} weight="bold" className="text-status-invalid shrink-0 mt-0.5 sm:mt-0" aria-hidden="true" />
          )}
          <span className={keysDistinct ? 'text-ink-secondary' : 'text-status-invalid font-semibold'}>
            {keysDistinct
              ? 'Key Separation Check Passed: BCH secp256k1 key and Nostr Schnorr key have distinct x-coordinates.'
              : 'Key Reuse Detected: BCH and Nostr keys share the same secp256k1 keypair and will be rejected.'}
          </span>
        </div>

        <button
          type="button"
          onClick={handleTestKeyReuse}
          className="press-tactile self-start sm:self-auto min-h-9 rounded-[4px] border border-hairline bg-surface px-3 text-xs font-semibold text-ink hover:border-hairline-strong cursor-pointer whitespace-nowrap"
        >
          Test Key-Reuse Rejection
        </button>
      </div>

      {reuseTestMessage ? (
        <div
          role="status"
          className="rounded-[4px] border border-status-invalid/30 bg-status-invalid-bg px-4 py-3 text-xs font-medium text-status-invalid"
        >
          {reuseTestMessage}
        </div>
      ) : null}

      {/* Metadata, Rotation & Cross-Sign Form */}
      <form
        onSubmit={handleCrossSign}
        className="border border-hairline bg-surface rounded-[6px] p-5 sm:p-6 space-y-5"
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="bind-handle" className="block text-sm font-semibold text-ink">
              Human-Readable Payment Handle
            </label>
            <input
              id="bind-handle"
              type="text"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="e.g. satoshi-coffee.bch or lee.nostr"
              className="mt-1.5 w-full h-11 px-3 text-sm bg-surface border border-hairline rounded-[4px] text-ink focus:border-emerald-notary"
            />
          </div>
          <div>
            <label htmlFor="bind-note" className="block text-sm font-semibold text-ink">
              Merchant or Creator Payment Note (optional)
            </label>
            <input
              id="bind-note"
              type="text"
              value={merchantNote}
              onChange={(e) => setMerchantNote(e.target.value)}
              placeholder="e.g. Verified BCH mainnet checkout for digital studio"
              className="mt-1.5 w-full h-11 px-3 text-sm bg-surface border border-hairline rounded-[4px] text-ink focus:border-emerald-notary"
            />
          </div>
        </div>

        {/* Key Rotation Lineage */}
        <div className="border-t border-hairline pt-4">
          <button
            type="button"
            onClick={() => setShowRotation((prev) => !prev)}
            aria-expanded={showRotation}
            className="text-xs font-semibold text-ink-secondary hover:text-ink underline underline-offset-4 cursor-pointer"
          >
            {showRotation
              ? 'Hide Key Rotation Lineage Fields'
              : 'Link Previous Binding Hash (Key Rotation Lineage)'}
          </button>

          {showRotation ? (
            <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label htmlFor="prev-hash" className="block text-xs font-medium text-ink-secondary">
                  Previous Binding SHA-256 Digest
                </label>
                <input
                  id="prev-hash"
                  type="text"
                  value={prevBindingHash}
                  onChange={(e) => setPrevBindingHash(e.target.value)}
                  placeholder="64-character SHA-256 hash of superseded binding"
                  spellCheck={false}
                  className="mt-1 w-full h-10 px-3 crypto-token text-xs bg-surface border border-hairline rounded-[4px] text-ink focus:border-emerald-notary"
                />
                {savedBundles.length > 0 ? (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {savedBundles.slice(0, 3).map((b) => (
                      <button
                        key={b.bindingHash}
                        type="button"
                        onClick={() => {
                          setPrevBindingHash(b.bindingHash);
                          if (b.anchorTxid) setPrevTxid(b.anchorTxid);
                        }}
                        className="rounded-[4px] border border-hairline bg-subtle px-2 py-1 text-[11px] font-medium text-ink-secondary hover:text-ink cursor-pointer"
                      >
                        Rotate from {b.payload.handle}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <div>
                <label htmlFor="prev-txid" className="block text-xs font-medium text-ink-secondary">
                  Previous Mainnet Anchor Txid (optional)
                </label>
                <input
                  id="prev-txid"
                  type="text"
                  value={prevTxid}
                  onChange={(e) => setPrevTxid(e.target.value)}
                  placeholder="64-character BCH mainnet txid"
                  spellCheck={false}
                  className="mt-1 w-full h-10 px-3 crypto-token text-xs bg-surface border border-hairline rounded-[4px] text-ink focus:border-emerald-notary"
                />
              </div>
            </div>
          ) : null}
        </div>

        {signError ? (
          <div
            role="alert"
            className="rounded-[4px] border border-status-invalid/30 bg-status-invalid-bg px-4 py-3 text-sm text-status-invalid"
          >
            {signError}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-hairline pt-4">
          <NotarySeal
            status={sealStatus}
            title={
              activeBundle
                ? `Dual Proof Signed for ${activeBundle.payload.handle}`
                : 'Ready to Cross-Sign Binding'
            }
            subtitle={
              activeBundle
                ? `Binding SHA-256 ${activeBundle.bindingHash.slice(0, 16)}… saved to local vault.`
                : 'Produces a Bitcoin Signed Message ECDSA proof and a Nostr NIP-78 Schnorr event.'
            }
            compact
          />

          <button
            type="submit"
            disabled={signing || !keysDistinct}
            className="press-tactile inline-flex min-h-12 items-center gap-2 rounded-[4px] bg-emerald-notary px-5 text-sm font-semibold text-white hover:bg-emerald-notary-hover disabled:opacity-50 cursor-pointer whitespace-nowrap"
          >
            <Key size={16} weight="regular" aria-hidden="true" />
            <span>{signing ? 'Signing…' : 'Cross-Sign Dual Proof'}</span>
          </button>
        </div>
      </form>

      {/* Post-Sign Publishing & On-Chain Anchoring Desk */}
      {activeBundle ? (
        <section
          aria-label="Publish and anchor signed binding"
          className="grid grid-cols-1 gap-6 lg:grid-cols-2"
        >
          {/* Step A: Publish to Live Nostr Relays */}
          <div className="border border-hairline bg-surface rounded-[6px] p-5 sm:p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-semibold text-ink">
                  Step A: Publish to Public Nostr Relays
                </h2>
                <p className="mt-1 text-xs text-ink-secondary">
                  Broadcasts the signed <code className="crypto-token text-ink">kind:30078</code>{' '}
                  addressable event to 3 independent public relays so anyone can discover and verify
                  this binding without a central server.
                </p>
              </div>
            </div>

            <div className="space-y-2 text-xs">
              <div>
                <span className="text-ink-muted">Binding SHA-256 Digest</span>
                <code className="mt-1 block crypto-token text-ink bg-subtle/70 border border-hairline rounded-[4px] px-3 py-2">
                  {activeBundle.bindingHash}
                </code>
              </div>
              <div>
                <span className="text-ink-muted">Nostr Event ID</span>
                <code className="mt-1 block crypto-token text-ink-secondary bg-subtle/50 border border-hairline rounded-[4px] px-3 py-2">
                  {activeBundle.nostrEvent.id}
                </code>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                void handlePublishRelays();
              }}
              disabled={publishingRelays}
              className="press-tactile inline-flex min-h-11 items-center gap-2 rounded-[4px] bg-ink px-4 text-sm font-semibold text-white hover:bg-ink/90 disabled:opacity-60 cursor-pointer"
            >
              <Broadcast size={16} weight="regular" aria-hidden="true" />
              <span>{publishingRelays ? 'Publishing to 3 Relays…' : 'Publish to Nostr Relays'}</span>
            </button>

            {relayOutcomes ? (
              <div className="border border-hairline rounded-[4px] divide-y divide-hairline text-xs">
                {relayOutcomes.map((out) => (
                  <div key={out.relay} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="crypto-token text-ink truncate">{out.relay}</span>
                    <span
                      className={`font-semibold whitespace-nowrap ${
                        out.ok ? 'text-emerald-notary' : 'text-status-invalid'
                      }`}
                    >
                      {out.ok ? `Accepted (${out.latencyMs} ms)` : out.error || 'Failed'}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {/* Step B: Anchor on BCH Mainnet (OP_RETURN) */}
          <div className="border border-hairline bg-surface rounded-[6px] p-5 sm:p-6 space-y-4">
            <div>
              <h2 className="font-display text-lg font-semibold text-ink">
                Step B: Anchor on BCH Mainnet (OP_RETURN)
              </h2>
              <p className="mt-1 text-xs text-ink-secondary">
                Commits the immutable 32-byte digest into a real Bitcoin Cash mainnet transaction
                using <code className="crypto-token text-ink">OP_RETURN CASHBIND v1 &lt;sha256&gt;</code>.
              </p>
            </div>

            {opReturnHex ? (
              <div className="text-xs">
                <span className="text-ink-muted">
                  Encoded OP_RETURN ScriptPubKey ({opReturnHex.length / 2} bytes)
                </span>
                <code className="mt-1 block crypto-token text-[11px] text-ink bg-subtle/70 border border-hairline rounded-[4px] px-3 py-2">
                  {opReturnHex}
                </code>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2.5">
              <button
                type="button"
                onClick={() => {
                  void handleAnchorWithWizardConnect();
                }}
                disabled={anchoring}
                className="press-tactile inline-flex min-h-11 items-center gap-2 rounded-[4px] bg-emerald-notary px-4 text-sm font-semibold text-white hover:bg-emerald-notary-hover disabled:opacity-60 cursor-pointer"
              >
                <Wallet size={16} weight="regular" aria-hidden="true" />
                <span>
                  {walletState === 'connected'
                    ? anchoring
                      ? 'Broadcasting…'
                      : 'Anchor via WizardConnect'
                    : 'Connect Wallet to Anchor'}
                </span>
              </button>

              {bchMode === 'local' ? (
                <button
                  type="button"
                  onClick={() => {
                    void handleAnchorWithLocalKey();
                  }}
                  disabled={anchoring}
                  className="press-tactile inline-flex min-h-11 items-center gap-2 rounded-[4px] border border-hairline bg-surface px-4 text-sm font-semibold text-ink hover:border-hairline-strong disabled:opacity-60 cursor-pointer"
                >
                  <span>Anchor with Local BCH Key</span>
                </button>
              ) : null}
            </div>

            {anchorError ? (
              <div
                role="alert"
                className="rounded-[4px] border border-status-pending/30 bg-status-pending-bg px-3.5 py-2.5 text-xs text-status-pending space-y-1.5"
              >
                <p className="font-semibold">{anchorError}</p>
                <p className="text-ink-secondary">
                  Send ~1,000 sats (&lt; $0.01) to the signing CashAddress on BCH mainnet, then click
                  the anchor button again to sign and broadcast via Fulcrum.
                </p>
              </div>
            ) : null}

            {anchorResult ? (
              <div className="rounded-[4px] border border-emerald-notary/30 bg-emerald-soft px-4 py-3 text-xs space-y-2">
                <p className="font-semibold text-emerald-notary">
                  Anchored on BCH Mainnet via {anchorResult.node}
                </p>
                <a
                  href={anchorResult.explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 crypto-token text-ink underline underline-offset-4"
                >
                  <span>{anchorResult.txid}</span>
                  <ArrowSquareOut size={13} weight="regular" aria-hidden="true" />
                </a>
                <div>
                  <button
                    type="button"
                    onClick={() => {
                      void handlePublishRelays();
                    }}
                    disabled={publishingRelays}
                    className="press-tactile mt-1 inline-flex min-h-9 items-center gap-1.5 rounded-[4px] bg-ink px-3 text-xs font-semibold text-white hover:bg-ink/90 disabled:opacity-50 cursor-pointer"
                  >
                    <Broadcast size={13} weight="regular" aria-hidden="true" />
                    <span>Re-Publish Nostr Event with Anchor Txid</span>
                  </button>
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-3">
              <Link
                to={`/vault?hash=${encodeURIComponent(activeBundle.bindingHash)}`}
                className="text-xs font-semibold text-ink-secondary hover:text-ink underline underline-offset-4"
              >
                Issue Attestations &amp; Export did:nostr
              </Link>
              <Link
                to={`/verify?hash=${encodeURIComponent(activeBundle.bindingHash)}`}
                className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-notary hover:underline underline-offset-4"
              >
                <span>Verify, Authenticate &amp; Pay</span>
                <ArrowRight size={13} weight="regular" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
