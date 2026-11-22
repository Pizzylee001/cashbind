import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useWizardConnect, type WizardConnectState } from '@wizardconnect/react';
import { PATH_RECEIVE } from '@wizardconnect/core';
import { binToHex } from '@bitauth/libauth';
import { WalletConnectModal } from '../components/WalletConnectModal';
import { deriveCashAddressFromPublicKey } from './protocol';
import type { UnsignedBchTxPlan } from './bchTx';

interface InjectedBchProvider {
  connect?: () => Promise<unknown>;
  disconnect?: () => Promise<void>;
  connected?: () => Promise<boolean> | boolean;
  address?: (() => Promise<string>) | string;
  getAddresses?: () => Promise<string[]>;
  signTransaction?: (options: Record<string, unknown>) => Promise<
    | string
    | {
        signedTransaction?: string;
        signedTransactionHash?: string;
        txHex?: string;
        hex?: string;
      }
  >;
  signMessage?: (options: { message: string; address?: string }) => Promise<string | { signature?: string }>;
}

interface DetectedProvider {
  provider: InjectedBchProvider;
  label: string;
}

function detectInjectedBchProvider(): DetectedProvider | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as Record<string, unknown>;
  if (win.paytaca && typeof win.paytaca === 'object') {
    return { provider: win.paytaca as InjectedBchProvider, label: 'Paytaca Extension' };
  }
  if (win.bitcoinCash && typeof win.bitcoinCash === 'object') {
    return { provider: win.bitcoinCash as InjectedBchProvider, label: 'BCH Browser Extension' };
  }
  return null;
}

function normalizeCashAddr(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  return trimmed.includes(':') ? trimmed : `bitcoincash:${trimmed}`;
}

export interface WizardWalletContextValue {
  state: WizardConnectState;
  walletName: string | null;
  connectedAddress: string | null;
  connectedPubkeyHex: string | null;
  connectionMode: 'wizardconnect' | 'extension' | null;
  error: string | null;
  connect: () => boolean;
  disconnect: () => Promise<void>;
  signTransactionWithWallet: (plan: UnsignedBchTxPlan, userPrompt: string) => Promise<string>;
}

const WizardWalletContext = createContext<WizardWalletContextValue | null>(null);

export function WizardWalletProvider({ children }: { children: ReactNode }) {
  const {
    state: wcState,
    manager,
    uri,
    qrUri,
    walletName: wcWalletName,
    connect: wcConnect,
    disconnect: wcDisconnect,
    error: wcError,
  } = useWizardConnect({
    dappName: 'CashBind',
    sessionKey: 'cashbind-wizardconnect-session',
    persistSession: true,
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [wcPubkeyHex, setWcPubkeyHex] = useState<string | null>(null);
  const [wcAddress, setWcAddress] = useState<string | null>(null);

  const [detected, setDetected] = useState<DetectedProvider | null>(() =>
    detectInjectedBchProvider(),
  );
  const [extConnected, setExtConnected] = useState(false);
  const [extConnecting, setExtConnecting] = useState(false);
  const [extAddress, setExtAddress] = useState<string | null>(null);
  const [extWalletName, setExtWalletName] = useState<string | null>(null);
  const [extError, setExtError] = useState<string | null>(null);

  // Re-check for asynchronously injected browser extensions shortly after mount
  useEffect(() => {
    const check = () => setDetected(detectInjectedBchProvider());
    check();
    const timer = window.setTimeout(check, 800);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!manager || wcState !== 'connected') {
      setWcPubkeyHex(null);
      setWcAddress(null);
      return;
    }

    setModalOpen(false);

    const syncPubkey = () => {
      try {
        const pub = manager.getPubkey(0, 0n);
        if (pub) {
          const hex = binToHex(pub);
          setWcPubkeyHex(hex);
          setWcAddress(deriveCashAddressFromPublicKey(hex));
        }
      } catch {
        // walletready may still be syncing xpubs
      }
    };

    syncPubkey();
    manager.on('walletready', syncPubkey);
    return () => {
      manager.off('walletready', syncPubkey);
    };
  }, [manager, wcState]);

  const connect = useCallback((): boolean => {
    setExtError(null);
    setDetected(detectInjectedBchProvider());
    setModalOpen(true);
    if (wcState !== 'connecting' && wcState !== 'connected') {
      wcConnect();
    }
    return true;
  }, [wcConnect, wcState]);

  const handleCloseModal = useCallback(() => {
    setModalOpen(false);
    if (wcState === 'connecting') {
      void wcDisconnect();
    }
  }, [wcDisconnect, wcState]);

  const connectInjectedExtension = useCallback(async () => {
    const found = detectInjectedBchProvider();
    if (!found) {
      setExtError(
        'No injected browser provider detected. Use the Copy URL option below to pair your Paytaca Chrome Extension via Apps -> WizardConnect -> Paste URL.',
      );
      return;
    }

    setExtConnecting(true);
    setExtError(null);
    try {
      const { provider, label } = found;
      let resolvedAddress: string | null = null;

      if (typeof provider.connect === 'function') {
        const res = await provider.connect();
        if (typeof res === 'string' && res.trim()) {
          resolvedAddress = normalizeCashAddr(res);
        } else if (res && typeof res === 'object' && 'address' in res) {
          const addr = (res as { address?: unknown }).address;
          if (typeof addr === 'string' && addr.trim()) {
            resolvedAddress = normalizeCashAddr(addr);
          }
        }
      }

      if (!resolvedAddress && typeof provider.address === 'function') {
        const addr = await provider.address();
        if (typeof addr === 'string' && addr.trim()) {
          resolvedAddress = normalizeCashAddr(addr);
        }
      } else if (!resolvedAddress && typeof provider.address === 'string' && provider.address.trim()) {
        resolvedAddress = normalizeCashAddr(provider.address);
      } else if (!resolvedAddress && typeof provider.getAddresses === 'function') {
        const addrs = await provider.getAddresses();
        if (Array.isArray(addrs) && typeof addrs[0] === 'string' && addrs[0].trim()) {
          resolvedAddress = normalizeCashAddr(addrs[0]);
        }
      }

      if (!resolvedAddress) {
        throw new Error(`${label} connected but did not return a Bitcoin Cash mainnet address.`);
      }

      if (wcState === 'connecting') {
        await wcDisconnect();
      }
      setExtAddress(resolvedAddress);
      setExtWalletName(label);
      setExtConnected(true);
      setModalOpen(false);
    } catch (err) {
      setExtError(err instanceof Error ? err.message : 'Failed to connect browser extension.');
    } finally {
      setExtConnecting(false);
    }
  }, [wcDisconnect, wcState]);

  const disconnect = useCallback(async () => {
    setModalOpen(false);
    if (extConnected) {
      const found = detectInjectedBchProvider();
      if (found?.provider.disconnect) {
        try {
          await found.provider.disconnect();
        } catch {
          // Ignore disconnect errors from extension
        }
      }
      setExtConnected(false);
      setExtAddress(null);
      setExtWalletName(null);
    }
    if (wcState !== 'idle' && wcState !== 'disconnected') {
      await wcDisconnect();
    }
  }, [extConnected, wcDisconnect, wcState]);

  const signTransactionWithWallet = useCallback(
    async (plan: UnsignedBchTxPlan, userPrompt: string): Promise<string> => {
      const wcSourceOutputs = plan.sourceOutputs.map((sourceOutput, idx) => ({
        ...plan.transaction.inputs[idx],
        ...sourceOutput,
      }));

      if (extConnected) {
        const found = detectInjectedBchProvider();
        if (!found?.provider.signTransaction) {
          throw new Error(
            'Connected browser extension does not expose signTransaction. Pair via WizardConnect Paste URL instead.',
          );
        }
        const response = await found.provider.signTransaction({
          transaction: plan.transaction,
          sourceOutputs: wcSourceOutputs,
          broadcast: false,
          userPrompt,
        });
        if (typeof response === 'string' && response.trim()) {
          return response.trim();
        }
        const hex =
          response && typeof response === 'object'
            ? response.signedTransaction || response.txHex || response.hex
            : undefined;
        if (!hex) {
          throw new Error('Browser extension did not return a signed transaction hex.');
        }
        return hex;
      }

      if (!manager || wcState !== 'connected') {
        throw new Error('Connect a Bitcoin Cash wallet first to sign this transaction.');
      }

      const response = await manager.signTransaction({
        transaction: {
          transaction: plan.transaction,
          sourceOutputs: wcSourceOutputs,
          broadcast: false,
          userPrompt,
        },
        inputPaths: plan.selectedUtxos.map((_, idx) => [idx, PATH_RECEIVE, 0]),
      });

      if (response.error) {
        throw new Error(response.error);
      }
      if (!response.signedTransaction) {
        throw new Error('Wallet did not return a signed transaction.');
      }
      return response.signedTransaction;
    },
    [extConnected, manager, wcState],
  );

  const effectiveState: WizardConnectState = extConnected
    ? 'connected'
    : modalOpen && wcState === 'connecting'
      ? 'connecting'
      : wcState;

  const value = useMemo<WizardWalletContextValue>(
    () => ({
      state: effectiveState,
      walletName: extConnected ? extWalletName : wcWalletName,
      connectedAddress: extConnected ? extAddress : wcAddress,
      connectedPubkeyHex: extConnected ? null : wcPubkeyHex,
      connectionMode: extConnected ? 'extension' : wcState === 'connected' ? 'wizardconnect' : null,
      error: extError || wcError,
      connect,
      disconnect,
      signTransactionWithWallet,
    }),
    [
      effectiveState,
      extConnected,
      extWalletName,
      wcWalletName,
      extAddress,
      wcAddress,
      wcPubkeyHex,
      wcState,
      extError,
      wcError,
      connect,
      disconnect,
      signTransactionWithWallet,
    ],
  );

  return (
    <WizardWalletContext.Provider value={value}>
      {children}
      <WalletConnectModal
        open={modalOpen && !extConnected && wcState !== 'connected'}
        onClose={handleCloseModal}
        uri={uri}
        qrUri={qrUri}
        hasInjectedExtension={Boolean(detected)}
        injectedLabel={detected?.label ?? 'Paytaca Extension'}
        extensionConnecting={extConnecting}
        error={extError || wcError}
        onConnectInjected={connectInjectedExtension}
      />
    </WizardWalletContext.Provider>
  );
}

export function useWizardWallet(): WizardWalletContextValue {
  const ctx = use(WizardWalletContext);
  if (!ctx) {
    throw new Error('useWizardWallet must be used inside WizardWalletProvider.');
  }
  return ctx;
}
