import { useState } from 'react';
import { api, setSessionToken } from '../api';
import type { AuthUser } from '../types';

interface Props {
  // The freshly-issued session from a successful login with a temporary password.
  token: string;
  user: AuthUser;
  // Called once the user has chosen a new password — proceeds with the login.
  onDone: (token: string, user: AuthUser) => void;
  // 'ltr' for the host login, 'rtl' for HQ — keeps the visual language consistent.
  dir?: 'ltr' | 'rtl';
}

// Shown after a login where the account carries mustChangePassword (i.e. an admin
// issued a temporary password). The user must set their own password before they
// can enter the app. This lives entirely inside the login flow — it never touches
// PIN login or the authenticated app render.
export default function ForcePasswordChange({ token, user, onDone, dir = 'ltr' }: Props) {
  const [password, setPassword]   = useState('');
  const [confirm,  setConfirm]    = useState('');
  const [error,    setError]      = useState<string | null>(null);
  const [loading,  setLoading]    = useState(false);
  const rtl = dir === 'rtl';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError(rtl ? 'הסיסמה חייבת להכיל לפחות 8 תווים.' : 'Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError(rtl ? 'הסיסמאות אינן תואמות.' : 'Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      // Use the freshly-issued token so the authenticated request carries auth.
      setSessionToken(token);
      await api.auth.changePassword(password);
      onDone(token, { ...user, mustChangePassword: false });
    } catch (err) {
      // The change failed — drop the session token so we don't leave a half-auth state.
      setSessionToken(null);
      setError(err instanceof Error ? err.message : (rtl ? 'עדכון הסיסמה נכשל.' : 'Failed to update password.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="h-full bg-iron-bg flex items-center justify-center p-4" dir={dir}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2.5 mb-2">
            <div className="w-9 h-9 bg-iron-green rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm tracking-tight">IB</span>
            </div>
            <span className="text-iron-text font-semibold text-xl tracking-tight">Iron Booking</span>
          </div>
          <p className="text-iron-muted text-sm">
            {rtl ? 'בחרו סיסמה חדשה כדי להמשיך' : 'Choose a new password to continue'}
          </p>
        </div>

        <div className="bg-iron-card border border-iron-border rounded-xl p-6">
          <p className="text-iron-muted text-xs mb-4">
            {rtl
              ? `שלום ${user.firstName}, נכנסת עם סיסמה זמנית. בחרו סיסמה קבועה משלכם.`
              : `Hi ${user.firstName}, you signed in with a temporary password. Please set your own.`}
          </p>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-iron-muted text-xs font-semibold uppercase tracking-wider mb-1.5">
                {rtl ? 'סיסמה חדשה' : 'New password'}
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoFocus
                autoComplete="new-password"
                className="w-full bg-iron-bg border border-iron-border rounded-lg px-3 py-2.5 text-iron-text text-sm placeholder-iron-muted focus:outline-none focus:border-iron-green transition-colors"
                placeholder="••••••••"
              />
            </div>
            <div>
              <label className="block text-iron-muted text-xs font-semibold uppercase tracking-wider mb-1.5">
                {rtl ? 'אימות סיסמה' : 'Confirm password'}
              </label>
              <input
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                required
                autoComplete="new-password"
                className="w-full bg-iron-bg border border-iron-border rounded-lg px-3 py-2.5 text-iron-text text-sm placeholder-iron-muted focus:outline-none focus:border-iron-green transition-colors"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p className="text-status-danger text-xs bg-red-900/10 border border-red-900/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-iron-green hover:bg-iron-green-light disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors"
            >
              {loading ? (rtl ? 'שומר…' : 'Saving…') : (rtl ? 'שמירה והמשך' : 'Save and continue')}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
