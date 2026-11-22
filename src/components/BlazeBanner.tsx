import { useState, type FormEvent } from 'react';
import {
  ArrowSquareOut,
  Check,
  Copy,
  GitBranch,
  PencilSimple,
  PresentationChart,
  X,
} from '@phosphor-icons/react';
import {
  loadBlazeBannerConfig,
  saveBlazeBannerConfig,
  type BlazeBannerConfig,
} from '../lib/storage';

export function BlazeBanner() {
  const [config, setConfig] = useState<BlazeBannerConfig>(() => loadBlazeBannerConfig());
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<BlazeBannerConfig>(config);
  const [copied, setCopied] = useState(false);

  const handleCopyEmber = async () => {
    try {
      await navigator.clipboard.writeText(config.emberCashTokensAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard fallback ignored if blocked in headless environment
    }
  };

  const handleSave = (e: FormEvent) => {
    e.preventDefault();
    const saved = saveBlazeBannerConfig({
      presentationUrl: draft.presentationUrl.trim() || config.presentationUrl,
      repoUrl: draft.repoUrl.trim() || config.repoUrl,
      emberCashTokensAddress:
        draft.emberCashTokensAddress.trim() || config.emberCashTokensAddress,
    });
    setConfig(saved);
    setEditing(false);
  };

  return (
    <section
      aria-label="BCH BLAZE 2026 submission details"
      className="border-b border-hairline bg-subtle/85"
    >
      <div className="mx-auto max-w-[1320px] px-4 py-2.5 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-[13px] text-ink-secondary">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 min-w-0">
            <span className="font-semibold text-ink whitespace-nowrap">
              BCH BLAZE 2026 Entry
            </span>
            <span aria-hidden="true" className="text-hairline-strong hidden sm:inline">
              /
            </span>
            <a
              href={config.presentationUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 font-medium text-ink hover:text-emerald-notary underline underline-offset-4 decoration-hairline-strong hover:decoration-emerald-notary transition-colors whitespace-nowrap"
            >
              <PresentationChart size={15} weight="regular" aria-hidden="true" />
              <span>Widget Factory Deck</span>
              <ArrowSquareOut size={13} weight="regular" aria-hidden="true" />
            </a>
            <span aria-hidden="true" className="text-hairline-strong hidden sm:inline">
              ·
            </span>
            <a
              href={config.repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 font-medium text-ink hover:text-emerald-notary underline underline-offset-4 decoration-hairline-strong hover:decoration-emerald-notary transition-colors whitespace-nowrap"
            >
              <GitBranch size={15} weight="regular" aria-hidden="true" />
              <span>Source Repository</span>
              <ArrowSquareOut size={13} weight="regular" aria-hidden="true" />
            </a>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-ink-muted whitespace-nowrap">EMBER2026 CashTokens:</span>
              <code
                className="crypto-token text-xs text-ink max-w-[180px] sm:max-w-[260px] truncate"
                title={config.emberCashTokensAddress}
                translate="no"
              >
                {config.emberCashTokensAddress}
              </code>
              <button
                type="button"
                onClick={handleCopyEmber}
                className="press-tactile inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-ink border border-hairline bg-surface rounded-[4px] hover:border-hairline-strong cursor-pointer whitespace-nowrap"
                aria-label="Copy EMBER2026 CashTokens address"
              >
                {copied ? (
                  <>
                    <Check size={13} weight="bold" className="text-emerald-notary" aria-hidden="true" />
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

            <button
              type="button"
              onClick={() => {
                setDraft(config);
                setEditing((prev) => !prev);
              }}
              className="press-tactile inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-ink-secondary hover:text-ink cursor-pointer whitespace-nowrap"
              aria-expanded={editing}
            >
              {editing ? (
                <>
                  <X size={13} weight="regular" aria-hidden="true" />
                  <span>Close</span>
                </>
              ) : (
                <>
                  <PencilSimple size={13} weight="regular" aria-hidden="true" />
                  <span>Edit Links</span>
                </>
              )}
            </button>
          </div>
        </div>

        {editing ? (
          <form
            onSubmit={handleSave}
            className="mt-3 grid grid-cols-1 gap-3 border-t border-hairline pt-3 md:grid-cols-3"
          >
            <div>
              <label htmlFor="blaze-deck-url" className="block text-xs font-medium text-ink-secondary mb-1">
                Widget Factory Deck URL
              </label>
              <input
                id="blaze-deck-url"
                type="text"
                value={draft.presentationUrl}
                onChange={(e) => setDraft({ ...draft, presentationUrl: e.target.value })}
                spellCheck={false}
                placeholder="/deck.html or https://docs.google.com/presentation/…"
                className="w-full h-10 px-3 text-sm bg-surface border border-hairline rounded-[4px] text-ink focus:border-emerald-notary"
              />
            </div>
            <div>
              <label htmlFor="blaze-repo-url" className="block text-xs font-medium text-ink-secondary mb-1">
                GitHub / GitLab Repository URL
              </label>
              <input
                id="blaze-repo-url"
                type="url"
                value={draft.repoUrl}
                onChange={(e) => setDraft({ ...draft, repoUrl: e.target.value })}
                spellCheck={false}
                placeholder="https://github.com/…"
                className="w-full h-10 px-3 text-sm bg-surface border border-hairline rounded-[4px] text-ink focus:border-emerald-notary"
              />
            </div>
            <div>
              <label htmlFor="blaze-ember-addr" className="block text-xs font-medium text-ink-secondary mb-1">
                EMBER2026 CashTokens Address (bitcoincash:z…)
              </label>
              <div className="flex gap-2">
                <input
                  id="blaze-ember-addr"
                  type="text"
                  value={draft.emberCashTokensAddress}
                  onChange={(e) => setDraft({ ...draft, emberCashTokensAddress: e.target.value })}
                  spellCheck={false}
                  placeholder="bitcoincash:z…"
                  className="min-w-0 flex-1 h-10 px-3 text-xs crypto-token bg-surface border border-hairline rounded-[4px] text-ink focus:border-emerald-notary"
                />
                <button
                  type="submit"
                  className="press-tactile h-10 px-4 text-xs font-semibold text-white bg-emerald-notary hover:bg-emerald-notary-hover rounded-[4px] cursor-pointer whitespace-nowrap shrink-0"
                >
                  Save Banner
                </button>
              </div>
            </div>
          </form>
        ) : null}
      </div>
    </section>
  );
}
