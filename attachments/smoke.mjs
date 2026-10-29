import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { unlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataFile = path.join(os.tmpdir(), `edge-shipping-smoke-${process.pid}.json`);
const port = await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const chosen = probe.address().port;
    probe.close(err => err ? reject(err) : resolve(chosen));
  });
});
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server.js'], {
  cwd: projectDir,
  // Simulate an old .env copied from the deployment template. The local Windows launcher
  // enables demo mode and should recover the documented local admin credentials.
  env: { ...process.env, PORT: String(port), DATA_FILE: dataFile, NODE_ENV: 'production', EDGE_LOCAL_MODE: '1', ADMIN_EMAIL: 'operations@edgeshipping.com', ADMIN_PASSWORD: 'replace-with-a-long-unique-password' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let serverOutput = '';
child.stdout.on('data', chunk => { serverOutput += chunk.toString(); });
child.stderr.on('data', chunk => { serverOutput += chunk.toString(); });
let cookie = '';
async function call(method, pathname, body, useAuth = true) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (useAuth && cookie) headers.cookie = cookie;
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual'
  });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  return { status: response.status, body: payload, response };
}
async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (child.exitCode !== null) throw new Error(`Server exited early. ${serverOutput}`);
    try {
      const result = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) });
      if (result.ok) return;
    } catch { /* server has not started yet */ }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Server did not start. ${serverOutput}`);
}
function check(condition, message) {
  assert.ok(condition, message);
  console.log(`PASS ${message}`);
}

try {
  await waitForServer();
  let result = await call('GET', '/api/health', undefined, false);
  check(result.status === 200 && result.body.ok === true, 'server health endpoint responds');
  result = await call('GET', '/api/auth/config', undefined, false);
  check(result.status === 200 && result.body.demoMode === true && result.body.email === 'admin@edgeshipping.com' && result.body.password === 'EdgeDemo#2026', 'local launcher recovers demo login from stale template credentials');

  for (const route of ['/', '/track', '/ship', '/services', '/manage', '/support', '/admin', '/app.js', '/styles.css', '/assets/edge-hero.webp']) {
    result = await call('GET', route, undefined, false);
    check(result.status === 200, `page asset route ${route} loads`);
  }

  result = await call('GET', '/', undefined, false);
  check(result.status === 200 && result.body.includes('data-menu-toggle="shipping"') && result.body.includes('data-menu-toggle="tracking"') && result.body.includes('account-promo-section'), 'homepage includes working carrier-style navigation and shipment shortcuts');
  result = await call('GET', '/styles.css', undefined, false);
  check(result.status === 200 && result.body.includes('assets/edge-hero.webp') && result.body.includes('.nav-menu-group.open .nav-dropdown'), 'carrier-style hero image and interactive dropdown styling are served');

  result = await call('GET', '/api/admin/stats', undefined, false);
  check(result.status === 401, 'admin endpoints reject unauthenticated access');

  result = await call('POST', '/api/auth/login', { email: 'admin@edgeshipping.com', password: 'EdgeDemo#2026' }, false);
  check(result.status === 200 && Boolean(cookie), 'administrator login issues a session cookie');

  result = await call('GET', '/api/admin/stats');
  check(result.status === 200 && result.body.total >= 3, 'admin dashboard data loads after login');

  result = await call('POST', '/api/admin/shipments', {
    senderName: 'Smoke Test Sender', senderEmail: 'sender@example.com',
    recipientName: 'Smoke Test Recipient', recipientEmail: 'recipient@example.com',
    originCity: 'Seattle', originState: 'WA', originZip: '98101',
    destinationCity: 'Miami', destinationState: 'FL', destinationZip: '33101',
    weight: 2, service: 'Edge Ground', description: 'Automated smoke-test parcel'
  });
  check(result.status === 201 && /^EDG-US-[A-F0-9]{10}$/.test(result.body.shipment.trackingId), 'admin can create shipment and generate a tracking ID');
  const trackingId = result.body.shipment.trackingId;

  result = await call('GET', `/api/shipments/${trackingId}`, undefined, false);
  check(result.status === 200 && result.body.status === 'Label created', 'new tracking ID works on the public tracking endpoint');

  result = await call('PATCH', `/api/admin/shipments/${trackingId}/status`, { status: 'In transit', location: 'Denver, CO', note: 'Smoke test transit scan' });
  check(result.status === 200 && result.body.shipment.status === 'In transit', 'admin can save a tracking event');
  result = await call('GET', `/api/shipments/${trackingId}`, undefined, false);
  check(result.status === 200 && result.body.events.some(event => event.note === 'Smoke test transit scan'), 'tracking history shows the saved event');

  result = await call('POST', '/api/quote', {
    name: 'Quote Smoke Test', email: 'quote@example.com',
    originCity: 'Seattle', originState: 'WA', originZip: '98101',
    destinationCity: 'Miami', destinationState: 'FL', destinationZip: '33101',
    weight: 3, service: 'Edge Priority'
  }, false);
  check(result.status === 201 && result.body.estimatedPrice > 0, 'quote form returns an estimate and saves a request');

  result = await call('POST', '/api/requests', { trackingId, type: 'hold', name: 'Hold Smoke Test', email: 'hold@example.com', reason: 'Need delivery held for pickup' }, false);
  check(result.status === 201, 'customer can submit a package hold request');
  const requestId = result.body.requestId;
  result = await call('PATCH', `/api/admin/requests/${requestId}`, { status: 'Approved' });
  check(result.status === 200 && result.body.request.status === 'Approved', 'admin can approve a customer request');
  result = await call('GET', `/api/shipments/${trackingId}`, undefined, false);
  check(result.status === 200 && result.body.status === 'Held at facility', 'approved hold updates the public shipment status');

  result = await call('GET', '/api/brand', undefined, false);
  check(result.status === 200 && result.body.isCustom === false, 'default Edge logo is available');
  const pixelPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/DQAAAABJRU5ErkJggg==';
  result = await call('POST', '/api/admin/brand-logo', { dataUrl: `data:image/png;base64,${pixelPng}` });
  check(result.status === 201 && result.body.isCustom === true, 'admin can upload a logo image');
  result = await call('GET', '/api/brand', undefined, false);
  check(result.status === 200 && result.body.isCustom === true, 'custom logo is reflected by the public branding endpoint');
  result = await call('DELETE', '/api/admin/brand-logo', {});
  check(result.status === 200 && result.body.isCustom === false, 'admin can restore the default logo');

  result = await call('POST', '/api/auth/logout', {});
  check(result.status === 200, 'admin logout clears the session');
  result = await call('GET', '/api/admin/stats', undefined, false);
  check(result.status === 401, 'logged-out sessions cannot access admin endpoints');

  console.log('\nAll Edge Shipping smoke tests passed.');
} catch (error) {
  console.error('\nSMOKE TEST FAILED:', error.message);
  if (serverOutput) console.error(serverOutput);
  process.exitCode = 1;
} finally {
  child.kill('SIGTERM');
  await new Promise(resolve => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', resolve);
    setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 2000).unref();
  });
  await unlink(dataFile).catch(() => {});
}
