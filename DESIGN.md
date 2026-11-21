---
project: CashBind
surfaceMode: Operate
dials:
  variance: 5
  motion: 4
  density: 6
  energy: 2
  rhythm: 2
  antislopMotion: 2
theme: light-archival-notary
colors:
  canvas: "#F2F5F7"
  surface: "#FAFBFC"
  subtle: "#E7EDF1"
  inkPrimary: "#0E1722"
  inkSecondary: "#445263"
  inkMuted: "#5A697B"
  borderHairline: "#CFD8E1"
  borderStrong: "#9FB0C2"
  accentPrimary: "#0A7E4F"
  accentPrimaryHover: "#08653F"
  accentSoft: "#E6F4ED"
  onAccent: "#FFFFFF"
  statusVerified: "#0A7E4F"
  statusPending: "#B45309"
  statusInvalid: "#B91C1C"
  statusPendingBg: "#FEF3C7"
  statusInvalidBg: "#FEE2E2"
typography:
  display:
    fontFamily: "'Outfit', sans-serif"
    fontWeight: [600, 700]
    letterSpacing: "-0.025em"
  body:
    fontFamily: "'Plus Jakarta Sans', sans-serif"
    fontSize: "15px"
    fontWeight: [400, 500, 600]
    lineHeight: 1.55
  mono:
    fontFamily: "'JetBrains Mono', monospace"
    fontWeight: [400, 500]
    fontVariantNumeric: "tabular-nums"
radii:
  ledger: "0px"
  control: "4px"
  surface: "6px"
  modal: "8px"
elevation:
  structure: "1px solid #CFD8E1"
  floatingShadow: "0 1px 2px rgba(14, 23, 34, 0.06), 0 12px 28px -10px rgba(14, 23, 34, 0.10)"
motion:
  easeOut: "cubic-bezier(0.23, 1, 0.32, 1)"
  easeInOut: "cubic-bezier(0.77, 0, 0.175, 1)"
  durationFast: "140ms"
  durationStandard: "220ms"
  durationSeal: "320ms"
  pressScale: 0.97
---

# CashBind Design System (`DESIGN.md`)

## 1. Visual Theme & Atmosphere

- **Design Read:** Reading this as: cryptographic identity and mainnet settlement workbench (`Operate`) for Bitcoin Cash and Nostr developers, merchants, and BCH BLAZE 2026 judges, with a Swiss archival notary aesthetic, leaning toward Swiss Modernism 2.0 with tactile micro-interactions, dial `ENERGY 2 / RHYTHM 2 / MOTION 2` (`01` dials: `VARIANCE 5 / MOTION 4 / DENSITY 6`).
- **Surface Mode:** `Operate`. Scanability of cryptographic hashes, CashAddrs, `npub` keys, `OP_RETURN` bytes, and live mainnet transaction states takes precedence over decorative effects.
- **Theme Rationale:** Light-first archival paper-stone surfaces replace the generic dark dashboard shell with repeated rounded panels. High-contrast ink on cool mineral paper makes long keys, signatures, and verification checklists legible during live two-minute judge reviews.
- **Designed Background Treatment:** Base canvas `#F2F5F7` layered with a soft top-left emerald mineral wash (`radial-gradient(900px 520px at 8% -6%, rgba(10, 126, 79, 0.065), transparent 68%)`), a counter-balancing cool slate depth tone at the bottom right (`radial-gradient(700px 440px at 94% 100%, rgba(14, 23, 34, 0.045), transparent 65%)`), and a 2px top archival rule in `#0A7E4F`. Flat single-fill backgrounds never ship.

## 2. Color Palette & Roles

| Semantic Token | Hex | Contrast & Functional Role |
| :--- | :--- | :--- |
| `--bg-canvas` | `#F2F5F7` | 60% dominant cool archival canvas |
| `--bg-surface` | `#FAFBFC` | 30% elevated ledger sheet and form surfaces |
| `--bg-subtle` | `#E7EDF1` | Recessed key wells, code blocks, and cryptographic payload trays |
| `--fg-primary` | `#0E1722` | Primary ink (>14:1 contrast on canvas and surface) |
| `--fg-secondary` | `#445263` | Supporting descriptions and table headers (>7.5:1 contrast) |
| `--fg-muted` | `#5A697B` | Quiet metadata with typographic separators (>5.1:1 contrast, WCAG AA) |
| `--border-hairline` | `#CFD8E1` | Structural 1px grid rules, table dividers, and input borders |
| `--border-strong` | `#9FB0C2` | Active input borders and prominent table column dividers |
| `--accent-primary` | `#0A7E4F` | 10% accent budget: primary CTA, active route rule, verified cryptographic seal (5.2:1 with `#FFFFFF`) |
| `--accent-primary-hover` | `#08653F` | Primary CTA hover state (6.9:1 with `#FFFFFF`) |
| `--accent-soft` | `#E6F4ED` | Subtle highlight surface for verified proof rows |
| `--status-pending` | `#B45309` | Pending mempool / unanchored relay state (always paired with text + icon) |
| `--status-invalid` | `#B91C1C` | Cryptographic mismatch, tampered payload, or reused key rejection (always paired with text + icon) |

## 3. Typography Rules

- **Production Font Loading:** Self-hosted via `@fontsource/outfit`, `@fontsource/plus-jakarta-sans`, and `@fontsource/jetbrains-mono` imported directly in `src/main.tsx` (zero external Google Fonts `<link>` tags in production).
- **Hierarchy Table:**

| Role | Family | Size | Weight | Line Height | Tracking / Rules |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Page Display (`h1`) | Outfit | `clamp(1.75rem, 2.6vw, 2.35rem)` | 700 | `1.14` | `-0.025em`, `text-wrap: balance` |
| Section Heading (`h2`) | Outfit | `1.25rem` (`20px`) | 600 | `1.25` | `-0.02em`, `text-wrap: balance` |
| Subheading (`h3`) | Outfit | `1rem` (`16px`) | 600 | `1.3` | `-0.01em` |
| Body / Forms | Plus Jakarta Sans | `0.9375rem` (`15px`) | 400 / 500 | `1.55` | `text-wrap: pretty`, 65 to 75ch max measure |
| Quiet Metadata | Plus Jakarta Sans | `0.8125rem` (`13px`) | 500 | `1.4` | Unboxed text with `·` separators, never pill boxes |
| Crypto Data / Amounts | JetBrains Mono | `0.8125rem` (`13px`) | 400 / 500 | `1.5` | `tabular-nums`, `overflow-wrap: anywhere` strictly on keys, hashes, CashAddrs, txids, and satoshis |

- **Iconography:** `@phosphor-icons/react` exclusively (`weight="regular"` globally, `16px` inline, `20px` toolbar, `24px` seal/empty state). Decorative icons alongside visible labels carry `aria-hidden="true"`. Zero emojis as UI icons.

## 4. Component Stylings

- **BLAZE 2026 Eligibility Strip (`/` top of page only):** Full-width subtle archival strip (`#E7EDF1` with 1px `#CFD8E1` bottom hairline) listing the three required Mainnet Track links in clean single-line controls: Widget Factory Presentation link, GitHub Repository link, and EMBER2026 CashTokens donation address with one-click copy and edit drawer so the builder can swap live URLs before judging.
- **Top Navigation Bar (3-Zone Contract):** Single row (`64px` height, `gap-8`, `border-b border-[#CFD8E1]`):
  - Zone 1: Single-line wordmark `CashBind` in Outfit 700 (no adjacent subtitle or status chip).
  - Zone 2: Four clean single-line text links (`Registry`, `Bind`, `Verify & Pay`, `Vault`) with a 2px bottom accent indicator on the active route.
  - Zone 3: One primary action button (`Connect Wallet` via WizardConnect, updating to connected wallet label + disconnect control when paired).
- **Primary & Secondary Buttons:** `4px` radius, `min-h-11` (`44px`) touch targets on mobile, `px-4 py-2` horizontal-to-vertical ratio, explicit `transition: background-color 140ms, border-color 140ms, transform 140ms cubic-bezier(0.23, 1, 0.32, 1)`, `:active` press scale `0.97`, visible `2px` focus ring (`#0A7E4F` with `2px` offset). Async actions disable with an inline Phosphor spinner and `aria-busy="true"`.
- **Ledger Tables & Diptych Panes:** Semantic `<table>` with `<thead>` and `<tbody>`, hairline horizontal dividers, right-aligned `tabular-nums` satoshi/block columns, hover row highlight (`#EBF1F5`), zero nested card wrappers.
- **Form Fields:** Visible `<label htmlFor>` above every `<input>` / `<textarea>`, persistent helper text, inline field error via `aria-describedby`, `spellCheck={false}` on keys/addresses/hex, paste never blocked.
- **WizardConnect QR Modal:** Styled with our light archival tokens (`dialogBackground: "#FAFBFC"`, `headerBackground: "#F2F5F7"`, `titleColor: "#0E1722"`, `qrForeground: "#0E1722"`, `qrBackground: "#FFFFFF"`, `borderColor: "#CFD8E1"`).

## 5. Layout Principles & Route Inventory

- **Container & Spacing:** `max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-8` on an 8px spacing rhythm (`16 / 24 / 32 / 48`).
- **Four Real Pages (distinct structural compositions across routes):**
  1. `/` (**Registry**): Mandatory BLAZE 2026 top eligibility banner + asymmetric `4fr / 8fr` split (left sticky notary overview & live network readiness rail; right full-bleed searchable ledger table of live Nostr-discovered and locally bound identities with slide-over proof inspector).
  2. `/bind` (**Bind & Anchor**): Horizontal dual-key diptych (BCH Keypair / WizardConnect column paired against Nostr Keypair / NIP-07 column) feeding down into the centered Dual-Key Notary Seal verification bar, multi-relay Nostr `kind:30078` publisher, live BCH mainnet `OP_RETURN` anchor transaction composer, and key-rotation chain builder.
  3. `/verify` (**Verify, Auth & Pay**): Full-width zero-trust input bar (`npub`, CashAddr, BCH txid, or raw JSON) above a two-column operational desk: left four-check cryptographic audit ledger (Nostr Schnorr, BCH ECDSA, Key Separation, On-Chain `OP_RETURN`), right stacked Stateless Challenge-Response Auth panel and Direct BCH Mainnet Payment composer (with WizardConnect or local WIF signing).
  4. `/vault` (**Attestations & DID**): Three-band editorial-technical layout: top portable third-party attestation issuer & verifier, middle W3C `did:nostr` JSON-LD document preview & `.json` export with key-rotation lineage timeline, bottom zero-dependency TypeScript verification SDK snippet with one-click copy.

## 6. Depth & Elevation

- **Single-Rule Elevation:** Borders (`1px solid #CFD8E1`) handle all structural layout separation on the page plane. Layered elevation shadow (`0 1px 2px rgba(14, 23, 34, 0.06), 0 12px 28px -10px rgba(14, 23, 34, 0.10)`) is reserved strictly for modals, slide-over proof drawers, and the active Dual-Key Notary Seal sheet. Never combine wide drop shadows with 1px borders on routine grid blocks.

## 7. Do's and Don'ts

- **Do:** Render metadata as quiet unboxed text with `·` separators; enforce distinct BCH and Nostr keys with explicit cryptographic failure messages; display real relay and Fulcrum block height readouts only from live network responses; provide populated, empty, loading, and error states on every data view.
- **Don't:** No kickers or uppercase eyebrows above headings; no pill badge sandwiches on cards or tables; no thick `border-l-4` accent stripes; no pulsing decorative dots; no invented metrics, fake user counts, or mock txids; no em dashes anywhere in UI copy or docs; no clickable `<div>` elements; no `transition: all`.

## 8. Responsive Behavior

- **Breakpoints:** Verified at `375px`, `768px`, `1024px`, and `1440px`.
- **Mobile Collapse (`< 768px`):** Asymmetric splits and dual-key diptychs collapse to single column; top navigation collapses to brand wordmark + accessible mobile menu drawer (aggregate sticky bar height strictly under 15% of viewport); long CashAddrs, `npub`s, and txids wrap safely with `overflow-wrap: anywhere` inside `min-w-0` flex/grid children; zero horizontal scroll; all interactive controls meet `>= 44px` tap targets.

## 9. Signature, Motion & Depth

- **Motion Tier:** Standard (`01` MOTION 4 / `08` MOTION 2).
- **Entrance & State Motion:** Route content enters cleanly with `opacity: 0 -> 1` and `translateY(8px -> 0)` (`220ms`, `cubic-bezier(0.23, 1, 0.32, 1)`, 35ms stagger capped at 6 rows, never `scale(0)`). Hover and active presses complete within `140ms` using `transform` and `opacity` only.
- **Subject-Grounded Signature Moment:** The **Dual-Key Notary Seal** SVG component on `/bind` and `/verify`. Two concentric half-arcs representing the BCH secp256k1 key and the Nostr Schnorr key rotate into mechanical registration and lock with a subtle `320ms` crisp settle only when real dual cryptographic verification passes (or separate visibly with a crimson split indicator if keys collide or a signature fails).
- **Reduced-Motion Fallback:** Every animation honors `prefers-reduced-motion: reduce`; under reduced motion, rows render immediately and the Dual-Key Notary Seal snaps straight to its verified or invalid SVG geometry.
- **3D / WebGL Decision:** `None`. Operational cryptographic inspection prioritizes sub-pixel hex/address legibility and zero GPU stutter across judge laptops and phones; visual depth comes from the layered mineral paper canvas, hairline grid discipline, and precision SVG seal geometry.
