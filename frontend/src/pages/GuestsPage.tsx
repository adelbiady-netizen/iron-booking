import { useState, useEffect } from 'react';
import type { GuestDetail, GuestListItem } from '../types';
import { api } from '../api';

interface Props {
  onBack: () => void;
}

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' });
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pending', CONFIRMED: 'Confirmed', SEATED: 'Seated',
  COMPLETED: 'Done', CANCELLED: 'Cancelled', NO_SHOW: 'No-show',
};

const STATUS_COLOR: Record<string, string> = {
  PENDING: 'text-amber-400', CONFIRMED: 'text-iron-green-light', SEATED: 'text-blue-400',
  COMPLETED: 'text-iron-muted', CANCELLED: 'text-red-400', NO_SHOW: 'text-red-400',
};

export default function GuestsPage({ onBack }: Props) {
  const [guests, setGuests]               = useState<GuestListItem[]>([]);
  const [total, setTotal]                 = useState(0);
  const [search, setSearch]               = useState('');
  const [loading, setLoading]             = useState(false);
  const [selectedId, setSelectedId]       = useState<string | null>(null);
  const [profile, setProfile]             = useState<GuestDetail | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  // Load guest list, debounced on search
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const result = await api.guests.list({ search: search.trim() || undefined, limit: 50 });
        if (!cancelled) {
          setGuests(result.data);
          setTotal(result.meta.total);
        }
      } catch {
        // silent — list stays as-is
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, search ? 300 : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [search]);

  // Load profile when selectedId changes
  useEffect(() => {
    if (!selectedId) { setProfile(null); return; }
    let cancelled = false;
    setProfileLoading(true);
    api.guests.getById(selectedId)
      .then(g => { if (!cancelled) setProfile(g); })
      .catch(() => { if (!cancelled) setProfile(null); })
      .finally(() => { if (!cancelled) setProfileLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId]);

  function handleRowClick(id: string) {
    setSelectedId(prev => (prev === id ? null : id));
  }

  return (
    <div className="h-full flex flex-col bg-iron-bg overflow-hidden">
      {/* Page header */}
      <div className="shrink-0 bg-iron-card border-b border-iron-border px-4 py-3 flex items-center gap-3">
        <button
          onClick={onBack}
          className="text-iron-muted hover:text-iron-text text-sm border border-iron-border rounded-md px-3 py-1.5 transition-colors shrink-0"
        >
          ← Back
        </button>
        <h1 className="text-iron-text font-semibold text-base">Guests</h1>
        <div className="flex-1" />
        <span className="text-iron-muted text-xs tabular-nums">
          {loading ? 'Loading…' : `${total} guest${total !== 1 ? 's' : ''}`}
        </span>
        <input
          type="search"
          placeholder="Search name, phone, email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-iron-bg border border-iron-border rounded-md px-3 py-1.5 text-sm text-iron-text placeholder:text-iron-muted focus:outline-none focus:border-iron-green transition-colors w-56"
        />
      </div>

      {/* Guest table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-iron-border bg-iron-card/50 text-iron-muted text-xs uppercase tracking-wide">
              <th className="text-left px-4 py-2 font-medium">Name</th>
              <th className="text-left px-4 py-2 font-medium hidden sm:table-cell">Phone</th>
              <th className="text-left px-4 py-2 font-medium hidden md:table-cell">Email</th>
              <th className="text-right px-4 py-2 font-medium">Visits</th>
              <th className="text-right px-4 py-2 font-medium">No-shows</th>
              <th className="text-right px-4 py-2 font-medium hidden sm:table-cell">Last Visit</th>
            </tr>
          </thead>
          <tbody>
            {guests.map(g => (
              <tr
                key={g.id}
                onClick={() => handleRowClick(g.id)}
                className={`border-b border-iron-border cursor-pointer transition-colors ${
                  selectedId === g.id
                    ? 'bg-iron-green/10'
                    : 'hover:bg-iron-card/40'
                }`}
              >
                <td className="px-4 py-2.5 text-iron-text">
                  <span className="font-medium">{g.firstName} {g.lastName}</span>
                  {g.isVip && (
                    <span className="ml-1.5 text-amber-400 text-xs font-semibold">VIP</span>
                  )}
                  {g.isBlacklisted && (
                    <span className="ml-1.5 text-red-400 text-xs font-semibold">BLOCKED</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-iron-muted hidden sm:table-cell">
                  {g.phone ?? '—'}
                </td>
                <td className="px-4 py-2.5 text-iron-muted hidden md:table-cell">
                  {g.email ?? '—'}
                </td>
                <td className="px-4 py-2.5 text-iron-text text-right tabular-nums">
                  {g.visitCount}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  <span className={g.noShowCount > 0 ? 'text-red-400' : 'text-iron-muted'}>
                    {g.noShowCount}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-iron-muted text-right hidden sm:table-cell">
                  {fmtDate(g.lastVisitAt)}
                </td>
              </tr>
            ))}
            {!loading && guests.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-iron-muted text-sm">
                  {search ? 'No guests match your search.' : 'No guests yet.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Profile panel */}
      {selectedId && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/30"
            onClick={() => setSelectedId(null)}
          />
          {/* Drawer */}
          <div className="fixed right-0 top-0 h-full w-full sm:w-[420px] z-50 bg-iron-card border-l border-iron-border flex flex-col shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-iron-border shrink-0">
              <h2 className="text-iron-text font-semibold text-sm">Guest Profile</h2>
              <button
                onClick={() => setSelectedId(null)}
                className="text-iron-muted hover:text-iron-text transition-colors text-lg leading-none"
              >
                ×
              </button>
            </div>

            {profileLoading && (
              <div className="flex-1 flex items-center justify-center text-iron-muted text-sm">
                Loading…
              </div>
            )}

            {!profileLoading && profile && (
              <div className="flex-1 overflow-y-auto p-4 space-y-5">
                {/* Name + badges */}
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-iron-text font-semibold text-base">
                      {profile.firstName} {profile.lastName}
                    </h3>
                    {profile.isVip && (
                      <span className="bg-amber-400/20 text-amber-400 text-xs font-semibold px-2 py-0.5 rounded-full">VIP</span>
                    )}
                    {profile.isBlacklisted && (
                      <span className="bg-red-400/20 text-red-400 text-xs font-semibold px-2 py-0.5 rounded-full">BLOCKED</span>
                    )}
                  </div>
                  <p className="text-iron-muted text-xs mt-0.5">
                    Member since {fmtDate(profile.createdAt)}
                  </p>
                </div>

                {/* Contact */}
                <section>
                  <h4 className="text-iron-muted text-xs uppercase tracking-wide font-medium mb-2">Contact</h4>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-iron-muted">Phone</span>
                      <span className="text-iron-text">{profile.phone ?? '—'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-iron-muted">Email</span>
                      <span className="text-iron-text">{profile.email ?? '—'}</span>
                    </div>
                  </div>
                </section>

                {/* Visit stats */}
                <section>
                  <h4 className="text-iron-muted text-xs uppercase tracking-wide font-medium mb-2">Visit History</h4>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-iron-bg rounded-lg px-3 py-2 text-center">
                      <p className="text-iron-text font-semibold text-lg tabular-nums">{profile.visitCount}</p>
                      <p className="text-iron-muted text-xs">Visits</p>
                    </div>
                    <div className="bg-iron-bg rounded-lg px-3 py-2 text-center">
                      <p className={`font-semibold text-lg tabular-nums ${profile.noShowCount > 0 ? 'text-red-400' : 'text-iron-text'}`}>
                        {profile.noShowCount}
                      </p>
                      <p className="text-iron-muted text-xs">No-shows</p>
                    </div>
                    <div className="bg-iron-bg rounded-lg px-3 py-2 text-center">
                      <p className="text-iron-text font-semibold text-lg tabular-nums">{profile.cancelCount}</p>
                      <p className="text-iron-muted text-xs">Cancels</p>
                    </div>
                  </div>
                  <p className="text-iron-muted text-xs mt-2">
                    Last visit: {fmtDate(profile.lastVisitAt)}
                  </p>
                </section>

                {/* Allergies */}
                {profile.allergies.length > 0 && (
                  <section>
                    <h4 className="text-iron-muted text-xs uppercase tracking-wide font-medium mb-2">Allergies</h4>
                    <div className="flex flex-wrap gap-1.5">
                      {profile.allergies.map(a => (
                        <span key={a} className="bg-red-400/15 text-red-400 text-xs px-2 py-0.5 rounded-full font-medium">
                          {a}
                        </span>
                      ))}
                    </div>
                  </section>
                )}

                {/* Tags */}
                {profile.tags.length > 0 && (
                  <section>
                    <h4 className="text-iron-muted text-xs uppercase tracking-wide font-medium mb-2">Tags</h4>
                    <div className="flex flex-wrap gap-1.5">
                      {profile.tags.map(t => (
                        <span key={t} className="bg-iron-bg text-iron-muted text-xs px-2 py-0.5 rounded-full border border-iron-border">
                          {t}
                        </span>
                      ))}
                    </div>
                  </section>
                )}

                {/* Seating preference */}
                {(profile.preferences as Record<string, string>)?.seatingPref && (
                  <section>
                    <h4 className="text-iron-muted text-xs uppercase tracking-wide font-medium mb-1">Seating Preference</h4>
                    <p className="text-iron-text text-sm">{(profile.preferences as Record<string, string>).seatingPref}</p>
                  </section>
                )}

                {/* Internal notes */}
                {profile.internalNotes && (
                  <section>
                    <h4 className="text-iron-muted text-xs uppercase tracking-wide font-medium mb-1">Internal Notes</h4>
                    <p className="text-iron-text text-sm whitespace-pre-wrap">{profile.internalNotes}</p>
                  </section>
                )}

                {/* Reservation history */}
                <section>
                  <h4 className="text-iron-muted text-xs uppercase tracking-wide font-medium mb-2">
                    Reservations ({profile.reservations.length})
                  </h4>
                  {profile.reservations.length === 0 ? (
                    <p className="text-iron-muted text-sm">No reservations on record.</p>
                  ) : (
                    <div className="space-y-2">
                      {profile.reservations.map(r => (
                        <div key={r.id} className="bg-iron-bg rounded-lg px-3 py-2 text-sm">
                          <div className="flex items-center justify-between">
                            <span className="text-iron-text font-medium">
                              {fmtDate(r.date)} at {r.time}
                            </span>
                            <span className={`text-xs font-medium ${STATUS_COLOR[r.status] ?? 'text-iron-muted'}`}>
                              {STATUS_LABEL[r.status] ?? r.status}
                            </span>
                          </div>
                          <div className="text-iron-muted text-xs mt-0.5 flex gap-2">
                            <span>{r.partySize} pax</span>
                            {r.table && <span>· {r.table.name}</span>}
                            {r.occasion && <span>· {r.occasion}</span>}
                          </div>
                          {r.guestNotes && (
                            <p className="text-iron-muted text-xs mt-1 italic">{r.guestNotes}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
