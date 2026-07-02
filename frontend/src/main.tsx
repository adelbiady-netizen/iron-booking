// build: 2026-05-05
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { InstallPrompt } from './components/InstallPrompt';
import './index.css';
import './styles/public-ds.css';
import './i18n';

// ── Service-worker update handling ──────────────────────────────────────────
// vite-plugin-pwa registers the SW (injectRegister: 'auto') with autoUpdate +
// skipWaiting + clientsClaim, but that only *activates* a new build's SW — it
// never reloads already-open pages. A long-lived host tab therefore keeps
// running the OLD precached bundle across ordinary refreshes, which is what made
// a deployed floor fix appear "still reproducible after deployment / refresh
// doesn't fix it". Force a one-time reload when a newly deployed SW takes
// control, and poll for new deploys so idle tabs pick them up on their own.
if ('serviceWorker' in navigator) {
  // Only reload on a genuine UPDATE — not the first-load clientsClaim, when the
  // page goes from uncontrolled to controlled for the first time.
  const hadControllerAtLoad = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadControllerAtLoad || reloading) return;
    reloading = true;
    window.location.reload();
  });
  navigator.serviceWorker.ready
    .then((reg) => {
      const check = () => { void reg.update(); };
      // Check on focus and every 5 minutes so a mid-service deploy reaches hosts
      // without them having to hard-reset the app.
      window.addEventListener('focus', check);
      setInterval(check, 5 * 60_000);
    })
    .catch(() => { /* SW not ready — nothing to poll */ });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
      <InstallPrompt />
    </ErrorBoundary>
  </React.StrictMode>
);
