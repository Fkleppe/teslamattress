#!/usr/bin/env node
// verify.js - Pre-deploy validation for multilingual build
// Usage: node scripts/verify.js

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');
const PAGES = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'pages.json'), 'utf8'));
const BASE_URL = 'https://teslamattress.com';

// Parse CLI args
const cliArgs = process.argv.slice(2);
const localesIdx = cliArgs.indexOf('--locales');
const LOCALES = (localesIdx !== -1 && cliArgs[localesIdx + 1])
  ? cliArgs[localesIdx + 1].split(',')
  : ['en', 'de', 'fr', 'no', 'da', 'sv'];
const LOCALE_PATHS = { en: '', de: 'de/', fr: 'fr/', no: 'no/', da: 'da/', sv: 'sv/' };
const HTML_LANGS = { en: 'en', de: 'de', fr: 'fr', no: 'nb', da: 'da', sv: 'sv' };

let errors = 0;
let warnings = 0;

function error(msg) { errors++; console.error(`  ERROR: ${msg}`); }
function warn(msg) { warnings++; console.warn(`  WARN:  ${msg}`); }
function pass(msg) { console.log(`  PASS:  ${msg}`); }

// ============================================================
// Check 1: All locale dirs have expected HTML files
// ============================================================
function checkFileCount() {
  console.log('\n--- File count per locale ---');

  for (const loc of LOCALES) {
    const locPath = loc === 'en' ? DIST_DIR : path.join(DIST_DIR, LOCALE_PATHS[loc]);
    let count = 0;

    for (const page of PAGES) {
      const filePath = path.join(locPath, page.output);
      if (fs.existsSync(filePath)) {
        count++;
      } else {
        error(`Missing: ${LOCALE_PATHS[loc]}${page.output}`);
      }
    }

    if (count === PAGES.length) {
      pass(`${loc}: ${count}/${PAGES.length} files`);
    }
  }
}

// ============================================================
// Check 2: No remaining {{t.}} placeholders
// ============================================================
function checkPlaceholders() {
  console.log('\n--- Unresolved placeholders ---');

  let found = 0;
  for (const loc of LOCALES) {
    const locPath = loc === 'en' ? DIST_DIR : path.join(DIST_DIR, LOCALE_PATHS[loc]);

    for (const page of PAGES) {
      const filePath = path.join(locPath, page.output);
      if (!fs.existsSync(filePath)) continue;

      const html = fs.readFileSync(filePath, 'utf8');
      const matches = html.match(/\{\{t\.[^}]+\}\}/g);
      if (matches) {
        found += matches.length;
        error(`${LOCALE_PATHS[loc]}${page.output}: ${matches.length} unresolved (${matches.slice(0, 3).join(', ')})`);
      }
    }
  }

  if (found === 0) pass('No unresolved {{t.}} placeholders');
}

// ============================================================
// Check 3: No "undefined" strings in output
// ============================================================
function checkUndefined() {
  console.log('\n--- Undefined strings ---');

  let found = 0;
  for (const loc of LOCALES) {
    const locPath = loc === 'en' ? DIST_DIR : path.join(DIST_DIR, LOCALE_PATHS[loc]);

    for (const page of PAGES) {
      const filePath = path.join(locPath, page.output);
      if (!fs.existsSync(filePath)) continue;

      const html = fs.readFileSync(filePath, 'utf8');
      // Check for literal "undefined" in content attributes or text
      const matches = html.match(/content="undefined"|>undefined</g);
      if (matches) {
        found += matches.length;
        error(`${LOCALE_PATHS[loc]}${page.output}: ${matches.length} "undefined" occurrences`);
      }
    }
  }

  if (found === 0) pass('No "undefined" strings found');
}

// ============================================================
// Check 4: html lang attribute matches locale
// ============================================================
function checkHtmlLang() {
  console.log('\n--- html lang attribute ---');

  let ok = 0;
  for (const loc of LOCALES) {
    const locPath = loc === 'en' ? DIST_DIR : path.join(DIST_DIR, LOCALE_PATHS[loc]);
    const expectedLang = HTML_LANGS[loc];

    for (const page of PAGES) {
      const filePath = path.join(locPath, page.output);
      if (!fs.existsSync(filePath)) continue;

      const html = fs.readFileSync(filePath, 'utf8');
      const langMatch = html.match(/<html lang="([^"]+)">/);
      if (!langMatch) {
        error(`${LOCALE_PATHS[loc]}${page.output}: missing <html lang>`);
      } else if (langMatch[1] !== expectedLang) {
        error(`${LOCALE_PATHS[loc]}${page.output}: lang="${langMatch[1]}" expected "${expectedLang}"`);
      } else {
        ok++;
      }
    }
  }

  pass(`${ok} files have correct html lang`);
}

// ============================================================
// Check 5: Hreflang tags present and reference all locales
// ============================================================
function checkHreflang() {
  console.log('\n--- Hreflang tags ---');

  let ok = 0;
  let issues = 0;

  for (const loc of LOCALES) {
    const locPath = loc === 'en' ? DIST_DIR : path.join(DIST_DIR, LOCALE_PATHS[loc]);

    for (const page of PAGES) {
      const filePath = path.join(locPath, page.output);
      if (!fs.existsSync(filePath)) continue;
      // Skip redirect pages
      if (page.pageKey === 'discount_tesery') continue;

      const html = fs.readFileSync(filePath, 'utf8');
      const hreflangs = html.match(/hreflang="[^"]+"/g) || [];
      const hreflangValues = hreflangs.map(h => h.match(/"([^"]+)"/)[1]);

      // Should have en, de, fr, nb, da, sv, x-default = 7
      if (hreflangValues.length < 7) {
        error(`${LOCALE_PATHS[loc]}${page.output}: only ${hreflangValues.length}/7 hreflang tags`);
        issues++;
      } else if (!hreflangValues.includes('x-default')) {
        error(`${LOCALE_PATHS[loc]}${page.output}: missing x-default hreflang`);
        issues++;
      } else {
        ok++;
      }
    }
  }

  pass(`${ok} files have correct hreflang tags (${issues} issues)`);
}

// ============================================================
// Check 6: Sitemap has correct URL count and hreflang
// ============================================================
function checkSitemap() {
  console.log('\n--- Sitemap ---');

  const sitemapPath = path.join(DIST_DIR, 'sitemap.xml');
  if (!fs.existsSync(sitemapPath)) {
    error('sitemap.xml not found');
    return;
  }

  const sitemap = fs.readFileSync(sitemapPath, 'utf8');
  const urlCount = (sitemap.match(/<url>/g) || []).length;
  const localeCount = LOCALES.filter(l => fs.existsSync(
    l === 'en' ? path.join(DIST_DIR, 'index.html') : path.join(DIST_DIR, LOCALE_PATHS[l], 'index.html')
  )).length;
  const expectedUrls = PAGES.length * localeCount;

  if (urlCount === expectedUrls) {
    pass(`Sitemap: ${urlCount} URLs (${PAGES.length} pages × ${localeCount} locales)`);
  } else {
    warn(`Sitemap: ${urlCount} URLs (expected ${expectedUrls})`);
  }

  // Check hreflang in sitemap
  const xhtmlLinks = (sitemap.match(/xhtml:link/g) || []).length;
  if (xhtmlLinks > 0) {
    pass(`Sitemap has ${xhtmlLinks} hreflang xhtml:link entries`);
  } else {
    error('Sitemap missing hreflang xhtml:link entries');
  }
}

// ============================================================
// Check 7: Internal links point to existing files
// ============================================================
function checkInternalLinks() {
  console.log('\n--- Internal link integrity ---');

  let checked = 0;
  let broken = 0;

  for (const loc of LOCALES) {
    const locPath = loc === 'en' ? DIST_DIR : path.join(DIST_DIR, LOCALE_PATHS[loc]);

    for (const page of PAGES) {
      const filePath = path.join(locPath, page.output);
      if (!fs.existsSync(filePath)) continue;

      const html = fs.readFileSync(filePath, 'utf8');
      const links = html.match(/href="\/[^"]*"/g) || [];

      for (const link of links) {
        const href = link.match(/"([^"]+)"/)[1];
        // Skip anchors, static assets
        if (href.includes('#')) continue;
        if (/\.(css|js|svg|png|jpg|webp|json|xml|txt|ico)$/.test(href)) continue;
        if (href.startsWith('/_vercel')) continue;

        // Check if the file exists
        let checkPath = href.replace(/\/$/, '/index.html');
        if (!checkPath.endsWith('.html')) checkPath += '.html';
        // Remove leading /
        checkPath = checkPath.replace(/^\//, '');

        const fullPath = path.join(DIST_DIR, checkPath);
        const altPath = path.join(DIST_DIR, checkPath.replace('.html', '/index.html'));

        if (!fs.existsSync(fullPath) && !fs.existsSync(altPath)) {
          // Check without .html (clean URLs)
          const cleanPath = path.join(DIST_DIR, href.replace(/^\//, ''), 'index.html');
          if (!fs.existsSync(cleanPath)) {
            broken++;
            if (broken <= 10) warn(`Broken link: ${LOCALE_PATHS[loc]}${page.output} → ${href}`);
          }
        }
        checked++;
      }
    }
  }

  if (broken === 0) {
    pass(`${checked} internal links checked, all valid`);
  } else {
    warn(`${broken}/${checked} broken internal links`);
  }
}

// ============================================================
// Check 8: disclosure.html has noindex on all locales
// ============================================================
function checkNoindex() {
  console.log('\n--- Noindex on disclosure pages ---');

  for (const loc of LOCALES) {
    const locPath = loc === 'en' ? DIST_DIR : path.join(DIST_DIR, LOCALE_PATHS[loc]);
    const filePath = path.join(locPath, 'disclosure.html');
    if (!fs.existsSync(filePath)) continue;

    const html = fs.readFileSync(filePath, 'utf8');
    if (html.includes('noindex')) {
      pass(`${loc}: disclosure.html has noindex`);
    } else {
      warn(`${loc}: disclosure.html missing noindex`);
    }
  }
}

// ============================================================
// Run all checks
// ============================================================
console.log('Verifying multilingual build...');

checkFileCount();
checkPlaceholders();
checkUndefined();
checkHtmlLang();
checkHreflang();
checkSitemap();
checkInternalLinks();
checkNoindex();

console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${errors} errors, ${warnings} warnings`);

if (errors > 0) {
  console.log('FAIL - Fix errors before deploying');
  process.exit(1);
} else if (warnings > 0) {
  console.log('PASS with warnings');
} else {
  console.log('ALL CHECKS PASSED');
}
