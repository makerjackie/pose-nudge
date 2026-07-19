import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const localeRoot = path.join(root, 'src', 'locales');
const supportedLocales = ['en', 'zh', 'zh-Hant', 'ja', 'ko', 'tr'];
const hangulPattern = /[\uac00-\ud7af]/u;

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  }));
  return nested.flat();
}

function flatten(value, prefix = '', result = new Map()) {
  for (const [key, child] of Object.entries(value)) {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      flatten(child, nextKey, result);
    } else {
      result.set(nextKey, String(child));
    }
  }
  return result;
}

function mergeLocales(base, override) {
  return Object.fromEntries([...new Set([...Object.keys(base), ...Object.keys(override)])].map((key) => {
    const baseValue = base[key];
    const overrideValue = override[key];
    if (baseValue && overrideValue && typeof baseValue === 'object' && typeof overrideValue === 'object') {
      return [key, mergeLocales(baseValue, overrideValue)];
    }
    return [key, overrideValue ?? baseValue];
  }));
}

const localeObjects = Object.fromEntries(await Promise.all(supportedLocales.map(async (locale) => {
  const source = await readFile(path.join(localeRoot, locale, 'translation.json'), 'utf8');
  return [locale, JSON.parse(source)];
})));

const runtimeLocales = {
  ...localeObjects,
  'zh-Hant': mergeLocales(localeObjects.zh, localeObjects['zh-Hant']),
};

const sourceFiles = (await walk(path.join(root, 'src')))
  .filter((file) => /\.(ts|tsx)$/u.test(file));
const translationKeyPattern = /\bt\(\s*['"]([^'"]+)['"]/gu;
const translationKeys = new Set();

for (const file of sourceFiles) {
  const source = await readFile(file, 'utf8');
  for (const match of source.matchAll(translationKeyPattern)) {
    translationKeys.add(match[1]);
  }
}

const failures = [];
for (const locale of supportedLocales) {
  const entries = flatten(runtimeLocales[locale]);
  const missing = [...translationKeys].filter((key) => !entries.has(key));
  if (missing.length > 0) {
    failures.push(`${locale}: missing ${missing.join(', ')}`);
  }
}

for (const locale of ['zh', 'zh-Hant']) {
  const leaked = [...flatten(runtimeLocales[locale])]
    .filter(([, value]) => hangulPattern.test(value))
    .map(([key]) => key);
  if (leaked.length > 0) {
    failures.push(`${locale}: Hangul leaked into ${leaked.join(', ')}`);
  }
}

const nonKoreanRuntimeFiles = [
  ...sourceFiles,
  ...(await walk(path.join(root, 'src-tauri', 'src'))).filter((file) => file.endsWith('.rs')),
  path.join(root, 'src-tauri', 'Info.plist'),
];

for (const file of nonKoreanRuntimeFiles) {
  const source = await readFile(file, 'utf8');
  if (hangulPattern.test(source)) {
    failures.push(`${path.relative(root, file)}: contains Hangul outside the Korean locale`);
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Localization check passed: ${translationKeys.size} static keys across ${supportedLocales.length} locales; Chinese runtime contains no Hangul.`);
