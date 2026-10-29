import http from 'node:http';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load a local .env file when present, without overwriting environment variables.
try {
  const envText = readFileSync(path.join(__dirname, '.env'), 'utf8');
  for (const line of envText.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
} catch { /* .env is optional */ }
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const ON_VERCEL = Boolean(process.env.VERCEL);
const UPLOADS_DIR = ON_VERCEL ? '/tmp/edge-uploads' : path.join(PUBLIC_DIR, 'uploads');
const DATA_FILE = process.env.DATA_FILE || (ON_VERCEL ? '/tmp/edge-shipping-store.json' : path.join(DATA_DIR, 'store.json'));
const PORT = Number(process.env.PORT || 3000);
const NODE_ENV = process.env.NODE_ENV || 'development';
const DEMO_EMAIL = 'admin@edgeshipping.com';
const DEMO_PASSWORD = 'EdgeDemo#2026';
const EXAMPLE_PASSWORD = 'replace-with-a-long-unique-password';
const configuredAdminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const configuredAdminPassword = (process.env.ADMIN_PASSWORD || '').trim();
const useLocalDemoCredentials = !configuredAdminPassword || configuredAdminPassword === EXAMPLE_PASSWORD;
const ADMIN_EMAIL = (useLocalDemoCredentials ? DEMO_EMAIL : configuredAdminEmail || DEMO_EMAIL).toLowerCase();
const ADMIN_PASSWORD = useLocalDemoCredentials ? DEMO_PASSWORD : configuredAdminPassword;
const SESSION_SECRET = process.env.SESSION_SECRET || 'edge-shipping-demo-session-secret';
const loginAttempts = new Map();
const SESSION_TTL = 8 * 60 * 60 * 1000;
const MAX_BODY = 1_500_000;
const MAX_LOGO_BYTES = 750 * 1024;

const US_STATE_CODES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'
]);
function validUSZip(zip) { return /^\d{5}(?:-\d{4})?$/.test(String(zip || '').trim()); }

const STATUS_OPTIONS = [
  'Label created', 'Picked up', 'In transit', 'At facility', 'Out for delivery',
  'Delivered', 'Held at facility', 'Return requested', 'Returning to sender', 'Exception'
];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp'
};

function nowIso() { return new Date().toISOString(); }
function idToken(bytes = 6) { return crypto.randomBytes(bytes).toString('hex').toUpperCase(); }
function makeTrackingId() { return `EDG-US-${idToken(5)}`; }
function safeEqual(a, b) {
  const aa = Buffer.from(String(a ?? ''));
  const bb = Buffer.from(String(b ?? ''));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}
function seedStore() {
  const today = Date.now();
  const stamp = (hoursAgo) => new Date(today - hoursAgo * 60 * 60 * 1000).toISOString();
  return {
    shipments: [
      {
        trackingId: 'FED-US-FEDO621', demo: true,
        senderName: 'Northstar Goods', senderEmail: 'fedex@shipping.com',
        recipientName: 'Jordan Lee', recipientEmail: '',
        description: 'Business parcel', weight: 4.2, service: 'Edge Priority',
        originCity: 'Dallas', originState: 'TX', originZip: '75201',
        destinationCity: 'Atlanta', destinationState: 'GA', destinationZip: '30303',
        status: 'In transit', currentLocation: 'Memphis, TN',
        eta: new Date(today + 36 * 60 * 60 * 1000).toISOString().slice(0, 10),
        createdAt: stamp(38), updatedAt: stamp(2),
        events: [
          { id: 'EV-DEMO-1', status: 'Label created', location: 'Dallas, TX', note: 'Shipment information received.', timestamp: stamp(38) },
          { id: 'EV-DEMO-2', status: 'Picked up', location: 'Dallas, TX', note: 'Package picked up by Edge Shipping.', timestamp: stamp(31) },
          { id: 'EV-DEMO-3', status: 'At facility', location: 'Dallas, TX Distribution Center', note: 'Processed at origin facility.', timestamp: stamp(24) },
          { id: 'EV-DEMO-4', status: 'In transit', location: 'Memphis, TN', note: 'Package moving through the network.', timestamp: stamp(2) }
        ]
      },
      {
        trackingId: 'EDG-US-DEMO002', demo: true,
        senderName: 'Sample Outdoor Co.', senderEmail: '',
        recipientName: 'Casey Morgan', recipientEmail: '',
        description: 'Retail package', weight: 1.6, service: 'Edge Express',
        originCity: 'Cleveland', originState: 'OH', originZip: '44113',
        destinationCity: 'Chicago', destinationState: 'IL', destinationZip: '60601',
        status: 'Out for delivery', currentLocation: 'Chicago, IL',
        eta: new Date(today).toISOString().slice(0, 10),
        createdAt: stamp(30), updatedAt: stamp(1),
        events: [
          { id: 'EV-DEMO-5', status: 'Label created', location: 'Cleveland, OH', note: 'Shipment information received.', timestamp: stamp(30) },
          { id: 'EV-DEMO-6', status: 'Picked up', location: 'Cleveland, OH', note: 'Package picked up.', timestamp: stamp(24) },
          { id: 'EV-DEMO-7', status: 'In transit', location: 'Chicago, IL', note: 'Arrived at destination metro area.', timestamp: stamp(8) },
          { id: 'EV-DEMO-8', status: 'Out for delivery', location: 'Chicago, IL', note: 'Your package is with a local delivery driver.', timestamp: stamp(1) }
        ]
      },
      {
        trackingId: 'EDG-US-DEMO003', demo: true,
        senderName: 'Sample Home Supply', senderEmail: '',
        recipientName: 'Riley Taylor', recipientEmail: '',
        description: 'Home accessories', weight: 3.0, service: 'Edge Ground',
        originCity: 'Phoenix', originState: 'AZ', originZip: '85004',
        destinationCity: 'Los Angeles', destinationState: 'CA', destinationZip: '90012',
        status: 'Delivered', currentLocation: 'Los Angeles, CA',
        eta: new Date(today - 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        createdAt: stamp(90), updatedAt: stamp(26),
        events: [
          { id: 'EV-DEMO-9', status: 'Label created', location: 'Phoenix, AZ', note: 'Shipment information received.', timestamp: stamp(90) },
          { id: 'EV-DEMO-10', status: 'Picked up', location: 'Phoenix, AZ', note: 'Package picked up.', timestamp: stamp(78) },
          { id: 'EV-DEMO-11', status: 'In transit', location: 'Los Angeles, CA', note: 'Package moving through the network.', timestamp: stamp(52) },
          { id: 'EV-DEMO-12', status: 'Delivered', location: 'Los Angeles, CA', note: 'Delivered to the destination address. Demo record only.', timestamp: stamp(26) }
        ]
      }
    ],
    requests: [],
    brandLogo: null
  };
}

let store;
async function persist() {
  await mkdir(path.dirname(DATA_FILE), { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(store, null, 2), 'utf8');
}
async function loadStore() {
  await mkdir(path.dirname(DATA_FILE), { recursive: true });
  if (!existsSync(DATA_FILE)) {
    store = seedStore();
    await persist();
    return;
  }
  try {
    store = JSON.parse(await readFile(DATA_FILE, 'utf8'));
    if (!Array.isArray(store.shipments) || !Array.isArray(store.requests)) throw new Error('Invalid store');
    if (typeof store.brandLogo !== 'string') store.brandLogo = null;
  } catch (err) {
    console.error('Could not read data file; starting with sample data:', err.message);
    store = seedStore();
    await persist();
  }
}

function send(res, status, body, extraHeaders = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY', 'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(payload);
}
function fail(res, status, message) { send(res, status, { error: message }); }
async function readBody(req) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > MAX_BODY) throw Object.assign(new Error('Request body is too large.'), { statusCode: 413 });
  }
  if (!data) return {};
  try { return JSON.parse(data); }
  catch { throw Object.assign(new Error('Request body must be valid JSON.'), { statusCode: 400 }); }
}
function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(v => v.trim()).filter(Boolean).map(pair => {
    const idx = pair.indexOf('='); return [pair.slice(0, idx), decodeURIComponent(pair.slice(idx + 1))];
  }));
}
function secureRequest(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return Boolean(req.socket.encrypted) || forwardedProto === 'https';
}
function getSession(req) {
  const token = cookies(req).edge_session;
  if (!token || !token.includes('.')) return null;
  const dot = token.lastIndexOf('.');
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  if (!safeEqual(sig, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!data?.email || Number(data.exp) < Date.now()) return null;
    return { email: data.email, expiresAt: data.exp };
  } catch { return null; }
}
function issueSession(email) {
  const payload = Buffer.from(JSON.stringify({ email, exp: Date.now() + SESSION_TTL })).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
function adminOnly(req, res) {
  const session = getSession(req);
  if (!session) { fail(res, 401, 'Please sign in with an administrator account.'); return null; }
  return session;
}
function cleanText(value, max = 180) { return String(value ?? '').trim().replace(/[<>]/g, '').slice(0, max); }
function publicShipment(s) {
  const { senderEmail, recipientEmail, ...rest } = s;
  return rest;
}
function findShipment(trackingId) {
  return store.shipments.find(s => s.trackingId.toLowerCase() === String(trackingId || '').trim().toLowerCase());
}
function eventFor(status, location, note) {
  return { id: `EV-${idToken(5)}`, status, location: cleanText(location, 180), note: cleanText(note, 500), timestamp: nowIso() };
}
function addShipmentEvent(shipment, status, location, note) {
  shipment.status = status;
  shipment.currentLocation = cleanText(location || shipment.currentLocation || `${shipment.destinationCity}, ${shipment.destinationState}`, 180);
  shipment.updatedAt = nowIso();
  shipment.events.push(eventFor(status, shipment.currentLocation, note || `Shipment status updated to ${status}.`));
}
function adminStats() {
  return {
    total: store.shipments.length,
    inTransit: store.shipments.filter(s => ['Picked up', 'In transit', 'At facility', 'Out for delivery'].includes(s.status)).length,
    delivered: store.shipments.filter(s => s.status === 'Delivered').length,
    held: store.shipments.filter(s => s.status === 'Held at facility').length,
    pendingRequests: store.requests.filter(r => r.status === 'Pending').length
  };
}
function validEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '')) && String(email).length <= 180; }
function calculateEstimate(service, weight) {
  const aliases = {
    'Edge Ground': 'FedEx Ground',
    'Edge Priority': 'FedEx Priority',
    'Edge Express': 'FedEx Express'
  };
  const name = aliases[service] || service;
  const rates = {
    'FedEx Ground': { base: 10, perLb: 2.25, transitWindow: '3–7 business days (illustrative)' },
    'FedEx Priority': { base: 16, perLb: 3.3, transitWindow: '2–4 business days (illustrative)' },
    'FedEx Express': { base: 26, perLb: 4.5, transitWindow: '1–2 business days (illustrative)' }
  };
  const rate = rates[name] || rates['FedEx Ground'];
  return { estimatedPrice: Math.round((rate.base + weight * rate.perLb) * 100) / 100, transitWindow: rate.transitWindow, service: name };
}
async function removeCustomLogo(logoUrl) {
  if (typeof logoUrl !== 'string' || !/^\/uploads\/edge-logo-[A-Za-z0-9_-]+\.(?:png|jpg|webp)$/.test(logoUrl)) return;
  try { await unlink(path.join(PUBLIC_DIR, logoUrl.slice(1))); } catch { /* old logo may already be gone */ }
}
function validLogoBytes(mime, bytes) {
  if (mime === 'image/png') return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  if (mime === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === 'image/webp') return bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  return false;
}

export async function handleApi(req, res, url) {
  const method = req.method;
  const pathname = url.pathname;

  const uploadMatch = pathname.match(/^\/(?:api\/)?uploads\/([A-Za-z0-9._-]+)$/);
  if (uploadMatch && (method === 'GET' || method === 'HEAD')) {
    try {
      const file = path.join(UPLOADS_DIR, uploadMatch[1]);
      const content = await readFile(file);
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=3600' });
      if (method === 'HEAD') return res.end();
      return res.end(content);
    } catch {
      return fail(res, 404, 'Logo file not found.');
    }
  }

  if (pathname === '/api/health' && method === 'GET') return send(res, 200, { ok: true, service: 'Edge Shipping', environment: NODE_ENV });
  if (pathname === '/api/public/stats' && method === 'GET') {
    const stats = adminStats(); return send(res, 200, { active: stats.inTransit + stats.held, delivered: stats.delivered, note: 'Counts include demo records until replaced with live shipments.' });
  }
  if (pathname === '/api/brand' && method === 'GET') {
    return send(res, 200, { logoUrl: store.brandLogo || '/assets/edge-mark.svg', isCustom: Boolean(store.brandLogo) });
  }
  if (pathname === '/api/auth/config' && method === 'GET') {
    const demoMode = useLocalDemoCredentials;
    return send(res, 200, demoMode
      ? { demoMode: true, email: ADMIN_EMAIL, password: ADMIN_PASSWORD }
      : { demoMode: false });
  }
  if (pathname === '/api/auth/me' && method === 'GET') {
    const session = getSession(req); return send(res, 200, { authenticated: Boolean(session), email: session?.email || null });
  }
  if (pathname === '/api/auth/login' && method === 'POST') {
    const ip = req.socket.remoteAddress || 'unknown';
    const attempt = loginAttempts.get(ip) || { count: 0, since: Date.now() };
    if (Date.now() - attempt.since > 15 * 60 * 1000) { attempt.count = 0; attempt.since = Date.now(); }
    if (attempt.count >= 8) return fail(res, 429, 'Too many login attempts. Try again in 15 minutes.');
    const body = await readBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!ADMIN_PASSWORD) return fail(res, 503, 'Administrator login is not configured. For local use, start with start-windows.bat. For deployment, set a private ADMIN_EMAIL and ADMIN_PASSWORD, then restart the server.');
    if (!safeEqual(email, ADMIN_EMAIL) || !safeEqual(password, ADMIN_PASSWORD)) {
      attempt.count += 1; loginAttempts.set(ip, attempt);
      return fail(res, 401, 'Email or password is incorrect.');
    }
    loginAttempts.delete(ip);
    const token = issueSession(email);
    const secure = secureRequest(req) ? '; Secure' : '';
    return send(res, 200, { ok: true, email }, { 'Set-Cookie': `edge_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_TTL / 1000)}${secure}` });
  }
  if (pathname === '/api/auth/logout' && method === 'POST') {
    const secure = secureRequest(req) ? '; Secure' : '';
    return send(res, 200, { ok: true }, { 'Set-Cookie': `edge_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}` });
  }

  if (pathname === '/api/quote' && method === 'POST') {
    const body = await readBody(req);
    const requesterName = cleanText(body.name, 120), email = cleanText(body.email, 180);
    const originCity = cleanText(body.originCity, 100), originState = cleanText(body.originState, 2).toUpperCase(), originZip = cleanText(body.originZip, 10);
    const destinationCity = cleanText(body.destinationCity, 100), destinationState = cleanText(body.destinationState, 2).toUpperCase(), destinationZip = cleanText(body.destinationZip, 10);
    if (!requesterName || !validEmail(email)) return fail(res, 400, 'Please provide your name and a valid email address.');
    if (!originCity || !destinationCity) return fail(res, 400, 'Please provide both origin and destination cities.');
    if (!US_STATE_CODES.has(originState) || !US_STATE_CODES.has(destinationState)) return fail(res, 400, 'Choose a valid state for both ends of this U.S. domestic shipment.');
    if (!validUSZip(originZip) || !validUSZip(destinationZip)) return fail(res, 400, 'Enter a valid 5-digit U.S. ZIP code or ZIP+4 for both origin and destination.');
    const origin = `${originCity}, ${originState} ${originZip}`;
    const destination = `${destinationCity}, ${destinationState} ${destinationZip}`;
    const weight = Number(body.weight);
    if (!Number.isFinite(weight) || weight < 0.1 || weight > 5000) return fail(res, 400, 'Weight must be between 0.1 and 5,000 lb.');
    const service = cleanText(body.service || 'FedEx Ground', 80);
    const allowed = ['FedEx Ground', 'FedEx Priority', 'FedEx Express', 'Edge Ground', 'Edge Priority', 'Edge Express'];
    if (!allowed.includes(service)) return fail(res, 400, 'Choose one of the available shipping services.');
    const estimate = calculateEstimate(service, weight);
    const request = {
      id: `REQ-${idToken(5)}`, type: 'quote', status: 'Pending', requesterName, email,
      origin, destination, originState, destinationState, originZip, destinationZip,
      weight, service, estimatedPrice: estimate.estimatedPrice, currency: 'USD', transitWindow: estimate.transitWindow,
      reason: 'U.S. domestic shipping estimate request', createdAt: nowIso()
    };
    store.requests.unshift(request); await persist();
    return send(res, 201, { ok: true, requestId: request.id, ...estimate, currency: 'USD', message: 'Your U.S. domestic quote request has been received. The displayed rate is an estimate, not a booking confirmation.' });
  }

  if (pathname === '/api/requests' && method === 'POST') {
    const body = await readBody(req);
    const shipment = findShipment(body.trackingId);
    if (!shipment) return fail(res, 404, 'We could not find that tracking ID. Check it and try again.');
    const type = String(body.type || '').toLowerCase();
    if (!['hold', 'return'].includes(type)) return fail(res, 400, 'Request type must be hold or return.');
    const requesterName = cleanText(body.name, 120), email = cleanText(body.email, 180), reason = cleanText(body.reason, 500);
    if (!requesterName || !validEmail(email) || !reason) return fail(res, 400, 'Please provide your name, a valid email and a reason.');
    if (type === 'hold' && ['Delivered', 'Returning to sender'].includes(shipment.status)) return fail(res, 409, 'A hold cannot be requested for a delivered or returning shipment.');
    if (type === 'return' && ['Delivered', 'Returning to sender'].includes(shipment.status)) return fail(res, 409, 'A return request is not available for this shipment status. Contact support for help.');
    const existsPending = store.requests.some(r => r.trackingId === shipment.trackingId && r.type === type && r.status === 'Pending');
    if (existsPending) return fail(res, 409, `A pending ${type} request already exists for this tracking ID.`);
    const request = { id: `REQ-${idToken(5)}`, type, status: 'Pending', trackingId: shipment.trackingId, requesterName, email, reason, createdAt: nowIso() };
    store.requests.unshift(request); await persist();
    return send(res, 201, { ok: true, requestId: request.id, message: 'Your request has been sent for review. The tracking status will change only after an administrator approves it.' });
  }

  const publicTrackMatch = pathname.match(/^\/api\/shipments\/([^/]+)$/);
  if (publicTrackMatch && method === 'GET') {
    const shipment = findShipment(decodeURIComponent(publicTrackMatch[1]));
    if (!shipment) return fail(res, 404, 'Tracking ID not found. Please check the number or contact Edge Shipping support.');
    return send(res, 200, publicShipment(shipment));
  }

  if (pathname.startsWith('/api/admin/')) {
    const session = adminOnly(req, res); if (!session) return;
    if (pathname === '/api/admin/brand-logo' && method === 'POST') {
      const body = await readBody(req);
      const dataUrl = String(body.dataUrl || '');
      const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
      if (!match) return fail(res, 400, 'Choose a PNG, JPG or WebP image file.');
      const mime = match[1];
      const bytes = Buffer.from(match[2], 'base64');
      if (!bytes.length || bytes.length > MAX_LOGO_BYTES) return fail(res, 413, 'Logo files must be smaller than 750 KB.');
      if (!validLogoBytes(mime, bytes)) return fail(res, 400, 'The file contents do not match the selected image type.');
      const extension = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
      await mkdir(UPLOADS_DIR, { recursive: true });
      const filename = `edge-logo-${Date.now()}-${idToken(4)}.${extension}`;
      await writeFile(path.join(UPLOADS_DIR, filename), bytes, { flag: 'wx' });
      const previous = store.brandLogo;
      store.brandLogo = `/uploads/${filename}`;
      try { await persist(); } catch (error) { store.brandLogo = previous; await unlink(path.join(UPLOADS_DIR, filename)).catch(() => {}); throw error; }
      await removeCustomLogo(previous);
      return send(res, 201, { ok: true, logoUrl: store.brandLogo, isCustom: true, message: 'Edge Shipping logo updated across the website.' });
    }
    if (pathname === '/api/admin/brand-logo' && method === 'DELETE') {
      const previous = store.brandLogo;
      store.brandLogo = null;
      await persist();
      await removeCustomLogo(previous);
      return send(res, 200, { ok: true, logoUrl: '/assets/edge-mark.svg', isCustom: false, message: 'The default Edge Shipping logo has been restored.' });
    }
    if (pathname === '/api/admin/stats' && method === 'GET') return send(res, 200, adminStats());
    if (pathname === '/api/admin/shipments' && method === 'GET') return send(res, 200, store.shipments);
    if (pathname === '/api/admin/shipments' && method === 'POST') {
      const body = await readBody(req);
      const required = ['senderName', 'recipientName', 'originCity', 'originState', 'destinationCity', 'destinationState', 'originZip', 'destinationZip'];
      for (const key of required) if (!cleanText(body[key], 180)) return fail(res, 400, `Please fill in ${key.replace(/([A-Z])/g, ' $1').toLowerCase()}.`);
      const originState = cleanText(body.originState, 2).toUpperCase();
      const destinationState = cleanText(body.destinationState, 2).toUpperCase();
      if (!US_STATE_CODES.has(originState) || !US_STATE_CODES.has(destinationState)) return fail(res, 400, 'Select a valid U.S. state for both origin and destination. Edge Shipping currently supports the 50 U.S. states.');
      if (!validUSZip(body.originZip) || !validUSZip(body.destinationZip)) return fail(res, 400, 'Enter a valid 5-digit U.S. ZIP code or ZIP+4 for both origin and destination.');
      const weight = Number(body.weight || 1);
      if (!Number.isFinite(weight) || weight <= 0 || weight > 5000) return fail(res, 400, 'Weight must be greater than 0 and no more than 5,000 lb.');
      let trackingId = makeTrackingId();
      while (findShipment(trackingId)) trackingId = makeTrackingId();
      const origin = `${cleanText(body.originCity, 100)}, ${cleanText(body.originState, 2).toUpperCase()}`;
      const shipment = {
        trackingId, demo: false,
        senderName: cleanText(body.senderName, 120), senderEmail: cleanText(body.senderEmail, 180),
        recipientName: cleanText(body.recipientName, 120), recipientEmail: cleanText(body.recipientEmail, 180),
        description: cleanText(body.description || 'Parcel', 180), weight,
        service: cleanText(body.service || 'Edge Ground', 80),
        originCity: cleanText(body.originCity, 100), originState, originZip: cleanText(body.originZip, 10),
        destinationCity: cleanText(body.destinationCity, 100), destinationState, destinationZip: cleanText(body.destinationZip, 10),
        status: 'Label created', currentLocation: origin,
        eta: body.eta && /^\d{4}-\d{2}-\d{2}$/.test(body.eta) ? body.eta : '',
        createdAt: nowIso(), updatedAt: nowIso(),
        events: [eventFor('Label created', origin, 'Shipment created by Edge Shipping operations.')]
      };
      store.shipments.unshift(shipment); await persist();
      return send(res, 201, { ok: true, shipment, message: 'Tracking ID generated.' });
    }
    if (pathname === '/api/admin/requests' && method === 'GET') return send(res, 200, store.requests);
    const statusMatch = pathname.match(/^\/api\/admin\/shipments\/([^/]+)\/status$/);
    if (statusMatch && method === 'PATCH') {
      const shipment = findShipment(decodeURIComponent(statusMatch[1]));
      if (!shipment) return fail(res, 404, 'Shipment not found.');
      const body = await readBody(req);
      const status = cleanText(body.status, 60), location = cleanText(body.location, 180), note = cleanText(body.note, 500);
      if (!STATUS_OPTIONS.includes(status)) return fail(res, 400, 'Choose a valid shipment status.');
      if (!location || !note) return fail(res, 400, 'Location and update note are required for a tracking event.');
      addShipmentEvent(shipment, status, location, note); await persist();
      return send(res, 200, { ok: true, shipment, message: 'Tracking event added.' });
    }
    const requestMatch = pathname.match(/^\/api\/admin\/requests\/([^/]+)$/);
    if (requestMatch && method === 'PATCH') {
      const request = store.requests.find(r => r.id === decodeURIComponent(requestMatch[1]));
      if (!request) return fail(res, 404, 'Request not found.');
      const body = await readBody(req);
      const decision = cleanText(body.status, 40);
      if (!['Approved', 'Rejected', 'Completed'].includes(decision)) return fail(res, 400, 'Choose Approved, Rejected or Completed.');
      if (request.status !== 'Pending' && decision !== 'Completed') return fail(res, 409, 'This request has already been reviewed.');
      request.status = decision; request.reviewedAt = nowIso(); request.reviewedBy = session.email;
      if (decision === 'Approved' && request.trackingId) {
        const shipment = findShipment(request.trackingId);
        if (shipment) {
          if (request.type === 'hold') addShipmentEvent(shipment, 'Held at facility', shipment.currentLocation || `${shipment.destinationCity}, ${shipment.destinationState}`, `Hold request approved by operations. Reason: ${request.reason}`);
          if (request.type === 'return') addShipmentEvent(shipment, 'Returning to sender', shipment.currentLocation || `${shipment.destinationCity}, ${shipment.destinationState}`, `Return approved by operations; package is being routed back to the sender. Reason: ${request.reason}`);
        }
      }
      await persist(); return send(res, 200, { ok: true, request, message: `Request ${decision.toLowerCase()}.` });
    }
    return fail(res, 404, 'Admin endpoint not found.');
  }
  return fail(res, 404, 'API endpoint not found.');
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, 'Method not allowed.');
    const decoded = decodeURIComponent(url.pathname);
    let filePath = path.resolve(PUBLIC_DIR, `.${decoded === '/' ? '/index.html' : decoded}`);
    if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== path.join(PUBLIC_DIR, 'index.html')) return fail(res, 403, 'Forbidden.');
    try {
      const content = await readFile(filePath);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'DENY' });
      if (req.method === 'HEAD') return res.end();
      return res.end(content);
    } catch {
      if (!path.extname(decoded)) {
        const content = await readFile(path.join(PUBLIC_DIR, 'index.html'));
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' });
        return res.end(content);
      }
      return fail(res, 404, 'File not found.');
    }
  } catch (err) {
    console.error(err);
    if (!res.headersSent) fail(res, err.statusCode || 500, err.statusCode ? err.message : 'An unexpected server error occurred.');
    else res.end();
  }
});

await loadStore();
await mkdir(UPLOADS_DIR, { recursive: true });

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Edge Shipping running at http://localhost:${PORT}`);
    if (useLocalDemoCredentials && ADMIN_PASSWORD) console.log(`Local demo admin login: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  });
}
