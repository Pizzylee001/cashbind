# CashBind: BCH BLAZE 2026 Widget Factory Slide Deck Copy

Ready-to-paste copy adapted directly from the official BCH BLAZE 2026 Project Presentation Template.

---

## Slide 1: Cover

- **Project Name:** CashBind
- **Website / App URL:** `https://cashbind.vercel.app`
- **Twitter / X / Nostr:** *(Paste your handle / npub)*
- **Telegram / Contact:** Pizzy Lee (`pizzylillee@gmail.com`)
- **Tagline:** Verify and pay Nostr identities on Bitcoin Cash
- **Repository:** `https://github.com/Pizzylee001/cashbind`

---

## Slide 2: The Story of CashBind

Merchants and creators on Nostr already have portable social reputation, but accepting Bitcoin Cash still forces users to trust screenshots, centralized bio links, or domain registrars that can be hijacked overnight.

We asked a simple question: what if any Nostr identity could cryptographically bind a separate Bitcoin Cash mainnet address, anchor that proof permanently on BCH, and let anyone verify and pay them in one zero-trust flow?

That idea became **CashBind**: a self-sovereign cryptographic notary that bridges Nostr social identity and Bitcoin Cash mainnet commerce without a central registry or key reuse.

---

## Slide 3: Benefits of CashBind

- **Strict Key Separation:** BCH funds stay isolated from Nostr social keys; key reuse is rejected at protocol level.
- **Zero-Trust Verification:** Any wallet or user verifies dual ECDSA + Schnorr proofs offline plus BCH mainnet `OP_RETURN` anchors via Fulcrum.
- **Verify-Before-Pay Protection:** Tampering with a single byte breaks the cryptographic seal and locks payment execution automatically.
- **Stateless Auth Everywhere:** One-time expiring challenges authenticate users via bound Nostr (NIP-42) or BCH signatures with zero password database.
- **Portable Reputation & Standards:** Third-party Schnorr attestations, verifiable key-rotation lineage, and W3C `did:nostr` JSON-LD export work across apps.

---

## Slide 4: BCH Mainnet Usage & WizardConnect

- **On-Chain `OP_RETURN` Anchoring:** Commits a 46-byte `CASHBIND|v1|<32-byte-sha256>` digest directly to Bitcoin Cash mainnet (< $0.01 fee).
- **Direct Verified BCH Payments:** Resolves any Nostr `npub` or handle to its verified CashAddress and sends live BCH mainnet payments with dust-limit and fee protection.
- **Native WizardConnect Integration:** Pairs directly with Paytaca, Selene, and Cashonize to sign mainnet anchor and payment transactions non-custodially.
- **Live Fulcrum Infrastructure:** Queries real mainnet block height, UTXOs, `OP_RETURN` commitments, and broadcasts transactions with multi-node TLS/WSS failover.

---

## Slide 5: Business Model & Vision

CashBind turns decentralized identity into real Bitcoin Cash commerce infrastructure:

- **Merchant Verified Handles:** BCH storefronts and creators publish tamper-proof Nostr-linked payment handles and BIP-21 checkout links with zero recurring registrar fees.
- **Paid Attestation Marketplaces:** Merchant guilds, auditors, and regional BCH directories can issue paid, cryptographically verifiable Schnorr attestations (such as "Verified BCH Merchant") settled directly in BCH.
- **Wallet & SDK Adoption:** Drop-in TypeScript verification library lets Paytaca, Selene, Cashonize, and BCH dApps resolve `npub -> verified CashAddress` natively.
- **Next Priority:** Publish `@cashbind/sdk` to npm, open-source a CashTokens membership attestation module, and onboard BCH merchant directories across LatAm, Asia, and global Nostr communities.

---

## Slide 6: Thank You

- **Try CashBind Live:** `https://cashbind.vercel.app`
- **Source Code & Protocol Spec:** `https://github.com/Pizzylee001/cashbind`
- **Support with EMBER2026 CashTokens:** *(Paste your `bitcoincash:z...` address)*
