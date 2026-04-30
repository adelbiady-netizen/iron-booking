import { useState } from 'react';
import { api } from '../api';
import { T } from '../strings';
import type { AuthUser } from '../types';

interface Props {
  onSetup: (token: string, user: AuthUser) => void;
}

export default function SetupPage({ onSetup }: Props) {
  const [form, setForm] = useState({ email: '', password: '', firstName: '', lastName: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm(f => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { token, user } = await api.admin.bootstrap(form);
      onSetup(token, user);
    } catch (err: any) {
      setError(err.message ?? 'Setup failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-full bg-iron-bg flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-iron-text mb-2">{T.admin.setupTitle}</h1>
          <p className="text-iron-muted text-sm">{T.admin.setupSubtitle}</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-iron-surface border border-iron-border rounded-lg p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-iron-muted mb-1">{T.admin.fieldFirstName}</label>
              <input
                value={form.firstName}
                onChange={set('firstName')}
                required
                className="w-full bg-iron-bg border border-iron-border rounded px-3 py-2 text-iron-text text-sm focus:outline-none focus:border-iron-green"
              />
            </div>
            <div>
              <label className="block text-xs text-iron-muted mb-1">{T.admin.fieldLastName}</label>
              <input
                value={form.lastName}
                onChange={set('lastName')}
                required
                className="w-full bg-iron-bg border border-iron-border rounded px-3 py-2 text-iron-text text-sm focus:outline-none focus:border-iron-green"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-iron-muted mb-1">{T.admin.fieldUserEmail}</label>
            <input
              type="email"
              value={form.email}
              onChange={set('email')}
              required
              className="w-full bg-iron-bg border border-iron-border rounded px-3 py-2 text-iron-text text-sm focus:outline-none focus:border-iron-green"
            />
          </div>

          <div>
            <label className="block text-xs text-iron-muted mb-1">{T.admin.fieldPassword}</label>
            <input
              type="password"
              value={form.password}
              onChange={set('password')}
              required
              minLength={8}
              className="w-full bg-iron-bg border border-iron-border rounded px-3 py-2 text-iron-text text-sm focus:outline-none focus:border-iron-green"
            />
          </div>

          {error && (
            <p className="text-xs text-red-400 bg-red-400/10 rounded px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full py-2.5 bg-iron-green text-black font-semibold rounded text-sm disabled:opacity-50"
          >
            {busy ? T.admin.setupSubmitBusy : T.admin.setupSubmit}
          </button>
        </form>
      </div>
    </div>
  );
}
