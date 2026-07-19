import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import translationEN from './locales/en/translation.json';
import translationKO from './locales/ko/translation.json';
import translationJA from './locales/ja/translation.json';
import translationZH from './locales/zh/translation.json';
import translationZHHant from './locales/zh-Hant/translation.json';
import translationTR from './locales/tr/translation.json';

const LANGUAGE_KEY = 'pose_nudge_language';
const SUPPORTED_LANGUAGES = ['en', 'ko', 'ja', 'zh', 'zh-Hant', 'zh-TW', 'zh-HK', 'tr'];
const traditionalChinese = {
  ...translationZH,
  ...translationZHHant,
  app: { ...translationZH.app, ...translationZHHant.app },
  nav: { ...translationZH.nav, ...translationZHHant.nav },
  shell: { ...translationZH.shell, ...translationZHHant.shell },
  dashboard: { ...translationZH.dashboard, ...translationZHHant.dashboard },
  about: { ...translationZH.about, ...translationZHHant.about },
  settings: { ...translationZH.settings, ...translationZHHant.settings },
  webcam: { ...translationZH.webcam, ...translationZHHant.webcam },
  reminder: { ...translationZH.reminder, ...translationZHHant.reminder },
};

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
  'zh-Hant': {
    translation: traditionalChinese,
  },
  'zh-TW': {
    translation: traditionalChinese,
  },
  'zh-HK': {
    translation: traditionalChinese,
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
    nonExplicitSupportedLngs: false,
    load: 'currentOnly',
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
