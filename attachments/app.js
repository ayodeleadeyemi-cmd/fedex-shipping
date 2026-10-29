const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const STATUS_STEPS = ['Label created', 'Picked up', 'In transit', 'At facility', 'Out for delivery', 'Delivered'];
const adminState = { authenticated: false, email: '', shipments: [], requests: [], selectedShipment: null };
let toastTimer;

const US_STATES = [
  ['AL','Alabama'],['AK','Alaska'],['AZ','Arizona'],['AR','Arkansas'],['CA','California'],['CO','Colorado'],['CT','Connecticut'],['DE','Delaware'],['FL','Florida'],['GA','Georgia'],
  ['HI','Hawaii'],['ID','Idaho'],['IL','Illinois'],['IN','Indiana'],['IA','Iowa'],['KS','Kansas'],['KY','Kentucky'],['LA','Louisiana'],['ME','Maine'],['MD','Maryland'],
  ['MA','Massachusetts'],['MI','Michigan'],['MN','Minnesota'],['MS','Mississippi'],['MO','Missouri'],['MT','Montana'],['NE','Nebraska'],['NV','Nevada'],['NH','New Hampshire'],['NJ','New Jersey'],
  ['NM','New Mexico'],['NY','New York'],['NC','North Carolina'],['ND','North Dakota'],['OH','Ohio'],['OK','Oklahoma'],['OR','Oregon'],['PA','Pennsylvania'],['RI','Rhode Island'],['SC','South Carolina'],
  ['SD','South Dakota'],['TN','Tennessee'],['TX','Texas'],['UT','Utah'],['VT','Vermont'],['VA','Virginia'],['WA','Washington'],['WV','West Virginia'],['WI','Wisconsin'],['WY','Wyoming']
];
function populateUSStateSelects() {
  $$('select[data-us-state]').forEach(select => {
    const current = select.value;
    select.innerHTML = '<option value="">Select a state</option>' + US_STATES.map(([code, name]) => `<option value="${code}">${name} (${code})</option>`).join('');
    if (current && US_STATES.some(([code]) => code === current)) select.value = current;
  });
}
populateUSStateSelects();
// Buttons are actions unless explicitly marked as form submit buttons.
// This avoids accidental form submission when controls are placed inside forms later.
$$('button:not([type])').forEach(button => { button.type = 'button'; });
if (location.protocol === 'file:') {
  showServerNotice('You opened the HTML file directly. To enable tracking, quotes, admin login and saved data, run start-windows.bat from the extracted folder and visit http://127.0.0.1:3000.');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
function formatDate(value, options = {}) {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', ...options });
}
function formatDateOnly(value) {
  if (!value) return 'To be confirmed';
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? escapeHtml(value) : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function routeCity(city, state, zip) {
  return [city, state].filter(Boolean).join(', ') + (zip ? ` ${zip}` : '');
}
function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3400);
}
function showServerNotice(message) {
  const notice = $('#serverModeNotice');
  if (!notice) return;
  notice.textContent = message;
  notice.hidden = false;
}
async function api(url, options = {}) {
  if (location.protocol === 'file:') {
    const message = 'Server features are not available when this file is opened directly. Run start-windows.bat from the extracted project folder, then open http://127.0.0.1:3000.';
    showServerNotice(message);
    throw new Error(message);
  }
  const headers = { ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
  let response;
  try {
    response = await fetch(url, { credentials: 'same-origin', ...options, headers });
  } catch (cause) {
    const message = 'Cannot reach the Edge Shipping server. Start the app with start-windows.bat (Windows) or run `node server.js`, then open http://127.0.0.1:3000.';
    showServerNotice(message);
    throw new Error(message, { cause });
  }
  const type = response.headers.get('content-type') || '';
  const body = type.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) throw new Error(body?.error || body?.message || `Request failed (${response.status}).`);
  const notice = $('#serverModeNotice');
  if (notice) notice.hidden = true;
  return body;
}
async function refreshBranding() {
  const branding = await api('/api/brand', { method: 'GET', headers: {} });
  $$('img[data-edge-logo]').forEach(image => {
    image.src = branding.logoUrl;
    image.alt = 'Edge Shipping logo';
  });
  const favicon = $('#appFavicon');
  if (favicon) {
    favicon.href = branding.logoUrl;
    favicon.type = branding.logoUrl.endsWith('.svg') ? 'image/svg+xml' : branding.logoUrl.endsWith('.webp') ? 'image/webp' : branding.logoUrl.endsWith('.jpg') ? 'image/jpeg' : 'image/png';
  }
  const status = $('#brandLogoStatus');
  if (status) status.textContent = branding.isCustom ? 'Your custom Edge Shipping logo is active.' : 'Default Edge Shipping logo is active.';
  return branding;
}

async function loadAdminLoginConfig() {
  try {
    const config = await api('/api/auth/config', { method: 'GET', headers: {} });
    const help = $('#adminCredentialHelp');
    if (!help) return;
    if (config.demoMode && config.email && config.password) {
      $('#demoAdminEmail').textContent = config.email;
      $('#demoAdminPassword').textContent = config.password;
      help.classList.remove('hidden');
      $('#fillDemoCredentials').onclick = () => {
        const form = $('#adminLoginForm');
        form.elements.email.value = config.email;
        form.elements.password.value = config.password;
        showFormMessage($('#adminLoginMessage'), 'Credentials filled in. Select Sign in to continue.');
      };
    } else {
      help.classList.add('hidden');
    }
  } catch { /* The login form remains usable if config discovery is unavailable. */ }
}

function showPage(page, options = {}) {
  const allowed = ['home', 'track', 'ship', 'services', 'manage', 'support', 'admin'];
  if (!allowed.includes(page)) page = 'home';
  $$('.page').forEach(section => section.classList.toggle('active', section.dataset.pageView === page));
  $$('.nav-link').forEach(button => {
    const active = button.dataset.page === page;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  const pageTitles = { home: 'Home', track: 'Track a package', ship: 'Ship with us', services: 'Shipping services', manage: 'Hold & returns', support: 'Support', admin: 'Administrator portal' };
  document.title = `${pageTitles[page]} | FedEx Shipping`;
  $('#mainNav').classList.remove('open');
  $('#mobileMenuButton').setAttribute('aria-expanded', 'false');
  closeNavMenus();
  const targetPath = page === 'home' ? '/' : `/${page}`;
  if (!options.noHistory && (location.pathname !== targetPath || location.hash)) {
    try { history.pushState({ page }, '', targetPath); } catch { /* standalone preview */ }
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (page === 'admin') checkAdminSession();
}
function showFormMessage(node, message, error = false) {
  if (!node) return;
  node.textContent = message || '';
  node.style.color = error ? '#aa4735' : '#2e805f';
}
function setLoading(button, loading, label) {
  if (!button) return;
  if (loading) {
    button.dataset.originalLabel = button.innerHTML;
    button.disabled = true;
    button.innerHTML = 'Please wait…';
  } else {
    button.disabled = false;
    if (button.dataset.originalLabel) button.innerHTML = button.dataset.originalLabel;
    else if (label) button.textContent = label;
    delete button.dataset.originalLabel;
  }
}
function statusSlug(status) { return String(status || '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, ''); }
function statusIcon(status) {
  if (status === 'Delivered') return '✓';
  if (status === 'Held at facility') return 'Ⅱ';
  if (status === 'Return requested' || status === 'Returning to sender') return '↶';
  if (status === 'Exception') return '!';
  if (status === 'Out for delivery') return '↗';
  return '⌁';
}
function progressFor(status) {
  if (status === 'Delivered') return 100;
  if (status === 'Out for delivery') return 82;
  if (status === 'At facility') return 60;
  if (status === 'In transit') return 48;
  if (status === 'Picked up') return 28;
  if (status === 'Held at facility') return 54;
  if (status === 'Return requested' || status === 'Returning to sender') return 45;
  if (status === 'Exception') return 38;
  return 12;
}
function renderTracking(shipment, target = '#trackResult') {
  const root = typeof target === 'string' ? $(target) : target;
  if (!root) return;
  const origin = routeCity(shipment.originCity, shipment.originState, shipment.originZip);
  const destination = routeCity(shipment.destinationCity, shipment.destinationState, shipment.destinationZip);
  const events = [...(shipment.events || [])].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const isSpecial = ['Held at facility', 'Return requested', 'Returning to sender', 'Exception'].includes(shipment.status);
  const badgeClass = isSpecial ? 'status-special' : `status-${statusSlug(shipment.status).toLowerCase()}`;
  const timeline = events.length ? events.map((event, index) => `
    <div class="timeline-item"><span class="timeline-dot"></span><b>${escapeHtml(event.status)}</b><small>${escapeHtml(formatDate(event.timestamp))} · ${escapeHtml(event.location || 'Location not provided')}</small><p>${escapeHtml(event.note || '')}</p></div>`).join('') : '<div class="track-empty">No tracking events have been recorded yet.</div>';
  root.innerHTML = `<article class="tracking-result-card">
    <div class="tracking-result-top"><div class="tracking-status-title"><span class="status-symbol">${escapeHtml(statusIcon(shipment.status))}</span><div><span class="tiny-label">TRACKING ID</span><h2>${escapeHtml(shipment.trackingId)}</h2><p>Last updated ${escapeHtml(formatDate(shipment.updatedAt || shipment.createdAt))}</p></div></div><span class="status-pill ${badgeClass}"><span></span>${escapeHtml(shipment.status)}</span></div>
    <div class="tracking-content-grid"><div class="timeline-column"><div class="tracking-section-caption">TRACKING HISTORY</div><div class="timeline">${timeline}</div></div>
    <div class="tracking-side-column"><div class="tracking-section-caption">SHIPMENT OVERVIEW</div><div class="shipment-route-card"><div class="route-city"><span class="route-pin">↗</span><span><b>${escapeHtml(origin || 'Origin pending')}</b><small>Origin</small></span></div><div class="route-separator"></div><div class="route-city destination"><span class="route-pin">⌂</span><span><b>${escapeHtml(destination || 'Destination pending')}</b><small>Destination</small></span></div></div>
    <div class="detail-list"><div class="detail-item"><small>Current location</small><b>${escapeHtml(shipment.currentLocation || 'Awaiting first scan')}</b></div><div class="detail-item"><small>Estimated delivery</small><b>${escapeHtml(formatDateOnly(shipment.eta))}</b></div><div class="detail-item"><small>Service</small><b>${escapeHtml(shipment.service || 'Standard')}</b></div><div class="detail-item"><small>Package weight</small><b>${escapeHtml(shipment.weight ? `${shipment.weight} lb` : 'Not listed')}</b></div></div>
    <button class="button button-outline-dark button-block" type="button" data-page="manage" data-prefill-tracking="${escapeHtml(shipment.trackingId)}">Request a hold or return <span>→</span></button>
    <p class="microcopy">Tracking events reflect updates recorded in Edge Shipping's system. Location and delivery estimates are not live GPS or third-party carrier data.</p></div></div></article>`;
}
async function trackShipment(trackingId, target = '#trackResult') {
  const root = typeof target === 'string' ? $(target) : target;
  if (!trackingId.trim()) return;
  if (root) root.innerHTML = '<div class="track-empty"><b>Looking up your shipment…</b>Checking the tracking ID in Edge Shipping records.</div>';
  try {
    const shipment = await api(`/api/shipments/${encodeURIComponent(trackingId.trim())}`, { method: 'GET', headers: {} });
    renderTracking(shipment, root);
  } catch (error) {
    if (root) root.innerHTML = `<div class="track-empty"><b>We couldn't find that shipment.</b>${escapeHtml(error.message)}<br><br>Try the sample ID <button type="button" class="inline-link" data-track-sample="EDG-US-DEMO001">FED-US-FEDO621</button>.</div>`;
  }
}
function requestType(value) {
  $('#requestType').value = value;
  $$('.manage-choice-button').forEach(button => button.classList.toggle('selected', button.dataset.requestType === value));
  const formButton = $('#manageForm button[type="submit"]');
  if (formButton) formButton.innerHTML = value === 'return' ? 'Submit return request <span>→</span>' : 'Submit hold request <span>→</span>';
}
function openAdminTab(tab) {
  $$('.admin-tab').forEach(button => button.classList.toggle('active', button.dataset.adminTab === tab));
  $$('[data-admin-panel]').forEach(panel => panel.classList.toggle('active', panel.dataset.adminPanel === tab));
  const panel = $(`[data-admin-panel="${tab}"]`);
  if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function renderStatusPill(status) {
  const colorClass = `status-${statusSlug(status)}`;
  return `<span class="table-status ${escapeHtml(colorClass)}">${escapeHtml(status)}</span>`;
}
function shipmentRows(shipments, emptyLabel = 'No shipment records yet.') {
  if (!shipments.length) return `<div class="empty-admin-state">${escapeHtml(emptyLabel)}</div>`;
  return `<table class="admin-table"><thead><tr><th>TRACKING ID</th><th>RECIPIENT / ROUTE</th><th>STATUS</th><th>UPDATED</th><th>ACTION</th></tr></thead><tbody>${shipments.map(s => `<tr><td><b class="tracking-code">${escapeHtml(s.trackingId)}</b><small>${escapeHtml(s.service || 'Edge Shipping')}</small></td><td><b>${escapeHtml(s.recipientName || 'Recipient')}</b><small>${escapeHtml(routeCity(s.originCity, s.originState))} → ${escapeHtml(routeCity(s.destinationCity, s.destinationState))}</small></td><td>${renderStatusPill(s.status)}</td><td>${escapeHtml(formatDate(s.updatedAt || s.createdAt, { year: undefined }))}</td><td><button type="button" class="table-action" data-manage-shipment="${escapeHtml(s.trackingId)}">Manage</button></td></tr>`).join('')}</tbody></table>`;
}
function requestIcon(type) { return type === 'hold' ? 'Ⅱ' : type === 'return' ? '↶' : '＄'; }
function requestTitle(request) { return request.type === 'hold' ? 'Package hold request' : request.type === 'return' ? 'Return to sender request' : 'Shipping quote request'; }
function renderRequestRow(request, compact = false) {
  const identifier = request.trackingId || request.origin && `${request.origin} → ${request.destination}` || 'Route pending';
  const canReview = request.status === 'Pending';
  const actions = canReview ? `<div class="request-actions"><button type="button" class="approve-request" data-request-action="Approved" data-request-id="${escapeHtml(request.id)}">Approve</button><button type="button" class="reject-request" data-request-action="Rejected" data-request-id="${escapeHtml(request.id)}">Reject</button></div>` : `<span class="request-state ${escapeHtml(request.status)}">${escapeHtml(request.status)}</span>`;
  return `<article class="request-row"><span class="request-type-icon">${escapeHtml(requestIcon(request.type))}</span><div class="request-main"><b>${escapeHtml(requestTitle(request))} <span class="request-state">${escapeHtml(request.status)}</span></b><p>${escapeHtml(request.requesterName)} · ${escapeHtml(request.email)}<br>${escapeHtml(identifier)}${request.reason ? ` · ${escapeHtml(request.reason)}` : ''}</p><small>Received ${escapeHtml(formatDate(request.createdAt))} · Request ${escapeHtml(request.id)}</small></div>${compact && !canReview ? '' : actions}</article>`;
}
function renderRequests() {
  const pending = adminState.requests.filter(r => r.status === 'Pending').length;
  $('#requestsTabCount').textContent = String(pending);
  $('#requestsCountBadge').textContent = `${pending} pending`;
  const all = adminState.requests;
  $('#allRequestsList').innerHTML = all.length ? all.map(r => renderRequestRow(r)).join('') : '<div class="empty-admin-state">No requests yet. Hold, return and quote requests from customers will appear here.</div>';
  const pendingRequests = all.filter(r => r.status === 'Pending');
  $('#overviewRequests').innerHTML = pendingRequests.length ? pendingRequests.slice(0, 4).map(r => renderRequestRow(r, true)).join('') : '<div class="empty-admin-state">No requests are waiting for review.</div>';
}
function renderAdminShipments() {
  const recent = [...adminState.shipments].sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
  $('#overviewShipments').innerHTML = shipmentRows(recent.slice(0, 5), 'No shipment records yet. Create one to generate a tracking ID.');
  const q = ($('#shipmentSearch')?.value || '').trim().toLowerCase();
  const filtered = recent.filter(s => [s.trackingId, s.recipientName, s.senderName, s.originCity, s.destinationCity, s.currentLocation].some(v => String(v || '').toLowerCase().includes(q)));
  $('#shipmentCountLabel').textContent = `${filtered.length} of ${recent.length} shipments`;
  $('#allShipmentsTable').innerHTML = shipmentRows(filtered, 'No shipments match this search.');
}
function renderMetrics(stats) {
  const rows = [
    ['Total shipments', stats.total, 'All shipment records'],
    ['In motion', stats.inTransit, 'Active network shipments'],
    ['Delivered', stats.delivered, 'Completed shipments'],
    ['Open requests', stats.pendingRequests, 'Waiting for review']
  ];
  $('#adminMetrics').innerHTML = rows.map(row => `<div class="metric-card"><span>${escapeHtml(row[0])}</span><b>${escapeHtml(row[1])}</b><small>${escapeHtml(row[2])}</small></div>`).join('');
}
async function refreshAdminData() {
  const [shipments, requests, stats] = await Promise.all([
    api('/api/admin/shipments', { method: 'GET', headers: {} }),
    api('/api/admin/requests', { method: 'GET', headers: {} }),
    api('/api/admin/stats', { method: 'GET', headers: {} })
  ]);
  adminState.shipments = shipments;
  adminState.requests = requests;
  renderMetrics(stats);
  renderAdminShipments();
  renderRequests();
}
function showAdminDashboard(email) {
  adminState.authenticated = true;
  adminState.email = email || adminState.email;
  $('#adminLoginView').classList.add('hidden');
  $('#adminDashboardView').classList.remove('hidden');
  refreshAdminData().catch(error => showToast(error.message));
}
function showAdminLogin() {
  adminState.authenticated = false;
  adminState.shipments = [];
  adminState.requests = [];
  adminState.selectedShipment = null;
  $('#adminLoginView').classList.remove('hidden');
  $('#adminDashboardView').classList.add('hidden');
}
async function checkAdminSession() {
  try {
    const result = await api('/api/auth/me', { method: 'GET', headers: {} });
    if (result.authenticated) showAdminDashboard(result.email);
    else showAdminLogin();
  } catch {
    showAdminLogin();
  }
}
function openStatusEditor(trackingId) {
  const shipment = adminState.shipments.find(s => s.trackingId === trackingId);
  if (!shipment) return;
  adminState.selectedShipment = trackingId;
  const editor = $('#statusEditor');
  editor.classList.remove('hidden');
  $('#statusEditorTracking').textContent = `${shipment.trackingId} · ${shipment.recipientName} · Current: ${shipment.status}`;
  const form = $('#statusUpdateForm');
  form.elements.trackingId.value = shipment.trackingId;
  form.elements.status.value = shipment.status;
  form.elements.location.value = shipment.currentLocation || `${shipment.destinationCity}, ${shipment.destinationState}`;
  form.elements.note.value = '';
  $('#statusUpdateMessage').textContent = '';
  editor.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function makeResult(message, error = false) {
  return `<div class="result-message${error ? ' error' : ''}">${escapeHtml(message)}</div>`;
}

// Header dropdown controls mirror a carrier-style global navigation, while each destination
// remains an Edge Shipping page with its existing real workflow.
function closeNavMenus(exceptGroup = null) {
  $$('.nav-menu-group').forEach(group => {
    if (exceptGroup && group.dataset.navGroup === exceptGroup) return;
    group.classList.remove('open');
    const toggle = $('[data-menu-toggle]', group);
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  });
}

// Global navigation and small interactions.
document.addEventListener('click', async event => {
  const menuToggle = event.target.closest('[data-menu-toggle]');
  if (menuToggle) {
    event.preventDefault();
    const group = menuToggle.closest('.nav-menu-group');
    const shouldOpen = !group.classList.contains('open');
    closeNavMenus();
    if (shouldOpen) {
      group.classList.add('open');
      menuToggle.setAttribute('aria-expanded', 'true');
    }
    return;
  }
  if (!event.target.closest('.nav-menu-group')) closeNavMenus();

  const headerSearch = event.target.closest('#headerSearchButton');
  if (headerSearch) {
    event.preventDefault();
    showPage('track');
    window.setTimeout(() => $('#trackPageInput')?.focus(), 80);
    return;
  }

  const pageButton = event.target.closest('[data-page]');
  if (pageButton) {
    event.preventDefault();
    closeNavMenus();
    const page = pageButton.dataset.page;
    showPage(page);
    if (pageButton.dataset.selectService && $('#quoteForm')) $('#quoteForm').elements.service.value = pageButton.dataset.selectService;
    if (pageButton.dataset.footerReturn) requestType('return');
    if (pageButton.dataset.prefillTracking) {
      $('#manageForm').elements.trackingId.value = pageButton.dataset.prefillTracking;
      showPage('manage');
      $('#manageForm').elements.trackingId.value = pageButton.dataset.prefillTracking;
    }
    return;
  }
  const sample = event.target.closest('[data-track-sample]');
  if (sample) {
    event.preventDefault();
    closeNavMenus();
    const id = sample.dataset.trackSample;
    showPage('track');
    $('#trackPageInput').value = id;
    await trackShipment(id);
    return;
  }
  const adminTab = event.target.closest('[data-admin-tab]');
  if (adminTab && adminState.authenticated) {
    event.preventDefault();
    openAdminTab(adminTab.dataset.adminTab);
    return;
  }
  const manageShipmentButton = event.target.closest('[data-manage-shipment]');
  if (manageShipmentButton) {
    openStatusEditor(manageShipmentButton.dataset.manageShipment);
    return;
  }
  const requestAction = event.target.closest('[data-request-action]');
  if (requestAction) {
    const { requestId, requestAction: decision } = requestAction.dataset;
    if (!window.confirm(`${decision} this customer request?${decision === 'Approved' ? ' If it is a hold or return, the shipment status will be updated.' : ''}`)) return;
    setLoading(requestAction, true);
    try {
      await api(`/api/admin/requests/${encodeURIComponent(requestId)}`, { method: 'PATCH', body: JSON.stringify({ status: decision }) });
      await refreshAdminData();
      showToast(`Request ${decision.toLowerCase()}.`);
    } catch (error) { showToast(error.message); }
    finally { setLoading(requestAction, false); }
  }
});


document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    closeNavMenus();
    const searchButton = $('#headerSearchButton');
    if (searchButton) searchButton.blur();
  }
});

$('#mobileMenuButton').addEventListener('click', () => {
  const nav = $('#mainNav');
  const open = !nav.classList.contains('open');
  nav.classList.toggle('open', open);
  $('#mobileMenuButton').setAttribute('aria-expanded', String(open));
});

$('#homeTrackForm').addEventListener('submit', async event => {
  event.preventDefault();
  const id = new FormData(event.currentTarget).get('trackingId').trim();
  showPage('track');
  $('#trackPageInput').value = id;
  await trackShipment(id);
});
$('#trackPageForm').addEventListener('submit', async event => {
  event.preventDefault();
  const id = new FormData(event.currentTarget).get('trackingId').trim();
  await trackShipment(id);
});

$('#quoteForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());
  data.origin = `${data.originCity}, ${data.originState} ${data.originZip}`;
  data.destination = `${data.destinationCity}, ${data.destinationState} ${data.destinationZip}`;
  const resultNode = $('#quoteResult');
  resultNode.innerHTML = '<div class="track-empty"><b>Calculating your estimate…</b>Validating the U.S. route and saving your quote request.</div>';
  const submitButton = $('button[type="submit"]', form);
  setLoading(submitButton, true);
  try {
    const result = await api('/api/quote', { method: 'POST', body: JSON.stringify(data) });
    const price = Number(result.estimatedPrice).toFixed(2);
    resultNode.innerHTML = `<div class="quote-breakdown"><small>SHIPPING ESTIMATE · ${escapeHtml(result.currency || 'USD')}</small><div class="quote-price">$${escapeHtml(price)}</div><b>${escapeHtml(data.service)}</b><p>${escapeHtml(data.origin)} → ${escapeHtml(data.destination)} · ${escapeHtml(data.weight)} lb<br>Indicative transit window: ${escapeHtml(result.transitWindow)}. Final rates and delivery dates require confirmation.</p></div>${makeResult(`${result.message} Reference: ${result.requestId}`)}`;
    form.reset(); form.elements.weight.value = '2';
  } catch (error) {
    resultNode.innerHTML = makeResult(error.message, true);
  } finally { setLoading(submitButton, false); }
});

$$('.manage-choice-button').forEach(button => button.addEventListener('click', () => requestType(button.dataset.requestType)));
$('#manageForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());
  const button = $('button[type="submit"]', form);
  setLoading(button, true);
  const node = $('#manageResult');
  node.innerHTML = '';
  try {
    const result = await api('/api/requests', { method: 'POST', body: JSON.stringify(data) });
    node.innerHTML = makeResult(`${result.message} Reference: ${result.requestId}`);
    form.reset(); requestType('hold');
  } catch (error) { node.innerHTML = makeResult(error.message, true); }
  finally { setLoading(button, false); }
});

$('#adminLoginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());
  const button = $('button[type="submit"]', form);
  setLoading(button, true);
  showFormMessage($('#adminLoginMessage'), '');
  try {
    const result = await api('/api/auth/login', { method: 'POST', body: JSON.stringify(data) });
    showAdminDashboard(result.email);
    showToast('Signed in to FedEx Shipping operations.');
  } catch (error) { showFormMessage($('#adminLoginMessage'), error.message, true); }
  finally { setLoading(button, false); }
});
$('#adminLogoutButton').addEventListener('click', async () => {
  try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); } catch { /* local view will still be cleared */ }
  showAdminLogin(); showToast('You have signed out.');
});

$('#createShipmentForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());
  const button = $('button[type="submit"]', form);
  const resultNode = $('#createShipmentResult');
  setLoading(button, true); resultNode.innerHTML = '';
  try {
    const result = await api('/api/admin/shipments', { method: 'POST', body: JSON.stringify(data) });
    const shipment = result.shipment;
    resultNode.innerHTML = `<div class="quote-breakdown"><small>TRACKING ID GENERATED SUCCESSFULLY</small><div class="quote-price" style="font-size:23px;letter-spacing:0;word-break:break-word">${escapeHtml(shipment.trackingId)}</div><b>${escapeHtml(shipment.senderName)} → ${escapeHtml(shipment.recipientName)}</b><p>${escapeHtml(routeCity(shipment.originCity, shipment.originState, shipment.originZip))} → ${escapeHtml(routeCity(shipment.destinationCity, shipment.destinationState, shipment.destinationZip))}<br>Initial status: Label created.</p><div class="form-submit-row"><button class="button button-outline-dark" type="button" id="copyTrackingIdButton">Copy tracking ID</button><button class="button button-primary" type="button" id="viewNewTrackingButton">View shipment <span>→</span></button></div></div>${makeResult('The tracking ID is now saved and ready to share with the customer.')}`;
    $('#copyTrackingIdButton').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(shipment.trackingId); showToast('Tracking ID copied.'); }
      catch { showToast(`Tracking ID: ${shipment.trackingId}`); }
    });
    $('#viewNewTrackingButton').addEventListener('click', () => { showPage('track'); $('#trackPageInput').value = shipment.trackingId; trackShipment(shipment.trackingId); });
    form.reset(); form.elements.weight.value = '1';
    await refreshAdminData();
    showToast(`Tracking ID generated: ${shipment.trackingId}`);
  } catch (error) { resultNode.innerHTML = makeResult(error.message, true); }
  finally { setLoading(button, false); }
});

$('#shipmentSearch').addEventListener('input', renderAdminShipments);
$('#closeStatusEditor').addEventListener('click', () => $('#statusEditor').classList.add('hidden'));
$('#statusUpdateForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());
  const trackingId = data.trackingId;
  const button = $('button[type="submit"]', form);
  setLoading(button, true); showFormMessage($('#statusUpdateMessage'), '');
  try {
    const result = await api(`/api/admin/shipments/${encodeURIComponent(trackingId)}/status`, { method: 'PATCH', body: JSON.stringify({ status: data.status, location: data.location, note: data.note }) });
    showFormMessage($('#statusUpdateMessage'), result.message);
    await refreshAdminData();
    $('#statusEditorTracking').textContent = `${trackingId} · ${result.shipment.recipientName} · Current: ${result.shipment.status}`;
    form.elements.note.value = '';
    showToast('Tracking event added.');
  } catch (error) { showFormMessage($('#statusUpdateMessage'), error.message, true); }
  finally { setLoading(button, false); }
});

$('#brandLogoFile').addEventListener('change', event => {
  const file = event.currentTarget.files?.[0];
  showFormMessage($('#brandLogoMessage'), '');
  if (!file) {
    $('#brandUploadPreviewWrap').classList.add('hidden');
    return;
  }
  const allowed = ['image/png', 'image/jpeg', 'image/webp'];
  if (!allowed.includes(file.type)) {
    event.currentTarget.value = '';
    $('#brandUploadPreviewWrap').classList.add('hidden');
    showFormMessage($('#brandLogoMessage'), 'Choose a PNG, JPG or WebP image.', true);
    return;
  }
  if (file.size > 750 * 1024) {
    event.currentTarget.value = '';
    $('#brandUploadPreviewWrap').classList.add('hidden');
    showFormMessage($('#brandLogoMessage'), 'The logo must be smaller than 750 KB.', true);
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    $('#brandUploadPreview').src = String(reader.result || '');
    $('#brandUploadPreviewWrap').classList.remove('hidden');
  };
  reader.onerror = () => showFormMessage($('#brandLogoMessage'), 'The selected image could not be read.', true);
  reader.readAsDataURL(file);
});
$('#brandLogoForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const file = $('#brandLogoFile').files?.[0];
  if (!file) return showFormMessage($('#brandLogoMessage'), 'Choose a logo image first.', true);
  const button = $('button[type="submit"]', form);
  setLoading(button, true); showFormMessage($('#brandLogoMessage'), '');
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('The selected image could not be read.'));
      reader.readAsDataURL(file);
    });
    const result = await api('/api/admin/brand-logo', { method: 'POST', body: JSON.stringify({ dataUrl }) });
    await refreshBranding();
    $('#brandUploadPreviewWrap').classList.add('hidden');
    form.reset();
    showFormMessage($('#brandLogoMessage'), result.message);
    showToast('Website logo saved.');
  } catch (error) { showFormMessage($('#brandLogoMessage'), error.message, true); }
  finally { setLoading(button, false); }
});
$('#resetLogoButton').addEventListener('click', async () => {
  const button = $('#resetLogoButton');
  setLoading(button, true); showFormMessage($('#brandLogoMessage'), '');
  try {
    const result = await api('/api/admin/brand-logo', { method: 'DELETE', body: '{}' });
    await refreshBranding();
    $('#brandLogoForm').reset();
    $('#brandUploadPreviewWrap').classList.add('hidden');
    showFormMessage($('#brandLogoMessage'), result.message);
    showToast('Default logo restored.');
  } catch (error) { showFormMessage($('#brandLogoMessage'), error.message, true); }
  finally { setLoading(button, false); }
});

$('#copyrightYear').textContent = new Date().getFullYear();
function pageFromLocation() {
  const allowed = ['home', 'track', 'ship', 'services', 'manage', 'support', 'admin'];
  const hashPage = location.hash.replace(/^#/, '');
  const pathPage = location.pathname.replace(/^\/+|\/+$/g, '');
  const candidate = hashPage || pathPage || 'home';
  return allowed.includes(candidate) ? candidate : 'home';
}
window.addEventListener('popstate', () => showPage(pageFromLocation(), { noHistory: true }));
// Each view has its own refresh-safe path; older #page links continue to work.
showPage(pageFromLocation(), { noHistory: true });
refreshBranding().catch(() => { /* default logo remains visible if the API is unavailable */ });
loadAdminLoginConfig();
