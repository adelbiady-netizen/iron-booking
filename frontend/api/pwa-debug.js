// Diagnostic page served fresh from Vercel edge — never cached by the service worker.
// /api/ is in navigateFallbackDenylist so the SW passes these requests straight to network.
// Visit: https://www.ironbooking.com/api/pwa-debug
export default function handler(req, res) {
  const BUILD_ID = '20260624-2';

  const html = `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PWA Debug — Iron Booking</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0a0a0a; color: #d1d5db; font-family: monospace; font-size: 13px; padding: 16px; }
  h1 { color: #ef4444; font-size: 14px; margin-bottom: 16px; border-bottom: 1px solid #333; padding-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; }
  tr + tr td { padding-top: 4px; }
  td:first-child { color: #9ca3af; width: 42%; padding-right: 10px; vertical-align: top; white-space: nowrap; }
  td:last-child { word-break: break-all; }
  .ok { color: #86efac; }
  .bad { color: #f87171; }
  .warn { color: #fbbf24; }
  hr { border: none; border-top: 1px solid #222; margin: 8px 0; }
  #out { margin-top: 0; }
</style>
</head>
<body>
<h1>PWA DIAGNOSTICS — server-fresh (no SW cache)</h1>
<table id="out"></table>
<script>
var BUILD_ID = ${JSON.stringify(BUILD_ID)};
var rows = [];

function row(label, value, cls) {
  rows.push([label, value, cls || '']);
}
function sep() { rows.push(null); }

// URL
row('server build', BUILD_ID, 'ok');
row('served at', new Date().toISOString(), 'ok');
sep();
row('href', location.href);
row('origin', location.origin);
row('pathname', location.pathname);
row('search', location.search || '(none)');

sep();

// Display mode
var standalone = window.matchMedia('(display-mode: standalone)').matches;
var iosStandalone = !!(navigator.standalone);
row('display-mode standalone', String(standalone), standalone ? 'ok' : 'bad');
row('navigator.standalone (iOS)', String(iosStandalone), iosStandalone ? 'ok' : 'bad');
row('pointer: coarse', String(window.matchMedia('(pointer: coarse)').matches));
row('maxTouchPoints', String(navigator.maxTouchPoints));
row('viewport width', String(window.innerWidth) + 'px');

sep();

// Manifest
var manifestEl = document.querySelector('link[rel="manifest"]');
row('manifest href', manifestEl ? manifestEl.href : '(none — API page has no manifest link)');

sep();

// Service worker
if ('serviceWorker' in navigator) {
  var ctrl = navigator.serviceWorker.controller;
  row('SW controller', ctrl ? ctrl.scriptURL : 'none / not controlling', ctrl ? 'ok' : 'bad');
  row('SW state', ctrl ? ctrl.state : '—');
  navigator.serviceWorker.getRegistrations().then(function(regs) {
    var cell = document.getElementById('sw-regs');
    if (cell) cell.textContent = regs.length ? regs.map(function(r) { return r.scope; }).join(', ') : 'none';
  });
  rows.push(['SW scopes', '(loading...)', '', 'sw-regs']);
} else {
  row('service worker', 'not supported', 'bad');
}

sep();

// Auth from localStorage
var authRaw = null;
try { authRaw = localStorage.getItem('iron_auth'); } catch(e) {}
var auth = null;
try { if (authRaw) auth = JSON.parse(authRaw); } catch(e) {}
row('has iron_auth', authRaw ? 'yes' : 'no', authRaw ? 'ok' : 'bad');
row('auth.user.role', auth && auth.user ? (auth.user.role || 'null') : 'null', auth && auth.user && auth.user.role ? 'ok' : 'bad');
row('auth.restaurant.slug', auth && auth.user && auth.user.restaurant ? (auth.user.restaurant.slug || 'null') : 'null',
  auth && auth.user && auth.user.restaurant && auth.user.restaurant.slug ? 'ok' : 'bad');
row('auth.restaurant.name', auth && auth.user && auth.user.restaurant ? (auth.user.restaurant.name || 'null') : 'null');

sep();

// All localStorage keys
var lsKeys = [];
try {
  for (var i = 0; i < localStorage.length; i++) {
    lsKeys.push(localStorage.key(i));
  }
} catch(e) {}
row('localStorage keys', lsKeys.length ? lsKeys.join(', ') : '(empty)', lsKeys.length ? '' : 'bad');

sep();

// Page JS bundle (from main document — this page has no bundle, so check parent if embedded)
// Check what bundle index.html uses by fetching it
row('index.html bundle', '(fetching...)', '', 'bundle-hash');
fetch('/').then(function(r){ return r.text(); }).then(function(html){
  var m = html.match(/assets\\/index-([^"]+)\\.js/);
  var el = document.getElementById('bundle-hash');
  if (el) el.textContent = m ? m[1] : '(not found in /)';
  // Also grab the ib-build meta
  var bm = html.match(/name="ib-build" content="([^"]+)"/);
  var bel = document.getElementById('ib-build');
  if (bel) bel.textContent = bm ? bm[1] : '(not found)';
}).catch(function(){
  var el = document.getElementById('bundle-hash');
  if (el) el.textContent = 'fetch failed';
});

row('index.html ib-build', '(fetching...)', '', 'ib-build');

sep();

// Render
var tbody = document.getElementById('out');
rows.forEach(function(r) {
  if (!r) {
    var hr = document.createElement('tr');
    hr.innerHTML = '<td colspan="2"><hr></td>';
    tbody.appendChild(hr);
    return;
  }
  var tr = document.createElement('tr');
  var label = r[0], value = r[1], cls = r[2] || '', id = r[3] || '';
  tr.innerHTML = '<td>' + label + '</td><td' + (cls ? ' class="' + cls + '"' : '') + (id ? ' id="' + id + '"' : '') + '>' + value + '</td>';
  tbody.appendChild(tr);
});
</script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(html);
}
