// ─── Guest Hub Preview Page ───────────────────────────────────────────────────
// Authenticated draft preview — /r-preview/:slug
// Reads auth from localStorage (iron_hq_auth or iron_auth) and calls the
// admin preview endpoint. Shows draft content (not yet published) with a banner.
// ISOLATION: no reservation, waitlist, floor, or SSE imports.

import { useState, useEffect } from 'react';
import { BASE, getStoredAuth, getStoredHQAuth } from '../../api';
import { mapGuestHub, type ApiGuestHub } from './mappers/hubMapper';
import type { GuestHubViewModel } from './types/viewModel';

const PLATFORM_LABELS: Record<string, string> = {
  instagram: 'Instagram',
  tiktok:    'TikTok',
  website:   'Website',
  facebook:  'Facebook',
  twitter:   'Twitter / X',
  youtube:   'YouTube',
};

export default function GuestHubPreviewPage({ slug }: { slug: string }) {
  const [status, setStatus] = useState<'loading' | 'unauthorized' | 'not_found' | 'error' | 'ready'>('loading');
  const [vm,     setVm]     = useState<GuestHubViewModel | null>(null);

  useEffect(() => {
    const auth = getStoredHQAuth() ?? getStoredAuth();
    if (!auth?.token) {
      setStatus('unauthorized');
      return;
    }

    let cancelled = false;

    fetch(`${BASE}/admin/hub/preview/${encodeURIComponent(slug)}`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    })
      .then(res => {
        if (res.status === 401 || res.status === 403) {
          if (!cancelled) setStatus('unauthorized');
          return null;
        }
        if (res.status === 404) {
          if (!cancelled) setStatus('not_found');
          return null;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<ApiGuestHub>;
      })
      .then(data => {
        if (!data || cancelled) return;
        setVm(mapGuestHub(data));
        setStatus('ready');
      })
      .catch(() => { if (!cancelled) setStatus('error'); });

    return () => { cancelled = true; };
  }, [slug]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-stone-950 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (status === 'unauthorized') {
    return (
      <div className="min-h-screen bg-stone-950 flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-white font-semibold mb-2">Login required</p>
          <p className="text-stone-400 text-sm mb-4">You must be logged in to preview draft content.</p>
          <a href="/hq" className="text-amber-400 text-sm hover:underline">Go to HQ Login →</a>
        </div>
      </div>
    );
  }

  if (status === 'not_found') {
    return (
      <div className="min-h-screen bg-stone-950 flex items-center justify-center p-4">
        <p className="text-stone-400 text-sm">Hub not found: <code className="text-amber-400">{slug}</code></p>
      </div>
    );
  }

  if (status === 'error' || !vm) {
    return (
      <div className="min-h-screen bg-stone-950 flex items-center justify-center p-4">
        <p className="text-red-400 text-sm">Failed to load preview. Try refreshing.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-950 text-white">

      {/* Draft preview banner */}
      <div className="sticky top-0 z-50 bg-amber-500 text-stone-900 px-4 py-2 flex items-center justify-between text-sm font-semibold">
        <span>DRAFT PREVIEW — not yet published</span>
        <div className="flex items-center gap-4">
          <a
            href={`/r/${slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-stone-700 text-xs font-normal hover:text-stone-900 underline"
          >
            View live page →
          </a>
          <a
            href="/hq"
            className="text-stone-700 text-xs font-normal hover:text-stone-900"
          >
            ← Back to HQ
          </a>
        </div>
      </div>

      <div className="max-w-md mx-auto px-4 pt-8 pb-16">

        {/* Cover image */}
        {vm.coverImageUrl && (
          <div className="relative rounded-2xl overflow-hidden mb-6" style={{ aspectRatio: '16/9' }}>
            <div className="absolute inset-0 bg-gradient-to-b from-stone-900/20 to-stone-900/70" />
            <img
              src={vm.coverImageUrl}
              alt=""
              className="w-full h-full object-cover"
              loading="eager"
              decoding="async"
            />
          </div>
        )}

        {/* Logo + name */}
        <div className="mb-6">
          {vm.logoUrl && (
            <img
              src={vm.logoUrl}
              alt={`${vm.name} logo`}
              className="w-12 h-12 rounded-xl object-cover mb-3"
              loading="eager"
              decoding="async"
            />
          )}
          <h1 className="text-2xl font-bold text-white">{vm.name || <span className="text-stone-600 italic">No name set</span>}</h1>
          {vm.tagline && <p className="text-stone-400 mt-1 text-sm">{vm.tagline}</p>}
        </div>

        {/* Contact info */}
        {(vm.phone || vm.address) && (
          <div className="bg-stone-900 rounded-xl p-4 mb-4 space-y-1.5 text-sm">
            {vm.phone   && <p className="text-stone-300">{vm.phone}</p>}
            {vm.address && <p className="text-stone-400">{vm.address}</p>}
          </div>
        )}

        {/* Social links */}
        {vm.socialLinks.length > 0 && (
          <div className="bg-stone-900 rounded-xl p-4 mb-4">
            <p className="text-xs text-stone-500 uppercase tracking-widest mb-3 font-medium">Social</p>
            <ul className="space-y-2">
              {vm.socialLinks.map(s => (
                <li key={s.platform} className="flex items-center gap-3 text-sm">
                  <span className="text-stone-500 w-28 flex-shrink-0 text-xs">
                    {PLATFORM_LABELS[s.platform] ?? s.platform}
                  </span>
                  <span className="text-stone-300 truncate">{s.handle}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Empty state */}
        {!vm.coverImageUrl && !vm.phone && !vm.address && vm.socialLinks.length === 0 && (
          <div className="text-center py-12">
            <p className="text-stone-600 text-sm">No draft content yet.</p>
            <p className="text-stone-700 text-xs mt-1">Save branding in the CMS to see a preview here.</p>
          </div>
        )}

      </div>
    </div>
  );
}
