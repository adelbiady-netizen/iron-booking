import { useTranslation } from 'react-i18next';

export function useLocale() {
  const { i18n } = useTranslation();
  const locale = i18n.language as 'en' | 'he';
  const isRTL = locale === 'he';
  return {
    locale,
    isRTL,
    dir: (isRTL ? 'rtl' : 'ltr') as 'rtl' | 'ltr',
    intlLocale: isRTL ? 'he-IL' : 'en',
  };
}
