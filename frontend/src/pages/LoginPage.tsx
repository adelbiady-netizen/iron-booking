import { useState } from 'react';
import { api } from '../api';
import type { AuthUser } from '../types';

interface Props {
  onLogin: (token: string, user: AuthUser) => void;
}

export default function LoginPage({ onLogin }: Props) {
  const [email, setEmail] = useState('dev@ironbooking.com');
  const [password, setPassword] = useState('dev123');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const r = await api.auth.login(email, password);
      onLogin(r.token, r.user);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  async function devLogin() {
    setError(null);
    setLoading(true);
    try {
      const r = await api.auth.devLogin();
      onLogin(r.token, r.user);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Dev login failed');
    } finally {
      setLoading(false);
    }
  }

  async function devSuperLogin() {
    setError(null);
    setLoading(true);
    try {
      const r = await api.auth.devSuperLogin();
      onLogin(r.token, r.user);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Dev super login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="h-full bg-iron-bg flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2.5 mb-2">
            <div className="w-9 h-9 bg-iron-green rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm tracking-tight">IB</span>
            </div>
            <span className="text-iron-text font-semibold text-xl tracking-tight">
              Iron Booking
            </span>
          </div>
          <p className="text-iron-muted text-sm">Host Dashboard</p>
        </div>

        <div className="bg-iron-card border border-iron-border rounded-xl p-6">
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-iron-muted text-xs font-semibold uppercase tracking-wider mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full bg-iron-bg border border-iron-border rounded-lg px-3 py-2.5 text-iron-text text-sm placeholder-iron-muted focus:outline-none focus:border-iron-green transition-colors"
                placeholder="you@restaurant.com"
              />
            </div>

            <div>
              <label className="block text-iron-muted text-xs font-semibold uppercase tracking-wider mb-1.5">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full bg-iron-bg border border-iron-border rounded-lg px-3 py-2.5 text-iron-text text-sm placeholder-iron-muted focus:outline-none focus:border-iron-green transition-colors"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p className="text-red-400 text-xs bg-red-900/10 border border-red-900/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-iron-green hover:bg-iron-green-light disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div className="mt-3 pt-3 border-t border-iron-border space-y-2">
            <button
              onClick={devLogin}
              disabled={loading}
              className="w-full border border-iron-border hover:border-iron-green text-iron-muted hover:text-iron-text text-sm py-2 rounded-lg transition-colors"
            >
              Dev login · ADMIN (no password)
            </button>
            <button
              onClick={devSuperLogin}
              disabled={loading}
              className="w-full border border-iron-border hover:border-iron-green text-iron-muted hover:text-iron-text text-sm py-2 rounded-lg transition-colors"
            >
              Dev login · SUPER_ADMIN (Admin Portal)
            </button>
          </div>
        </div>

        <p className="text-center text-iron-muted text-xs mt-4">
          Iron Booking · Host Dashboard
        </p>
      </div>
    </div>
  );
}
