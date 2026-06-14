import { useEffect, useState } from 'react';
import { api } from '../api';

interface Props {
  token: string;
}

type PageState = 'loading' | 'form' | 'done' | 'already-joined' | 'expired';

const MONTHS = [
  '', 'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];

const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

interface DateDropdownsProps {
  label: string;
  month: string;
  day: string;
  onMonthChange: (v: string) => void;
  onDayChange: (v: string) => void;
}

function DateDropdowns({ label, month, day, onMonthChange, onDayChange }: DateDropdownsProps) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <div className="flex gap-2">
        <select
          value={month}
          onChange={e => onMonthChange(e.target.value)}
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-800"
        >
          <option value="">חודש</option>
          {MONTHS.slice(1).map((name, i) => (
            <option key={i + 1} value={String(i + 1).padStart(2, '0')}>{name}</option>
          ))}
        </select>
        <select
          value={day}
          onChange={e => onDayChange(e.target.value)}
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-800"
        >
          <option value="">יום</option>
          {DAYS.map(d => (
            <option key={d} value={String(d).padStart(2, '0')}>{d}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

export default function JoinPage({ token }: Props) {
  const [pageState, setPageState] = useState<PageState>('loading');
  const [restaurantName, setRestaurantName] = useState('');

  // Form fields
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [birthdayMonth, setBirthdayMonth] = useState('');
  const [birthdayDay, setBirthdayDay] = useState('');
  const [anniversaryMonth, setAnniversaryMonth] = useState('');
  const [anniversaryDay, setAnniversaryDay] = useState('');
  const [smsConsent, setSmsConsent] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    api.join.get(token)
      .then(res => {
        if (res.expired) { setPageState('expired'); return; }
        if (res.alreadyJoined) { setPageState('already-joined'); return; }
        setRestaurantName(res.restaurantName ?? '');
        // Pre-fill name from guestName if available
        if (res.guestName) {
          const parts = res.guestName.trim().split(/\s+/);
          setFirstName(parts[0] ?? '');
          setLastName(parts.slice(1).join(' ') ?? '');
        }
        setPageState('form');
      })
      .catch(() => setPageState('expired'));
  }, [token]);

  const canSubmit = firstName.trim().length > 0 && lastName.trim().length > 0 && smsConsent;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setSubmitError('');

    const birthday =
      birthdayMonth && birthdayDay ? `${birthdayMonth}-${birthdayDay}` : undefined;
    const anniversary =
      anniversaryMonth && anniversaryDay ? `${anniversaryMonth}-${anniversaryDay}` : undefined;

    try {
      const res = await api.join.submit(token, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim() || undefined,
        birthday,
        anniversary,
        smsConsent,
        marketingConsent,
      });
      if (res.ok) {
        setPageState('done');
      } else {
        setSubmitError('אירעה שגיאה, נסה שוב');
      }
    } catch {
      setSubmitError('אירעה שגיאה, נסה שוב');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (pageState === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center" dir="rtl">
        <div className="w-7 h-7 border-2 border-gray-300 border-t-gray-800 rounded-full animate-spin" />
      </div>
    );
  }

  // ── Expired ────────────────────────────────────────────────────────────────
  if (pageState === 'expired') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6" dir="rtl">
        <div className="max-w-md w-full text-center">
          <div className="text-5xl mb-4">🔗</div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">הקישור פג תוקף</h2>
          <p className="text-gray-500 text-sm">פנה למסעדה לקבל קישור חדש.</p>
        </div>
      </div>
    );
  }

  // ── Already joined ─────────────────────────────────────────────────────────
  if (pageState === 'already-joined') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6" dir="rtl">
        <div className="max-w-md w-full text-center">
          <div className="w-16 h-16 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-4">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="16" cy="16" r="15" stroke="#22c55e" strokeWidth="2"/>
              <path d="M10 16l4 4 8-8" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-1">כבר חבר/ת בקלאב!</h2>
          <p className="text-gray-500 text-sm">אתה כבר רשום ב-IRON CLUB.</p>
        </div>
      </div>
    );
  }

  // ── Done (success) ─────────────────────────────────────────────────────────
  if (pageState === 'done') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6" dir="rtl">
        <div className="max-w-md w-full text-center">
          <div className="w-20 h-20 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-4">
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="20" cy="20" r="19" stroke="#22c55e" strokeWidth="2"/>
              <path d="M12 20l6 6 10-12" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">ברוך הבא ל-IRON CLUB!</h2>
          <p className="text-gray-600">
            {firstName && <><span className="font-semibold">{firstName}</span>, </>}
            אנחנו שמחים שהצטרפת
          </p>
        </div>
      </div>
    );
  }

  // ── Form ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50" dir="rtl">
      <div className="max-w-md mx-auto p-6">
        {/* Header */}
        <div className="text-center mb-8 pt-4">
          {restaurantName && (
            <h1 className="text-2xl font-bold text-gray-900 mb-1">{restaurantName}</h1>
          )}
          <p className="text-gray-500 text-base">הצטרפות ל-IRON CLUB ♦</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex flex-col gap-4">
          {/* First name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              שם פרטי <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={firstName}
              onChange={e => setFirstName(e.target.value)}
              required
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-800"
              placeholder="שם פרטי"
            />
          </div>

          {/* Last name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              שם משפחה <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={lastName}
              onChange={e => setLastName(e.target.value)}
              required
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-800"
              placeholder="שם משפחה"
            />
          </div>

          {/* Phone */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">טלפון</label>
            <input
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-800"
              placeholder="05X-XXXXXXX"
              dir="ltr"
            />
          </div>

          {/* Birthday */}
          <DateDropdowns
            label="יום הולדת"
            month={birthdayMonth}
            day={birthdayDay}
            onMonthChange={setBirthdayMonth}
            onDayChange={setBirthdayDay}
          />

          {/* Anniversary */}
          <DateDropdowns
            label="יום נישואין"
            month={anniversaryMonth}
            day={anniversaryDay}
            onMonthChange={setAnniversaryMonth}
            onDayChange={setAnniversaryDay}
          />

          {/* Consents */}
          <div className="flex flex-col gap-3 pt-1">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={smsConsent}
                onChange={e => setSmsConsent(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-gray-300 text-gray-900 focus:ring-gray-800"
              />
              <span className="text-sm text-gray-700">
                אני מסכים/ה לקבל הודעות SMS מהמסעדה{' '}
                <span className="text-red-500">*</span>
              </span>
            </label>

            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={marketingConsent}
                onChange={e => setMarketingConsent(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-gray-300 text-gray-900 focus:ring-gray-800"
              />
              <span className="text-sm text-gray-700">
                אני מסכים/ה לקבל עדכונים ומבצעים
              </span>
            </label>
          </div>

          {submitError && (
            <p className="text-sm text-red-600 text-center">{submitError}</p>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={!canSubmit || submitting}
            className="w-full mt-1 bg-gray-900 hover:bg-gray-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-semibold rounded-xl py-3 text-sm transition-colors"
          >
            {submitting ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                שולח...
              </span>
            ) : (
              'הצטרף לקלאב ♦'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
