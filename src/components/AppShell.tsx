import { useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { List, SignOut, Wallet, X } from '@phosphor-icons/react';
import { useWizardWallet } from '../lib/wizardConnect';

const NAV_ITEMS = [
  { to: '/', label: 'Registry' },
  { to: '/bind', label: 'Bind' },
  { to: '/verify', label: 'Verify & Pay' },
  { to: '/vault', label: 'Vault' },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { state, walletName, connectedAddress, connect, disconnect } = useWizardWallet();

  return (
    <div className="min-h-[100dvh] flex flex-col border-t-2 border-emerald-notary">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-2 focus:bg-ink focus:text-white focus:rounded-[4px]"
      >
        Skip to main content
      </a>

      <header className="sticky top-0 z-30 border-b border-hairline bg-surface/95 backdrop-blur-xs">
        <div className="mx-auto flex h-16 max-w-[1320px] items-center justify-between gap-8 px-4 sm:px-6 lg:px-8">
          {/* Zone 1: Single-line Brand Wordmark */}
          <Link
            to="/"
            className="font-display text-xl font-bold tracking-tight text-ink whitespace-nowrap shrink-0"
            translate="no"
          >
            CashBind
          </Link>

          {/* Zone 2: Four Clean Single-Line Text Navigation Links */}
          <nav
            aria-label="Primary navigation"
            className="hidden md:flex items-center gap-7"
          >
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `relative py-5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                    isActive
                      ? 'text-ink after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-emerald-notary'
                      : 'text-ink-secondary hover:text-ink'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          {/* Zone 3: One Primary Action (WizardConnect Wallet) + Mobile Drawer Toggle */}
          <div className="flex items-center gap-2 shrink-0">
            {state === 'connected' ? (
              <div className="flex items-center gap-2">
                <span
                  className="hidden sm:inline crypto-token text-xs text-ink-secondary max-w-[140px] truncate"
                  title={connectedAddress || walletName || 'Connected wallet'}
                >
                  {connectedAddress
                    ? `${connectedAddress.replace('bitcoincash:', '').slice(0, 8)}…`
                    : walletName || 'Connected'}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    void disconnect();
                  }}
                  className="press-tactile inline-flex min-h-11 items-center gap-2 rounded-[4px] border border-hairline bg-surface px-3.5 py-2 text-xs font-semibold text-ink hover:border-hairline-strong cursor-pointer whitespace-nowrap shrink-0"
                >
                  <SignOut size={15} weight="regular" aria-hidden="true" />
                  <span>Disconnect</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => connect()}
                disabled={state === 'connecting'}
                aria-busy={state === 'connecting'}
                className="press-tactile inline-flex min-h-11 items-center gap-2 rounded-[4px] bg-emerald-notary px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-notary-hover disabled:opacity-60 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Wallet size={16} weight="regular" aria-hidden="true" />
                <span>{state === 'connecting' ? 'Connecting…' : 'Connect Wallet'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
              aria-expanded={mobileMenuOpen}
              className="press-tactile inline-flex md:hidden min-h-11 min-w-11 items-center justify-center rounded-[4px] border border-hairline bg-surface text-ink cursor-pointer"
            >
              {mobileMenuOpen ? (
                <X size={20} weight="regular" aria-hidden="true" />
              ) : (
                <List size={20} weight="regular" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        {mobileMenuOpen ? (
          <nav
            aria-label="Mobile navigation"
            className="border-t border-hairline bg-surface px-4 py-3 md:hidden"
          >
            <div className="flex flex-col gap-1">
              {NAV_ITEMS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  onClick={() => setMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    `min-h-11 flex items-center px-3 rounded-[4px] text-sm font-medium ${
                      isActive
                        ? 'bg-emerald-soft text-emerald-notary font-semibold'
                        : 'text-ink-secondary hover:bg-subtle hover:text-ink'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
          </nav>
        ) : null}
      </header>

      <main id="main-content" className="flex-1">
        {children}
      </main>

      <footer className="border-t border-hairline bg-surface mt-16">
        <div className="mx-auto flex max-w-[1320px] flex-col gap-3 px-4 py-6 text-xs text-ink-muted sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-display font-semibold text-ink" translate="no">
              CashBind
            </span>
            <span aria-hidden="true">·</span>
            <span>Self-sovereign Bitcoin Cash mainnet &amp; Nostr cryptographic identity protocol</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Link to="/bind" className="hover:text-ink underline underline-offset-4 decoration-hairline">
              Bind Identity
            </Link>
            <Link to="/verify" className="hover:text-ink underline underline-offset-4 decoration-hairline">
              Verify &amp; Pay
            </Link>
            <Link to="/vault" className="hover:text-ink underline underline-offset-4 decoration-hairline">
              Attestations &amp; DID
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
