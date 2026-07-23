#!/usr/bin/env node
// verify.js - Pre-deploy validation for multilingual build
// Usage: node scripts/verify.js

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

function decodeEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function canonicalUrlFor(page, loc) {
  const pagePath = page.output.replace(/index\.html$/, '').replace(/\.html$/, '').replace(/\/$/, '');
  const fullPath = `${LOCALE_PATHS[loc]}${pagePath}`.replace(/\/$/, '');
  return fullPath ? `${BASE_URL}/${fullPath}` : `${BASE_URL}/`;
}

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
  const sitemapBlocks = [...sitemap.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(match => match[1]);
  const sitemapEntries = sitemapBlocks.map(block => ({
    loc: decodeEntities((block.match(/<loc>([^<]+)<\/loc>/) || [])[1]),
    lastmod: (block.match(/<lastmod>([^<]+)<\/lastmod>/) || [])[1] || '',
  }));
  const sitemapUrls = sitemapEntries.map(entry => entry.loc);
  const sitemapUrlSet = new Set(sitemapUrls);
  const builtLocales = LOCALES.filter(l => fs.existsSync(
    l === 'en' ? path.join(DIST_DIR, 'index.html') : path.join(DIST_DIR, LOCALE_PATHS[l], 'index.html')
  ));
  // Mirrors NOINDEX_PAGES in build.js — noindex pages are excluded from the sitemap
  const NOINDEX_PAGES = new Set(['disclosure']);
  const expectedEntries = [];
  for (const loc of builtLocales) {
    for (const page of PAGES) {
      if (NOINDEX_PAGES.has(page.pageKey)) continue;
      expectedEntries.push({
        url: canonicalUrlFor(page, loc),
        filePath: path.join(
          loc === 'en' ? DIST_DIR : path.join(DIST_DIR, LOCALE_PATHS[loc]),
          page.output
        ),
      });
    }
  }
  const expectedUrlSet = new Set(expectedEntries.map(entry => entry.url));

  if (sitemapEntries.length === expectedEntries.length) {
    pass(`Sitemap: ${sitemapEntries.length} canonical URLs (${PAGES.length} pages × ${builtLocales.length} locales, excluding noindex)`);
  } else {
    error(`Sitemap: ${sitemapEntries.length} URLs (expected ${expectedEntries.length})`);
  }

  if (sitemapUrlSet.size !== sitemapUrls.length) {
    const duplicates = [...new Set(sitemapUrls.filter((url, index) => sitemapUrls.indexOf(url) !== index))];
    error(`Sitemap has duplicate URLs: ${duplicates.join(', ')}`);
  } else {
    pass('Sitemap URLs are unique');
  }

  const missingUrls = [...expectedUrlSet].filter(url => !sitemapUrlSet.has(url));
  const unexpectedUrls = [...sitemapUrlSet].filter(url => !expectedUrlSet.has(url));
  for (const url of missingUrls) error(`Sitemap missing canonical URL: ${url}`);
  for (const url of unexpectedUrls) error(`Sitemap contains unexpected/non-indexable URL: ${url}`);
  if (missingUrls.length === 0 && unexpectedUrls.length === 0) {
    pass('Sitemap contains every and only expected indexable URL');
  }

  const today = new Date().toISOString().slice(0, 10);
  for (const entry of sitemapEntries) {
    if (!/^https:\/\/teslamattress\.com(?:\/|$)/.test(entry.loc)) {
      error(`Sitemap URL is not absolute canonical apex URL: ${entry.loc || '(missing loc)'}`);
    }
    if (entry.loc !== `${BASE_URL}/` && entry.loc.endsWith('/')) {
      error(`Sitemap URL has a non-canonical trailing slash: ${entry.loc}`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.lastmod)) {
      error(`Sitemap has invalid lastmod for ${entry.loc}: ${entry.lastmod || '(missing)'}`);
    } else if (entry.lastmod > today) {
      error(`Sitemap has future lastmod for ${entry.loc}: ${entry.lastmod}`);
    }
  }
  if (!sitemapEntries.some(entry => !entry.loc || !/^\d{4}-\d{2}-\d{2}$/.test(entry.lastmod) || entry.lastmod > today)) {
    pass('All sitemap URLs and lastmod dates use the canonical format');
  }

  for (const entry of expectedEntries) {
    const html = fs.readFileSync(entry.filePath, 'utf8');
    const canonical = decodeEntities((html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/i) || [])[1]);
    const robots = decodeEntities((html.match(/<meta\s+name="robots"\s+content="([^"]+)"/i) || [])[1]);
    if (canonical !== entry.url) error(`${path.relative(DIST_DIR, entry.filePath)}: canonical ${canonical || '(missing)'} does not match sitemap URL ${entry.url}`);
    if (/noindex/i.test(robots)) error(`${path.relative(DIST_DIR, entry.filePath)}: noindex page must not be in sitemap`);
  }
  if (unexpectedUrls.length === 0) pass('Every sitemap URL is self-canonical and indexable');

  if (/<(?:priority|changefreq)>/i.test(sitemap)) {
    error('Sitemap contains ignored priority/changefreq metadata');
  } else {
    pass('Sitemap uses only actionable loc/lastmod metadata');
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
// Check 6b: robots.txt and hosting rules preserve crawlability
// ============================================================
function checkCrawlerConfiguration() {
  console.log('\n--- Robots and hosting indexability ---');

  const robotsPath = path.join(DIST_DIR, 'robots.txt');
  if (!fs.existsSync(robotsPath)) {
    error('robots.txt not found');
    return;
  }

  const robots = fs.readFileSync(robotsPath, 'utf8');
  const sitemapDirectives = [...robots.matchAll(/^sitemap:\s*(\S+)\s*$/gim)].map(match => match[1]);
  if (!/^user-agent:\s*\*$/im.test(robots)) error('robots.txt is missing a wildcard user-agent group');
  if (!/^allow:\s*\/\s*$/im.test(robots)) error('robots.txt does not explicitly allow the public site');
  if (/^disallow:\s*\/\s*$/im.test(robots)) error('robots.txt blocks the entire site');
  if (sitemapDirectives.length !== 1 || sitemapDirectives[0] !== `${BASE_URL}/sitemap.xml`) {
    error(`robots.txt must contain exactly one canonical Sitemap directive (found: ${sitemapDirectives.join(', ') || 'none'})`);
  } else {
    pass('robots.txt allows crawling and declares the canonical sitemap exactly once');
  }
  if (/sitmap\.xml/i.test(robots)) error('robots.txt contains the misspelled sitmap.xml path');

  const vercelPath = path.join(ROOT, 'vercel.json');
  if (!fs.existsSync(vercelPath)) {
    error('vercel.json not found');
    return;
  }
  const vercel = JSON.parse(fs.readFileSync(vercelPath, 'utf8'));
  if (vercel.cleanUrls !== true) error('vercel.json must keep cleanUrls enabled');
  if (vercel.trailingSlash !== false) error('vercel.json must keep trailingSlash disabled');
  const responseHeaders = (vercel.headers || []).flatMap(rule => rule.headers || []);
  const blockingHeader = responseHeaders.find(header =>
    String(header.key).toLowerCase() === 'x-robots-tag' && /noindex/i.test(String(header.value))
  );
  if (blockingHeader) error('vercel.json applies an index-blocking X-Robots-Tag header');

  const apexRedirect = (vercel.redirects || []).find(rule =>
    rule.permanent === true &&
    rule.destination === 'https://teslamattress.com/:path' &&
    (rule.has || []).some(condition => condition.type === 'host' && condition.value === 'www.teslamattress.com')
  );
  if (!apexRedirect) error('vercel.json is missing the permanent www → apex redirect');

  if (
    vercel.cleanUrls === true &&
    vercel.trailingSlash === false &&
    !blockingHeader &&
    apexRedirect
  ) {
    pass('Hosting config enforces clean apex canonicals without index-blocking headers');
  }
}

// ============================================================
// Check 6c: every built page has the intended index directive
// ============================================================
function checkPageIndexability() {
  console.log('\n--- Page indexability and canonicals ---');

  const NOINDEX_PAGES = new Set(['disclosure']);
  let checked = 0;
  for (const loc of LOCALES) {
    const locPath = loc === 'en' ? DIST_DIR : path.join(DIST_DIR, LOCALE_PATHS[loc]);
    for (const page of PAGES) {
      const filePath = path.join(locPath, page.output);
      if (!fs.existsSync(filePath)) continue;
      const html = fs.readFileSync(filePath, 'utf8');
      const expectedCanonical = canonicalUrlFor(page, loc);
      const canonical = decodeEntities((html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/i) || [])[1]);
      const robots = decodeEntities((html.match(/<meta\s+name="robots"\s+content="([^"]+)"/i) || [])[1]);

      if (canonical !== expectedCanonical) {
        error(`${LOCALE_PATHS[loc]}${page.output}: canonical ${canonical || '(missing)'} expected ${expectedCanonical}`);
      }
      if (!robots) {
        error(`${LOCALE_PATHS[loc]}${page.output}: missing robots meta tag`);
      } else if (NOINDEX_PAGES.has(page.pageKey) && !/noindex/i.test(robots)) {
        error(`${LOCALE_PATHS[loc]}${page.output}: expected noindex`);
      } else if (!NOINDEX_PAGES.has(page.pageKey) && /noindex/i.test(robots)) {
        error(`${LOCALE_PATHS[loc]}${page.output}: important page is unexpectedly noindex`);
      }
      checked++;
    }
  }

  const notFoundPath = path.join(DIST_DIR, '404.html');
  if (!fs.existsSync(notFoundPath) || !/<meta\s+name="robots"\s+content="[^"]*noindex/i.test(fs.readFileSync(notFoundPath, 'utf8'))) {
    error('404.html must exist and carry a noindex robots directive');
  }
  pass(`${checked} routed pages have explicit intended indexability and self-referencing canonicals`);
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
// Check 14: Shared editorial visuals have locked real-source provenance
// ============================================================
function checkEditorialImageProvenance() {
  console.log('\n--- Editorial image provenance ---');

  const provenancePath = path.join(ROOT, 'src', 'editorial-image-provenance.json');
  if (!fs.existsSync(provenancePath)) {
    error('Missing src/editorial-image-provenance.json');
    return;
  }

  const provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
  const allowedKinds = new Set(['vendor_product_image', 'official_tesla_asset']);
  let checked = 0;

  for (const [filename, record] of Object.entries(provenance)) {
    const imagePath = path.join(ROOT, 'images', filename);
    if (!fs.existsSync(imagePath)) {
      error(`Missing provenance-locked image: images/${filename}`);
      continue;
    }
    if (!allowedKinds.has(record.kind)) {
      error(`images/${filename}: unsupported provenance kind ${record.kind || '(missing)'}`);
    }
    if (record.synthetic !== false) {
      error(`images/${filename}: synthetic imagery is not permitted`);
    }
    if (!Array.isArray(record.source_urls) || record.source_urls.length === 0) {
      error(`images/${filename}: source_urls must identify the official source`);
    }
    for (const source of record.sources || []) {
      const sourcePath = path.join(ROOT, source.replace(/^\//, ''));
      if (!fs.existsSync(sourcePath)) error(`images/${filename}: missing local source ${source}`);
    }

    const hash = crypto.createHash('sha256').update(fs.readFileSync(imagePath)).digest('hex');
    if (hash !== record.sha256) {
      error(`images/${filename}: content hash changed without a provenance review`);
    }
    checked++;
  }

  const generatedLanguage = /\b(?:AI[- ]generated|generated scene|editorial illustration|concept image)\b/i;
  const textFiles = [
    path.join(ROOT, 'src', 'locales', 'en.json'),
    ...PAGES.map(page => path.join(ROOT, 'src', 'templates', page.template)),
  ];
  const checkedTextFiles = [...new Set(textFiles)].filter(file => fs.existsSync(file));
  for (const file of checkedTextFiles) {
    const content = fs.readFileSync(file, 'utf8');
    if (generatedLanguage.test(content)) {
      error(`${path.relative(ROOT, file)}: generated/editorial-illustration language remains`);
    }
  }

  pass(`${checked} shared editorial visuals are locked to official Tesla or manufacturer product sources`);
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
checkCrawlerConfiguration();
checkPageIndexability();
checkInternalLinks();
checkNoindex();
checkResponsiveShell();
checkLocalImages();
checkGeneratedArticleContent();
checkHavnbyCatalog();
checkEditorialMedia();
checkEditorialImageProvenance();

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
