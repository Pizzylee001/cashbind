import {
  base64ToBin,
  binToBase64,
  binToHex,
  cashAddressToLockingBytecode,
  decodeCashAddress,
  decodePrivateKeyWif,
  encodeCashAddress,
  encodeDataPush,
  encodePrivateKeyWif,
  hash160,
  hexToBin,
  OpcodesBCH,
  secp256k1,
  sha256,
  utf8ToBin,
} from '@bitauth/libauth';
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip19,
  verifyEvent,
  type Event as NostrEvent,
  type EventTemplate,
} from 'nostr-tools';

export const CASHBIND_DOMAIN = 'cashbind.protocol/v1';
export const CASHBIND_NOSTR_KIND = 30078;
export const CASHBIND_OP_RETURN_TAG = 'CASHBIND';
export const CASHBIND_OP_RETURN_VERSION = 'v1';

export const DEFAULT_NOSTR_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
] as const;

export interface BchIdentity {
  privateKeyHex: string;
  publicKeyHex: string;
  address: string;
  wif: string;
}

export interface NostrIdentity {
  privateKeyHex: string;
  publicKeyHex: string;
  npub: string;
  nsec: string;
}

export interface CashBindPayload {
  version: 1;
  domain: typeof CASHBIND_DOMAIN;
  nostrPubkey: string;
  bchAddress: string;
  bchPubkey: string;
  handle: string;
  issuedAt: number;
  merchantNote?: string;
  prevBindingHash?: string;
  prevTxid?: string;
}

export interface CashBindBundle {
  payload: CashBindPayload;
  canonicalPayload: string;
  bindingHash: string;
  bchSignature: string;
  nostrEvent: NostrEvent;
  relays: string[];
  anchorTxid?: string;
  anchorBlockHeight?: number;
}

export interface CheckDetail {
  ok: boolean;
  detail: string;
}

export interface BindingVerificationReport {
  valid: boolean;
  bindingHash: string;
  checks: {
    distinctKeys: CheckDetail;
    bchAddressMatch: CheckDetail;
    bchSignature: CheckDetail;
    nostrSignature: CheckDetail;
    payloadHashMatch: CheckDetail;
  };
}

export interface DecodedOpReturnCommitment {
  protocol: string;
  version: string;
  bindingHash: string;
}

export interface AuthChallenge {
  nonce: string;
  domain: string;
  issuedAt: number;
  expiresAt: number;
  message: string;
}

export interface AuthChallengeProof {
  method: 'bch' | 'nostr';
  nonce: string;
  signer: string;
  signature: string;
  nostrEvent?: NostrEvent;
}

export interface CashBindAttestation {
  id: string;
  issuerNostrPubkey: string;
  issuerNpub: string;
  issuerLabel: string;
  subjectBindingHash: string;
  subjectNostrPubkey: string;
  subjectBchAddress: string;
  claimType: string;
  claimStatement: string;
  issuedAt: number;
  nostrEvent: NostrEvent;
}

export interface DidNostrDocument {
  '@context': string[];
  id: string;
  alsoKnownAs: string[];
  verificationMethod: Array<{
    id: string;
    type: string;
    controller: string;
    publicKeyHex: string;
    blockchainAccountId?: string;
  }>;
  authentication: string[];
  assertionMethod: string[];
  service: Array<{
    id: string;
    type: string;
    serviceEndpoint: string | Record<string, unknown>;
  }>;
}

function randomBytes32(): Uint8Array {
  const bytes = new Uint8Array(32);
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }
  throw new Error('Secure WebCrypto randomness is unavailable in this environment.');
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function encodeVarUint(n: number): Uint8Array {
  if (n < 0xfd) return Uint8Array.of(n);
  if (n <= 0xffff) return Uint8Array.of(0xfd, n & 0xff, (n >> 8) & 0xff);
  return Uint8Array.of(
    0xfe,
    n & 0xff,
    (n >> 8) & 0xff,
    (n >> 16) & 0xff,
    (n >> 24) & 0xff,
  );
}

export function normalizeCashAddress(input: string): string {
  const trimmed = input.trim().toLowerCase();
  const withPrefix = trimmed.includes(':') ? trimmed : `bitcoincash:${trimmed}`;
  const decoded = decodeCashAddress(withPrefix);
  if (typeof decoded === 'string') {
    throw new Error(`Invalid Bitcoin Cash address: ${decoded}`);
  }
  const reencoded = encodeCashAddress({
    prefix: decoded.prefix,
    type: decoded.type,
    payload: decoded.payload,
  });
  if (typeof reencoded === 'string') {
    throw new Error(`Could not normalize CashAddress: ${reencoded}`);
  }
  return reencoded.address;
}

export function deriveCashAddressFromPublicKey(publicKeyHex: string): string {
  const pubBytes = hexToBin(publicKeyHex.trim());
  if (pubBytes.length !== 33 && pubBytes.length !== 65) {
    throw new Error('BCH public key must be 33-byte compressed or 65-byte uncompressed hex.');
  }
  const pkh = hash160(pubBytes);
  const encoded = encodeCashAddress({
    prefix: 'bitcoincash',
    type: 'p2pkh',
    payload: pkh,
  });
  if (typeof encoded === 'string') {
    throw new Error(`Failed to encode CashAddress: ${encoded}`);
  }
  return encoded.address;
}

export function generateBchIdentity(): BchIdentity {
  for (let attempt = 0; attempt < 16; attempt++) {
    const priv = randomBytes32();
    const pub = secp256k1.derivePublicKeyCompressed(priv);
    if (typeof pub === 'string') continue;
    const publicKeyHex = binToHex(pub);
    const address = deriveCashAddressFromPublicKey(publicKeyHex);
    const wif = encodePrivateKeyWif(priv, 'mainnet');
    return {
      privateKeyHex: binToHex(priv),
      publicKeyHex,
      address,
      wif,
    };
  }
  throw new Error('Could not generate a valid secp256k1 BCH keypair.');
}

export function importBchWif(wifInput: string): BchIdentity {
  const cleaned = wifInput.trim();
  const decoded = decodePrivateKeyWif(cleaned);
  if (typeof decoded === 'string') {
    throw new Error(`Invalid BCH WIF key: ${decoded}`);
  }
  const pub = secp256k1.derivePublicKeyCompressed(decoded.privateKey);
  if (typeof pub === 'string') {
    throw new Error(`Invalid secp256k1 private key: ${pub}`);
  }
  const publicKeyHex = binToHex(pub);
  const address = deriveCashAddressFromPublicKey(publicKeyHex);
  return {
    privateKeyHex: binToHex(decoded.privateKey),
    publicKeyHex,
    address,
    wif: encodePrivateKeyWif(decoded.privateKey, 'mainnet'),
  };
}

export function generateNostrIdentity(): NostrIdentity {
  const sk = generateSecretKey();
  const publicKeyHex = getPublicKey(sk);
  return {
    privateKeyHex: binToHex(sk),
    publicKeyHex,
    npub: nip19.npubEncode(publicKeyHex),
    nsec: nip19.nsecEncode(sk),
  };
}

export function importNostrNsec(input: string): NostrIdentity {
  const trimmed = input.trim();
  let skBytes: Uint8Array;
  if (trimmed.startsWith('nsec1')) {
    const decoded = nip19.decode(trimmed);
    if (decoded.type !== 'nsec') {
      throw new Error('Expected a Nostr nsec1 private key.');
    }
    skBytes = decoded.data;
  } else if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    skBytes = hexToBin(trimmed.toLowerCase());
  } else {
    throw new Error('Enter a valid Nostr nsec1 key or 64-character hex private key.');
  }
  const publicKeyHex = getPublicKey(skBytes);
  return {
    privateKeyHex: binToHex(skBytes),
    publicKeyHex,
    npub: nip19.npubEncode(publicKeyHex),
    nsec: nip19.nsecEncode(skBytes),
  };
}

export function normalizeNostrPubkey(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith('npub1')) {
    const decoded = nip19.decode(trimmed);
    if (decoded.type !== 'npub') {
      throw new Error('Invalid Nostr npub key.');
    }
    return decoded.data;
  }
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  throw new Error('Enter a valid npub1 identifier or 64-character Nostr hex pubkey.');
}

export function areKeysDistinct(bchPubkeyHex: string, nostrPubkeyHex: string): boolean {
  const cleanBch = bchPubkeyHex.trim().toLowerCase();
  const cleanNostr = nostrPubkeyHex.trim().toLowerCase();
  const bchXOnly = cleanBch.length === 66 ? cleanBch.slice(2) : cleanBch.slice(2, 66);
  return bchXOnly !== cleanNostr;
}

export function canonicalizeBindingPayload(payload: CashBindPayload): string {
  const ordered: Record<string, unknown> = {
    version: payload.version,
    domain: payload.domain,
    nostrPubkey: payload.nostrPubkey.toLowerCase(),
    bchAddress: normalizeCashAddress(payload.bchAddress),
    bchPubkey: payload.bchPubkey.toLowerCase(),
    handle: payload.handle.trim(),
    issuedAt: payload.issuedAt,
  };
  if (payload.merchantNote && payload.merchantNote.trim().length > 0) {
    ordered.merchantNote = payload.merchantNote.trim();
  }
  if (payload.prevBindingHash && payload.prevBindingHash.trim().length > 0) {
    ordered.prevBindingHash = payload.prevBindingHash.trim().toLowerCase();
  }
  if (payload.prevTxid && payload.prevTxid.trim().length > 0) {
    ordered.prevTxid = payload.prevTxid.trim().toLowerCase();
  }
  return JSON.stringify(ordered);
}

export function computeBindingHash(canonicalPayload: string): string {
  return binToHex(sha256.hash(utf8ToBin(canonicalPayload)));
}

function bitcoinSignedMessageHash(message: string): Uint8Array {
  const prefix = utf8ToBin('Bitcoin Signed Message:\n');
  const msgBytes = utf8ToBin(message);
  const full = concatBytes(
    encodeVarUint(prefix.length),
    prefix,
    encodeVarUint(msgBytes.length),
    msgBytes,
  );
  return sha256.hash(sha256.hash(full));
}

export function signBchMessage(message: string, bchPrivateKeyHex: string): string {
  const privBytes = hexToBin(bchPrivateKeyHex.trim());
  const msgHash = bitcoinSignedMessageHash(message);
  const signed = secp256k1.signMessageHashRecoverableCompact(privBytes, msgHash);
  if (typeof signed === 'string') {
    throw new Error(`Failed to sign BCH message: ${signed}`);
  }
  const headerByte = 31 + signed.recoveryId;
  const compact65 = concatBytes(Uint8Array.of(headerByte), signed.signature);
  return binToBase64(compact65);
}

export function verifyBchMessage(
  message: string,
  signatureBase64: string,
  expectedAddress: string,
  expectedPubkeyHex?: string,
): { valid: boolean; recoveredAddress?: string; recoveredPubkeyHex?: string; reason?: string } {
  try {
    const normalizedExpected = normalizeCashAddress(expectedAddress);
    const sigBytes = base64ToBin(signatureBase64.trim());
    if (sigBytes.length !== 65) {
      return { valid: false, reason: 'BCH signature must decode to 65 compact recoverable bytes.' };
    }
    const header = sigBytes[0];
    let recoveryId: number;
    let compressed = true;
    if (header >= 31 && header <= 34) {
      recoveryId = header - 31;
      compressed = true;
    } else if (header >= 27 && header <= 30) {
      recoveryId = header - 27;
      compressed = false;
    } else {
      return { valid: false, reason: `Unsupported Bitcoin Signed Message header byte: ${header}.` };
    }
    const sig64 = sigBytes.slice(1);
    const msgHash = bitcoinSignedMessageHash(message);
    const recoveredPub = compressed
      ? secp256k1.recoverPublicKeyCompressed(sig64, recoveryId as 0 | 1 | 2 | 3, msgHash)
      : secp256k1.recoverPublicKeyUncompressed(sig64, recoveryId as 0 | 1 | 2 | 3, msgHash);
    if (typeof recoveredPub === 'string') {
      return { valid: false, reason: `Public key recovery failed: ${recoveredPub}` };
    }
    const recoveredPubkeyHex = binToHex(recoveredPub);
    const recoveredAddress = deriveCashAddressFromPublicKey(recoveredPubkeyHex);
    if (recoveredAddress !== normalizedExpected) {
      return {
        valid: false,
        recoveredAddress,
        recoveredPubkeyHex,
        reason: 'Recovered CashAddress does not match the claimed BCH address.',
      };
    }
    if (expectedPubkeyHex && compressed && recoveredPubkeyHex.toLowerCase() !== expectedPubkeyHex.trim().toLowerCase()) {
      return {
        valid: false,
        recoveredAddress,
        recoveredPubkeyHex,
        reason: 'Recovered BCH public key does not match the claimed BCH public key.',
      };
    }
    return { valid: true, recoveredAddress, recoveredPubkeyHex };
  } catch (err) {
    return {
      valid: false,
      reason: err instanceof Error ? err.message : 'Unable to parse BCH signature.',
    };
  }
}

export function buildNostrBindingTemplate(params: {
  payload: CashBindPayload;
  canonicalPayload: string;
  bindingHash: string;
  bchSignature: string;
  anchorTxid?: string;
}): EventTemplate {
  const tags: string[][] = [
    ['d', `cashbind:v1:${params.payload.bchAddress}`],
    ['t', 'cashbind'],
    ['bch', params.payload.bchAddress],
    ['bch_pubkey', params.payload.bchPubkey],
    ['h', params.bindingHash],
    ['handle', params.payload.handle],
  ];
  if (params.payload.prevBindingHash) {
    tags.push(['prev_h', params.payload.prevBindingHash]);
  }
  if (params.payload.prevTxid) {
    tags.push(['prev_txid', params.payload.prevTxid]);
  }
  if (params.anchorTxid) {
    tags.push(['anchor_txid', params.anchorTxid]);
  }
  const content = JSON.stringify({
    payload: params.payload,
    canonicalPayload: params.canonicalPayload,
    bindingHash: params.bindingHash,
    bchSignature: params.bchSignature,
    anchorTxid: params.anchorTxid,
  });
  return {
    kind: CASHBIND_NOSTR_KIND,
    created_at: params.payload.issuedAt,
    tags,
    content,
  };
}

export function createSignedBindingBundle(params: {
  bchPrivateKeyHex: string;
  nostrPrivateKeyHex: string;
  handle: string;
  merchantNote?: string;
  prevBindingHash?: string;
  prevTxid?: string;
  relays?: string[];
  issuedAt?: number;
}): CashBindBundle {
  const bchPrivBytes = hexToBin(params.bchPrivateKeyHex.trim());
  const bchPubBytes = secp256k1.derivePublicKeyCompressed(bchPrivBytes);
  if (typeof bchPubBytes === 'string') {
    throw new Error(`Invalid BCH private key: ${bchPubBytes}`);
  }
  const bchPubkey = binToHex(bchPubBytes);
  const bchAddress = deriveCashAddressFromPublicKey(bchPubkey);

  const nostrPrivBytes = hexToBin(params.nostrPrivateKeyHex.trim());
  const nostrPubkey = getPublicKey(nostrPrivBytes);

  if (!areKeysDistinct(bchPubkey, nostrPubkey)) {
    throw new Error(
      'BCH and Nostr identities must use distinct cryptographic keys. Key reuse is prohibited by CashBind.',
    );
  }

  const payload: CashBindPayload = {
    version: 1,
    domain: CASHBIND_DOMAIN,
    nostrPubkey,
    bchAddress,
    bchPubkey,
    handle: params.handle.trim() || 'unnamed.bch',
    issuedAt: params.issuedAt ?? Math.floor(Date.now() / 1000),
    ...(params.merchantNote?.trim() ? { merchantNote: params.merchantNote.trim() } : {}),
    ...(params.prevBindingHash?.trim()
      ? { prevBindingHash: params.prevBindingHash.trim().toLowerCase() }
      : {}),
    ...(params.prevTxid?.trim() ? { prevTxid: params.prevTxid.trim().toLowerCase() } : {}),
  };

  const canonicalPayload = canonicalizeBindingPayload(payload);
  const bindingHash = computeBindingHash(canonicalPayload);
  const bchSignature = signBchMessage(canonicalPayload, params.bchPrivateKeyHex);

  const template = buildNostrBindingTemplate({
    payload,
    canonicalPayload,
    bindingHash,
    bchSignature,
  });
  const nostrEvent = finalizeEvent(template, nostrPrivBytes);

  return {
    payload,
    canonicalPayload,
    bindingHash,
    bchSignature,
    nostrEvent,
    relays: params.relays ?? [...DEFAULT_NOSTR_RELAYS],
  };
}

export function createBindingBundleFromExternalSignatures(params: {
  payload: CashBindPayload;
  bchSignature: string;
  nostrEvent: NostrEvent;
  relays?: string[];
  anchorTxid?: string;
}): CashBindBundle {
  const canonicalPayload = canonicalizeBindingPayload(params.payload);
  const bindingHash = computeBindingHash(canonicalPayload);
  return {
    payload: params.payload,
    canonicalPayload,
    bindingHash,
    bchSignature: params.bchSignature.trim(),
    nostrEvent: params.nostrEvent,
    relays: params.relays ?? [...DEFAULT_NOSTR_RELAYS],
    anchorTxid: params.anchorTxid,
  };
}

export function parseBindingBundleFromNostrEvent(
  event: NostrEvent,
  relays: string[] = [...DEFAULT_NOSTR_RELAYS],
): CashBindBundle | null {
  try {
    const parsed = JSON.parse(event.content) as {
      payload?: CashBindPayload;
      canonicalPayload?: string;
      bindingHash?: string;
      bchSignature?: string;
      anchorTxid?: string;
    };
    if (!parsed.payload || !parsed.bchSignature) return null;
    if (parsed.payload.domain !== CASHBIND_DOMAIN) return null;
    const anchorTag = event.tags.find((t) => t[0] === 'anchor_txid')?.[1];
    const canonicalPayload = canonicalizeBindingPayload(parsed.payload);
    const bindingHash = computeBindingHash(canonicalPayload);
    return {
      payload: parsed.payload,
      canonicalPayload,
      bindingHash,
      bchSignature: parsed.bchSignature,
      nostrEvent: event,
      relays,
      anchorTxid: parsed.anchorTxid || anchorTag,
    };
  } catch {
    return null;
  }
}

export function verifyBindingBundle(bundle: CashBindBundle): BindingVerificationReport {
  let recomputedCanonical = '';
  let recomputedHash = '';
  let addressMatchesPubkey = false;
  let bchAddrDetail = '';

  try {
    recomputedCanonical = canonicalizeBindingPayload(bundle.payload);
    recomputedHash = computeBindingHash(recomputedCanonical);
  } catch (err) {
    recomputedHash = '';
    bchAddrDetail = err instanceof Error ? err.message : 'Invalid payload structure.';
  }

  try {
    const derived = deriveCashAddressFromPublicKey(bundle.payload.bchPubkey);
    const claimed = normalizeCashAddress(bundle.payload.bchAddress);
    addressMatchesPubkey = derived === claimed;
    bchAddrDetail = addressMatchesPubkey
      ? 'BCH compressed secp256k1 pubkey hashes cleanly to the claimed CashAddress.'
      : `Claimed address ${claimed} does not match pubkey-derived address ${derived}.`;
  } catch (err) {
    addressMatchesPubkey = false;
    bchAddrDetail = err instanceof Error ? err.message : 'Invalid BCH public key or address.';
  }

  const distinctOk = areKeysDistinct(bundle.payload.bchPubkey, bundle.payload.nostrPubkey);
  const distinctKeys: CheckDetail = {
    ok: distinctOk,
    detail: distinctOk
      ? 'BCH and Nostr public keys have distinct secp256k1 x-coordinates (no key reuse).'
      : 'Rejected: BCH and Nostr keys share the same secp256k1 x-coordinate.',
  };

  let contentMatches = false;
  try {
    const parsedContent = JSON.parse(bundle.nostrEvent.content) as {
      bindingHash?: string;
      canonicalPayload?: string;
      bchSignature?: string;
    };
    const hTag = bundle.nostrEvent.tags.find((t) => t[0] === 'h')?.[1];
    contentMatches =
      Boolean(recomputedHash) &&
      recomputedHash === bundle.bindingHash &&
      parsedContent.bindingHash === recomputedHash &&
      parsedContent.canonicalPayload === recomputedCanonical &&
      parsedContent.bchSignature === bundle.bchSignature &&
      hTag === recomputedHash;
  } catch {
    contentMatches = false;
  }

  const payloadHashMatch: CheckDetail = {
    ok: contentMatches,
    detail: contentMatches
      ? `SHA-256 canonical binding digest ${recomputedHash.slice(0, 16)}… matches Nostr event content and h-tag.`
      : 'Canonical payload hash does not match the signed Nostr event content or tag.',
  };

  const bchSigCheck = recomputedCanonical
    ? verifyBchMessage(
        recomputedCanonical,
        bundle.bchSignature,
        bundle.payload.bchAddress,
        bundle.payload.bchPubkey,
      )
    : { valid: false, reason: 'Missing canonical payload.' };

  const bchSignature: CheckDetail = {
    ok: bchSigCheck.valid,
    detail: bchSigCheck.valid
      ? 'Bitcoin Signed Message ECDSA proof verified against claimed CashAddress.'
      : bchSigCheck.reason || 'BCH signature verification failed.',
  };

  let nostrSigValid = false;
  try {
    nostrSigValid =
      bundle.nostrEvent.pubkey.toLowerCase() === bundle.payload.nostrPubkey.toLowerCase() &&
      bundle.nostrEvent.kind === CASHBIND_NOSTR_KIND &&
      verifyEvent(bundle.nostrEvent);
  } catch {
    nostrSigValid = false;
  }

  const nostrSignature: CheckDetail = {
    ok: nostrSigValid,
    detail: nostrSigValid
      ? 'Nostr NIP-78 (kind:30078) Schnorr BIP-340 signature verified against claimed pubkey.'
      : 'Nostr Schnorr signature is invalid or pubkey does not match payload.',
  };

  const bchAddressMatch: CheckDetail = {
    ok: addressMatchesPubkey,
    detail: bchAddrDetail,
  };

  const valid =
    distinctKeys.ok &&
    bchAddressMatch.ok &&
    bchSignature.ok &&
    nostrSignature.ok &&
    payloadHashMatch.ok;

  return {
    valid,
    bindingHash: recomputedHash || bundle.bindingHash,
    checks: {
      distinctKeys,
      bchAddressMatch,
      bchSignature,
      nostrSignature,
      payloadHashMatch,
    },
  };
}

export function encodeCashBindOpReturn(bindingHashHex: string): Uint8Array {
  const cleanHash = bindingHashHex.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(cleanHash)) {
    throw new Error('Binding hash must be a 64-character SHA-256 hex digest.');
  }
  return concatBytes(
    Uint8Array.of(OpcodesBCH.OP_RETURN),
    encodeDataPush(utf8ToBin(CASHBIND_OP_RETURN_TAG)),
    encodeDataPush(utf8ToBin(CASHBIND_OP_RETURN_VERSION)),
    encodeDataPush(hexToBin(cleanHash)),
  );
}

export function decodeCashBindOpReturn(scriptPubKeyHex: string): DecodedOpReturnCommitment | null {
  try {
    const bytes = hexToBin(scriptPubKeyHex.trim().toLowerCase());
    if (bytes.length < 46 || bytes[0] !== OpcodesBCH.OP_RETURN) return null;

    let cursor = 1;
    const pushes: Uint8Array[] = [];
    while (cursor < bytes.length && pushes.length < 3) {
      const len = bytes[cursor];
      cursor += 1;
      if (len === 0 || len > 75 || cursor + len > bytes.length) return null;
      pushes.push(bytes.slice(cursor, cursor + len));
      cursor += len;
    }
    if (pushes.length !== 3) return null;

    const protocol = new TextDecoder().decode(pushes[0]);
    const version = new TextDecoder().decode(pushes[1]);
    const hashBytes = pushes[2];
    if (protocol !== CASHBIND_OP_RETURN_TAG || version !== CASHBIND_OP_RETURN_VERSION || hashBytes.length !== 32) {
      return null;
    }
    return {
      protocol,
      version,
      bindingHash: binToHex(hashBytes),
    };
  } catch {
    return null;
  }
}

export function verifyOnChainCommitment(
  outputs: Array<{ scriptPubKeyHex: string; valueSats: number }>,
  expectedBindingHashHex: string,
): { matched: boolean; commitment?: DecodedOpReturnCommitment } {
  const target = expectedBindingHashHex.trim().toLowerCase();
  for (const out of outputs) {
    const decoded = decodeCashBindOpReturn(out.scriptPubKeyHex);
    if (decoded && decoded.bindingHash === target) {
      return { matched: true, commitment: decoded };
    }
  }
  return { matched: false };
}

export function verifyRotationChain(
  orderedBundles: CashBindBundle[],
): { valid: boolean; depth: number; reason: string } {
  if (orderedBundles.length === 0) {
    return { valid: false, depth: 0, reason: 'No bindings provided for rotation verification.' };
  }
  for (let i = 0; i < orderedBundles.length; i++) {
    const current = orderedBundles[i];
    const check = verifyBindingBundle(current);
    if (!check.valid) {
      return {
        valid: false,
        depth: i,
        reason: `Binding at position ${i + 1} failed cryptographic verification.`,
      };
    }
    if (i > 0) {
      const prev = orderedBundles[i - 1];
      if (current.payload.prevBindingHash !== prev.bindingHash) {
        return {
          valid: false,
          depth: i,
          reason: `Rotation link broken at position ${i + 1}: prevBindingHash does not match previous digest.`,
        };
      }
    }
  }
  return {
    valid: true,
    depth: orderedBundles.length,
    reason: `Verified unbroken cryptographic lineage across ${orderedBundles.length} binding${orderedBundles.length === 1 ? '' : 's'}.`,
  };
}

export function createAuthChallenge(domain: string, ttlSeconds = 300): AuthChallenge {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + ttlSeconds;
  const nonce = binToHex(randomBytes32().slice(0, 16));
  const message = `CashBind Auth Challenge\nDomain: ${domain}\nNonce: ${nonce}\nIssuedAt: ${issuedAt}\nExpiresAt: ${expiresAt}`;
  return { nonce, domain, issuedAt, expiresAt, message };
}

export function signAuthChallengeWithBch(
  challenge: AuthChallenge,
  bchPrivateKeyHex: string,
  bchAddress: string,
): AuthChallengeProof {
  const signature = signBchMessage(challenge.message, bchPrivateKeyHex);
  return {
    method: 'bch',
    nonce: challenge.nonce,
    signer: normalizeCashAddress(bchAddress),
    signature,
  };
}

export function signAuthChallengeWithNostr(
  challenge: AuthChallenge,
  nostrPrivateKeyHex: string,
): AuthChallengeProof {
  const skBytes = hexToBin(nostrPrivateKeyHex.trim());
  const pubkey = getPublicKey(skBytes);
  const event = finalizeEvent(
    {
      kind: 22242,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['domain', challenge.domain],
        ['challenge', challenge.nonce],
      ],
      content: challenge.message,
    },
    skBytes,
  );
  return {
    method: 'nostr',
    nonce: challenge.nonce,
    signer: pubkey,
    signature: event.sig,
    nostrEvent: event,
  };
}

export function verifyAuthChallengeResponse(
  challenge: AuthChallenge,
  proof: AuthChallengeProof,
  verifiedBundle: CashBindBundle,
): { valid: boolean; reason: string } {
  const now = Math.floor(Date.now() / 1000);
  if (now > challenge.expiresAt) {
    return { valid: false, reason: 'Challenge expired. Generate a fresh nonce to authenticate.' };
  }
  if (proof.nonce !== challenge.nonce) {
    return { valid: false, reason: 'Proof nonce does not match the active challenge.' };
  }
  const bundleCheck = verifyBindingBundle(verifiedBundle);
  if (!bundleCheck.valid) {
    return { valid: false, reason: 'Underlying CashBind identity bundle is invalid.' };
  }

  if (proof.method === 'bch') {
    const sigRes = verifyBchMessage(
      challenge.message,
      proof.signature,
      verifiedBundle.payload.bchAddress,
      verifiedBundle.payload.bchPubkey,
    );
    return sigRes.valid
      ? {
          valid: true,
          reason: `Authenticated via BCH key bound to ${verifiedBundle.payload.handle}.`,
        }
      : { valid: false, reason: sigRes.reason || 'BCH challenge signature failed.' };
  }

  if (!proof.nostrEvent) {
    return { valid: false, reason: 'Missing signed Nostr NIP-42 challenge event.' };
  }
  const matchesPubkey =
    proof.nostrEvent.pubkey.toLowerCase() === verifiedBundle.payload.nostrPubkey.toLowerCase();
  const matchesMsg = proof.nostrEvent.content === challenge.message;
  const sigValid = verifyEvent(proof.nostrEvent);
  if (matchesPubkey && matchesMsg && sigValid) {
    return {
      valid: true,
      reason: `Authenticated via Nostr Schnorr key bound to ${verifiedBundle.payload.bchAddress}.`,
    };
  }
  return { valid: false, reason: 'Nostr challenge signature or bound pubkey mismatch.' };
}

export function createSignedAttestation(params: {
  issuerNostrPrivateKeyHex: string;
  issuerLabel: string;
  subjectBindingHash: string;
  subjectNostrPubkey: string;
  subjectBchAddress: string;
  claimType: string;
  claimStatement: string;
}): CashBindAttestation {
  const skBytes = hexToBin(params.issuerNostrPrivateKeyHex.trim());
  const issuerNostrPubkey = getPublicKey(skBytes);
  const issuerNpub = nip19.npubEncode(issuerNostrPubkey);
  const issuedAt = Math.floor(Date.now() / 1000);
  const subjectBchAddress = normalizeCashAddress(params.subjectBchAddress);
  const subjectBindingHash = params.subjectBindingHash.trim().toLowerCase();

  const content = JSON.stringify({
    protocol: 'cashbind-attestation/v1',
    issuerLabel: params.issuerLabel.trim(),
    subjectBindingHash,
    subjectNostrPubkey: params.subjectNostrPubkey.toLowerCase(),
    subjectBchAddress,
    claimType: params.claimType.trim(),
    claimStatement: params.claimStatement.trim(),
    issuedAt,
  });

  const nostrEvent = finalizeEvent(
    {
      kind: 30078,
      created_at: issuedAt,
      tags: [
        ['d', `cashbind:attestation:${subjectBindingHash}:${params.claimType.trim()}`],
        ['t', 'cashbind-attestation'],
        ['h', subjectBindingHash],
        ['p', params.subjectNostrPubkey.toLowerCase()],
        ['bch', subjectBchAddress],
      ],
      content,
    },
    skBytes,
  );

  return {
    id: nostrEvent.id,
    issuerNostrPubkey,
    issuerNpub,
    issuerLabel: params.issuerLabel.trim(),
    subjectBindingHash,
    subjectNostrPubkey: params.subjectNostrPubkey.toLowerCase(),
    subjectBchAddress,
    claimType: params.claimType.trim(),
    claimStatement: params.claimStatement.trim(),
    issuedAt,
    nostrEvent,
  };
}

export function verifySignedAttestation(
  attestation: CashBindAttestation,
  subjectBundle?: CashBindBundle,
): { valid: boolean; reason: string } {
  try {
    if (!verifyEvent(attestation.nostrEvent)) {
      return { valid: false, reason: 'Issuer Nostr Schnorr signature failed verification.' };
    }
    if (attestation.nostrEvent.pubkey.toLowerCase() !== attestation.issuerNostrPubkey.toLowerCase()) {
      return { valid: false, reason: 'Issuer public key does not match event signer.' };
    }
    const content = JSON.parse(attestation.nostrEvent.content) as {
      subjectBindingHash?: string;
      subjectBchAddress?: string;
      claimStatement?: string;
    };
    if (content.subjectBindingHash !== attestation.subjectBindingHash) {
      return { valid: false, reason: 'Attestation payload binding hash mismatch.' };
    }
    if (subjectBundle && attestation.subjectBindingHash !== subjectBundle.bindingHash) {
      return { valid: false, reason: 'Attestation is bound to a different CashBind identity hash.' };
    }
    return {
      valid: true,
      reason: `Verified Schnorr attestation signed by ${attestation.issuerLabel} (${attestation.issuerNpub.slice(0, 14)}…).`,
    };
  } catch (err) {
    return {
      valid: false,
      reason: err instanceof Error ? err.message : 'Unable to verify attestation.',
    };
  }
}

export function exportDidNostrDocument(
  bundle: CashBindBundle,
  anchorTxid?: string,
  attestations: CashBindAttestation[] = [],
): DidNostrDocument {
  const did = `did:nostr:${bundle.payload.nostrPubkey}`;
  const txid = anchorTxid || bundle.anchorTxid;
  return {
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/suites/secp256k1-2019/v1',
    ],
    id: did,
    alsoKnownAs: [
      `bch:${bundle.payload.bchAddress}`,
      `nostr:${nip19.npubEncode(bundle.payload.nostrPubkey)}`,
      `cashbind:${bundle.payload.handle}`,
    ],
    verificationMethod: [
      {
        id: `${did}#nostr-key-1`,
        type: 'SchnorrSecp256k1VerificationKey2019',
        controller: did,
        publicKeyHex: bundle.payload.nostrPubkey,
      },
      {
        id: `${did}#bch-key-1`,
        type: 'EcdsaSecp256k1RecoveryMethod2020',
        controller: did,
        publicKeyHex: bundle.payload.bchPubkey,
        blockchainAccountId: `bip122:000000000000000000651ef99cb9fcbe:${bundle.payload.bchAddress}`,
      },
    ],
    authentication: [`${did}#nostr-key-1`, `${did}#bch-key-1`],
    assertionMethod: [`${did}#nostr-key-1`],
    service: [
      {
        id: `${did}#bch-payment`,
        type: 'BitcoinCashPaymentEndpoint',
        serviceEndpoint: bundle.payload.bchAddress,
      },
      {
        id: `${did}#nostr-relays`,
        type: 'NostrRelaySet',
        serviceEndpoint: {
          relays: bundle.relays,
          bindingEventId: bundle.nostrEvent.id,
          bindingHash: bundle.bindingHash,
          ...(txid ? { bchAnchorTxid: txid } : {}),
        },
      },
      ...(attestations.length > 0
        ? [
            {
              id: `${did}#attestations`,
              type: 'CashBindPortableAttestations',
              serviceEndpoint: {
                count: attestations.length,
                eventIds: attestations.map((a) => a.id),
              },
            },
          ]
        : []),
    ],
  };
}

export function bchAddressToElectrumScriptHash(address: string): string {
  const normalized = normalizeCashAddress(address);
  const locking = cashAddressToLockingBytecode(normalized);
  if (typeof locking === 'string') {
    throw new Error(`Could not derive locking bytecode: ${locking}`);
  }
  const digest = sha256.hash(locking.bytecode);
  return binToHex(new Uint8Array(digest).reverse());
}

export function formatNpub(pubkeyHex: string): string {
  return nip19.npubEncode(pubkeyHex.trim().toLowerCase());
}
