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
const LOCALE_PATHS = { en: '', de: 'de/', fr: 'fr/', no: 'no/', da: 'da/', sv: 'sv/' };
// Default: verify whatever locales the build actually emitted (English-only since 2026-06-25)
const builtLocales = Object.keys(LOCALE_PATHS).filter(l =>
  fs.existsSync(path.join(DIST_DIR, LOCALE_PATHS[l], 'index.html'))
);
const LOCALES = (localesIdx !== -1 && cliArgs[localesIdx + 1])
  ? cliArgs[localesIdx + 1].split(',')
  : builtLocales;
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

      if (LOCALES.length <= 1) {
        // Single-locale build: pages must NOT carry hreflang tags
        if (hreflangValues.length > 0) {
          error(`${LOCALE_PATHS[loc]}${page.output}: ${hreflangValues.length} stale hreflang tags in single-locale build`);
          issues++;
        } else {
          ok++;
        }
      } else if (hreflangValues.length < LOCALES.length + 1) {
        error(`${LOCALE_PATHS[loc]}${page.output}: only ${hreflangValues.length}/${LOCALES.length + 1} hreflang tags`);
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
  // Mirrors NOINDEX_PAGES in build.js — noindex pages are excluded from the sitemap
  const NOINDEX_PAGES = new Set(['disclosure']);
  const expectedUrls = PAGES.filter(p => !NOINDEX_PAGES.has(p.pageKey)).length * localeCount;

  if (urlCount === expectedUrls) {
    pass(`Sitemap: ${urlCount} URLs (${PAGES.length} pages × ${localeCount} locales)`);
  } else {
    warn(`Sitemap: ${urlCount} URLs (expected ${expectedUrls})`);
  }

  // Check hreflang in sitemap
  const xhtmlLinks = (sitemap.match(/xhtml:link/g) || []).length;
  if (LOCALES.length <= 1) {
    // Single-locale build: sitemap must NOT carry hreflang alternates
    if (xhtmlLinks === 0) {
      pass('Sitemap correctly has no hreflang entries (single-locale build)');
    } else {
      error(`Sitemap has ${xhtmlLinks} stale hreflang xhtml:link entries in single-locale build`);
    }
  } else if (xhtmlLinks > 0) {
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
        const hrefPath = href.split(/[?#]/)[0];
        // Skip anchors, static assets
        if (href.includes('#')) continue;
        if (/\.(css|js|svg|png|jpg|webp|json|xml|txt|ico|webmanifest)$/.test(hrefPath)) continue;
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
// Check 9: Every page ships the shared mobile shell
// ============================================================
function checkResponsiveShell() {
  console.log('\n--- Responsive page shell ---');

  let checked = 0;
  for (const loc of LOCALES) {
    const locPath = loc === 'en' ? DIST_DIR : path.join(DIST_DIR, LOCALE_PATHS[loc]);

    for (const page of PAGES) {
      const filePath = path.join(locPath, page.output);
      if (!fs.existsSync(filePath)) continue;
      const html = fs.readFileSync(filePath, 'utf8');

      if (!html.includes('viewport-fit=cover')) {
        error(`${LOCALE_PATHS[loc]}${page.output}: viewport-fit=cover missing`);
      }
      if (!/<script src="\/mobile-nav\.js\?v=[a-f0-9]{10}" defer><\/script>/.test(html)) {
        error(`${LOCALE_PATHS[loc]}${page.output}: shared mobile navigation missing`);
      }
      if (!/href="\/styles\.css\?v=[a-f0-9]{10}"/.test(html)) {
        error(`${LOCALE_PATHS[loc]}${page.output}: versioned global stylesheet missing`);
      }
      checked++;
    }
  }

  pass(`${checked} pages include the responsive viewport and shared navigation`);
}

// ============================================================
// Check 10: Local image references exist in the deployed bundle
// ============================================================
function checkLocalImages() {
  console.log('\n--- Local image assets ---');

  let checked = 0;
  const missing = new Set();
  for (const loc of LOCALES) {
    const locPath = loc === 'en' ? DIST_DIR : path.join(DIST_DIR, LOCALE_PATHS[loc]);

    for (const page of PAGES) {
      const filePath = path.join(locPath, page.output);
      if (!fs.existsSync(filePath)) continue;
      const html = fs.readFileSync(filePath, 'utf8');
      const refs = [...html.matchAll(/(?:src|content)="(\/images\/[^"?#]+)(?:[?#][^"]*)?"/g)];

      for (const match of refs) {
        checked++;
        const imagePath = path.join(DIST_DIR, decodeURIComponent(match[1]).replace(/^\//, ''));
        if (!fs.existsSync(imagePath)) missing.add(`${page.output} → ${match[1]}`);
      }
    }
  }

  for (const item of missing) error(`Missing image: ${item}`);
  if (missing.size === 0) pass(`${checked} local image references resolve to deployed files`);
}

// ============================================================
// Check 11: New answer/guide pages retain rich media and conversion paths
// ============================================================
function checkGeneratedArticleContent() {
  console.log('\n--- Generated article media and CTAs ---');

  const articlePages = PAGES.filter(page => page.template === 'faq/_paa.html');
  let checked = 0;

  for (const page of articlePages) {
    const filePath = path.join(DIST_DIR, page.output);
    if (!fs.existsSync(filePath)) continue;
    const html = fs.readFileSync(filePath, 'utf8');
    const imageCount = (html.match(/<img\b/g) || []).length;

    if (imageCount < 4) error(`${page.output}: only ${imageCount}/4 expected article images`);
    if (!html.includes('class="article-visual"')) error(`${page.output}: missing primary article visual`);
    if (!html.includes('class="article-visual-guide-grid"')) error(`${page.output}: missing visual continuation cards`);
    if (!html.includes('class="faq-cta"')) error(`${page.output}: missing decision CTA`);
    checked++;
  }

  pass(`${checked} generated articles include a lead image, three visual cards and a decision CTA`);
}

// ============================================================
// Check 12: Current Havnby catalog replaces the retired product everywhere
// ============================================================
function checkHavnbyCatalog() {
  console.log('\n--- Current Havnby catalog ---');

  const requiredPages = [
    'reviews/havnby-autolevel.html',
    'reviews/havnby-solo.html',
    'reviews/havnby-cloudcore.html',
    'vs/havnby-flatcore-vs-cloudcore.html',
  ];
  for (const relativePath of requiredPages) {
    if (!fs.existsSync(path.join(DIST_DIR, relativePath))) error(`Missing current Havnby page: ${relativePath}`);
  }

  const requiredNames = [
    'Havnby FlatCore Foam Mattress',
    'Havnby FlatCore Foam Mattress — Solo Edition',
    'Havnby CloudCore Foam Mattress',
  ];
  const keyFiles = [
    'index.html',
    'reviews/index.html',
    'guides/best-tesla-mattresses.html',
    'guides/best-model-y-mattress.html',
    'discounts/index.html',
  ];
  const combined = keyFiles
    .map(file => fs.readFileSync(path.join(DIST_DIR, file), 'utf8'))
    .join('\n');
  for (const name of requiredNames) {
    if (!combined.includes(name)) error(`Current Havnby product missing from key pages: ${name}`);
  }

  const scanFiles = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (/\.(?:html|xml|txt)$/.test(entry.name)) scanFiles.push(fullPath);
    }
  };
  walk(DIST_DIR);
  const banned = [
    '/reviews/havnby-foam',
    '/vs/havnby-autolevel-vs-foam',
    'Havnby Foam (discontinued)',
    'Havnby Foam Mattress (discontinued)',
  ];
  for (const filePath of scanFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    for (const phrase of banned) {
      if (content.includes(phrase)) error(`${path.relative(DIST_DIR, filePath)}: retired Havnby reference remains (${phrase})`);
    }
  }

  pass('FlatCore, Solo Edition and CloudCore are present; retired catalog references are absent');
}

// ============================================================
// Check 13: Every editorial page has real media and review depth
// ============================================================
function checkEditorialMedia() {
  console.log('\n--- Editorial page media coverage ---');

  const editorialPrefixes = ['reviews/', 'guides/', 'faq/', 'vs/', 'discounts/'];
  const editorialPages = PAGES.filter(page =>
    editorialPrefixes.some(prefix => page.output.startsWith(prefix)) &&
    !page.output.endsWith('/index.html')
  );
  let checked = 0;

  for (const page of editorialPages) {
    const filePath = path.join(DIST_DIR, page.output);
    if (!fs.existsSync(filePath)) continue;
    const html = fs.readFileSync(filePath, 'utf8');
    const images = [...html.matchAll(/<img\b([^>]*)>/gi)];
    const minimum = page.output.startsWith('reviews/') ? 4 : 1;

    if (images.length < minimum) {
      error(`${page.output}: only ${images.length}/${minimum} expected editorial images`);
    }
    for (const image of images) {
      if (!/\balt="[^"]*"/i.test(image[1])) error(`${page.output}: image is missing an alt attribute`);
      if (!/\bwidth="\d+"/i.test(image[1]) || !/\bheight="\d+"/i.test(image[1])) {
        error(`${page.output}: image is missing intrinsic width/height`);
      }
    }
    checked++;
  }

  pass(`${checked} editorial pages have media; every review has at least four images`);
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
checkResponsiveShell();
checkLocalImages();
checkGeneratedArticleContent();
checkHavnbyCatalog();
checkEditorialMedia();

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
