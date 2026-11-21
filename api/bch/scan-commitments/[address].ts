import {
  scanBchAddressCommitmentsServer,
  type ServerlessRequest,
  type ServerlessResponse,
} from '../../../src/server/fulcrum';

export default async function handler(req: ServerlessRequest, res: ServerlessResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  }
  const raw = req.query?.address;
  const address = Array.isArray(raw) ? raw[0] : raw;
  if (!address) {
    return res.status(400).json({ ok: false, error: 'Missing BCH address parameter.' });
  }
  try {
    const result = await scanBchAddressCommitmentsServer(decodeURIComponent(address));
    return res.status(200).json(result);
  } catch (err) {
    return res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to scan BCH commitments.',
    });
  }
}
