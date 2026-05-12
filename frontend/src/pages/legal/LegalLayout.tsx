import { useEffect, useState } from 'react';
import { useLocale } from '../../i18n/useLocale';
import LanguageSwitcher from '../../components/LanguageSwitcher';
import { PublicFooter } from '../../components/PublicFooter';

interface Props {
  children: (isHebrew: boolean) => React.ReactNode;
  titleEn: string;
  titleHe: string;
}

export function LegalLayout({ children, titleEn, titleHe }: Props) {
  const { dir, locale } = useLocale();
  const isHebrew = locale === 'he';
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const t = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(t);
  }, []);

  useEffect(() => {
    document.title = `${isHebrew ? titleHe : titleEn} · Iron Booking`;
  }, [isHebrew, titleEn, titleHe]);

  return (
    <div
      dir={dir}
      className="relative min-h-screen flex flex-col items-center"
      style={{ paddingBottom: 'clamp(24px, 5vh, 64px)' }}
    >
      {/* Atmospheric background */}
      <div className="pub-atm-base" />
      <div className="pub-atm-vignette" />

      {/* Language switcher */}
      <div className="fixed top-4 right-4 z-50">
        <LanguageSwitcher variant="public" />
      </div>

      {/* Back link */}
      <div
        className="w-full max-w-[700px] px-5 pt-6 pb-0"
        style={{
          opacity: mounted ? 1 : 0,
          transform: mounted ? 'none' : 'translateY(6px)',
          transition: 'opacity 300ms ease, transform 300ms ease',
        }}
      >
        <a
          href="/"
          className="pub-footer-link inline-flex items-center gap-1.5 text-[12px]"
          style={{ color: 'rgba(255,255,255,0.32)' }}
        >
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="currentColor" aria-hidden="true">
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
          </svg>
          {isHebrew ? 'חזרה לאתר' : 'Back'}
        </a>
      </div>

      {/* Content */}
      <div
        className="w-full max-w-[700px] px-4 pt-6"
        style={{
          opacity: mounted ? 1 : 0,
          transform: mounted ? 'none' : 'translateY(10px)',
          transition: 'opacity 400ms ease 60ms, transform 400ms ease 60ms',
        }}
      >
        <article className="pub-legal-article">
          {children(isHebrew)}
        </article>
      </div>

      <PublicFooter />
    </div>
  );
}

// ─── Shared sub-components ────────────────────────────────────────────────────

export function LegalH1({ children }: { children: React.ReactNode }) {
  return <h1 className="pub-legal-h1">{children}</h1>;
}

export function LegalUpdated({ children }: { children: React.ReactNode }) {
  return <p className="pub-legal-updated">{children}</p>;
}

export function LegalDisclaimer({ isHebrew }: { isHebrew: boolean }) {
  return (
    <div className="pub-legal-disclaimer" role="note">
      {isHebrew
        ? 'גרסה 1 — מסמך זה הוא גרסה ראשונה של המדיניות ויש לאשרו על ידי יועץ משפטי לפני הסתמכות עליו.'
        : 'Version 1 — This is a first-draft policy document and should be reviewed by a qualified legal professional before being relied upon.'}
    </div>
  );
}

export function LegalSection({ id, title }: { id: string; title: string }) {
  return <h2 id={id} className="pub-legal-h2">{title}</h2>;
}

export function LegalP({ children }: { children: React.ReactNode }) {
  return <p className="pub-legal-p">{children}</p>;
}

export function LegalUl({ items }: { items: (string | React.ReactNode)[] }) {
  return (
    <ul className="pub-legal-ul" role="list">
      {items.map((item, i) => <li key={i}>{item}</li>)}
    </ul>
  );
}

export function LegalA({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} className="pub-legal-a" target={href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer">
      {children}
    </a>
  );
}

export function LegalDivider() {
  return <hr className="pub-legal-divider" aria-hidden="true" />;
}
