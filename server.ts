import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  broadcastRawBchTransaction,
  fetchAndParseBchTransaction,
  getBchAddressDetails,
  getBchNetworkStatus,
  scanBchAddressCommitmentsServer,
} from './src/server/fulcrum';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/bch/status', async (_req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await getBchNetworkStatus());
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to reach BCH mainnet Fulcrum nodes.',
      });
    }
  });

  app.get('/api/bch/address/:address', async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await getBchAddressDetails(req.params.address));
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to inspect BCH address.',
      });
    }
  });

  app.get('/api/bch/tx/:txid', async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const parsed = await fetchAndParseBchTransaction(req.params.txid);
      res.json({ ok: true, ...parsed });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to fetch BCH transaction.',
      });
    }
  });

  app.get('/api/bch/scan-commitments/:address', async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await scanBchAddressCommitmentsServer(req.params.address));
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to scan BCH commitments.',
      });
    }
  });

  app.post('/api/bch/broadcast', async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const rawTxHex = String(req.body?.rawTxHex || '');
      res.json(await broadcastRawBchTransaction(rawTxHex));
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : 'BCH mainnet node rejected the transaction.',
      });
    }
  });

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Run npm run build before starting production server.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CashBind server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
