import { Relay, type Event as NostrEvent, type Filter } from 'nostr-tools';
import {
  CASHBIND_NOSTR_KIND,
  DEFAULT_NOSTR_RELAYS,
  formatNpub,
  parseBindingBundleFromNostrEvent,
  verifyBindingBundle,
  verifySignedAttestation,
  type CashBindAttestation,
  type CashBindBundle,
} from './protocol';

export interface RelayPublishOutcome {
  relay: string;
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export async function publishEventToRelays(
  event: NostrEvent,
  relays: string[] = [...DEFAULT_NOSTR_RELAYS],
  timeoutMs = 6000,
): Promise<RelayPublishOutcome[]> {
  return Promise.all(
    relays.map(async (relayUrl) => {
      const started = performance.now();
      let relay: Relay | null = null;
      try {
        relay = await Promise.race([
          Relay.connect(relayUrl),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Relay connection timed out')), timeoutMs),
          ),
        ]);
        await Promise.race([
          relay.publish(event),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Relay publish ack timed out')), timeoutMs),
          ),
        ]);
        return {
          relay: relayUrl,
          ok: true,
          latencyMs: Math.round(performance.now() - started),
        };
      } catch (err) {
        return {
          relay: relayUrl,
          ok: false,
          latencyMs: Math.round(performance.now() - started),
          error: err instanceof Error ? err.message : 'Relay publish failed',
        };
      } finally {
        if (relay) {
          try {
            relay.close();
          } catch {
            // ignore close error
          }
        }
      }
    }),
  );
}

async function querySingleRelay(
  relayUrl: string,
  filter: Filter,
  timeoutMs = 4500,
): Promise<{ relay: string; ok: boolean; events: NostrEvent[]; error?: string }> {
  let relay: Relay | null = null;
  try {
    relay = await Promise.race([
      Relay.connect(relayUrl),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Connection timeout')), timeoutMs),
      ),
    ]);

    const events = await new Promise<NostrEvent[]>((resolve) => {
      const collected: NostrEvent[] = [];
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try {
          sub.close();
        } catch {
          // ignore
        }
        resolve(collected);
      };
      const timer = setTimeout(finish, timeoutMs);
      const sub = relay!.subscribe([filter], {
        onevent(evt) {
          collected.push(evt);
        },
        oneose() {
          finish();
        },
      });
    });

    return { relay: relayUrl, ok: true, events };
  } catch (err) {
    return {
      relay: relayUrl,
      ok: false,
      events: [],
      error: err instanceof Error ? err.message : 'Query failed',
    };
  } finally {
    if (relay) {
      try {
        relay.close();
      } catch {
        // ignore
      }
    }
  }
}

export async function discoverBindingsFromRelays(options?: {
  relays?: string[];
  authorPubkey?: string;
  bchAddress?: string;
  bindingHash?: string;
  limit?: number;
}): Promise<{
  bundles: CashBindBundle[];
  relayStatuses: Array<{ relay: string; ok: boolean; count: number; error?: string }>;
}> {
  const relays = options?.relays ?? [...DEFAULT_NOSTR_RELAYS];
  const filter: Filter = {
    kinds: [CASHBIND_NOSTR_KIND],
    '#t': ['cashbind'],
    limit: options?.limit ?? 30,
  };
  if (options?.authorPubkey) filter.authors = [options.authorPubkey];
  if (options?.bchAddress) filter['#bch'] = [options.bchAddress];
  if (options?.bindingHash) filter['#h'] = [options.bindingHash];

  const results = await Promise.all(relays.map((r) => querySingleRelay(r, filter)));

  const byHash = new Map<string, { bundle: CashBindBundle; relays: Set<string> }>();

  for (const res of results) {
    for (const evt of res.events) {
      const bundle = parseBindingBundleFromNostrEvent(evt, [res.relay]);
      if (!bundle) continue;
      const check = verifyBindingBundle(bundle);
      if (!check.valid) continue;
      const existing = byHash.get(bundle.bindingHash);
      if (existing) {
        existing.relays.add(res.relay);
        if (!existing.bundle.anchorTxid && bundle.anchorTxid) {
          existing.bundle.anchorTxid = bundle.anchorTxid;
        }
      } else {
        byHash.set(bundle.bindingHash, { bundle, relays: new Set([res.relay]) });
      }
    }
  }

  const bundles = [...byHash.values()]
    .map(({ bundle, relays: seen }) => ({
      ...bundle,
      relays: [...seen],
    }))
    .sort((a, b) => b.payload.issuedAt - a.payload.issuedAt);

  return {
    bundles,
    relayStatuses: results.map((r) => ({
      relay: r.relay,
      ok: r.ok,
      count: r.events.length,
      error: r.error,
    })),
  };
}

export async function discoverAttestationsFromRelays(options?: {
  relays?: string[];
  bindingHash?: string;
}): Promise<CashBindAttestation[]> {
  const relays = options?.relays ?? [...DEFAULT_NOSTR_RELAYS];
  const filter: Filter = {
    kinds: [CASHBIND_NOSTR_KIND],
    '#t': ['cashbind-attestation'],
    limit: 30,
  };
  if (options?.bindingHash) filter['#h'] = [options.bindingHash];

  const results = await Promise.all(relays.map((r) => querySingleRelay(r, filter)));
  const seen = new Map<string, CashBindAttestation>();

  for (const res of results) {
    for (const evt of res.events) {
      try {
        const parsed = JSON.parse(evt.content) as {
          protocol?: string;
          issuerLabel?: string;
          subjectBindingHash?: string;
          subjectNostrPubkey?: string;
          subjectBchAddress?: string;
          claimType?: string;
          claimStatement?: string;
          issuedAt?: number;
        };
        if (parsed.protocol !== 'cashbind-attestation/v1' || !parsed.subjectBindingHash) continue;
        const att: CashBindAttestation = {
          id: evt.id,
          issuerNostrPubkey: evt.pubkey,
          issuerNpub: formatNpub(evt.pubkey),
          issuerLabel: parsed.issuerLabel || 'Independent Issuer',
          subjectBindingHash: parsed.subjectBindingHash,
          subjectNostrPubkey: parsed.subjectNostrPubkey || '',
          subjectBchAddress: parsed.subjectBchAddress || '',
          claimType: parsed.claimType || 'endorsement',
          claimStatement: parsed.claimStatement || '',
          issuedAt: parsed.issuedAt || evt.created_at,
          nostrEvent: evt,
        };
        if (verifySignedAttestation(att).valid && !seen.has(att.id)) {
          seen.set(att.id, att);
        }
      } catch {
        // skip malformed events
      }
    }
  }

  return [...seen.values()].sort((a, b) => b.issuedAt - a.issuedAt);
}
