import {
  fetchAndParseBchTransaction,
  type ServerlessRequest,
  type ServerlessResponse,
} from '../../../src/server/fulcrum';

export default async function handler(req: ServerlessRequest, res: ServerlessResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  }
  const raw = req.query?.txid;
  const txid = Array.isArray(raw) ? raw[0] : raw;
  if (!txid) {
    return res.status(400).json({ ok: false, error: 'Missing BCH txid parameter.' });
  }
  try {
    const parsed = await fetchAndParseBchTransaction(decodeURIComponent(txid));
    return res.status(200).json({ ok: true, ...parsed });
  } catch (err) {
    return res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to fetch BCH transaction.',
    });
  }
}
