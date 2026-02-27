import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import translationEN from './locales/en/translation.json';
import translationKO from './locales/ko/translation.json';
import translationJA from './locales/ja/translation.json';
import translationZH from './locales/zh/translation.json';
import translationTR from './locales/tr/translation.json';

const LANGUAGE_KEY = 'pose_nudge_language';
const SUPPORTED_LANGUAGES = ['en', 'ko', 'ja', 'zh', 'tr'];

const resources = {
  en: {
    translation: translationEN,
  },
  ko: {
    translation: translationKO,
  },
  ja: {
    translation: translationJA,
  },
  zh: {
    translation: translationZH,
  },
  tr: {
    translation: translationTR,
  },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    supportedLngs: SUPPORTED_LANGUAGES,
    nonExplicitSupportedLngs: true,
    load: 'languageOnly',
    fallbackLng: 'en',
    debug: false,
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: LANGUAGE_KEY,
      caches: ['localStorage'],
    },
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
