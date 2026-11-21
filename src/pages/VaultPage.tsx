import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  ArrowsClockwise,
  Check,
  Code,
  Copy,
  DownloadSimple,
  Key,
  SealCheck,
} from '@phosphor-icons/react';
import {
  discoverAttestationsFromRelays,
  publishEventToRelays,
  type RelayPublishOutcome,
} from '../lib/nostrNetwork';
import {
  createSignedAttestation,
  createSignedBindingBundle,
  DEFAULT_NOSTR_RELAYS,
  exportDidNostrDocument,
  formatNpub,
  generateBchIdentity,
  generateNostrIdentity,
  importNostrNsec,
  verifyRotationChain,
  verifySignedAttestation,
  type CashBindAttestation,
  type CashBindBundle,
  type NostrIdentity,
} from '../lib/protocol';
import {
  loadLocalAttestations,
  loadLocalBundles,
  saveLocalAttestation,
  saveLocalBundle,
} from '../lib/storage';

const CLAIM_TYPES = [
  { value: 'verified-merchant', label: 'Verified Merchant' },
  { value: 'community-vouch', label: 'Community Vouch' },
  { value: 'security-audit', label: 'Security Audit' },
  { value: 'developer-identity', label: 'Developer Identity' },
] as const;

const SDK_SNIPPET = `import {
  verifyBindingBundle,
  verifyOnChainCommitment,
  verifyAuthChallengeResponse,
} from './lib/protocol';

// 1. Verify dual BCH ECDSA + Nostr Schnorr proof offline
const report = verifyBindingBundle(bundle);
if (!report.valid) throw new Error('Invalid CashBind identity');

// 2. Confirm BCH mainnet OP_RETURN commitment against Fulcrum tx outputs
const onChain = verifyOnChainCommitment(txOutputs, report.bindingHash);

// 3. Route BCH payment safely to bundle.payload.bchAddress
console.log('Verified payment endpoint:', bundle.payload.bchAddress, onChain.matched);`;

export function VaultPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [bundles, setBundles] = useState<CashBindBundle[]>(() => loadLocalBundles());
  const [selectedHash, setSelectedHash] = useState<string>(
    () => searchParams.get('hash') || loadLocalBundles()[0]?.bindingHash || '',
  );

  // Independent Issuer key for third-party attestations
  const [issuerIdentity, setIssuerIdentity] = useState<NostrIdentity>(() => generateNostrIdentity());
  const [issuerNsecInput, setIssuerNsecInput] = useState('');
  const [issuerLabel, setIssuerLabel] = useState('BCH Merchant Guild');
  const [claimType, setClaimType] = useState<string>('verified-merchant');
  const [claimStatement, setClaimStatement] = useState(
    'Confirmed active Bitcoin Cash mainnet settlement and Nostr ownership.',
  );
  const [issuerError, setIssuerError] = useState<string | null>(null);
  const [publishingAtt, setPublishingAtt] = useState(false);
  const [attPublishOutcomes, setAttPublishOutcomes] = useState<RelayPublishOutcome[] | null>(null);

  const [localAttestations, setLocalAttestations] = useState<CashBindAttestation[]>(() =>
    loadLocalAttestations(),
  );
  const [relayAttestations, setRelayAttestations] = useState<CashBindAttestation[]>([]);
  const [loadingAtts, setLoadingAtts] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const selectedBundle = useMemo(
    () => bundles.find((b) => b.bindingHash === selectedHash) || bundles[0] || null,
    [bundles, selectedHash],
  );

  const refreshRelayAttestations = useCallback(async (bindingHash?: string) => {
    if (!bindingHash) return;
    setLoadingAtts(true);
    try {
      const discovered = await discoverAttestationsFromRelays({ bindingHash });
      setRelayAttestations(discovered);
    } finally {
      setLoadingAtts(false);
    }
  }, []);

  useEffect(() => {
    if (selectedBundle) {
      void refreshRelayAttestations(selectedBundle.bindingHash);
    }
  }, [selectedBundle, refreshRelayAttestations]);

  const subjectAttestations = useMemo(() => {
    if (!selectedBundle) return [];
    const byId = new Map<string, CashBindAttestation>();
    for (const att of [...localAttestations, ...relayAttestations]) {
      if (att.subjectBindingHash === selectedBundle.bindingHash && !byId.has(att.id)) {
        byId.set(att.id, att);
      }
    }
    return [...byId.values()].sort((a, b) => b.issuedAt - a.issuedAt);
  }, [selectedBundle, localAttestations, relayAttestations]);

  const didDocument = useMemo(() => {
    if (!selectedBundle) return null;
    return exportDidNostrDocument(selectedBundle, selectedBundle.anchorTxid, subjectAttestations);
  }, [selectedBundle, subjectAttestations]);

  const rotationLineage = useMemo(() => {
    if (!selectedBundle) return { chain: [] as CashBindBundle[], report: null };
    const byHash = new Map(bundles.map((b) => [b.bindingHash, b]));
    const chain: CashBindBundle[] = [selectedBundle];
    const visited = new Set([selectedBundle.bindingHash]);
    let cursor = selectedBundle;
    while (cursor.payload.prevBindingHash && !visited.has(cursor.payload.prevBindingHash)) {
      const prev = byHash.get(cursor.payload.prevBindingHash);
      if (!prev) break;
      chain.unshift(prev);
      visited.add(prev.bindingHash);
      cursor = prev;
    }
    return {
      chain,
      report: verifyRotationChain(chain),
    };
  }, [bundles, selectedBundle]);

  const handleCopy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      // ignore
    }
  };

  const handleDownloadDid = () => {
    if (!didDocument || !selectedBundle) return;
    const blob = new Blob([JSON.stringify(didDocument, null, 2)], {
      type: 'application/did+ld+json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selectedBundle.payload.handle.replace(/[^a-zA-Z0-9._-]/g, '_')}.did.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImportIssuerNsec = () => {
    setIssuerError(null);
    try {
      const imported = importNostrNsec(issuerNsecInput);
      setIssuerIdentity(imported);
      setIssuerNsecInput('');
    } catch (err) {
      setIssuerError(err instanceof Error ? err.message : 'Invalid issuer nsec key.');
    }
  };

  const handleIssueAttestation = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedBundle) return;
    setIssuerError(null);
    setPublishingAtt(true);
    setAttPublishOutcomes(null);
    try {
      if (!issuerLabel.trim() || !claimStatement.trim()) {
        throw new Error('Provide both an issuer label and a claim statement.');
      }
      const attestation = createSignedAttestation({
        issuerNostrPrivateKeyHex: issuerIdentity.privateKeyHex,
        issuerLabel,
        subjectBindingHash: selectedBundle.bindingHash,
        subjectNostrPubkey: selectedBundle.payload.nostrPubkey,
        subjectBchAddress: selectedBundle.payload.bchAddress,
        claimType,
        claimStatement,
      });
      const check = verifySignedAttestation(attestation, selectedBundle);
      if (!check.valid) {
        throw new Error(check.reason);
      }
      setLocalAttestations(saveLocalAttestation(attestation));
      const outcomes = await publishEventToRelays(attestation.nostrEvent, [...DEFAULT_NOSTR_RELAYS]);
      setAttPublishOutcomes(outcomes);
    } catch (err) {
      setIssuerError(err instanceof Error ? err.message : 'Unable to issue signed attestation.');
    } finally {
      setPublishingAtt(false);
    }
  };

  const handleCreateStarterIdentity = () => {
    const bch = generateBchIdentity();
    const nostr = generateNostrIdentity();
    const created = createSignedBindingBundle({
      bchPrivateKeyHex: bch.privateKeyHex,
      nostrPrivateKeyHex: nostr.privateKeyHex,
      handle: `vault-${bch.address.slice(-4)}.bch`,
      merchantNote: 'Created locally to inspect portable attestations and W3C did:nostr export.',
    });
    const next = saveLocalBundle(created);
    setBundles(next);
    setSelectedHash(created.bindingHash);
    setSearchParams({ hash: created.bindingHash });
  };

  return (
    <div className="mx-auto max-w-[1320px] px-4 py-8 sm:px-6 lg:px-8 lg:py-10 space-y-8">
      {/* Header + Active Identity Selector */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <h1 className="font-display text-3xl sm:text-[36px] font-bold leading-tight tracking-tight text-ink">
            Attestations, W3C DID &amp; SDK
          </h1>
          <p className="mt-2 text-[15px] text-ink-secondary">
            Issue portable third-party Nostr attestations bound to a CashBind identity, inspect
            key-rotation lineage, and export standards-compliant{' '}
            <code className="crypto-token text-[13px] text-ink">did:nostr</code> JSON-LD documents.
          </p>
        </div>

        {bundles.length > 0 ? (
          <div className="flex items-center gap-2">
            <label htmlFor="vault-identity-select" className="text-xs font-semibold text-ink-muted whitespace-nowrap">
              Active Identity
            </label>
            <select
              id="vault-identity-select"
              value={selectedBundle?.bindingHash || ''}
              onChange={(e) => {
                setSelectedHash(e.target.value);
                setSearchParams({ hash: e.target.value });
              }}
              className="h-11 rounded-[4px] border border-hairline bg-surface px-3 text-sm font-medium text-ink focus:border-emerald-notary"
            >
              {bundles.map((b) => (
                <option key={b.bindingHash} value={b.bindingHash}>
                  {b.payload.handle} ({b.bindingHash.slice(0, 8)}…)
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      {!selectedBundle ? (
        <div className="border border-hairline bg-surface rounded-[6px] px-6 py-12 text-center space-y-4">
          <h2 className="font-display text-lg font-semibold text-ink">
            No Saved CashBind Identity in Vault Yet
          </h2>
          <p className="mx-auto max-w-md text-sm text-ink-secondary">
            Bind a BCH and Nostr identity first, or create a live cryptographic identity here to
            issue third-party attestations and export a W3C did:nostr document.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/bind"
              className="press-tactile inline-flex min-h-11 items-center gap-2 rounded-[4px] bg-emerald-notary px-4 text-sm font-semibold text-white hover:bg-emerald-notary-hover"
            >
              <span>Bind Identity</span>
            </Link>
            <button
              type="button"
              onClick={handleCreateStarterIdentity}
              className="press-tactile inline-flex min-h-11 items-center gap-2 rounded-[4px] border border-hairline bg-surface px-4 text-sm font-semibold text-ink hover:border-hairline-strong cursor-pointer"
            >
              <span>Generate Live Identity</span>
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Band 1: Portable Third-Party Attestations */}
          <section
            aria-label="Portable third-party attestations"
            className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start"
          >
            {/* Issue Attestation Form */}
            <form
              onSubmit={handleIssueAttestation}
              className="lg:col-span-5 border border-hairline bg-surface rounded-[6px] p-5 space-y-4"
            >
              <div>
                <h2 className="font-display text-lg font-semibold text-ink">
                  Issue Portable Attestation
                </h2>
                <p className="mt-1 text-xs text-ink-secondary">
                  An independent third-party issuer signs a verifiable Nostr claim targeting{' '}
                  <span className="font-semibold text-ink">{selectedBundle.payload.handle}</span>.
                </p>
              </div>

              <div className="rounded-[4px] border border-hairline bg-subtle/60 p-3 space-y-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-ink">Independent Issuer Key</span>
                  <button
                    type="button"
                    onClick={() => setIssuerIdentity(generateNostrIdentity())}
                    className="inline-flex items-center gap-1 font-semibold text-emerald-notary hover:underline underline-offset-4 cursor-pointer"
                  >
                    <Key size={13} weight="regular" aria-hidden="true" />
                    <span>Rotate Issuer Key</span>
                  </button>
                </div>
                <code className="block crypto-token text-[11px] text-ink-secondary">
                  {issuerIdentity.npub}
                </code>
                <div className="flex gap-1.5 pt-1">
                  <input
                    type="password"
                    value={issuerNsecInput}
                    onChange={(e) => setIssuerNsecInput(e.target.value)}
                    placeholder="Or import issuer nsec1…"
                    aria-label="Import third-party issuer nsec"
                    spellCheck={false}
                    className="min-w-0 flex-1 h-9 px-2.5 crypto-token text-xs bg-surface border border-hairline rounded-[4px] text-ink"
                  />
                  <button
                    type="button"
                    onClick={handleImportIssuerNsec}
                    disabled={!issuerNsecInput.trim()}
                    className="press-tactile h-9 px-2.5 rounded-[4px] border border-hairline bg-surface text-xs font-semibold text-ink disabled:opacity-50 cursor-pointer"
                  >
                    Import
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="issuer-label" className="block text-xs font-semibold text-ink">
                    Issuer Name
                  </label>
                  <input
                    id="issuer-label"
                    type="text"
                    value={issuerLabel}
                    onChange={(e) => setIssuerLabel(e.target.value)}
                    className="mt-1 w-full h-10 px-3 text-sm bg-surface border border-hairline rounded-[4px] text-ink focus:border-emerald-notary"
                  />
                </div>
                <div>
                  <label htmlFor="claim-type" className="block text-xs font-semibold text-ink">
                    Claim Type
                  </label>
                  <select
                    id="claim-type"
                    value={claimType}
                    onChange={(e) => setClaimType(e.target.value)}
                    className="mt-1 w-full h-10 px-3 text-sm bg-surface border border-hairline rounded-[4px] text-ink focus:border-emerald-notary"
                  >
                    {CLAIM_TYPES.map((ct) => (
                      <option key={ct.value} value={ct.value}>
                        {ct.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="claim-statement" className="block text-xs font-semibold text-ink">
                  Attestation Statement
                </label>
                <textarea
                  id="claim-statement"
                  rows={3}
                  value={claimStatement}
                  onChange={(e) => setClaimStatement(e.target.value)}
                  className="mt-1 w-full p-3 text-sm bg-surface border border-hairline rounded-[4px] text-ink focus:border-emerald-notary"
                />
              </div>

              {issuerError ? (
                <p role="alert" className="text-xs font-semibold text-status-invalid">
                  {issuerError}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={publishingAtt}
                className="press-tactile w-full inline-flex min-h-11 items-center justify-center gap-2 rounded-[4px] bg-emerald-notary px-4 text-sm font-semibold text-white hover:bg-emerald-notary-hover disabled:opacity-60 cursor-pointer"
              >
                <SealCheck size={16} weight="regular" aria-hidden="true" />
                <span>{publishingAtt ? 'Signing & Publishing…' : 'Sign & Publish Attestation'}</span>
              </button>

              {attPublishOutcomes ? (
                <div className="border border-hairline rounded-[4px] divide-y divide-hairline text-xs">
                  {attPublishOutcomes.map((o) => (
                    <div key={o.relay} className="flex items-center justify-between px-3 py-1.5">
                      <span className="crypto-token text-ink-secondary truncate">{o.relay}</span>
                      <span className={o.ok ? 'font-semibold text-emerald-notary' : 'text-status-invalid'}>
                        {o.ok ? `Accepted (${o.latencyMs} ms)` : 'Failed'}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </form>

            {/* Attestation Ledger */}
            <div className="lg:col-span-7 border border-hairline bg-surface rounded-[6px] overflow-hidden">
              <div className="flex items-center justify-between gap-3 border-b border-hairline bg-subtle/60 px-4 py-3">
                <div>
                  <h2 className="font-display text-sm font-semibold text-ink">
                    Verified Attestations for {selectedBundle.payload.handle}
                  </h2>
                  <p className="text-xs text-ink-muted">
                    Portable Schnorr credentials verified client-side from local vault and public
                    Nostr relays.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void refreshRelayAttestations(selectedBundle.bindingHash);
                  }}
                  disabled={loadingAtts}
                  className="press-tactile inline-flex min-h-9 items-center gap-1.5 rounded-[4px] border border-hairline bg-surface px-3 text-xs font-semibold text-ink hover:border-hairline-strong disabled:opacity-50 cursor-pointer whitespace-nowrap"
                >
                  <ArrowsClockwise
                    size={13}
                    weight="regular"
                    className={loadingAtts ? 'animate-spin' : ''}
                    aria-hidden="true"
                  />
                  <span>Refresh Relays</span>
                </button>
              </div>

              {subjectAttestations.length === 0 ? (
                <div className="px-5 py-10 text-center text-sm text-ink-secondary">
                  No third-party attestations signed for this binding digest yet. Use the issuer
                  form on the left to sign and publish the first portable credential.
                </div>
              ) : (
                <div className="divide-y divide-hairline">
                  {subjectAttestations.map((att) => {
                    const check = verifySignedAttestation(att, selectedBundle);
                    return (
                      <article key={att.id} className="p-4 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm text-ink">{att.issuerLabel}</span>
                            <span className="text-ink-muted" aria-hidden="true">
                              ·
                            </span>
                            <code className="crypto-token text-xs text-ink-secondary">
                              {att.claimType}
                            </code>
                          </div>
                          <span
                            className={`text-xs font-semibold ${
                              check.valid ? 'text-emerald-notary' : 'text-status-invalid'
                            }`}
                          >
                            {check.valid ? 'Schnorr Verified' : 'Invalid'}
                          </span>
                        </div>
                        <p className="text-sm text-ink-secondary">{att.claimStatement}</p>
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
                          <code className="crypto-token" translate="no">
                            Issuer: {att.issuerNpub.startsWith('npub1') ? att.issuerNpub : formatNpub(att.issuerNostrPubkey)}
                          </code>
                          <code className="crypto-token">Event {att.id.slice(0, 12)}…</code>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          {/* Band 2: W3C did:nostr JSON-LD & Key-Rotation Lineage */}
          <section
            aria-label="W3C DID export and key rotation lineage"
            className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start"
          >
            <div className="lg:col-span-7 border border-hairline bg-surface rounded-[6px] overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline bg-subtle/60 px-4 py-3">
                <div>
                  <h2 className="font-display text-sm font-semibold text-ink">
                    W3C did:nostr JSON-LD Document
                  </h2>
                  <p className="crypto-token text-xs text-ink-muted">
                    {didDocument?.id}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      didDocument && void handleCopy('did', JSON.stringify(didDocument, null, 2))
                    }
                    className="press-tactile inline-flex min-h-9 items-center gap-1.5 rounded-[4px] border border-hairline bg-surface px-3 text-xs font-semibold text-ink hover:border-hairline-strong cursor-pointer"
                  >
                    {copiedKey === 'did' ? (
                      <>
                        <Check size={13} weight="bold" className="text-emerald-notary" aria-hidden="true" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy size={13} weight="regular" aria-hidden="true" />
                        <span>Copy JSON</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadDid}
                    className="press-tactile inline-flex min-h-9 items-center gap-1.5 rounded-[4px] bg-ink px-3 text-xs font-semibold text-white hover:bg-ink/90 cursor-pointer"
                  >
                    <DownloadSimple size={13} weight="regular" aria-hidden="true" />
                    <span>Download did.json</span>
                  </button>
                </div>
              </div>
              <pre className="max-h-[420px] overflow-auto crypto-token text-xs leading-relaxed text-ink bg-surface p-4">
                {JSON.stringify(didDocument, null, 2)}
              </pre>
            </div>

            <div className="lg:col-span-5 border border-hairline bg-surface rounded-[6px] p-5 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-lg font-semibold text-ink">
                  Key-Rotation Lineage
                </h2>
                <Link
                  to={`/bind?rotate=${encodeURIComponent(selectedBundle.bindingHash)}`}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-notary hover:underline underline-offset-4"
                >
                  <span>Rotate Keys</span>
                  <ArrowRight size={13} weight="regular" aria-hidden="true" />
                </Link>
              </div>

              {rotationLineage.report ? (
                <div
                  className={`rounded-[4px] px-3.5 py-2.5 text-xs font-semibold ${
                    rotationLineage.report.valid
                      ? 'border border-emerald-notary/30 bg-emerald-soft text-emerald-notary'
                      : 'border border-status-invalid/30 bg-status-invalid-bg text-status-invalid'
                  }`}
                >
                  {rotationLineage.report.reason}
                </div>
              ) : null}

              <ol className="space-y-3 border-t border-hairline pt-3">
                {rotationLineage.chain.map((node, index) => (
                  <li
                    key={node.bindingHash}
                    className="rounded-[4px] border border-hairline bg-subtle/50 p-3 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-ink">
                        Generation {index + 1}: {node.payload.handle}
                      </span>
                      <span className="crypto-token text-ink-muted">
                        {node.bindingHash.slice(0, 10)}…
                      </span>
                    </div>
                    <p className="crypto-token text-[11px] text-ink-secondary">
                      BCH: {node.payload.bchAddress}
                    </p>
                    {node.payload.prevBindingHash ? (
                      <p className="crypto-token text-[11px] text-ink-muted">
                        Supersedes: {node.payload.prevBindingHash.slice(0, 16)}…
                      </p>
                    ) : (
                      <p className="text-[11px] text-ink-muted">Genesis CashBind binding</p>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          </section>

          {/* Band 3: Drop-In TypeScript Verification Snippet */}
          <section
            aria-label="Developer verification SDK snippet"
            className="border border-hairline bg-surface rounded-[6px] overflow-hidden"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline bg-subtle/60 px-4 py-3">
              <div className="flex items-center gap-2">
                <Code size={16} weight="regular" className="text-emerald-notary" aria-hidden="true" />
                <h2 className="font-display text-sm font-semibold text-ink">
                  Drop-In TypeScript Verification Snippet
                </h2>
              </div>
              <button
                type="button"
                onClick={() => void handleCopy('sdk', SDK_SNIPPET)}
                className="press-tactile inline-flex min-h-9 items-center gap-1.5 rounded-[4px] border border-hairline bg-surface px-3 text-xs font-semibold text-ink hover:border-hairline-strong cursor-pointer"
              >
                {copiedKey === 'sdk' ? (
                  <>
                    <Check size={13} weight="bold" className="text-emerald-notary" aria-hidden="true" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy size={13} weight="regular" aria-hidden="true" />
                    <span>Copy Snippet</span>
                  </>
                )}
              </button>
            </div>
            <pre className="overflow-x-auto crypto-token text-xs leading-relaxed text-ink bg-surface p-4">
              {SDK_SNIPPET}
            </pre>
          </section>
        </>
      )}
    </div>
  );
}
