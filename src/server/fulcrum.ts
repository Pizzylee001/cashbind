import tls from 'node:tls';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { binToHex, decodeTransactionBCH, hexToBin } from '@bitauth/libauth';
import {
  bchAddressToElectrumScriptHash,
  decodeCashBindOpReturn,
  normalizeCashAddress,
} from '../lib/protocol';

export interface ServerlessRequest extends IncomingMessage {
  query?: Record<string, string | string[] | undefined>;
  body?: unknown;
}

export interface ServerlessResponse extends ServerResponse {
  status: (code: number) => ServerlessResponse;
  json: (payload: unknown) => ServerlessResponse;
}

interface FulcrumNode {
  label: string;
  transport: 'tls' | 'wss';
  host?: string;
  port?: number;
  url?: string;
}

const FULCRUM_NODES: FulcrumNode[] = [
  { label: 'bch.imaginary.cash:50002', transport: 'tls', host: 'bch.imaginary.cash', port: 50002 },
  { label: 'bch.loping.net:50002', transport: 'tls', host: 'bch.loping.net', port: 50002 },
  { label: 'fulcrum.greyh.at:50004', transport: 'wss', url: 'wss://fulcrum.greyh.at:50004' },
];

function callFulcrumTls<T>(
  host: string,
  port: number,
  method: string,
  params: unknown[],
  timeoutMs = 6500,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let buffer = '';
    const socket = tls.connect({ host, port, rejectUnauthorized: false });
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        socket.destroy();
        reject(new Error(`Fulcrum TLS timeout (${host}:${port}) for ${method}`));
      }
    }, timeoutMs);

    const finish = (err: Error | null, data?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (err) reject(err);
      else resolve(data as T);
    };

    socket.on('secureConnect', () => {
      const payload = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) + '\n';
      socket.write(payload);
    });

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const nl = buffer.indexOf('\n');
      if (nl !== -1) {
        const line = buffer.slice(0, nl).trim();
        try {
          const parsed = JSON.parse(line) as { result?: T; error?: { message?: string } | string };
          if (parsed.error) {
            const msg =
              typeof parsed.error === 'string'
                ? parsed.error
                : parsed.error.message || JSON.stringify(parsed.error);
            finish(new Error(msg));
          } else {
            finish(null, parsed.result);
          }
        } catch (err) {
          finish(err instanceof Error ? err : new Error('Malformed JSON-RPC response'));
        }
      }
    });

    socket.on('error', (err) => finish(err));
  });
}

function callFulcrumWss<T>(
  url: string,
  method: string,
  params: unknown[],
  timeoutMs = 6500,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          ws.close();
        } catch {
          // ignore close errors on timeout
        }
        reject(new Error(`Fulcrum WSS timeout (${url}) for ${method}`));
      }
    }, timeoutMs);

    const finish = (err: Error | null, data?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // ignore close errors
      }
      if (err) reject(err);
      else resolve(data as T);
    };

    ws.onopen = () => {
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }));
    };
    ws.onmessage = (evt) => {
      try {
        const parsed = JSON.parse(String(evt.data)) as {
          result?: T;
          error?: { message?: string } | string;
        };
        if (parsed.error) {
          const msg =
            typeof parsed.error === 'string'
              ? parsed.error
              : parsed.error.message || JSON.stringify(parsed.error);
          finish(new Error(msg));
        } else {
          finish(null, parsed.result);
        }
      } catch (err) {
        finish(err instanceof Error ? err : new Error('Malformed WSS JSON-RPC response'));
      }
    };
    ws.onerror = () => finish(new Error(`Fulcrum WSS connection failed (${url})`));
  });
}

export async function callFulcrum<T>(
  method: string,
  params: unknown[] = [],
): Promise<{ result: T; node: string }> {
  let lastError: Error | null = null;
  for (const node of FULCRUM_NODES) {
    try {
      const result =
        node.transport === 'tls' && node.host && node.port
          ? await callFulcrumTls<T>(node.host, node.port, method, params)
          : await callFulcrumWss<T>(node.url!, method, params);
      return { result, node: node.label };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastError || new Error('All BCH mainnet Fulcrum nodes failed to respond.');
}

interface FulcrumUtxoRaw {
  tx_hash: string;
  tx_pos: number;
  value: number;
  height: number;
}

interface FulcrumHistoryRaw {
  tx_hash: string;
  height: number;
}

export interface ParsedTxResponse {
  txid: string;
  node: string;
  confirmations: number;
  blockHeight: number | null;
  blockTime: number | null;
  outputs: Array<{
    index: number;
    valueSats: number;
    scriptPubKeyHex: string;
    cashBindCommitment: ReturnType<typeof decodeCashBindOpReturn>;
  }>;
  explorerUrl: string;
}

export async function getBchNetworkStatus() {
  const [ver, tip] = await Promise.all([
    callFulcrum<[string, string]>('server.version', ['CashBind', '1.4']),
    callFulcrum<{ height: number; hex: string }>('blockchain.headers.subscribe', []),
  ]);
  return {
    ok: true,
    network: 'bitcoin-cash-mainnet',
    node: tip.node,
    serverVersion: Array.isArray(ver.result) ? ver.result[0] : String(ver.result),
    blockHeight: tip.result.height,
    checkedAt: Math.floor(Date.now() / 1000),
  };
}

export async function getBchAddressDetails(address: string) {
  const normalized = normalizeCashAddress(address);
  const scripthash = bchAddressToElectrumScriptHash(normalized);

  const [balanceRes, utxoRes, historyRes] = await Promise.all([
    callFulcrum<{ confirmed: number; unconfirmed: number }>('blockchain.scripthash.get_balance', [
      scripthash,
    ]),
    callFulcrum<FulcrumUtxoRaw[]>('blockchain.scripthash.listunspent', [scripthash]),
    callFulcrum<FulcrumHistoryRaw[]>('blockchain.scripthash.get_history', [scripthash]),
  ]);

  return {
    ok: true,
    address: normalized,
    scripthash,
    node: balanceRes.node,
    confirmedSats: balanceRes.result.confirmed,
    unconfirmedSats: balanceRes.result.unconfirmed,
    utxos: utxoRes.result.map((u) => ({
      txid: u.tx_hash,
      vout: u.tx_pos,
      value: u.value,
      height: u.height,
    })),
    history: historyRes.result.slice(-20).reverse(),
  };
}

export async function fetchAndParseBchTransaction(txid: string): Promise<ParsedTxResponse> {
  const cleanTxid = txid.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(cleanTxid)) {
    throw new Error('Transaction ID must be a 64-character hex string.');
  }

  let confirmations = 0;
  let blockHeight: number | null = null;
  let blockTime: number | null = null;
  let outputs: ParsedTxResponse['outputs'] = [];
  let activeNode = '';

  try {
    const verboseCall = await callFulcrum<{
      txid?: string;
      confirmations?: number;
      blockheight?: number;
      blocktime?: number;
      vout?: Array<{
        n: number;
        value: number;
        scriptPubKey?: { hex?: string };
      }>;
    }>('blockchain.transaction.get', [cleanTxid, true]);

    activeNode = verboseCall.node;
    const v = verboseCall.result;
    confirmations = Number(v.confirmations ?? 0);
    blockHeight = typeof v.blockheight === 'number' ? v.blockheight : null;
    blockTime = typeof v.blocktime === 'number' ? v.blocktime : null;
    outputs = (v.vout || []).map((o) => {
      const scriptHex = (o.scriptPubKey?.hex || '').toLowerCase();
      return {
        index: o.n,
        valueSats: Math.round(Number(o.value || 0) * 1e8),
        scriptPubKeyHex: scriptHex,
        cashBindCommitment: decodeCashBindOpReturn(scriptHex),
      };
    });
  } catch {
    const rawCall = await callFulcrum<string>('blockchain.transaction.get', [cleanTxid, false]);
    activeNode = rawCall.node;
    const decoded = decodeTransactionBCH(hexToBin(rawCall.result));
    if (typeof decoded === 'string') {
      throw new Error(`Could not decode raw transaction: ${decoded}`);
    }
    outputs = decoded.outputs.map((o, index) => {
      const scriptHex = binToHex(o.lockingBytecode).toLowerCase();
      return {
        index,
        valueSats: Number(o.valueSatoshis),
        scriptPubKeyHex: scriptHex,
        cashBindCommitment: decodeCashBindOpReturn(scriptHex),
      };
    });
  }

  return {
    txid: cleanTxid,
    node: activeNode,
    confirmations,
    blockHeight,
    blockTime,
    outputs,
    explorerUrl: `https://blockchair.com/bitcoin-cash/transaction/${cleanTxid}`,
  };
}

export async function scanBchAddressCommitmentsServer(address: string) {
  const normalized = normalizeCashAddress(address);
  const scripthash = bchAddressToElectrumScriptHash(normalized);
  const historyRes = await callFulcrum<FulcrumHistoryRaw[]>('blockchain.scripthash.get_history', [
    scripthash,
  ]);
  const recent = historyRes.result.slice(-10).reverse();

  const inspected = await Promise.all(
    recent.map(async (item) => {
      try {
        const tx = await fetchAndParseBchTransaction(item.tx_hash);
        const commitmentOutput = tx.outputs.find((o) => o.cashBindCommitment !== null);
        if (!commitmentOutput?.cashBindCommitment) return null;
        return {
          txid: tx.txid,
          blockHeight: tx.blockHeight ?? (item.height > 0 ? item.height : null),
          confirmations: tx.confirmations,
          commitment: commitmentOutput.cashBindCommitment,
          explorerUrl: tx.explorerUrl,
        };
      } catch {
        return null;
      }
    }),
  );

  return {
    ok: true,
    address: normalized,
    node: historyRes.node,
    commitments: inspected.filter((c): c is NonNullable<typeof c> => c !== null),
  };
}

export async function broadcastRawBchTransaction(rawTxHexInput: string) {
  const rawTxHex = rawTxHexInput.trim().toLowerCase();
  if (!/^[0-9a-f]{20,}$/.test(rawTxHex) || rawTxHex.length % 2 !== 0) {
    throw new Error('rawTxHex must be a valid even-length hex transaction.');
  }
  const broadcastRes = await callFulcrum<string>('blockchain.transaction.broadcast', [rawTxHex]);
  const txid = String(broadcastRes.result).trim();
  return {
    ok: true,
    txid,
    node: broadcastRes.node,
    explorerUrl: `https://blockchair.com/bitcoin-cash/transaction/${txid}`,
  };
}
