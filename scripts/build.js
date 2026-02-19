#!/usr/bin/env node
// build.js - Templates + locale JSON → dist/
// Usage: node scripts/build.js [--locales en,de,fr,no,da,sv]

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TEMPLATE_DIR = path.join(ROOT, 'src', 'templates');
const LOCALE_DIR = path.join(ROOT, 'src', 'locales');
const DIST_DIR = path.join(ROOT, 'dist');
const PAGES = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'pages.json'), 'utf8'));
const BASE_URL = 'https://teslamattress.com';

// Parse CLI args
const args = process.argv.slice(2);
let selectedLocales = null;
const localesIdx = args.indexOf('--locales');
if (localesIdx !== -1 && args[localesIdx + 1]) {
  selectedLocales = args[localesIdx + 1].split(',');
}

// Locale config (used for structural placeholders)
const LOCALE_CONFIG = {
  en: { locale_path: '', og_locale: 'en_US', html_lang: 'en', hreflang: 'en', flag: '🇬🇧', name: 'English' },
  de: { locale_path: 'de/', og_locale: 'de_DE', html_lang: 'de', hreflang: 'de', flag: '🇩🇪', name: 'Deutsch' },
  fr: { locale_path: 'fr/', og_locale: 'fr_FR', html_lang: 'fr', hreflang: 'fr', flag: '🇫🇷', name: 'Français' },
  no: { locale_path: 'no/', og_locale: 'nb_NO', html_lang: 'nb', hreflang: 'nb', flag: '🇳🇴', name: 'Norsk' },
  da: { locale_path: 'da/', og_locale: 'da_DK', html_lang: 'da', hreflang: 'da', flag: '🇩🇰', name: 'Dansk' },
  sv: { locale_path: 'sv/', og_locale: 'sv_SE', html_lang: 'sv', hreflang: 'sv', flag: '🇸🇪', name: 'Svenska' },
};
const ALL_LOCALES = Object.keys(LOCALE_CONFIG);

// Load locale files
function loadLocales() {
  const locales = {};
  const toLoad = selectedLocales || ALL_LOCALES;

  for (const loc of toLoad) {
    const filePath = path.join(LOCALE_DIR, `${loc}.json`);
    if (!fs.existsSync(filePath)) {
      console.warn(`  Warning: ${loc}.json not found, skipping locale`);
      continue;
    }
    locales[loc] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }

  return locales;
}

// Generate hreflang link tags for a page
function generateHreflangTags(pagePath) {
  const tags = ALL_LOCALES.map(loc => {
    const cfg = LOCALE_CONFIG[loc];
    const url = `${BASE_URL}/${cfg.locale_path}${pagePath}`;
    return `<link rel="alternate" hreflang="${cfg.hreflang}" href="${url}">`;
  });
  // x-default → English
  tags.push(`<link rel="alternate" hreflang="x-default" href="${BASE_URL}/${pagePath}">`);
  return tags.join('\n    ');
}

// Generate og:locale:alternate meta tags
function generateOgLocaleAlternates(currentLocale) {
  return ALL_LOCALES
    .filter(loc => loc !== currentLocale)
    .map(loc => `<meta property="og:locale:alternate" content="${LOCALE_CONFIG[loc].og_locale}">`)
    .join('\n    ');
}

// Generate language switcher HTML
function generateLangSwitcher(pagePath, currentLocale) {
  const cfg = LOCALE_CONFIG[currentLocale];
  const links = ALL_LOCALES.map(loc => {
    const lCfg = LOCALE_CONFIG[loc];
    const url = `/${lCfg.locale_path}${pagePath}`;
    const active = loc === currentLocale ? ' class="lang-active"' : '';
    return `<li><a href="${url}"${active}>${lCfg.flag} ${lCfg.name}</a></li>`;
  }).join('\n            ');

  return `<div class="lang-switcher">
        <button class="lang-current" aria-label="Language">${cfg.flag} ${cfg.html_lang.toUpperCase()} ▾</button>
        <ul class="lang-dropdown">
            ${links}
        </ul>
    </div>`;
}

// Replace all {{t.section.key}} placeholders
function replaceTranslations(html, localeData, pageKey) {
  return html.replace(/\{\{t\.([a-zA-Z0-9_]+)\.([a-zA-Z0-9_&+'"(). -]+)\}\}/g, (match, section, key) => {
    // Look up in locale data
    if (localeData[section] && localeData[section][key] !== undefined) {
      return localeData[section][key];
    }
    // Fallback: leave placeholder (verify.js will catch this)
    console.warn(`    Missing: ${section}.${key}`);
    return match;
  });
}

// Build a single page for a single locale
function buildPage(page, locale, localeData) {
  const templatePath = path.join(TEMPLATE_DIR, page.template);
  if (!fs.existsSync(templatePath)) {
    console.warn(`  Template not found: ${page.template}`);
    return;
  }

  let html = fs.readFileSync(templatePath, 'utf8');
  const cfg = LOCALE_CONFIG[locale];
  const pagePath = page.output.replace(/index\.html$/, '').replace(/\.html$/, '');

  // 1. Structural placeholders
  html = html.replace(/\{\{htmlLang\}\}/g, cfg.html_lang);
  html = html.replace(/\{\{ogLocale\}\}/g, cfg.og_locale);
  html = html.replace(/\{\{localePath\}\}/g, cfg.locale_path);
  html = html.replace(/\{\{canonicalUrl\}\}/g, `${BASE_URL}/${cfg.locale_path}${pagePath}`);
  html = html.replace(/\{\{pageUrl\}\}/g, `${BASE_URL}/${cfg.locale_path}${pagePath}`);
  html = html.replace(/\{\{hreflangTags\}\}/g, generateHreflangTags(pagePath));
  html = html.replace(/\{\{ogLocaleAlternates\}\}/g, generateOgLocaleAlternates(locale));
  html = html.replace(/\{\{langSwitcher\}\}/g, generateLangSwitcher(pagePath, locale));

  // 2. Translation placeholders
  html = replaceTranslations(html, localeData, page.pageKey);

  // 3. Write output
  const outputPath = path.join(DIST_DIR, cfg.locale_path, page.output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, html, 'utf8');
}

// Generate sitemap.xml
function generateSitemap(locales) {
  let urls = '';
  const today = new Date().toISOString().split('T')[0];

  for (const page of PAGES) {
    const pagePath = page.output.replace(/index\.html$/, '').replace(/\.html$/, '');

    for (const loc of Object.keys(locales)) {
      const cfg = LOCALE_CONFIG[loc];
      const url = `${BASE_URL}/${cfg.locale_path}${pagePath}`;

      // Priority: home=1.0, index pages=0.8, others=0.6
      let priority = '0.6';
      if (page.pageKey === 'home') priority = '1.0';
      else if (page.output.endsWith('index.html')) priority = '0.8';

      // Skip disclosure from high priority
      if (page.pageKey === 'disclosure') priority = '0.3';

      // Changefreq: home/hub pages weekly, others monthly
      const changefreq = (page.pageKey === 'home' || page.output.endsWith('index.html')) ? 'weekly' : 'monthly';

      // Hreflang xhtml:link entries
      const hreflangs = ALL_LOCALES.map(l => {
        const lCfg = LOCALE_CONFIG[l];
        return `      <xhtml:link rel="alternate" hreflang="${lCfg.hreflang}" href="${BASE_URL}/${lCfg.locale_path}${pagePath}"/>`;
      }).join('\n');

      const xdefault = `      <xhtml:link rel="alternate" hreflang="x-default" href="${BASE_URL}/${pagePath}"/>`;

      urls += `  <url>
    <loc>${url}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
${hreflangs}
${xdefault}
  </url>\n`;
    }
  }

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}</urlset>`;

  fs.writeFileSync(path.join(DIST_DIR, 'sitemap.xml'), sitemap, 'utf8');
}

// Copy static files to dist
function copyStaticFiles() {
  const staticFiles = [
    'styles.css',
    'robots.txt',
    'favicon.svg',
    'apple-touch-icon.png',
    'reviews/review-page.css',
    'vs/vs.css',
    'discounts/discounts.css',
    'discounts/brand-page.css',
    'guides/guides.css',
  ];

  for (const file of staticFiles) {
    const src = path.join(ROOT, file);
    const dest = path.join(DIST_DIR, file);
    if (fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
  }

  // Copy images directory
  const imgSrc = path.join(ROOT, 'images');
  const imgDest = path.join(DIST_DIR, 'images');
  if (fs.existsSync(imgSrc)) {
    fs.mkdirSync(imgDest, { recursive: true });
    for (const file of fs.readdirSync(imgSrc)) {
      fs.copyFileSync(path.join(imgSrc, file), path.join(imgDest, file));
    }
  }
}

// ============================================================
// Main
// ============================================================
console.log('Building multilingual site...\n');

// Clean dist
if (fs.existsSync(DIST_DIR)) {
  fs.rmSync(DIST_DIR, { recursive: true });
}
fs.mkdirSync(DIST_DIR, { recursive: true });

// Load locales
const locales = loadLocales();
const localeKeys = Object.keys(locales);
console.log(`  Locales: ${localeKeys.join(', ')}`);
console.log(`  Pages: ${PAGES.length}`);

// Build all pages for all locales
let pageCount = 0;
for (const locale of localeKeys) {
  console.log(`\n  Building ${locale}...`);
  for (const page of PAGES) {
    buildPage(page, locale, locales[locale]);
    pageCount++;
  }
}

// Copy static files
console.log('\n  Copying static files...');
copyStaticFiles();

// Generate sitemap
console.log('  Generating sitemap.xml...');
generateSitemap(locales);

// Update robots.txt with new sitemap URL
const robotsPath = path.join(DIST_DIR, 'robots.txt');
if (fs.existsSync(robotsPath)) {
  let robots = fs.readFileSync(robotsPath, 'utf8');
  if (!robots.includes('Sitemap:')) {
    robots += `\nSitemap: ${BASE_URL}/sitemap.xml\n`;
    fs.writeFileSync(robotsPath, robots, 'utf8');
  }
}

console.log(`\nDone! Built ${pageCount} pages.`);
console.log(`  Output: dist/`);
