import { motion, useReducedMotion } from 'motion/react';
import { Check, Warning, ShieldCheck } from '@phosphor-icons/react';

export type SealStatus = 'idle' | 'verified' | 'invalid';

interface NotarySealProps {
  status: SealStatus;
  title: string;
  subtitle: string;
  compact?: boolean;
}

export function NotarySeal({ status, title, subtitle, compact = false }: NotarySealProps) {
  const prefersReduced = useReducedMotion();

  const bchRotation = status === 'verified' ? 0 : status === 'invalid' ? -28 : -16;
  const nostrRotation = status === 'verified' ? 0 : status === 'invalid' ? 28 : 16;

  const strokePrimary =
    status === 'verified' ? '#0A7E4F' : status === 'invalid' ? '#B91C1C' : '#5A697B';
  const strokeSecondary =
    status === 'verified' ? '#0E1722' : status === 'invalid' ? '#B91C1C' : '#9FB0C2';

  const size = compact ? 56 : 76;

  return (
    <div
      className={`flex items-center gap-4 border border-hairline bg-surface rounded-[6px] notary-floating-shadow ${
        compact ? 'px-4 py-3' : 'px-5 py-4'
      }`}
      data-testid="notary-seal"
      data-seal-status={status}
    >
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox="0 0 80 80"
          fill="none"
          aria-hidden="true"
          className="block"
        >
          {/* Outer registration ring */}
          <circle cx="40" cy="40" r="36" stroke="#CFD8E1" strokeWidth="1" strokeDasharray="2 3" />

          {/* BCH key half-arc */}
          <motion.g
            style={{ transformOrigin: '40px 40px' }}
            animate={{ rotate: bchRotation }}
            transition={
              prefersReduced
                ? { duration: 0 }
                : { duration: 0.32, ease: [0.23, 1, 0.32, 1] }
            }
          >
            <path
              d="M 40 8 A 32 32 0 0 1 72 40"
              stroke={strokePrimary}
              strokeWidth="3"
              strokeLinecap="square"
            />
            <path
              d="M 40 72 A 32 32 0 0 1 8 40"
              stroke={strokePrimary}
              strokeWidth="3"
              strokeLinecap="square"
            />
          </motion.g>

          {/* Nostr key half-arc */}
          <motion.g
            style={{ transformOrigin: '40px 40px' }}
            animate={{ rotate: nostrRotation }}
            transition={
              prefersReduced
                ? { duration: 0 }
                : { duration: 0.32, ease: [0.23, 1, 0.32, 1] }
            }
          >
            <path
              d="M 40 16 A 24 24 0 0 0 16 40"
              stroke={strokeSecondary}
              strokeWidth="2.25"
              strokeLinecap="square"
            />
            <path
              d="M 40 64 A 24 24 0 0 0 64 40"
              stroke={strokeSecondary}
              strokeWidth="2.25"
              strokeLinecap="square"
            />
          </motion.g>

          {/* Inner lock ring */}
          <circle
            cx="40"
            cy="40"
            r="15"
            fill={
              status === 'verified'
                ? '#E6F4ED'
                : status === 'invalid'
                  ? '#FEE2E2'
                  : '#E7EDF1'
            }
            stroke={strokePrimary}
            strokeWidth="1.25"
          />
        </svg>

        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          {status === 'verified' ? (
            <Check size={compact ? 16 : 20} weight="bold" className="text-emerald-notary" aria-hidden="true" />
          ) : status === 'invalid' ? (
            <Warning size={compact ? 16 : 20} weight="regular" className="text-status-invalid" aria-hidden="true" />
          ) : (
            <ShieldCheck size={compact ? 16 : 20} weight="regular" className="text-ink-muted" aria-hidden="true" />
          )}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <p className="font-display text-base font-semibold tracking-tight text-ink">
            {title}
          </p>
          <span className="text-xs font-medium text-ink-muted" aria-hidden="true">
            ·
          </span>
          <span
            className={`text-xs font-semibold ${
              status === 'verified'
                ? 'text-emerald-notary'
                : status === 'invalid'
                  ? 'text-status-invalid'
                  : 'text-ink-muted'
            }`}
          >
            {status === 'verified'
              ? 'Dual Proof Locked'
              : status === 'invalid'
                ? 'Verification Failed'
                : 'Awaiting Dual Signatures'}
          </span>
        </div>
        <p className="mt-0.5 text-sm text-ink-secondary">{subtitle}</p>
      </div>
    </div>
  );
}
