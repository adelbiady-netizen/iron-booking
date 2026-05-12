import { useTranslation } from 'react-i18next';

// Active legal links. Uncomment future entries when policy pages are published.
const LINKS = [
  { key: 'privacy',       href: 'https://www.ironbooking.com/privacy' },
  { key: 'terms',         href: 'https://www.ironbooking.com/terms' },
  { key: 'accessibility', href: 'https://www.ironbooking.com/accessibility' },
  { key: 'contact',       href: 'https://www.ironbooking.com/contact' },
  // { key: 'cookie',       href: 'https://www.ironbooking.com/cookie-policy' },
  // { key: 'cancellation', href: 'https://www.ironbooking.com/cancellation-policy' },
  // { key: 'noShow',       href: 'https://www.ironbooking.com/no-show-policy' },
] as const;

export function PublicFooter({ visible = true }: { visible?: boolean }) {
  const { t } = useTranslation();
  const year = new Date().getFullYear();
  if (!visible) return null;

  return (
    <footer className="pub-footer" aria-label="Iron Booking">
      {/* Visual connector — gradient hairline */}
      <div className="pub-footer-sep" aria-hidden="true" />

      {/* Wordmark */}
      <p className="pub-footer-brand" aria-label="Iron Booking">
        <span className="pub-footer-diamond" aria-hidden="true">◆</span>
        IRON BOOKING
      </p>

      {/* Legal nav */}
      <nav aria-label={t('footer.navLabel')}>
        <ul className="pub-footer-links" role="list">
          {LINKS.map(l => (
            <li key={l.key}>
              <a
                href={l.href}
                className="pub-footer-link"
                target="_blank"
                rel="noopener noreferrer"
              >
                {t(`footer.${l.key}`)}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {/* Copyright */}
      <p className="pub-footer-copy">{t('footer.copyright', { year })}</p>
    </footer>
  );
}
