import { useEffect, useState } from 'react';
import {
  ArrowSquareOut,
  Check,
  Copy,
  PlugsConnected,
  QrCode,
  Wallet,
  X,
} from '@phosphor-icons/react';
import { AlphanumericQRCode } from '@wizardconnect/react';

type ConnectTab = 'extension' | 'qr';

interface WalletConnectModalProps {
  open: boolean;
  onClose: () => void;
  uri: string | null;
  qrUri: string | null;
  hasInjectedExtension: boolean;
  injectedLabel: string;
  extensionConnecting: boolean;
  error: string | null;
  onConnectInjected: () => Promise<void>;
}

export function WalletConnectModal({
  open,
  onClose,
  uri,
  qrUri,
  hasInjectedExtension,
  injectedLabel,
  extensionConnecting,
  error,
  onConnectInjected,
}: WalletConnectModalProps) {
  const [activeTab, setActiveTab] = useState<ConnectTab>('extension');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const handleCopyUri = async () => {
    if (!uri) return;
    try {
      await navigator.clipboard.writeText(uri);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be unavailable in restricted contexts
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/55 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wallet-modal-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-[480px] rounded-[8px] border border-hairline bg-surface shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-hairline bg-canvas px-5 py-4">
          <div>
            <h2 id="wallet-modal-title" className="font-display text-lg font-bold text-ink">
              Connect Bitcoin Cash Wallet
            </h2>
            <p className="mt-0.5 text-xs text-ink-secondary">
              Non-custodial BCH mainnet signing via browser extension or WizardConnect QR/link.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close wallet connection dialog"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[4px] border border-hairline bg-surface text-ink-secondary hover:text-ink cursor-pointer"
          >
            <X size={18} weight="regular" aria-hidden="true" />
          </button>
        </div>

        {/* Two Connection Modes */}
        <div className="border-b border-hairline bg-surface px-5 pt-3">
          <div role="tablist" aria-label="Wallet connection method" className="grid grid-cols-2 gap-2">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'extension'}
              onClick={() => setActiveTab('extension')}
              className={`inline-flex min-h-11 items-center justify-center gap-2 border-b-2 px-3 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                activeTab === 'extension'
                  ? 'border-emerald-notary text-emerald-notary'
                  : 'border-transparent text-ink-secondary hover:text-ink'
              }`}
            >
              <PlugsConnected size={16} weight="regular" aria-hidden="true" />
              <span>Paytaca Extension</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'qr'}
              onClick={() => setActiveTab('qr')}
              className={`inline-flex min-h-11 items-center justify-center gap-2 border-b-2 px-3 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                activeTab === 'qr'
                  ? 'border-emerald-notary text-emerald-notary'
                  : 'border-transparent text-ink-secondary hover:text-ink'
              }`}
            >
              <QrCode size={16} weight="regular" aria-hidden="true" />
              <span>QR Code / Link</span>
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {error ? (
            <div
              role="alert"
              className="rounded-[6px] border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-xs text-danger"
            >
              {error}
            </div>
          ) : null}

          {activeTab === 'extension' ? (
            <div className="space-y-4">
              {hasInjectedExtension ? (
                <div className="rounded-[6px] border border-emerald-notary/30 bg-emerald-soft/60 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-ink">{injectedLabel} Detected</span>
                    <span className="crypto-token text-[11px] font-semibold text-emerald-notary">
                      Injected Provider
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed text-ink-secondary">
                    Connect directly to your browser extension without scanning a QR code.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      void onConnectInjected();
                    }}
                    disabled={extensionConnecting}
                    className="press-tactile w-full inline-flex min-h-11 items-center justify-center gap-2 rounded-[4px] bg-emerald-notary px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-notary-hover disabled:opacity-60 cursor-pointer"
                  >
                    <Wallet size={16} weight="regular" aria-hidden="true" />
                    <span>
                      {extensionConnecting ? 'Waiting for extension…' : `Connect ${injectedLabel}`}
                    </span>
                  </button>
                </div>
              ) : null}

              <div className="rounded-[6px] border border-hairline bg-canvas p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-ink">
                    Paytaca Browser Extension (Paste URL)
                  </span>
                  <span className="crypto-token text-[11px] text-ink-muted">WizardConnect</span>
                </div>

                <ol className="space-y-1.5 text-xs leading-relaxed text-ink-secondary list-decimal pl-4">
                  <li>
                    Click <strong className="text-ink">Copy Pairing URL</strong> below.
                  </li>
                  <li>
                    Open your <strong className="text-ink">Paytaca Chrome Extension</strong>, go to{' '}
                    <strong className="text-ink">Apps -&gt; WizardConnect -&gt; Paste URL</strong>.
                  </li>
                  <li>Approve the session in Paytaca to link your BCH mainnet wallet.</li>
                </ol>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    aria-label="WizardConnect pairing URL"
                    value={uri ?? 'Generating pairing URL…'}
                    className="w-full min-h-10 rounded-[4px] border border-hairline bg-surface px-3 py-2 crypto-token text-xs text-ink"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      void handleCopyUri();
                    }}
                    disabled={!uri}
                    className="press-tactile inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-[4px] bg-emerald-notary px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-notary-hover disabled:opacity-50 cursor-pointer"
                  >
                    {copied ? (
                      <>
                        <Check size={14} weight="bold" aria-hidden="true" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy size={14} weight="regular" aria-hidden="true" />
                        <span>Copy URL</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="flex items-center justify-between pt-1 text-[11px] text-ink-muted">
                  <span>{uri ? 'Waiting for Paytaca Extension approval…' : 'Initializing relay session…'}</span>
                  <a
                    href="https://chromewebstore.google.com/detail/paytaca/pakphhpnneopheifihmjcjnbdbhaaiaa"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-emerald-notary hover:underline"
                  >
                    <span>Get Paytaca</span>
                    <ArrowSquareOut size={12} weight="regular" aria-hidden="true" />
                  </a>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-col items-center rounded-[6px] border border-hairline bg-white p-4">
                {qrUri ? (
                  <AlphanumericQRCode
                    value={qrUri}
                    size={224}
                    foreground="#0E1722"
                    background="#FFFFFF"
                    quietZone={6}
                  />
                ) : (
                  <div className="flex h-[224px] w-[224px] items-center justify-center text-xs text-ink-muted">
                    Generating QR code…
                  </div>
                )}
              </div>

              <p className="text-center text-xs text-ink-secondary">
                Scan with <strong className="text-ink">Paytaca Mobile</strong>,{' '}
                <strong className="text-ink">Selene</strong>, or{' '}
                <strong className="text-ink">Cashonize</strong>, or use the direct pairing link.
              </p>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void handleCopyUri();
                  }}
                  disabled={!uri}
                  className="press-tactile flex-1 inline-flex min-h-11 items-center justify-center gap-2 rounded-[4px] border border-hairline bg-surface px-3.5 py-2 text-xs font-semibold text-ink hover:border-hairline-strong disabled:opacity-50 cursor-pointer"
                >
                  {copied ? (
                    <>
                      <Check size={15} weight="bold" aria-hidden="true" />
                      <span>Pairing Link Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy size={15} weight="regular" aria-hidden="true" />
                      <span>Copy Pairing Link</span>
                    </>
                  )}
                </button>
                {uri ? (
                  <a
                    href={uri}
                    className="press-tactile flex-1 inline-flex min-h-11 items-center justify-center gap-2 rounded-[4px] bg-emerald-notary px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-notary-hover"
                  >
                    <ArrowSquareOut size={15} weight="regular" aria-hidden="true" />
                    <span>Open Wallet Link</span>
                  </a>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
