# CashBind Protocol Specification (v1)

Domain string: `cashbind.protocol/v1`

## 1. Key Separation Requirement

CashBind strictly separates Bitcoin Cash financial custody keys from Nostr social identity keys:

- **BCH Key:** 32-byte `secp256k1` private key producing a 33-byte compressed public key (`02...` or `03...`) and P2PKH CashAddress (`bitcoincash:q...`).
- **Nostr Key:** Independent 32-byte `secp256k1` private key producing a 32-byte x-only BIP-340 Schnorr public key (`npub1...`).
- **Key-Reuse Rejection Rule:** Let `bchX = lowercase(bchPubkeyHex).slice(2, 66)`. A binding is **invalid** if `bchX === lowercase(nostrPubkeyHex)`.

## 2. Canonical Binding Payload

Fields are serialized deterministically via `JSON.stringify` in exact key order with optional fields omitted when absent:

```json
{
  "version": 1,
  "domain": "cashbind.protocol/v1",
  "nostrPubkey": "<64-char lowercase hex>",
  "bchAddress": "bitcoincash:q...",
  "bchPubkey": "<66-char lowercase compressed hex>",
  "handle": "merchant.bch",
  "issuedAt": 1763600000,
  "merchantNote": "Optional payment description",
  "prevBindingHash": "<optional 64-char hex of superseded binding>",
  "prevTxid": "<optional 64-char hex of prior BCH anchor tx>"
}
```

### Binding Digest

```text
bindingHash = lowercase_hex(SHA256(UTF8(canonicalPayload)))
```

## 3. Dual Cross-Signature Proofs

### 3.1 Bitcoin Cash Proof (Bitcoin Signed Message)

Signed over `canonicalPayload` using standard double-SHA256 Bitcoin message signing:

```text
msgHash = SHA256(SHA256(varint(len(prefix)) || prefix || varint(len(msg)) || msg))
prefix  = "Bitcoin Signed Message:\n"
```

The resulting 65-byte compact recoverable ECDSA signature (1-byte header `31..34` for compressed pubkey recovery + 64-byte `(r, s)`) is base64-encoded as `bchSignature`. Verifiers recover the compressed pubkey, verify `HASH160(recoveredPubkey)` encodes to `payload.bchAddress`, and confirm `recoveredPubkey === payload.bchPubkey`.

### 3.2 Nostr Proof (NIP-78 Addressable Event)

Published as a `kind: 30078` event signed by `payload.nostrPubkey`:

- **Required Tags:**
  - `["d", "cashbind:v1:<bchAddress>"]`
  - `["t", "cashbind"]`
  - `["bch", "<bchAddress>"]`
  - `["bch_pubkey", "<bchPubkey>"]`
  - `["h", "<bindingHash>"]`
  - `["handle", "<handle>"]`
- **Optional Tags:** `["prev_h", "<prevBindingHash>"]`, `["prev_txid", "<prevTxid>"]`, `["anchor_txid", "<txid>"]`
- **Content JSON:** Contains `payload`, `canonicalPayload`, `bindingHash`, `bchSignature`, and optional `anchorTxid`.

## 4. BCH Mainnet `OP_RETURN` Commitment Layout

An on-chain commitment binds `bindingHash` to Bitcoin Cash mainnet block height without storing personal metadata on-chain:

```text
0x6a                 OP_RETURN
0x08 4341534842494e44 PUSH(8)  "CASHBIND"
0x02 7631             PUSH(2)  "v1"
0x20 <32-byte hash>   PUSH(32) raw SHA-256 bytes of bindingHash
```

Total `scriptPubKey` size: **46 bytes** (0 satoshi output value).

## 5. Verification Algorithm (Zero-Trust)

Any verifier validates a `CashBindBundle` offline in 5 mandatory steps plus optional step 6:

1. **Key Separation:** Confirm `areKeysDistinct(payload.bchPubkey, payload.nostrPubkey)` is true.
2. **Address Derivation:** Confirm `P2PKH_CashAddress(payload.bchPubkey) === normalize(payload.bchAddress)`.
3. **BCH ECDSA Verification:** Recover pubkey from `bchSignature` over `canonicalize(payload)` and match both `bchAddress` and `bchPubkey`.
4. **Nostr Schnorr Verification:** Confirm `event.kind === 30078`, `event.pubkey === payload.nostrPubkey`, and `verifyEvent(event)` passes BIP-340 verification.
5. **Digest & Tag Consistency:** Recompute `SHA256(canonicalPayload)` and confirm equality with `bundle.bindingHash`, `event.content.bindingHash`, `event.content.canonicalPayload`, and the `h` tag.
6. **On-Chain Commitment Check:** Fetch the BCH mainnet transaction outputs from an independent Fulcrum node and confirm an `OP_RETURN` output decodes to `CASHBIND | v1 | bindingHash`.

## 6. Key Rotation Lineage

To rotate keys cleanly without breaking identity history, the new binding includes `prevBindingHash` (and optionally `prevTxid`). Verifiers walk `prevBindingHash` backwards to the genesis binding and confirm every link passes all 5 cryptographic checks.

## 7. Stateless Challenge-Response Authentication

1. Verifier issues an expiring challenge string containing `domain`, random 128-bit hex `nonce`, `issuedAt`, and `expiresAt`.
2. Subject proves live key control by either:
   - Signing a Nostr `kind: 22242` (NIP-42) event with `content === challenge.message` using `payload.nostrPubkey`, or
   - Signing `challenge.message` via Bitcoin Signed Message using `payload.bchAddress`.
3. Verifier confirms non-expiration, nonce match, underlying bundle validity, and live signature validity.

## 8. Portable Third-Party Attestations

Independent issuers sign `kind: 30078` Nostr events tagged with `["t", "cashbind-attestation"]`, `["h", "<subjectBindingHash>"]`, `["p", "<subjectNostrPubkey>"]`, and `["bch", "<subjectBchAddress>"]`. Anyone verifies the issuer's BIP-340 Schnorr signature directly against the subject's `bindingHash`.
