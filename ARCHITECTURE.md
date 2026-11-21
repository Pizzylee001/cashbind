# CashBind Architecture & Security Model

## 1. System Overview

CashBind is a zero-trust, client-first web application backed by a thin, stateless Fulcrum ElectrumX proxy for BCH mainnet reads and transaction broadcasts.

```text
+-------------------------------------------------------------------+
| Browser Client (React 19 + TypeScript + Vite)                     |
|                                                                   |
|  src/lib/protocol.ts    Isomorphic crypto (libauth + nostr-tools) |
|  src/lib/bchTx.ts       BCH mainnet P2PKH + OP_RETURN tx builder  |
|  src/lib/wizardConnect  WizardConnect wallet pairing & tx signing |
|  src/lib/nostrNetwork   Direct browser WebSockets to Nostr relays |
|  src/lib/storage.ts     Local vault (localStorage, no secrets)    |
+--------------------------+--------------------------+-------------+
                           |                          |
          Direct WSS       |                          | HTTPS /api/bch/*
                           v                          v
          +-----------------------------+   +-----------------------+
          | Public Nostr Relays         |   | Express Server        |
          | - wss://relay.damus.io      |   | (server.ts, port 3000)|
          | - wss://nos.lol             |   | Stateless JSON-RPC    |
          | - wss://relay.primal.net    |   | TLS/WSS failover      |
          +-----------------------------+   +-----------+-----------+
                                                        |
                                                        v
                                            +-----------------------+
                                            | BCH Mainnet Fulcrum   |
                                            | - bch.imaginary.cash  |
                                            | - bch.loping.net      |
                                            | - fulcrum.greyh.at    |
                                            +-----------------------+
```

## 2. Why No Central Database Is Used

CashBind stores zero user identities, keys, or attestations on any centralized server:

- **Discovery:** Signed `kind:30078` binding events and attestations are published to and queried directly from multiple independent public Nostr relays via browser WebSockets.
- **Immutability & Timestamping:** Optional 46-byte `OP_RETURN` digests are anchored directly into Bitcoin Cash mainnet blocks and audited against live Fulcrum nodes.
- **Local Vault:** The browser caches public signed bundles and attestations in `localStorage` for fast offline inspection. Private keys (`WIF` and `nsec`) are **never** written to `localStorage` or transmitted to `server.ts`.

## 3. Stateless Fulcrum Proxy (`server.ts`)

Browsers cannot open raw TLS sockets (`50002`) to Fulcrum ElectrumX nodes directly. `server.ts` provides five stateless read/broadcast routes with automatic node failover across `bch.imaginary.cash:50002` (TLS), `bch.loping.net:50002` (TLS), and `wss://fulcrum.greyh.at:50004` (WSS):

- `GET /api/bch/status`: Live mainnet block height and active Fulcrum server version.
- `GET /api/bch/address/:address`: Confirmed/unconfirmed balance, spendable UTXOs, and tx history for a CashAddress.
- `GET /api/bch/tx/:txid`: Decoded transaction outputs with automatic `CASHBIND|v1|<sha256>` `OP_RETURN` extraction.
- `GET /api/bch/scan-commitments/:address`: Scans recent transaction history of an address for valid CashBind `OP_RETURN` commitments.
- `POST /api/bch/broadcast`: Broadcasts an already-signed raw BCH mainnet transaction hex (`SIGHASH_ALL | SIGHASH_FORKID`) and returns the txid and Blockchair explorer link.

## 4. Wallet & Signing Architecture

CashBind supports both non-custodial external wallets and local browser signing:

- **WizardConnect (`@wizardconnect/react` + `@wizardconnect/dapp`):** Pairs with Paytaca, Selene, or Cashonize via QR/URI, derives receive addresses, and signs BCH mainnet `OP_RETURN` anchor and direct-payment transactions without private keys ever touching the browser.
- **External Wallet Signature Mode:** Displays the exact canonical payload string so users can sign in Paytaca or Electron Cash and paste the resulting base64 Bitcoin Signed Message proof.
- **NIP-07 Browser Extensions:** Detects `window.nostr` (Alby, nos2x) to sign `kind:30078` bindings and `kind:22242` auth challenges.
- **Local Key Mode:** Generates fresh CSPRNG keys via `crypto.getRandomValues` in memory for immediate testing or WIF/nsec import.

## 5. Threat Model & Mitigations

| Threat | Mitigation in CashBind |
| :--- | :--- |
| **Compromised Nostr key draining BCH funds** | Strict key-separation check rejects any binding where BCH and Nostr keys share the same secp256k1 x-coordinate. |
| **Impersonation / Fake Payment Address** | Verifier independently checks both ECDSA and Schnorr signatures before unlocking the payment UI. Tampering with even 1 byte immediately fails verification and locks payment execution. |
| **Compromised or Censoring Relay** | Events are published in parallel across 3 independent relays and remain verifiable offline as raw JSON bundles or anchored via BCH mainnet `OP_RETURN`. |
| **Replay of Authentication Challenges** | Challenges embed a random 128-bit nonce, domain binding, and strict `expiresAt` timestamp check. |
| **Dust / Malformed Mainnet Transactions** | `bchTx.ts` enforces the 546-satoshi BCH dust limit on every output, computes dynamic fee estimates (`>= 1.2 sat/byte`), absorbs sub-dust change cleanly, and signs with `SIGHASH_ALL \| SIGHASH_FORKID (0x41)`. |
