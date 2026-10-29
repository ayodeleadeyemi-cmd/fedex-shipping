import { handleApi } from '../server.js';

export default async function handler(req, res) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const url = new URL(req.url || '/', `${proto}://${host}`);
  try {
    await handleApi(req, res, url);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.statusCode = err.statusCode || 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: err.statusCode ? err.message : 'An unexpected server error occurred.' }));
    } else {
      res.end();
    }
  }
}
