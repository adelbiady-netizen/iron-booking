import { useTranslation } from 'react-i18next';
import { T } from '../strings';
import { THe } from './strings-he';

export function useT() {
  const { i18n } = useTranslation();
  return i18n.language === 'he' ? THe : T;
}
