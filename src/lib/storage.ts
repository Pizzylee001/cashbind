import type { CashBindAttestation, CashBindBundle } from './protocol';

const BUNDLES_KEY = 'cashbind:v1:bundles';
const ATTESTATIONS_KEY = 'cashbind:v1:attestations';
const BANNER_CONFIG_KEY = 'cashbind:v1:blaze-banner';

export interface BlazeBannerConfig {
  presentationUrl: string;
  repoUrl: string;
  emberCashTokensAddress: string;
}

export const DEFAULT_BLAZE_BANNER: BlazeBannerConfig = {
  presentationUrl: '/deck.html',
  repoUrl: 'https://github.com/Pizzylee001/cashbind',
  emberCashTokensAddress: 'bitcoincash:z_replace_with_your_cashtokens_address',
};

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

export function loadBlazeBannerConfig(): BlazeBannerConfig {
  try {
    const raw = localStorage.getItem(BANNER_CONFIG_KEY);
    if (!raw) return DEFAULT_BLAZE_BANNER;
    const parsed = JSON.parse(raw) as Partial<BlazeBannerConfig>;
    return {
      presentationUrl: parsed.presentationUrl || DEFAULT_BLAZE_BANNER.presentationUrl,
      repoUrl: parsed.repoUrl || DEFAULT_BLAZE_BANNER.repoUrl,
      emberCashTokensAddress:
        parsed.emberCashTokensAddress || DEFAULT_BLAZE_BANNER.emberCashTokensAddress,
    };
  } catch {
    return DEFAULT_BLAZE_BANNER;
  }
}

export function saveBlazeBannerConfig(config: BlazeBannerConfig): BlazeBannerConfig {
  localStorage.setItem(BANNER_CONFIG_KEY, JSON.stringify(config));
  return config;
}
