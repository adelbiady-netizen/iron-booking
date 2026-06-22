import { useEffect, useState } from 'react';
import { BASE } from '../api';

interface Props {
  token: string;
}

type PageState = 'loading' | 'ok' | 'already_used' | 'expired' | 'invalid' | 'error';

export default function UnsubscribePage({ token }: Props) {
  const [state, setState] = useState<PageState>('loading');

  useEffect(() => {
    fetch(`${BASE}/public/unsubscribe/${token}`)
      .then(r => r.json())
      .then((data: { status: string }) => {
        const s = data.status as PageState;
        setState(['ok', 'already_used', 'expired', 'invalid'].includes(s) ? s : 'error');
      })
      .catch(() => setState('error'));
  }, [token]);

  return (
    <div
      dir="rtl"
      style={{
        minHeight:       '100vh',
        display:         'flex',
        flexDirection:   'column',
        alignItems:      'center',
        justifyContent:  'center',
        padding:         '24px',
        fontFamily:      "'Heebo', 'Arial Hebrew', Arial, sans-serif",
        backgroundColor: '#f9fafb',
        color:           '#111827',
      }}
    >
      <div
        style={{
          maxWidth:        '400px',
          width:           '100%',
          background:      '#fff',
          borderRadius:    '16px',
          boxShadow:       '0 4px 24px rgba(0,0,0,0.08)',
          padding:         '40px 32px',
          textAlign:       'center',
        }}
      >
        {state === 'loading' && <Loading />}
        {state === 'ok'          && <Success />}
        {state === 'already_used' && <AlreadyUsed />}
        {state === 'expired'     && <Expired />}
        {state === 'invalid'     && <Invalid />}
        {state === 'error'       && <ServerError />}
      </div>

      <p style={{ marginTop: '24px', fontSize: '13px', color: '#9ca3af' }}>
        Iron Booking · מערכת ניהול הזמנות
      </p>
    </div>
  );
}

// ── State components ──────────────────────────────────────────────────────────

function Loading() {
  return (
    <>
      <Spinner />
      <p style={{ marginTop: '16px', fontSize: '15px', color: '#6b7280' }}>מעבד בקשה…</p>
    </>
  );
}

function Success() {
  return (
    <>
      <Icon bg="#d1fae5" color="#059669">✓</Icon>
      <h1 style={headingStyle}>הוסרת בהצלחה</h1>
      <p style={bodyStyle}>
        בקשתך התקבלה. לא תקבל/י יותר הודעות שיווקיות ממסעדה זו.
      </p>
      <p style={{ ...bodyStyle, marginTop: '12px', fontSize: '13px', color: '#9ca3af' }}>
        ניתן לעדכן הגדרות הסכמה בכל עת דרך הצוות המסעדה.
      </p>
    </>
  );
}

function AlreadyUsed() {
  return (
    <>
      <Icon bg="#dbeafe" color="#2563eb">i</Icon>
      <h1 style={headingStyle}>כבר הוסרת</h1>
      <p style={bodyStyle}>קישור זה כבר שומש. הסרתך מרשימת התפוצה כבר בתוקף.</p>
    </>
  );
}

function Expired() {
  return (
    <>
      <Icon bg="#fef3c7" color="#d97706">!</Icon>
      <h1 style={headingStyle}>הקישור פג תוקף</h1>
      <p style={bodyStyle}>
        קישור ההסרה תקף ל-90 יום ופג תוקפו. לבקשת הסרה יש לפנות ישירות למסעדה.
      </p>
    </>
  );
}

function Invalid() {
  return (
    <>
      <Icon bg="#fee2e2" color="#dc2626">✕</Icon>
      <h1 style={headingStyle}>קישור לא תקין</h1>
      <p style={bodyStyle}>
        לא ניתן לאמת את קישור ההסרה. ייתכן שהועתק בצורה שגויה.
        לבקשת הסרה יש לפנות ישירות למסעדה.
      </p>
    </>
  );
}

function ServerError() {
  return (
    <>
      <Icon bg="#fee2e2" color="#dc2626">!</Icon>
      <h1 style={headingStyle}>שגיאה זמנית</h1>
      <p style={bodyStyle}>אירעה שגיאה פנימית. נסה/י שוב מאוחר יותר.</p>
    </>
  );
}

// ── Shared primitives ─────────────────────────────────────────────────────────

function Icon({ bg, color, children }: { bg: string; color: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        width:          '64px',
        height:         '64px',
        borderRadius:   '50%',
        background:     bg,
        color,
        fontSize:       '28px',
        fontWeight:     '700',
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        margin:         '0 auto 20px',
      }}
    >
      {children}
    </div>
  );
}

function Spinner() {
  return (
    <div
      style={{
        width:          '48px',
        height:         '48px',
        borderRadius:   '50%',
        border:         '3px solid #e5e7eb',
        borderTopColor: '#6366f1',
        animation:      'spin 0.8s linear infinite',
        margin:         '0 auto',
      }}
    />
  );
}

const headingStyle: React.CSSProperties = {
  fontSize:   '22px',
  fontWeight: '700',
  margin:     '0 0 12px',
  color:      '#111827',
};

const bodyStyle: React.CSSProperties = {
  fontSize:   '15px',
  lineHeight: '1.6',
  color:      '#4b5563',
  margin:     0,
};
