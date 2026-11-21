import {
  broadcastRawBchTransaction,
  type ServerlessRequest,
  type ServerlessResponse,
} from '../../src/server/fulcrum';

export default async function handler(req: ServerlessRequest, res: ServerlessResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  }
  try {
    const parsedBody =
      typeof req.body === 'string'
        ? (JSON.parse(req.body) as { rawTxHex?: string })
        : ((req.body || {}) as { rawTxHex?: string });
    const rawTxHex = String(parsedBody.rawTxHex || '');
    const result = await broadcastRawBchTransaction(rawTxHex);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'BCH mainnet node rejected the transaction.',
    });
  }
}
