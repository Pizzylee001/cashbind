import {
  getBchNetworkStatus,
  type ServerlessRequest,
  type ServerlessResponse,
} from '../../src/server/fulcrum';

export default async function handler(req: ServerlessRequest, res: ServerlessResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  }
  try {
    const status = await getBchNetworkStatus();
    return res.status(200).json(status);
  } catch (err) {
    return res.status(502).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Unable to reach BCH mainnet Fulcrum nodes.',
    });
  }
}
