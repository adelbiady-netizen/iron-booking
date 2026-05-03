import { useTranslation } from 'react-i18next';

interface Props {
  variant?: 'dashboard' | 'public';
}

const LANGS = [
  { code: 'en' as const, label: 'EN' },
  { code: 'he' as const, label: 'עברית' },
];

export default function LanguageSwitcher({ variant = 'dashboard' }: Props) {
  const { i18n } = useTranslation();
  const current = i18n.language as 'en' | 'he';

  function select(lng: 'en' | 'he') {
    if (lng === current) return;
    i18n.changeLanguage(lng);
    const url = new URL(window.location.href);
    url.searchParams.set('lang', lng);
    window.history.replaceState(null, '', url.toString());
  }

  /* ── Dashboard segmented toggle ─────────────────────────────────────────── */
  if (variant === 'dashboard') {
    return (
      <div className="flex items-center rounded-md overflow-hidden shrink-0 border border-iron-border bg-iron-bg">
        {LANGS.map((lang, i) => {
          const active = current === lang.code;
          return (
            <button
              key={lang.code}
              onClick={() => select(lang.code)}
              className={[
                'text-[11px] font-medium tracking-wide transition-colors duration-150 select-none',
                'px-2.5 py-[5px]',
                i < LANGS.length - 1 ? 'border-r border-iron-border' : '',
                active
                  ? 'bg-iron-green/15 text-iron-green-light'
                  : 'text-iron-muted hover:text-iron-text hover:bg-iron-card',
              ].join(' ')}
            >
              {lang.label}
            </button>
          );
        })}
      </div>
    );
  }

  /* ── Public glass pill ───────────────────────────────────────────────────── */
  return (
    <div
      className="flex items-center rounded-full overflow-hidden"
      style={{
        background: 'rgba(0,0,0,0.40)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        border: '1px solid rgba(255,255,255,0.16)',
        boxShadow: '0 2px 12px rgba(0,0,0,0.30)',
      }}
    >
      {LANGS.map((lang, i) => {
        const active = current === lang.code;
        return (
          <button
            key={lang.code}
            onClick={() => select(lang.code)}
            className="text-[12px] font-medium tracking-wide transition-all duration-150 select-none"
            style={{
              padding: '6px 14px',
              color: active ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.40)',
              background: active ? 'rgba(255,255,255,0.16)' : 'transparent',
              borderRight: i < LANGS.length - 1
                ? '1px solid rgba(255,255,255,0.10)'
                : 'none',
            }}
          >
            {lang.label}
          </button>
        );
      })}
    </div>
  );
}
