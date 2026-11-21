import { createContext, use, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  useWizardConnect,
  WizardConnectQRDialog,
  type WizardConnectQRTheme,
  type WizardConnectState,
} from '@wizardconnect/react';
import { PATH_RECEIVE } from '@wizardconnect/core';
import { binToHex } from '@bitauth/libauth';
import { deriveCashAddressFromPublicKey } from './protocol';
import type { UnsignedBchTxPlan } from './bchTx';

export interface WizardWalletContextValue {
  state: WizardConnectState;
  walletName: string | null;
  connectedAddress: string | null;
  connectedPubkeyHex: string | null;
  error: string | null;
  connect: () => boolean;
  disconnect: () => Promise<void>;
  signTransactionWithWallet: (plan: UnsignedBchTxPlan, userPrompt: string) => Promise<string>;
}

const WizardWalletContext = createContext<WizardWalletContextValue | null>(null);

const ARCHIVAL_QR_THEME: WizardConnectQRTheme = {
  backdropColor: 'rgba(14, 23, 34, 0.56)',
  dialogBackground: '#FAFBFC',
  headerBackground: '#F2F5F7',
  titleColor: '#0E1722',
  subtitleColor: '#445263',
  qrForeground: '#0E1722',
  qrBackground: '#FFFFFF',
  uriRowBackground: '#E7EDF1',
  uriTextColor: '#0E1722',
  borderColor: '#CFD8E1',
  closeButtonColor: '#445263',
  copyButtonColor: '#0A7E4F',
  qrSize: 256,
};

export function WizardWalletProvider({ children }: { children: ReactNode }) {
  const {
    state,
    manager,
    uri,
    qrUri,
    walletName,
    connect,
    disconnect,
    error,
  } = useWizardConnect({
    dappName: 'CashBind',
    sessionKey: 'cashbind-wizardconnect-session',
    persistSession: true,
  });

  const [connectedPubkeyHex, setConnectedPubkeyHex] = useState<string | null>(null);
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);

  useEffect(() => {
    if (!manager || state !== 'connected') {
      setConnectedPubkeyHex(null);
      setConnectedAddress(null);
      return;
    }

    const syncPubkey = () => {
      try {
        const pub = manager.getPubkey(0, 0n);
        if (pub) {
          const hex = binToHex(pub);
          setConnectedPubkeyHex(hex);
          setConnectedAddress(deriveCashAddressFromPublicKey(hex));
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
  }, [manager, state]);

  const signTransactionWithWallet = async (
    plan: UnsignedBchTxPlan,
    userPrompt: string,
  ): Promise<string> => {
    if (!manager || state !== 'connected') {
      throw new Error('Connect a WizardConnect BCH wallet first to sign this transaction.');
    }

    const wcSourceOutputs = plan.sourceOutputs.map((sourceOutput, idx) => ({
      ...plan.transaction.inputs[idx],
      ...sourceOutput,
    }));

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
  };

  const value = useMemo<WizardWalletContextValue>(
    () => ({
      state,
      walletName,
      connectedAddress,
      connectedPubkeyHex,
      error,
      connect,
      disconnect,
      signTransactionWithWallet,
    }),
    [state, walletName, connectedAddress, connectedPubkeyHex, error, connect, disconnect],
  );

  return (
    <WizardWalletContext.Provider value={value}>
      {children}
      {uri && qrUri ? (
        <WizardConnectQRDialog
          show={state === 'connecting'}
          onClose={() => {
            void disconnect();
          }}
          uri={uri}
          qrUri={qrUri}
          title="Connect BCH Wallet via WizardConnect"
          subtitle="Scan with Paytaca, Selene, or Cashonize to pair over WizardConnect"
          theme={ARCHIVAL_QR_THEME}
        />
      ) : null}
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
