import { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import { useT } from '../i18n/useT';
import type { AuthUser } from '../types';

interface PublicHost {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  role: string;
}

interface Props {
  restaurantId: string;
  onLogin: (token: string, user: AuthUser) => void;
  onManagerLogin: () => void;
}

function roleLabel(role: string, T: ReturnType<typeof useT>) {
  if (role === 'MANAGER') return T.hostSelection.roleManager;
  if (role === 'SERVER')  return T.hostSelection.roleServer;
  return T.hostSelection.roleHost;
}

function initials(firstName: string, lastName: string) {
  return (firstName[0] ?? '') + (lastName[0] ?? '');
}

const AVATAR_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b',
  '#10b981', '#06b6d4', '#3b82f6', '#ef4444',
];

function avatarColor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export default function HostSelectionScreen({ restaurantId, onLogin, onManagerLogin }: Props) {
  const T = useT();
  const [hosts,    setHosts]    = useState<PublicHost[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [loadErr,  setLoadErr]  = useState(false);

  // PIN entry state
  const [selected, setSelected] = useState<PublicHost | null>(null);
  const [pin,      setPin]      = useState('');
  const [pinError, setPinError] = useState(false);
  const [pinBusy,  setPinBusy]  = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.public.getHosts(restaurantId)
      .then(setHosts)
      .catch(() => setLoadErr(true))
      .finally(() => setLoading(false));
  }, [restaurantId]);

  function selectHost(host: PublicHost) {
    setSelected(host);
    setPin('');
    setPinError(false);
  }

  function deselectHost() {
    setSelected(null);
    setPin('');
    setPinError(false);
  }

  async function submitPin(finalPin: string) {
    if (!selected) return;
    setPinBusy(true);
    setPinError(false);
    try {
      const r = await api.auth.pinLogin(restaurantId, selected.id, finalPin);
      onLogin(r.token, r.user);
    } catch {
      setPinError(true);
      setPin('');
    } finally {
      setPinBusy(false);
    }
  }

  function pressDigit(d: string) {
    if (pinBusy) return;
    const next = (pin + d).slice(0, 4);
    setPin(next);
    setPinError(false);
    if (next.length === 4) submitPin(next);
  }

  function pressBackspace() {
    if (pinBusy) return;
    setPin(p => p.slice(0, -1));
  }

  const PAD = ['1','2','3','4','5','6','7','8','9','','0','⌫'];

  return (
    <div className="h-full bg-iron-bg flex flex-col items-center justify-start p-4 pt-10 overflow-y-auto">
      {/* Logo */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2.5 mb-2">
          <div className="w-9 h-9 bg-iron-green rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm tracking-tight">IB</span>
          </div>
          <span className="text-iron-text font-semibold text-xl tracking-tight">Iron Booking</span>
        </div>
        <p className="text-iron-text font-medium text-base">{T.hostSelection.title}</p>
        <p className="text-iron-muted text-sm mt-0.5">{T.hostSelection.subtitle}</p>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="w-5 h-5 border-2 border-iron-green border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Error */}
      {!loading && loadErr && (
        <div className="text-center py-8">
          <p className="text-status-danger text-sm">{T.hostSelection.loadError}</p>
        </div>
      )}

      {/* No hosts */}
      {!loading && !loadErr && hosts.length === 0 && (
        <div className="text-center py-8 max-w-xs">
          <p className="text-iron-text text-sm font-medium">{T.hostSelection.noHosts}</p>
          <p className="text-iron-muted text-xs mt-1">{T.hostSelection.noHostsHint}</p>
        </div>
      )}

      {/* Host grid */}
      {!loading && !loadErr && hosts.length > 0 && !selected && (
        <div
          ref={containerRef}
          className="grid gap-3 w-full max-w-sm"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}
        >
          {hosts.map(host => (
            <button
              key={host.id}
              onClick={() => selectHost(host)}
              className="bg-iron-card border border-iron-border hover:border-iron-green/50 rounded-xl p-4 flex flex-col items-center gap-2 transition-all hover:bg-iron-card/80 active:scale-95"
            >
              {/* Avatar */}
              {host.avatarUrl ? (
                <img
                  src={host.avatarUrl}
                  alt={host.firstName}
                  className="w-14 h-14 rounded-full object-cover"
                />
              ) : (
                <div
                  className="w-14 h-14 rounded-full flex items-center justify-center text-white font-bold text-lg"
                  style={{ backgroundColor: avatarColor(host.id) }}
                >
                  {initials(host.firstName, host.lastName)}
                </div>
              )}
              <div className="text-center">
                <p className="text-iron-text text-sm font-medium leading-tight">
                  {host.firstName} {host.lastName}
                </p>
                <p className="text-iron-muted text-xs mt-0.5">{roleLabel(host.role, T)}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* PIN entry */}
      {selected && (
        <div className="w-full max-w-xs">
          {/* Selected host header */}
          <div className="flex flex-col items-center mb-6">
            {selected.avatarUrl ? (
              <img
                src={selected.avatarUrl}
                alt={selected.firstName}
                className="w-16 h-16 rounded-full object-cover mb-2"
              />
            ) : (
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center text-white font-bold text-xl mb-2"
                style={{ backgroundColor: avatarColor(selected.id) }}
              >
                {initials(selected.firstName, selected.lastName)}
              </div>
            )}
            <p className="text-iron-text font-semibold">
              {selected.firstName} {selected.lastName}
            </p>
            <p className="text-iron-muted text-xs mt-0.5">{T.hostSelection.pinTitle(selected.firstName)}</p>
          </div>

          {/* PIN dots */}
          <div className="flex justify-center gap-4 mb-6">
            {[0,1,2,3].map(i => (
              <div
                key={i}
                className={`w-4 h-4 rounded-full border-2 transition-all ${
                  i < pin.length
                    ? (pinError ? 'bg-status-danger border-status-danger' : 'bg-iron-green border-iron-green')
                    : 'border-iron-border bg-transparent'
                }`}
              />
            ))}
          </div>

          {/* Error message */}
          {pinError && (
            <p className="text-center text-status-danger text-xs mb-3">{T.hostSelection.pinError}</p>
          )}

          {/* Busy state */}
          {pinBusy && (
            <p className="text-center text-iron-muted text-xs mb-3">{T.hostSelection.pinSubmitting}</p>
          )}

          {/* Number pad */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            {PAD.map((d, i) => {
              if (d === '') return <div key={i} />;
              if (d === '⌫') return (
                <button
                  key={i}
                  onClick={pressBackspace}
                  disabled={pinBusy}
                  className="h-14 bg-iron-card border border-iron-border rounded-xl text-iron-muted hover:text-iron-text hover:border-iron-text/30 text-lg transition-colors disabled:opacity-40 flex items-center justify-center"
                >
                  {d}
                </button>
              );
              return (
                <button
                  key={i}
                  onClick={() => pressDigit(d)}
                  disabled={pinBusy}
                  className="h-14 bg-iron-card border border-iron-border rounded-xl text-iron-text font-semibold text-xl hover:bg-iron-green/10 hover:border-iron-green/40 transition-colors disabled:opacity-40"
                >
                  {d}
                </button>
              );
            })}
          </div>

          {/* Back button */}
          <button
            onClick={deselectHost}
            disabled={pinBusy}
            className="w-full text-iron-muted text-sm py-2 hover:text-iron-text transition-colors disabled:opacity-40"
          >
            {T.hostSelection.pinBack}
          </button>
        </div>
      )}

      {/* Manager login link */}
      {!selected && (
        <button
          onClick={onManagerLogin}
          className="mt-10 text-iron-muted text-xs hover:text-iron-text transition-colors"
        >
          {T.hostSelection.managerLogin}
        </button>
      )}
    </div>
  );
}
