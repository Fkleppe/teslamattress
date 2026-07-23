#!/usr/bin/env node
// build.js - Templates + locale JSON → dist/
// Usage: node scripts/build.js [--locales en,de,fr,no,da,sv]

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const TEMPLATE_DIR = path.join(ROOT, 'src', 'templates');
const LOCALE_DIR = path.join(ROOT, 'src', 'locales');
const DIST_DIR = path.join(ROOT, 'dist');
const PAGES = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'pages.json'), 'utf8'));
const BASE_URL = 'https://teslamattress.com';
const BUILD_DATE = process.env.BUILD_DATE_OVERRIDE || new Date().toISOString().slice(0, 10);
const VERSIONED_SHELL_ASSETS = [
  '/styles.css',
  '/guides/guides.css',
  '/reviews/review-page.css',
  '/vs/vs.css',
  '/discounts/discounts.css',
  '/discounts/brand-page.css',
  '/mobile-nav.js',
];
const SHELL_ASSET_VERSION = crypto.createHash('sha1')
  .update(VERSIONED_SHELL_ASSETS.map(asset => {
    const filePath = path.join(ROOT, asset.replace(/^\//, ''));
    return fs.existsSync(filePath) ? fs.readFileSync(filePath) : '';
  }).join('\0'))
  .digest('hex')
  .slice(0, 10);

// Honest per-page dates: {{buildDate}} / sitemap lastmod only advance when the
// page's rendered content actually changes (tracked by content hash).
// State is committed so dateModified survives across machines/CI.
const LASTMOD_PATH = path.join(ROOT, 'src', 'lastmod.json');
let lastmodState = {};
try { lastmodState = JSON.parse(fs.readFileSync(LASTMOD_PATH, 'utf8')); } catch (e) { /* first run */ }

function pageDateFor(locale, pageKey, htmlBeforeDate) {
  const key = `${locale}:${pageKey}`;
  const hash = crypto.createHash('sha1').update(htmlBeforeDate).digest('hex');
  const prev = lastmodState[key];
  if (prev && prev.hash === hash) return prev.date;
  lastmodState[key] = { hash, date: BUILD_DATE };
  return BUILD_DATE;
}

function saveLastmodState() {
  const sorted = {};
  for (const k of Object.keys(lastmodState).sort()) sorted[k] = lastmodState[k];
  fs.writeFileSync(LASTMOD_PATH, JSON.stringify(sorted, null, 2) + '\n', 'utf8');
}

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
const ALL_LOCALES = Object.keys(LOCALE_CONFIG).filter(l => l === 'en'); // English-only (other locales kept in config but not built; old locale URLs 301 → English via vercel.json)

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
  // Single-language site: hreflang is meaningless, omit it entirely.
  if (ALL_LOCALES.length <= 1) return '';
  const tags = ALL_LOCALES.map(loc => {
    const cfg = LOCALE_CONFIG[loc];
    const fp = `${cfg.locale_path}${pagePath}`.replace(/\/$/, '');
    const url = fp ? `${BASE_URL}/${fp}` : `${BASE_URL}/`;
    return `<link rel="alternate" hreflang="${cfg.hreflang}" href="${url}">`;
  });
  // x-default → English
  const xdef = pagePath ? `${BASE_URL}/${pagePath}` : `${BASE_URL}/`;
  tags.push(`<link rel="alternate" hreflang="x-default" href="${xdef}">`);
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
  // Single-language site: no switcher.
  if (ALL_LOCALES.length <= 1) return '';
  const cfg = LOCALE_CONFIG[currentLocale];
  const links = ALL_LOCALES.map(loc => {
    const lCfg = LOCALE_CONFIG[loc];
    const url = `/${lCfg.locale_path}${pagePath}`.replace(/\/$/, '') || '/';
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

// Fields whose values are rendered into HTML attributes (meta content="...",
// <title>, etc.) — never inside ld+json. A raw " or & in these breaks the
// attribute (e.g. inch marks 6'2" or a code "10" truncate the meta tag), so
// they must be HTML-escaped in the non-JSON pass.
const HTML_ATTR_FIELDS = new Set([
  'meta_title', 'meta_name_title', 'meta_description', 'meta_keywords',
  'og_title', 'og_description', 'twitter_title', 'twitter_description',
]);

function escapeHtmlAttr(value) {
  return String(value)
    .replace(/&(?![a-zA-Z#0-9]+;)/g, '&amp;') // bare & only (don't double-encode entities)
    .replace(/"/g, '&quot;');
}

// Replace all {{t.section.key}} placeholders.
// When escapeJson is true, values are JSON-string-escaped so they remain
// valid inside a <script type="application/ld+json"> block (e.g. inch marks
// like 7.5" or codes like "10" would otherwise break the JSON).
function replaceTranslations(html, localeData, pageKey, fallbackData, escapeJson = false) {
  const out = (value, key) => {
    if (escapeJson) return JSON.stringify(value).slice(1, -1);
    if (HTML_ATTR_FIELDS.has(key)) return escapeHtmlAttr(value);
    return value;
  };
  return html.replace(/\{\{t\.([a-zA-Z0-9_]+)\.([a-zA-Z0-9_&+'"(). -]+)\}\}/g, (match, section, key) => {
    if (localeData[section] && localeData[section][key] !== undefined) {
      return out(localeData[section][key], key);
    }
    if (fallbackData && fallbackData[section] && fallbackData[section][key] !== undefined) {
      return out(fallbackData[section][key], key);
    }
    console.warn(`    Missing: ${section}.${key}`);
    return match;
  });
}

// Run translation substitution, JSON-escaping values inside ld+json blocks
// and substituting raw everywhere else.
function replaceTranslationsContextAware(html, localeData, pageKey, fallbackData) {
  // First pass: escape values inside JSON-LD script blocks.
  html = html.replace(
    /(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/g,
    (full, open, body, close) =>
      open + replaceTranslations(body, localeData, pageKey, fallbackData, true) + close
  );
  // Second pass: substitute remaining placeholders (outside ld+json) raw.
  return replaceTranslations(html, localeData, pageKey, fallbackData, false);
}

// Keep the responsive shell consistent across every template. Several older
// templates predate notched phones and each carried its own menu script; the
// shared controller below progressively upgrades those pages after parsing.
function enhancePageShell(html) {
  html = html.replace(
    /<meta name="viewport" content="width=device-width, initial-scale=1\.0">/,
    '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">'
  );

  for (const asset of VERSIONED_SHELL_ASSETS.filter(item => item.endsWith('.css'))) {
    html = html.replaceAll(`"${asset}"`, `"${asset}?v=${SHELL_ASSET_VERSION}"`);
  }

  if (!html.includes('/mobile-nav.js')) {
    html = html.replace(
      '</body>',
      `    <script src="/mobile-nav.js?v=${SHELL_ASSET_VERSION}" defer></script>\n</body>`
    );
  }

  return html;
}

// Build a single page for a single locale
function buildPage(page, locale, localeData, fallbackData) {
  const templatePath = path.join(TEMPLATE_DIR, page.template);
  if (!fs.existsSync(templatePath)) {
    console.warn(`  Template not found: ${page.template}`);
    return;
  }

  let html = fs.readFileSync(templatePath, 'utf8');
  const cfg = LOCALE_CONFIG[locale];
  const pagePath = page.output.replace(/index\.html$/, '').replace(/\.html$/, '').replace(/\/$/, '');

  // 1. Structural placeholders ({{buildDate}} is resolved LAST — see step 3 —
  // so the content hash for honest lastmod excludes date churn)
  html = html.replace(/\{\{htmlLang\}\}/g, cfg.html_lang);
  html = html.replace(/\{\{ogLocale\}\}/g, cfg.og_locale);
  html = html.replace(/\{\{localePath\}\}/g, cfg.locale_path);
  const localeHome = cfg.locale_path ? `/${cfg.locale_path.replace(/\/$/, '')}` : '/';
  html = html.replace(/\{\{localeHome\}\}/g, localeHome);
  // Build full URL and strip trailing slash (except for root /)
  const fullPath = `${cfg.locale_path}${pagePath}`.replace(/\/$/, '');
  const fullUrl = fullPath ? `${BASE_URL}/${fullPath}` : `${BASE_URL}/`;
  html = html.replace(/\{\{canonicalUrl\}\}/g, fullUrl);
  html = html.replace(/\{\{pageUrl\}\}/g, fullUrl);
  // Content data stores absolute image URLs for metadata/JSON-LD. Derive the
  // same-origin root-relative path for visible <img> elements so preview and
  // production do not hotlink the deployed site back to itself.
  const pageImage = localeData[page.pageKey] && localeData[page.pageKey].image_path;
  const pageImageRelative = typeof pageImage === 'string' && pageImage.startsWith(BASE_URL)
    ? pageImage.slice(BASE_URL.length)
    : (pageImage || '');
  html = html.replace(/\{\{pageImageRelative\}\}/g, pageImageRelative);
  html = html.replace(/\{\{hreflangTags\}\}/g, generateHreflangTags(pagePath));
  html = html.replace(/\{\{ogLocaleAlternates\}\}/g, generateOgLocaleAlternates(locale));
  html = html.replace(/\{\{langSwitcher\}\}/g, generateLangSwitcher(pagePath, locale));

  // Allow shared templates to use t.PAGEKEY.* — substitute literal token before translation pass
  html = html.replace(/\bt\.PAGEKEY\./g, `t.${page.pageKey}.`);

  // 2. Translation placeholders (JSON-escaped inside ld+json blocks)
  html = replaceTranslationsContextAware(html, localeData, page.pageKey, fallbackData);

  // 2b. Shared responsive viewport and accessible mobile navigation.
  html = enhancePageShell(html);

  // 3. Honest date: hash content with {{buildDate}} still unresolved, then
  // stamp the page with its last-actual-change date
  const pageDate = pageDateFor(locale, page.pageKey, html);
  const buildDateHuman = new Intl.DateTimeFormat(cfg.html_lang, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(`${pageDate}T12:00:00Z`));
  html = html.replace(/\{\{buildDateHuman\}\}/g, buildDateHuman);
  html = html.replace(/\{\{buildDate\}\}/g, pageDate);

  // 4. Write output
  const outputPath = path.join(DIST_DIR, cfg.locale_path, page.output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, html, 'utf8');
}

// Pages to exclude from sitemap (noindex)
const NOINDEX_PAGES = new Set(['disclosure']);

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Generate sitemap.xml
function generateSitemap(locales) {
  let urls = '';
  const today = new Date().toISOString().split('T')[0];
  const sitemapLocales = Object.keys(locales);
  const hasAlternates = sitemapLocales.length > 1;

  for (const page of PAGES) {
    if (NOINDEX_PAGES.has(page.pageKey)) continue;
    const pagePath = page.output.replace(/index\.html$/, '').replace(/\.html$/, '').replace(/\/$/, '');

    for (const loc of sitemapLocales) {
      const cfg = LOCALE_CONFIG[loc];
      // Build URL, strip trailing slash (except root /)
      const fp = `${cfg.locale_path}${pagePath}`.replace(/\/$/, '');
      const url = fp ? `${BASE_URL}/${fp}` : `${BASE_URL}/`;

      // Hreflang xhtml:link entries (omitted entirely for single-locale builds —
      // self-referencing alternates are meaningless noise)
      let alternates = '';
      if (hasAlternates) {
        const hreflangs = sitemapLocales.map(l => {
          const lCfg = LOCALE_CONFIG[l];
          const lfp = `${lCfg.locale_path}${pagePath}`.replace(/\/$/, '');
          const lurl = lfp ? `${BASE_URL}/${lfp}` : `${BASE_URL}/`;
          return `      <xhtml:link rel="alternate" hreflang="${lCfg.hreflang}" href="${escapeXml(lurl)}"/>`;
        }).join('\n');
        const xdefFp = pagePath || '';
        const xdefaultUrl = xdefFp ? `${BASE_URL}/${xdefFp}` : `${BASE_URL}/`;
        const xdefault = `      <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(xdefaultUrl)}"/>`;
        alternates = `\n${hreflangs}\n${xdefault}`;
      }

      // Honest lastmod: the date this page's content last actually changed
      const lastmod = (lastmodState[`${loc}:${page.pageKey}`] || {}).date || today;

      urls += `  <url>
    <loc>${escapeXml(url)}</loc>
    <lastmod>${lastmod}</lastmod>${alternates}
  </url>\n`;
    }
  }

  const xhtmlNamespace = hasAlternates
    ? '\n        xmlns:xhtml="http://www.w3.org/1999/xhtml"'
    : '';
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${xhtmlNamespace}>
${urls}</urlset>`;

  fs.writeFileSync(path.join(DIST_DIR, 'sitemap.xml'), sitemap, 'utf8');
}

// Copy static files to dist
function copyStaticFiles() {
  const staticFiles = [
    'styles.css',
    'robots.txt',
    'llms.txt',
    'favicon.svg',
    'favicon.ico',
    'apple-touch-icon.png',
    'icon-192.png',
    'icon-512.png',
    'site.webmanifest',
    'mobile-nav.js',
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
      if (file.endsWith('.css')) {
        // Minify CSS: remove comments, extra whitespace, newlines
        let css = fs.readFileSync(src, 'utf-8');
        css = css
          .replace(/\/\*[\s\S]*?\*\//g, '')     // remove comments
          .replace(/\s+/g, ' ')                   // collapse whitespace
          .replace(/\s*([{}:;,>~+])\s*/g, '$1')  // remove space around selectors
          .replace(/;}/g, '}')                    // remove last semicolon
          .trim();
        fs.writeFileSync(dest, css);
      } else {
        fs.copyFileSync(src, dest);
      }
    }
  }

  // Copy 404 page (root, English) — resolve placeholders so no raw {{...}} ships
  const src404 = path.join(ROOT, 'src', 'templates', '404.html');
  if (fs.existsSync(src404)) {
    let html404 = fs.readFileSync(src404, 'utf8');
    html404 = html404.replace(/\{\{localeHome\}\}/g, '/');
    html404 = enhancePageShell(html404);
    fs.writeFileSync(path.join(DIST_DIR, '404.html'), html404);
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
    buildPage(page, locale, locales[locale], locale === 'en' ? null : locales.en);
    pageCount++;
  }
}

// Copy static files
console.log('\n  Copying static files...');
copyStaticFiles();

// Generate sitemap
console.log('  Generating sitemap.xml...');
generateSitemap(locales);

// Persist honest per-page lastmod state (committed — see LASTMOD_PATH)
saveLastmodState();

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
