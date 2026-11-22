import type { CashBindAttestation, CashBindBundle } from './protocol';

const BUNDLES_KEY = 'cashbind:v1:bundles';
const ATTESTATIONS_KEY = 'cashbind:v1:attestations';

export function loadLocalBundles(): CashBindBundle[] {
  try {
    const raw = localStorage.getItem(BUNDLES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CashBindBundle[]) : [];
  } catch {
    return [];
  }
}

export function saveLocalBundle(bundle: CashBindBundle): CashBindBundle[] {
  const existing = loadLocalBundles().filter((b) => b.bindingHash !== bundle.bindingHash);
  const next = [bundle, ...existing].slice(0, 50);
  localStorage.setItem(BUNDLES_KEY, JSON.stringify(next));
  return next;
}

export function updateLocalBundleAnchor(
  bindingHash: string,
  anchorTxid: string,
  anchorBlockHeight?: number,
): CashBindBundle[] {
  const existing = loadLocalBundles();
  const next = existing.map((b) =>
    b.bindingHash === bindingHash
      ? { ...b, anchorTxid, anchorBlockHeight: anchorBlockHeight ?? b.anchorBlockHeight }
      : b,
  );
  localStorage.setItem(BUNDLES_KEY, JSON.stringify(next));
  return next;
}

export function removeLocalBundle(bindingHash: string): CashBindBundle[] {
  const next = loadLocalBundles().filter((b) => b.bindingHash !== bindingHash);
  localStorage.setItem(BUNDLES_KEY, JSON.stringify(next));
  return next;
}

export function loadLocalAttestations(): CashBindAttestation[] {
  try {
    const raw = localStorage.getItem(ATTESTATIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CashBindAttestation[]) : [];
  } catch {
    return [];
  }
}

export function saveLocalAttestation(att: CashBindAttestation): CashBindAttestation[] {
  const existing = loadLocalAttestations().filter((a) => a.id !== att.id);
  const next = [att, ...existing].slice(0, 50);
  localStorage.setItem(ATTESTATIONS_KEY, JSON.stringify(next));
  return next;
}
