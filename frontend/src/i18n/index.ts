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

const initialLocale = detectInitialLocale();

// Apply direction to <html> synchronously so it's set before React renders.
document.documentElement.dir  = initialLocale === 'he' ? 'rtl' : 'ltr';
document.documentElement.lang = initialLocale;

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      he: { translation: he },
    },
    lng: initialLocale,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    // Force synchronous init when resources are bundled — prevents a first-render
    // tick where i18n.language is undefined and dir/RTL flags are wrong.
    initAsync: false,
  });

// Keep <html> dir/lang in sync if the language is changed at runtime.
i18n.on('languageChanged', (lng) => {
  document.documentElement.dir  = lng === 'he' ? 'rtl' : 'ltr';
  document.documentElement.lang = lng;
});

export default i18n;
