import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import he from './locales/he.json';

function detectInitialLocale(): 'en' | 'he' {
  const params = new URLSearchParams(window.location.search);
  const lang = params.get('lang');
  if (lang === 'he') return 'he';
  if (lang === 'en') return 'en';
  if (navigator.language.startsWith('he')) return 'he';
  return 'en';
}

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      he: { translation: he },
    },
    lng: detectInitialLocale(),
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });

export default i18n;
