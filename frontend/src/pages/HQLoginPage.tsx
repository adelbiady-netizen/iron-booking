import { useState, useRef } from 'react';
import { api } from '../api';
import type { AuthUser } from '../types';

interface Props {
  onLogin: (token: string, user: AuthUser) => void;
}

export default function HQLoginPage({ onLogin }: Props) {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState<string | null>(null);
  const [loading,  setLoading]  = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const r = await api.auth.login(email.trim(), password);
      if (r.user.role !== 'SUPER_ADMIN') {
        setError('Not authorized for HQ access. Contact your system administrator.');
        setPassword('');
        passwordRef.current?.focus();
        return;
      }
      onLogin(r.token, r.user);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Login failed';
      const isWrongPassword = msg.toLowerCase().includes('invalid') ||
        msg.toLowerCase().includes('unauthorized') ||
        msg.toLowerCase().includes('401');
      setError(isWrongPassword ? 'Incorrect email or password.' : msg);
      passwordRef.current?.select();
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
          <p className="text-iron-muted text-sm">HQ Access</p>
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
                autoFocus
                autoComplete="email"
                className="w-full bg-iron-bg border border-iron-border rounded-lg px-3 py-2.5 text-iron-text text-sm placeholder-iron-muted focus:outline-none focus:border-iron-green transition-colors"
                placeholder="you@ironbooking.com"
              />
            </div>

            <div>
              <label className="block text-iron-muted text-xs font-semibold uppercase tracking-wider mb-1.5">
                Password
              </label>
              <input
                ref={passwordRef}
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
        </div>

        <p className="text-center text-iron-muted text-xs mt-4">
          Iron Booking HQ ·{' '}
          <a href="/" className="hover:text-iron-text transition-colors hover:underline underline-offset-2">
            Host login
          </a>
        </p>

      </div>
    </div>
  );
}
