import { useState, useEffect } from 'react';
import { api, ApiError } from '../api';
import { useT } from '../i18n/useT';
import type { HostUser } from '../types';

interface Props {
  onBack: () => void;
}

type Role = 'HOST' | 'SERVER' | 'MANAGER';

const ROLES: Role[] = ['HOST', 'SERVER', 'MANAGER'];

function roleLabel(role: string, T: ReturnType<typeof useT>) {
  if (role === 'MANAGER') return T.hostsSettings.roleManager;
  if (role === 'SERVER')  return T.hostsSettings.roleServer;
  return T.hostsSettings.roleHost;
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

function initials(firstName: string, lastName: string) {
  return (firstName[0] ?? '') + (lastName[0] ?? '');
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface HostFormProps {
  host?: HostUser;
  onSave: (data: { firstName: string; lastName: string; role: Role; avatarUrl: string }) => Promise<void>;
  onCancel: () => void;
  T: ReturnType<typeof useT>;
}

function HostForm({ host, onSave, onCancel, T }: HostFormProps) {
  const [firstName, setFirstName] = useState(host?.firstName ?? '');
  const [lastName,  setLastName]  = useState(host?.lastName  ?? '');
  const [role,      setRole]      = useState<Role>((host?.role as Role) ?? 'HOST');
  const [avatarUrl, setAvatarUrl] = useState(host?.avatarUrl ?? '');
  const [busy,      setBusy]      = useState(false);
  const [error,     setError]     = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSave({ firstName: firstName.trim(), lastName: lastName.trim(), role, avatarUrl: avatarUrl.trim() });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : T.hostsSettings.toastError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="block text-iron-muted text-xs font-semibold uppercase tracking-wider mb-1">
            {T.hostsSettings.fieldFirst}
          </label>
          <input
            value={firstName}
            onChange={e => setFirstName(e.target.value)}
            required
            autoFocus
            className="w-full bg-iron-bg border border-iron-border rounded-lg px-3 py-2 text-iron-text text-sm focus:outline-none focus:border-iron-green"
          />
        </div>
        <div className="flex-1">
          <label className="block text-iron-muted text-xs font-semibold uppercase tracking-wider mb-1">
            {T.hostsSettings.fieldLast}
          </label>
          <input
            value={lastName}
            onChange={e => setLastName(e.target.value)}
            required
            className="w-full bg-iron-bg border border-iron-border rounded-lg px-3 py-2 text-iron-text text-sm focus:outline-none focus:border-iron-green"
          />
        </div>
      </div>

      <div>
        <label className="block text-iron-muted text-xs font-semibold uppercase tracking-wider mb-1">
          {T.hostsSettings.fieldRole}
        </label>
        <div className="flex gap-1">
          {ROLES.map(r => (
            <button
              key={r}
              type="button"
              onClick={() => setRole(r)}
              className={`flex-1 py-1.5 text-xs rounded-lg border font-medium transition-colors ${
                role === r
                  ? 'bg-iron-green/20 border-iron-green/50 text-iron-green-light'
                  : 'border-iron-border text-iron-muted hover:text-iron-text'
              }`}
            >
              {roleLabel(r, T)}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-iron-muted text-xs font-semibold uppercase tracking-wider mb-1">
          {T.hostsSettings.fieldAvatar}
        </label>
        <input
          value={avatarUrl}
          onChange={e => setAvatarUrl(e.target.value)}
          type="url"
          placeholder="https://…"
          className="w-full bg-iron-bg border border-iron-border rounded-lg px-3 py-2 text-iron-text text-sm focus:outline-none focus:border-iron-green placeholder-iron-muted"
        />
      </div>

      {error && (
        <p className="text-red-400 text-xs bg-red-900/10 border border-red-900/20 rounded px-2 py-1">{error}</p>
      )}

      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={busy || !firstName.trim() || !lastName.trim()}
          className="flex-1 bg-iron-green hover:bg-iron-green-light disabled:opacity-50 text-white font-semibold py-2 rounded-lg text-sm transition-colors"
        >
          {busy ? T.hostsSettings.saveBusy : T.hostsSettings.saveBtn}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 border border-iron-border text-iron-muted hover:text-iron-text py-2 rounded-lg text-sm transition-colors"
        >
          {T.hostsSettings.cancelBtn}
        </button>
      </div>
    </form>
  );
}

interface PinDialogProps {
  host: HostUser;
  onSave: (pin: string) => Promise<void>;
  onCancel: () => void;
  T: ReturnType<typeof useT>;
}

function PinDialog({ host, onSave, onCancel, T }: PinDialogProps) {
  const [pin,     setPin]     = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pin !== confirm) { setError(T.hostsSettings.pinMismatch); return; }
    setBusy(true);
    setError('');
    try {
      await onSave(pin);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : T.hostsSettings.toastError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-iron-card border border-iron-border rounded-xl p-5 w-full max-w-xs">
        <h3 className="text-iron-text font-semibold text-sm mb-4">
          {T.hostsSettings.pinDialogTitle(`${host.firstName} ${host.lastName}`)}
        </h3>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-iron-muted text-xs font-semibold uppercase tracking-wider mb-1">
              {T.hostsSettings.pinHint}
            </label>
            <input
              value={pin}
              onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              type="password"
              inputMode="numeric"
              pattern="\d{4}"
              maxLength={4}
              required
              autoFocus
              className="w-full bg-iron-bg border border-iron-border rounded-lg px-3 py-2 text-iron-text text-sm text-center tracking-[0.5em] focus:outline-none focus:border-iron-green"
              placeholder="••••"
            />
          </div>
          <div>
            <label className="block text-iron-muted text-xs font-semibold uppercase tracking-wider mb-1">
              {T.hostsSettings.pinConfirmHint}
            </label>
            <input
              value={confirm}
              onChange={e => setConfirm(e.target.value.replace(/\D/g, '').slice(0, 4))}
              type="password"
              inputMode="numeric"
              pattern="\d{4}"
              maxLength={4}
              required
              className="w-full bg-iron-bg border border-iron-border rounded-lg px-3 py-2 text-iron-text text-sm text-center tracking-[0.5em] focus:outline-none focus:border-iron-green"
              placeholder="••••"
            />
          </div>

          {error && (
            <p className="text-red-400 text-xs">{error}</p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={busy || pin.length !== 4 || confirm.length !== 4}
              className="flex-1 bg-iron-green hover:bg-iron-green-light disabled:opacity-50 text-white font-semibold py-2 rounded-lg text-sm transition-colors"
            >
              {busy ? T.hostsSettings.pinSaveBusy : T.hostsSettings.pinSaveBtn}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 border border-iron-border text-iron-muted hover:text-iron-text py-2 rounded-lg text-sm transition-colors"
            >
              {T.hostsSettings.pinCancelBtn}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function HostsSettingsPage({ onBack }: Props) {
  const T = useT();
  const [hosts,    setHosts]    = useState<HostUser[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing,  setEditing]  = useState<HostUser | null>(null);
  const [pinFor,   setPinFor]   = useState<HostUser | null>(null);
  const [toast,    setToast]    = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  function load() {
    setLoading(true);
    api.hosts.list()
      .then(setHosts)
      .catch(() => setToast(T.hostsSettings.toastError))
      .finally(() => setLoading(false));
  }

  async function handleCreate(data: { firstName: string; lastName: string; role: Role; avatarUrl: string }) {
    const host = await api.hosts.create({
      firstName: data.firstName,
      lastName:  data.lastName,
      role:      data.role,
      avatarUrl: data.avatarUrl || null,
    });
    setHosts(h => [host, ...h]);
    setCreating(false);
    setToast(T.hostsSettings.toastCreated(`${host.firstName} ${host.lastName}`));
  }

  async function handleEdit(data: { firstName: string; lastName: string; role: Role; avatarUrl: string }) {
    if (!editing) return;
    const host = await api.hosts.update(editing.id, {
      firstName: data.firstName,
      lastName:  data.lastName,
      role:      data.role,
      avatarUrl: data.avatarUrl || null,
    });
    setHosts(h => h.map(u => u.id === host.id ? host : u));
    setEditing(null);
    setToast(T.hostsSettings.toastUpdated(`${host.firstName} ${host.lastName}`));
  }

  async function handleSetPin(pin: string) {
    if (!pinFor) return;
    const host = await api.hosts.setPin(pinFor.id, pin);
    setHosts(h => h.map(u => u.id === host.id ? host : u));
    setPinFor(null);
    setToast(T.hostsSettings.toastPinSet(`${host.firstName} ${host.lastName}`));
  }

  async function handleToggleActive(host: HostUser) {
    try {
      const updated = await api.hosts.toggleActive(host.id);
      setHosts(h => h.map(u => u.id === updated.id ? updated : u));
      setToast(T.hostsSettings.toastToggled(`${updated.firstName} ${updated.lastName}`, updated.isActive));
    } catch {
      setToast(T.hostsSettings.toastError);
    }
  }

  async function handleDelete(host: HostUser) {
    if (!window.confirm(T.hostsSettings.deleteConfirm(`${host.firstName} ${host.lastName}`))) return;
    try {
      await api.hosts.remove(host.id);
      setHosts(h => h.filter(u => u.id !== host.id));
      setToast(T.hostsSettings.toastDeleted(`${host.firstName} ${host.lastName}`));
    } catch {
      setToast(T.hostsSettings.toastError);
    }
  }

  return (
    <div className="h-full bg-iron-bg flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-iron-border">
        <button
          onClick={onBack}
          className="text-iron-muted hover:text-iron-text text-sm transition-colors"
        >
          {T.hostsSettings.back}
        </button>
        <h1 className="text-iron-text font-semibold flex-1">{T.hostsSettings.title}</h1>
        <button
          onClick={() => { setCreating(true); setEditing(null); }}
          className="text-xs bg-iron-green hover:bg-iron-green-light text-white font-semibold px-3 py-1.5 rounded-lg transition-colors"
        >
          {T.hostsSettings.addHost}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {/* Create form */}
        {creating && (
          <div className="bg-iron-card border border-iron-border rounded-xl p-4 mb-4">
            <p className="text-iron-text text-sm font-semibold mb-3">{T.hostsSettings.formTitleCreate}</p>
            <HostForm
              onSave={handleCreate}
              onCancel={() => setCreating(false)}
              T={T}
            />
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex justify-center py-12">
            <div className="w-5 h-5 border-2 border-iron-green border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* Empty */}
        {!loading && hosts.length === 0 && !creating && (
          <div className="text-center py-12">
            <p className="text-iron-text text-sm font-medium">{T.hostsSettings.noHosts}</p>
            <p className="text-iron-muted text-xs mt-1">{T.hostsSettings.noHostsHint}</p>
          </div>
        )}

        {/* Host list */}
        {!loading && hosts.length > 0 && (
          <div className="space-y-2">
            {hosts.map(host => (
              <div key={host.id} className="bg-iron-card border border-iron-border rounded-xl overflow-hidden">
                {/* Edit form inline */}
                {editing?.id === host.id ? (
                  <div className="p-4">
                    <p className="text-iron-text text-sm font-semibold mb-3">{T.hostsSettings.formTitleEdit}</p>
                    <HostForm
                      host={host}
                      onSave={handleEdit}
                      onCancel={() => setEditing(null)}
                      T={T}
                    />
                  </div>
                ) : (
                  <div className="p-3 flex items-center gap-3">
                    {/* Avatar */}
                    {host.avatarUrl ? (
                      <img
                        src={host.avatarUrl}
                        alt={host.firstName}
                        className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                      />
                    ) : (
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
                        style={{ backgroundColor: avatarColor(host.id) }}
                      >
                        {initials(host.firstName, host.lastName)}
                      </div>
                    )}

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className={`text-sm font-medium leading-tight ${host.isActive ? 'text-iron-text' : 'text-iron-muted line-through'}`}>
                          {host.firstName} {host.lastName}
                        </p>
                        <span className="text-xs text-iron-muted bg-iron-bg border border-iron-border rounded px-1.5 py-0.5">
                          {roleLabel(host.role, T)}
                        </span>
                      </div>
                      <p className={`text-xs mt-0.5 ${host.hasPin ? 'text-iron-green-light' : 'text-amber-400'}`}>
                        {host.hasPin ? T.hostsSettings.pinSet : T.hostsSettings.pinNotSet}
                      </p>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => setPinFor(host)}
                        className="text-xs text-iron-muted hover:text-iron-text border border-iron-border hover:border-iron-text/30 rounded px-2 py-1 transition-colors"
                      >
                        {host.hasPin ? T.hostsSettings.changePin : T.hostsSettings.setPin}
                      </button>
                      <button
                        onClick={() => { setEditing(host); setCreating(false); }}
                        className="text-xs text-iron-muted hover:text-iron-text border border-iron-border hover:border-iron-text/30 rounded px-2 py-1 transition-colors"
                      >
                        {T.hostsSettings.editBtn}
                      </button>
                      <button
                        onClick={() => handleToggleActive(host)}
                        className="text-xs text-iron-muted hover:text-iron-text border border-iron-border hover:border-iron-text/30 rounded px-2 py-1 transition-colors"
                      >
                        {host.isActive ? T.hostsSettings.deactivate : T.hostsSettings.activate}
                      </button>
                      <button
                        onClick={() => handleDelete(host)}
                        className="text-xs text-red-400/70 hover:text-red-400 border border-iron-border hover:border-red-900/30 rounded px-2 py-1 transition-colors"
                      >
                        {T.hostsSettings.deleteBtn}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* PIN dialog */}
      {pinFor && (
        <PinDialog
          host={pinFor}
          onSave={handleSetPin}
          onCancel={() => setPinFor(null)}
          T={T}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-iron-card border border-iron-border text-iron-text text-xs px-4 py-2 rounded-lg shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
