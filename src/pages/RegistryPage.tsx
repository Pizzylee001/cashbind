import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ArrowSquareOut,
  ArrowsClockwise,
  Check,
  Copy,
  Cube,
  Key,
  MagnifyingGlass,
  ShieldCheck,
  X,
} from '@phosphor-icons/react';
import { BlazeBanner } from '../components/BlazeBanner';
import { NotarySeal } from '../components/NotarySeal';
import { fetchBchStatus, type BchNetworkStatus } from '../lib/bchApi';
import { discoverBindingsFromRelays } from '../lib/nostrNetwork';
import {
  createSignedBindingBundle,
  formatNpub,
  generateBchIdentity,
  generateNostrIdentity,
  verifyBindingBundle,
  type CashBindBundle,
} from '../lib/protocol';
import { loadLocalBundles, saveLocalBundle } from '../lib/storage';

type SourceFilter = 'all' | 'anchored' | 'relay' | 'local';

interface RegistryEntry {
  bundle: CashBindBundle;
  sources: Array<'relay' | 'local'>;
  verified: boolean;
}

function truncateMiddle(value: string, start = 14, end = 8): string {
  if (value.length <= start + end + 3) return value;
  return `${value.slice(0, start)}…${value.slice(-end)}`;
}

function formatTimestamp(unixSeconds: number): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(unixSeconds * 1000));
  } catch {
    return String(unixSeconds);
  }
}

export function RegistryPage() {
  const [bchStatus, setBchStatus] = useState<BchNetworkStatus | null>(null);
  const [relayBundles, setRelayBundles] = useState<CashBindBundle[]>([]);
  const [localBundles, setLocalBundles] = useState<CashBindBundle[]>(() => loadLocalBundles());
  const [relayStatuses, setRelayStatuses] = useState<
    Array<{ relay: string; ok: boolean; count: number; error?: string }>
  >([]);
  const [loadingRelays, setLoadingRelays] = useState(true);
  const [relayError, setRelayError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [selectedBundle, setSelectedBundle] = useState<CashBindBundle | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const loadNetworkData = useCallback(async () => {
    setLoadingRelays(true);
    setRelayError(null);
    setLocalBundles(loadLocalBundles());

    const [statusResult, relaysResult] = await Promise.allSettled([
      fetchBchStatus(),
      discoverBindingsFromRelays({ limit: 40 }),
    ]);

    if (statusResult.status === 'fulfilled') {
      setBchStatus(statusResult.value);
    } else {
      setBchStatus({
        ok: false,
        error: 'Unable to reach Fulcrum mainnet proxy.',
      });
    }

    if (relaysResult.status === 'fulfilled') {
      setRelayBundles(relaysResult.value.bundles);
      setRelayStatuses(relaysResult.value.relayStatuses);
      const anyConnected = relaysResult.value.relayStatuses.some((r) => r.ok);
      if (!anyConnected) {
        setRelayError('Could not connect to public Nostr relays. Check network connectivity and retry.');
      }
    } else {
      setRelayError('Failed to query public Nostr relays for CashBind records.');
    }

    setLoadingRelays(false);
  }, []);

  useEffect(() => {
    void loadNetworkData();
  }, [loadNetworkData]);

  useEffect(() => {
    if (!selectedBundle) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedBundle(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedBundle]);

  const mergedEntries = useMemo<RegistryEntry[]>(() => {
    const byHash = new Map<string, RegistryEntry>();

    for (const bundle of localBundles) {
      const report = verifyBindingBundle(bundle);
      byHash.set(bundle.bindingHash, {
        bundle,
        sources: ['local'],
        verified: report.valid,
      });
    }

    for (const bundle of relayBundles) {
      const existing = byHash.get(bundle.bindingHash);
      if (existing) {
        if (!existing.sources.includes('relay')) {
          existing.sources.push('relay');
        }
        if (!existing.bundle.anchorTxid && bundle.anchorTxid) {
          existing.bundle = { ...existing.bundle, anchorTxid: bundle.anchorTxid };
        }
      } else {
        const report = verifyBindingBundle(bundle);
        byHash.set(bundle.bindingHash, {
          bundle,
          sources: ['relay'],
          verified: report.valid,
        });
      }
    }

    return [...byHash.values()].sort(
      (a, b) => b.bundle.payload.issuedAt - a.bundle.payload.issuedAt,
    );
  }, [localBundles, relayBundles]);

  const filteredEntries = useMemo(() => {
    const q = query.trim().toLowerCase();
    return mergedEntries.filter((entry) => {
      if (sourceFilter === 'anchored' && !entry.bundle.anchorTxid) return false;
      if (sourceFilter === 'relay' && !entry.sources.includes('relay')) return false;
      if (sourceFilter === 'local' && !entry.sources.includes('local')) return false;

      if (!q) return true;
      const npub = formatNpub(entry.bundle.payload.nostrPubkey).toLowerCase();
      return (
        entry.bundle.payload.handle.toLowerCase().includes(q) ||
        entry.bundle.payload.bchAddress.toLowerCase().includes(q) ||
        entry.bundle.payload.nostrPubkey.toLowerCase().includes(q) ||
        npub.includes(q) ||
        entry.bundle.bindingHash.toLowerCase().includes(q) ||
        (entry.bundle.anchorTxid && entry.bundle.anchorTxid.toLowerCase().includes(q))
      );
    });
  }, [mergedEntries, query, sourceFilter]);

  const liveRelayCount = relayStatuses.filter((r) => r.ok).length;

  const handleCopy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(key);
      setTimeout(() => setCopiedField(null), 1800);
    } catch {
      // Clipboard may be blocked in restricted contexts
    }
  };

  const handleGenerateTestProof = () => {
    const bch = generateBchIdentity();
    const nostr = generateNostrIdentity();
    const suffix = bch.address.replace('bitcoincash:', '').slice(1, 5);
    const bundle = createSignedBindingBundle({
      bchPrivateKeyHex: bch.privateKeyHex,
      nostrPrivateKeyHex: nostr.privateKeyHex,
      handle: `notary-${suffix}.bch`,
      merchantNote: 'Cryptographic test binding generated locally in browser.',
    });
    const updated = saveLocalBundle(bundle);
    setLocalBundles(updated);
    setSelectedBundle(bundle);
  };

  const selectedReport = useMemo(
    () => (selectedBundle ? verifyBindingBundle(selectedBundle) : null),
    [selectedBundle],
  );

  return (
    <div>
      <BlazeBanner />

      <div className="mx-auto max-w-[1320px] px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-start">
          {/* Left Sticky Rail (4 cols) */}
          <aside className="lg:col-span-4 lg:sticky lg:top-24 space-y-6">
            <div>
              <h1 className="font-display text-3xl sm:text-[38px] font-bold leading-[1.1] tracking-tight text-ink">
                Verify and pay Nostr identities on Bitcoin Cash
              </h1>
              <p className="mt-3 text-[15px] leading-relaxed text-ink-secondary">
                CashBind links a Nostr identity key and a distinct Bitcoin Cash mainnet key with
                two independent signatures and an optional on-chain{' '}
                <code className="crypto-token text-[13px] text-ink">OP_RETURN</code> commitment.
                No central registry, no custodian, and no key reuse.
              </p>

              <div className="mt-5 flex flex-wrap gap-2.5">
                <Link
                  to="/bind"
                  className="press-tactile inline-flex min-h-11 items-center gap-2 rounded-[4px] bg-emerald-notary px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-notary-hover"
                >
                  <Key size={16} weight="regular" aria-hidden="true" />
                  <span>Bind New Identity</span>
                </Link>
                <Link
                  to="/verify"
                  className="press-tactile inline-flex min-h-11 items-center gap-2 rounded-[4px] border border-hairline bg-surface px-4 py-2.5 text-sm font-semibold text-ink hover:border-hairline-strong"
                >
                  <ShieldCheck size={16} weight="regular" aria-hidden="true" />
                  <span>Verify or Pay</span>
                </Link>
              </div>
            </div>

            {/* Live Mainnet & Relay Telemetry Rail */}
            <div className="border border-hairline bg-surface rounded-[6px] p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-hairline pb-2.5">
                <span className="font-display text-sm font-semibold text-ink">
                  Live Verification Infrastructure
                </span>
                <span className="crypto-token text-xs text-ink-muted">BCH Mainnet</span>
              </div>

              <dl className="space-y-2.5 text-sm">
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-ink-muted">Mainnet Height</dt>
                  <dd className="crypto-token font-semibold text-ink">
                    {bchStatus?.ok && bchStatus.blockHeight
                      ? `#${new Intl.NumberFormat('en-US').format(bchStatus.blockHeight)}`
                      : bchStatus === null
                        ? 'Querying…'
                        : 'Unavailable'}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-ink-muted">Fulcrum Node</dt>
                  <dd className="crypto-token text-xs text-ink-secondary truncate max-w-[200px]">
                    {bchStatus?.ok && bchStatus.node ? bchStatus.node : 'Connecting…'}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-ink-muted">Nostr Relays</dt>
                  <dd className="crypto-token text-xs font-medium text-ink">
                    {loadingRelays
                      ? 'Scanning 3 relays…'
                      : `${liveRelayCount} / ${relayStatuses.length || 3} reachable`}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-ink-muted">Verified Bindings</dt>
                  <dd className="crypto-token font-semibold text-emerald-notary">
                    {mergedEntries.filter((e) => e.verified).length}
                  </dd>
                </div>
              </dl>
            </div>

            {/* Commercial & Ecosystem Value Case */}
            <div className="border-t border-hairline pt-4 space-y-2">
              <h2 className="font-display text-sm font-semibold text-ink">
                Built for Verified BCH Commerce
              </h2>
              <p className="text-[13px] leading-relaxed text-ink-secondary">
                Merchants, creators, and BCH applications publish portable payment handles tied to
                their Nostr reputation. Any wallet or verifier resolves the CashAddress directly
                from Nostr relays and BCH mainnet blocks without trusting a domain registrar or
                payment processor.
              </p>
            </div>
          </aside>

          {/* Right Main Ledger Column (8 cols) */}
          <section className="lg:col-span-8 min-w-0 space-y-4" aria-label="Identity binding ledger">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative flex-1 min-w-0">
                <MagnifyingGlass
                  size={16}
                  weight="regular"
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by handle, bitcoincash:q…, npub1…, or binding hash"
                  aria-label="Filter CashBind identity bindings"
                  spellCheck={false}
                  className="w-full h-11 pl-9 pr-3 text-sm bg-surface border border-hairline rounded-[4px] text-ink placeholder:text-ink-muted focus:border-emerald-notary"
                />
              </div>

              <button
                type="button"
                onClick={() => {
                  void loadNetworkData();
                }}
                disabled={loadingRelays}
                className="press-tactile inline-flex min-h-11 items-center justify-center gap-2 rounded-[4px] border border-hairline bg-surface px-3.5 text-sm font-medium text-ink hover:border-hairline-strong disabled:opacity-60 cursor-pointer whitespace-nowrap shrink-0"
              >
                <ArrowsClockwise
                  size={15}
                  weight="regular"
                  className={loadingRelays ? 'animate-spin' : ''}
                  aria-hidden="true"
                />
                <span>Refresh Relays</span>
              </button>
            </div>

            {/* Source Filters */}
            <div
              className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline pb-3"
              role="group"
              aria-label="Filter bindings by source"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    { id: 'all', label: 'All Records' },
                    { id: 'anchored', label: 'On-Chain Anchored' },
                    { id: 'relay', label: 'Relay Discovered' },
                    { id: 'local', label: 'Local Vault' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setSourceFilter(tab.id)}
                    aria-pressed={sourceFilter === tab.id}
                    className={`press-tactile min-h-9 rounded-[4px] px-3 text-xs font-semibold cursor-pointer ${
                      sourceFilter === tab.id
                        ? 'bg-ink text-white'
                        : 'border border-hairline bg-surface text-ink-secondary hover:text-ink hover:border-hairline-strong'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {mergedEntries.length > 0 ? (
                <button
                  type="button"
                  onClick={handleGenerateTestProof}
                  className="press-tactile min-h-9 rounded-[4px] border border-hairline bg-subtle/70 px-3 text-xs font-semibold text-ink hover:border-hairline-strong cursor-pointer"
                >
                  Generate Live Test Proof
                </button>
              ) : null}
            </div>

            {relayError ? (
              <div
                role="alert"
                className="flex flex-wrap items-center justify-between gap-3 rounded-[4px] border border-status-invalid/30 bg-status-invalid-bg px-4 py-3 text-sm text-status-invalid"
              >
                <span>{relayError}</span>
                <button
                  type="button"
                  onClick={() => {
                    void loadNetworkData();
                  }}
                  className="font-semibold underline underline-offset-4 cursor-pointer"
                >
                  Retry
                </button>
              </div>
            ) : null}

            {/* Ledger Table */}
            <div className="border border-hairline bg-surface rounded-[6px] overflow-hidden">
              {loadingRelays && mergedEntries.length === 0 ? (
                <div className="divide-y divide-hairline" aria-busy="true" aria-label="Loading bindings">
                  {[0, 1, 2, 3].map((row) => (
                    <div key={row} className="grid grid-cols-12 gap-4 px-4 py-4">
                      <div className="col-span-3 h-4 rounded bg-subtle animate-pulse" />
                      <div className="col-span-4 h-4 rounded bg-subtle animate-pulse" />
                      <div className="col-span-3 h-4 rounded bg-subtle animate-pulse" />
                      <div className="col-span-2 h-4 rounded bg-subtle animate-pulse" />
                    </div>
                  ))}
                </div>
              ) : filteredEntries.length === 0 ? (
                <div className="px-6 py-12 text-center space-y-4">
                  <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-[4px] border border-hairline bg-subtle text-ink-secondary">
                    <Cube size={20} weight="regular" aria-hidden="true" />
                  </div>
                  <div className="space-y-1">
                    <h2 className="font-display text-lg font-semibold text-ink">
                      {mergedEntries.length === 0
                        ? 'No CashBind records found on public relays yet'
                        : 'No bindings match your filter'}
                    </h2>
                    <p className="mx-auto max-w-md text-sm text-ink-secondary">
                      {mergedEntries.length === 0
                        ? 'Create and publish the first live dual-signed BCH and Nostr binding, or generate a real in-browser cryptographic test proof to inspect verification right away.'
                        : 'Clear the search query or switch the source filter to see all verified records.'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
                    <Link
                      to="/bind"
                      className="press-tactile inline-flex min-h-11 items-center gap-2 rounded-[4px] bg-emerald-notary px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-notary-hover"
                    >
                      <span>Bind Your Identity</span>
                      <ArrowRight size={15} weight="regular" aria-hidden="true" />
                    </Link>
                    <button
                      type="button"
                      onClick={handleGenerateTestProof}
                      className="press-tactile inline-flex min-h-11 items-center gap-2 rounded-[4px] border border-hairline bg-surface px-4 py-2 text-sm font-semibold text-ink hover:border-hairline-strong cursor-pointer"
                    >
                      <span>Generate Live Test Proof</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-hairline bg-subtle/65 text-xs font-semibold text-ink-secondary">
                        <th scope="col" className="px-4 py-3">
                          Handle
                        </th>
                        <th scope="col" className="px-4 py-3">
                          BCH CashAddress
                        </th>
                        <th scope="col" className="px-4 py-3">
                          Nostr Identity
                        </th>
                        <th scope="col" className="px-4 py-3">
                          Proof Status
                        </th>
                        <th scope="col" className="px-4 py-3 text-right">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-hairline">
                      {filteredEntries.map((entry) => {
                        const npub = formatNpub(entry.bundle.payload.nostrPubkey);
                        return (
                          <tr
                            key={entry.bundle.bindingHash}
                            className="hover:bg-subtle/40 transition-colors"
                          >
                            <td className="px-4 py-3.5 align-top">
                              <div className="font-semibold text-ink">
                                {entry.bundle.payload.handle}
                              </div>
                              <div className="mt-0.5 text-xs text-ink-muted">
                                {formatTimestamp(entry.bundle.payload.issuedAt)}
                              </div>
                            </td>
                            <td className="px-4 py-3.5 align-top">
                              <code
                                className="crypto-token text-xs text-ink"
                                title={entry.bundle.payload.bchAddress}
                                translate="no"
                              >
                                {truncateMiddle(entry.bundle.payload.bchAddress, 18, 7)}
                              </code>
                            </td>
                            <td className="px-4 py-3.5 align-top">
                              <code
                                className="crypto-token text-xs text-ink-secondary"
                                title={npub}
                                translate="no"
                              >
                                {truncateMiddle(npub, 13, 6)}
                              </code>
                            </td>
                            <td className="px-4 py-3.5 align-top">
                              <div
                                className={`text-xs font-semibold ${
                                  entry.verified ? 'text-emerald-notary' : 'text-status-invalid'
                                }`}
                              >
                                {entry.verified ? 'Dual-Signed' : 'Invalid Proof'}
                              </div>
                              <div className="mt-0.5 text-xs text-ink-muted">
                                {entry.bundle.anchorTxid
                                  ? 'BCH Mainnet Anchored'
                                  : entry.sources.includes('relay')
                                    ? 'Public Nostr Relay'
                                    : 'Local Vault Only'}
                              </div>
                            </td>
                            <td className="px-4 py-3.5 align-top text-right">
                              <div className="inline-flex items-center justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => setSelectedBundle(entry.bundle)}
                                  className="press-tactile min-h-9 rounded-[4px] border border-hairline bg-surface px-2.5 text-xs font-semibold text-ink hover:border-hairline-strong cursor-pointer"
                                >
                                  Inspect
                                </button>
                                <Link
                                  to={`/verify?hash=${encodeURIComponent(entry.bundle.bindingHash)}`}
                                  className="press-tactile inline-flex min-h-9 items-center rounded-[4px] bg-emerald-soft px-2.5 text-xs font-semibold text-emerald-notary hover:bg-emerald-notary hover:text-white"
                                >
                                  Verify &amp; Pay
                                </Link>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      {/* Proof Inspection Slide-Over Drawer */}
      {selectedBundle && selectedReport ? (
        <div
          className="fixed inset-0 z-40 flex justify-end bg-ink/40"
          role="dialog"
          aria-modal="true"
          aria-label="Inspect CashBind proof"
        >
          <div className="relative flex h-full w-full max-w-xl flex-col bg-surface border-l border-hairline notary-floating-shadow overflow-y-auto">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-hairline bg-surface px-5 py-4">
              <div>
                <h2 className="font-display text-lg font-bold text-ink">
                  {selectedBundle.payload.handle}
                </h2>
                <p className="crypto-token text-xs text-ink-muted">
                  Digest {truncateMiddle(selectedBundle.bindingHash, 14, 12)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedBundle(null)}
                aria-label="Close proof inspector"
                className="press-tactile inline-flex min-h-11 min-w-11 items-center justify-center rounded-[4px] border border-hairline bg-surface text-ink hover:border-hairline-strong cursor-pointer"
              >
                <X size={18} weight="regular" aria-hidden="true" />
              </button>
            </div>

            <div className="p-5 space-y-5 flex-1">
              <NotarySeal
                status={selectedReport.valid ? 'verified' : 'invalid'}
                title={selectedReport.valid ? 'Cryptographic Binding Verified' : 'Proof Failed Audit'}
                subtitle={
                  selectedBundle.anchorTxid
                    ? `Anchored on BCH mainnet (${truncateMiddle(selectedBundle.anchorTxid, 12, 8)})`
                    : 'Dual BCH ECDSA and Nostr Schnorr signatures valid; ready for on-chain OP_RETURN anchor.'
                }
                compact
              />

              <div className="space-y-3 border-t border-hairline pt-4">
                <div>
                  <div className="flex items-center justify-between text-xs font-medium text-ink-muted">
                    <span>Bound BCH CashAddress</span>
                    <button
                      type="button"
                      onClick={() =>
                        void handleCopy('bch', selectedBundle.payload.bchAddress)
                      }
                      className="inline-flex items-center gap-1 text-ink hover:text-emerald-notary cursor-pointer"
                    >
                      {copiedField === 'bch' ? (
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
                  <code className="mt-1 block crypto-token text-xs text-ink bg-subtle/70 border border-hairline rounded-[4px] px-3 py-2">
                    {selectedBundle.payload.bchAddress}
                  </code>
                </div>

                <div>
                  <div className="flex items-center justify-between text-xs font-medium text-ink-muted">
                    <span>Bound Nostr npub</span>
                    <button
                      type="button"
                      onClick={() =>
                        void handleCopy('npub', formatNpub(selectedBundle.payload.nostrPubkey))
                      }
                      className="inline-flex items-center gap-1 text-ink hover:text-emerald-notary cursor-pointer"
                    >
                      {copiedField === 'npub' ? (
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
                  <code className="mt-1 block crypto-token text-xs text-ink bg-subtle/70 border border-hairline rounded-[4px] px-3 py-2">
                    {formatNpub(selectedBundle.payload.nostrPubkey)}
                  </code>
                </div>

                <div>
                  <span className="block text-xs font-medium text-ink-muted">
                    SHA-256 Binding Digest
                  </span>
                  <code className="mt-1 block crypto-token text-xs text-ink bg-subtle/70 border border-hairline rounded-[4px] px-3 py-2">
                    {selectedBundle.bindingHash}
                  </code>
                </div>

                {selectedBundle.anchorTxid ? (
                  <div>
                    <span className="block text-xs font-medium text-ink-muted">
                      BCH Mainnet OP_RETURN Anchor Transaction
                    </span>
                    <a
                      href={`https://blockchair.com/bitcoin-cash/transaction/${selectedBundle.anchorTxid}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex items-center gap-1.5 crypto-token text-xs text-emerald-notary underline underline-offset-4"
                    >
                      <span>{selectedBundle.anchorTxid}</span>
                      <ArrowSquareOut size={13} weight="regular" aria-hidden="true" />
                    </a>
                  </div>
                ) : null}

                <div>
                  <span className="block text-xs font-medium text-ink-muted">
                    Canonical Signed Payload
                  </span>
                  <pre className="mt-1 whitespace-pre-wrap break-all crypto-token text-[11px] leading-relaxed text-ink-secondary bg-subtle/70 border border-hairline rounded-[4px] p-3">
                    {JSON.stringify(selectedBundle.payload, null, 2)}
                  </pre>
                </div>
              </div>
            </div>

            <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 border-t border-hairline bg-surface px-5 py-4">
              <Link
                to={`/vault?hash=${encodeURIComponent(selectedBundle.bindingHash)}`}
                onClick={() => setSelectedBundle(null)}
                className="press-tactile inline-flex min-h-11 items-center gap-1.5 rounded-[4px] border border-hairline bg-surface px-3.5 text-xs font-semibold text-ink hover:border-hairline-strong"
              >
                <span>Attestations &amp; DID</span>
              </Link>
              <Link
                to={`/verify?hash=${encodeURIComponent(selectedBundle.bindingHash)}`}
                onClick={() => setSelectedBundle(null)}
                className="press-tactile inline-flex min-h-11 items-center gap-1.5 rounded-[4px] bg-emerald-notary px-4 text-xs font-semibold text-white hover:bg-emerald-notary-hover"
              >
                <span>Open in Verify &amp; Pay</span>
                <ArrowRight size={14} weight="regular" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
