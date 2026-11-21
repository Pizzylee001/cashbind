import type { BchUtxo } from './bchTx';
import type { DecodedOpReturnCommitment } from './protocol';

export interface BchNetworkStatus {
  ok: boolean;
  network?: string;
  node?: string;
  serverVersion?: string;
  blockHeight?: number;
  checkedAt?: number;
  error?: string;
}

export interface BchAddressInfo {
  ok: boolean;
  address: string;
  scripthash: string;
  node: string;
  confirmedSats: number;
  unconfirmedSats: number;
  utxos: BchUtxo[];
  history: Array<{ tx_hash: string; height: number }>;
  error?: string;
}

export interface BchTxInfo {
  ok: boolean;
  txid: string;
  node: string;
  confirmations: number;
  blockHeight: number | null;
  blockTime: number | null;
  outputs: Array<{
    index: number;
    valueSats: number;
    scriptPubKeyHex: string;
    cashBindCommitment: DecodedOpReturnCommitment | null;
  }>;
  explorerUrl: string;
  error?: string;
}

export interface BchScannedCommitment {
  txid: string;
  blockHeight: number | null;
  confirmations: number;
  commitment: DecodedOpReturnCommitment;
  explorerUrl: string;
}

export async function fetchBchStatus(): Promise<BchNetworkStatus> {
  const res = await fetch('/api/bch/status');
  return res.json();
}

export async function fetchBchAddressInfo(address: string): Promise<BchAddressInfo> {
  const res = await fetch(`/api/bch/address/${encodeURIComponent(address)}`);
  const data = (await res.json()) as BchAddressInfo;
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Could not fetch BCH address balance and UTXOs.');
  }
  return data;
}

export async function fetchBchTransaction(txid: string): Promise<BchTxInfo> {
  const res = await fetch(`/api/bch/tx/${encodeURIComponent(txid)}`);
  const data = (await res.json()) as BchTxInfo;
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Could not look up BCH mainnet transaction.');
  }
  return data;
}

export async function scanBchAddressCommitments(
  address: string,
): Promise<{ commitments: BchScannedCommitment[]; node: string }> {
  const res = await fetch(`/api/bch/scan-commitments/${encodeURIComponent(address)}`);
  const data = (await res.json()) as {
    ok: boolean;
    commitments: BchScannedCommitment[];
    node: string;
    error?: string;
  };
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Could not scan BCH address for CashBind commitments.');
  }
  return { commitments: data.commitments, node: data.node };
}

export async function broadcastBchTransaction(
  rawTxHex: string,
): Promise<{ txid: string; node: string; explorerUrl: string }> {
  const res = await fetch('/api/bch/broadcast', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rawTxHex }),
  });
  const data = (await res.json()) as {
    ok: boolean;
    txid: string;
    node: string;
    explorerUrl: string;
    error?: string;
  };
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Mainnet broadcast rejected by Fulcrum node.');
  }
  return { txid: data.txid, node: data.node, explorerUrl: data.explorerUrl };
}

export function formatSatsToBch(sats: number): string {
  const bch = sats / 1e8;
  return `${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 8,
  }).format(bch)} BCH`;
}

export function formatSatoshis(sats: number): string {
  return `${new Intl.NumberFormat('en-US').format(sats)} sats`;
}
