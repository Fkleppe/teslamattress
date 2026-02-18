#!/usr/bin/env node
// extract.js - One-time script: HTML files → templates + en.json
// Usage: node scripts/extract.js

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PAGES = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'pages.json'), 'utf8'));
const TEMPLATE_DIR = path.join(ROOT, 'src', 'templates');
const LOCALE_DIR = path.join(ROOT, 'src', 'locales');
const BASE_URL = 'https://teslamattress.com';

// --- State ---
const locale = {
  _meta: {
    en: { locale: 'en', locale_path: '', og_locale: 'en_US', html_lang: 'en' },
    de: { locale: 'de', locale_path: 'de/', og_locale: 'de_DE', html_lang: 'de' },
    fr: { locale: 'fr', locale_path: 'fr/', og_locale: 'fr_FR', html_lang: 'fr' },
    no: { locale: 'no', locale_path: 'no/', og_locale: 'nb_NO', html_lang: 'nb' },
    da: { locale: 'da', locale_path: 'da/', og_locale: 'da_DK', html_lang: 'da' },
    sv: { locale: 'sv', locale_path: 'sv/', og_locale: 'sv_SE', html_lang: 'sv' }
  },
  shared: {}
};

function addString(section, key, value) {
  if (!locale[section]) locale[section] = {};
  locale[section][key] = value;
}

function addShared(key, value) {
  if (!locale.shared[key]) locale.shared[key] = value;
}

function shouldSkip(text) {
  const clean = text.replace(/<[^>]+>/g, '').trim();
  if (!clean || clean.length < 2) return true;
  if (/^[\d.,/%€$£+×~≈°]+$/.test(clean)) return true;
  if (/^#?\d+$/.test(clean)) return true;
  if (clean.startsWith('{{')) return true;
  return false;
}

function escRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// --- Write helpers ---
function writeTemplate(relPath, content) {
  const dest = path.join(TEMPLATE_DIR, relPath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content, 'utf8');
}

// ============================================================
// PHASE 1: Meta tag extraction
// ============================================================
function extractMeta(html, pk) {
  // <title>
  html = html.replace(/<title>([\s\S]*?)<\/title>/, (_, t) => {
    addString(pk, 'meta_title', t.trim());
    return `<title>{{t.${pk}.meta_title}}</title>`;
  });

  const metaTags = [
    { pattern: /<meta name="title" content="([^"]*)"/, key: 'meta_name_title' },
    { pattern: /<meta name="description" content="([^"]*)"/, key: 'meta_description' },
    { pattern: /<meta name="keywords" content="([^"]*)"/, key: 'meta_keywords' },
    { pattern: /<meta property="og:title" content="([^"]*)"/, key: 'og_title' },
    { pattern: /<meta property="og:description" content="([^"]*)"/, key: 'og_description' },
    { pattern: /<meta name="twitter:title" content="([^"]*)"/, key: 'twitter_title' },
    { pattern: /<meta name="twitter:description" content="([^"]*)"/, key: 'twitter_description' },
  ];

  for (const { pattern, key } of metaTags) {
    html = html.replace(pattern, (match, val) => {
      if (!val.trim()) return match;
      addString(pk, key, val);
      return match.replace(`content="${val}"`, `content="{{t.${pk}.${key}}}"`);
    });
  }

  return html;
}

// ============================================================
// PHASE 2: Structural templating (URLs, lang, hreflang)
// ============================================================
function templateStructural(html, page) {
  // html lang
  html = html.replace('<html lang="en">', '<html lang="{{htmlLang}}">');

  // Canonical URL → template + hreflang
  html = html.replace(
    /<link rel="canonical" href="[^"]*">/,
    '<link rel="canonical" href="{{canonicalUrl}}">\n    {{hreflangTags}}'
  );

  // og:url
  html = html.replace(
    /<meta property="og:url" content="[^"]*"\s*\/?>/,
    '<meta property="og:url" content="{{pageUrl}}">'
  );

  // twitter:url
  html = html.replace(
    /<meta name="twitter:url" content="[^"]*"\s*\/?>/,
    '<meta name="twitter:url" content="{{pageUrl}}">'
  );

  // og:locale → template + alternates
  html = html.replace(
    /<meta property="og:locale" content="[^"]*"\s*\/?>/,
    '<meta property="og:locale" content="{{ogLocale}}">\n    {{ogLocaleAlternates}}'
  );

  return html;
}

// ============================================================
// PHASE 3: JSON-LD extraction
// ============================================================
function extractJsonLd(html, pk) {
  let jsonLdIdx = 0;

  html = html.replace(
    /(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/g,
    (match, open, jsonStr, close) => {
      jsonLdIdx++;
      let json;
      try {
        json = JSON.parse(jsonStr);
      } catch {
        return match; // malformed JSON-LD, skip
      }

      const prefix = `jsonld_${jsonLdIdx}`;
      let keyIdx = 0;

      function walkAndExtract(obj) {
        if (Array.isArray(obj)) {
          obj.forEach(item => walkAndExtract(item));
          return;
        }
        if (typeof obj !== 'object' || obj === null) return;

        const translatableFields = [
          'description', 'reviewBody', 'headline', 'slogan',
          'name', 'text', 'award'
        ];

        for (const field of translatableFields) {
          if (typeof obj[field] === 'string' && obj[field].length > 10) {
            // Skip URLs, dates, schema.org values
            if (obj[field].startsWith('http') || obj[field].startsWith('https')) continue;
            if (/^\d{4}-\d{2}-\d{2}$/.test(obj[field])) continue;
            if (obj[field].includes('schema.org')) continue;
            // Skip brand names that are short identifiers
            if (field === 'name' && obj['@type'] && ['Brand', 'Organization', 'Person', 'ImageObject', 'Rating', 'AggregateRating', 'AggregateOffer', 'Offer', 'EducationalOccupationalCredential'].includes(obj['@type'])) continue;
            if (field === 'name' && obj['@type'] === 'ListItem' && obj.item) continue;

            keyIdx++;
            const k = `${prefix}_${field}_${keyIdx}`;
            addString(pk, k, obj[field]);
            obj[field] = `{{t.${pk}.${k}}}`;
          }
        }

        // Recurse into nested objects
        for (const val of Object.values(obj)) {
          if (typeof val === 'object' && val !== null) {
            walkAndExtract(val);
          }
        }
      }

      walkAndExtract(json);

      const newJsonStr = JSON.stringify(json, null, 8)
        .replace(/"\{\{t\./g, '"{{t.')
        .replace(/\}\}"/g, '}}"');

      return `${open}\n    ${newJsonStr}\n    ${close}`;
    }
  );

  return html;
}

// ============================================================
// PHASE 4: Nav templating
// ============================================================
function templateNav(html) {
  // Add shared nav text keys
  const navTexts = {
    'Reviews': 'nav_reviews',
    'Compare': 'nav_compare',
    'Discounts': 'nav_discounts',
    'About': 'nav_about',
    'Comparison': 'nav_comparison',
    'All Reviews': 'nav_all_reviews',
  };

  for (const [text, key] of Object.entries(navTexts)) {
    addShared(key, text);
  }

  // Replace nav link text within <ul class="nav-links"> blocks
  html = html.replace(
    /(<ul class="nav-links">)([\s\S]*?)(<\/ul>)/g,
    (match, open, content, close) => {
      for (const [text, key] of Object.entries(navTexts)) {
        content = content.replace(
          new RegExp(`>${escRegex(text)}</a>`, 'g'),
          `>{{t.shared.${key}}}</a>`
        );
      }
      return `${open}${content}${close}\n        {{langSwitcher}}`;
    }
  );

  return html;
}

// ============================================================
// PHASE 5: Body text extraction
// ============================================================
function extractBodyText(html, pk) {
  const cnt = {};
  const nextKey = (prefix) => {
    cnt[prefix] = (cnt[prefix] || 0) + 1;
    return cnt[prefix] === 1 ? prefix : `${prefix}_${cnt[prefix]}`;
  };

  // Split HTML into sections to avoid processing <script> and <style> content
  // We'll process line-by-line with state tracking
  const lines = html.split('\n');
  let inScript = false;
  let inStyle = false;
  let inJsonLd = false;
  let inFooter = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track script/style/footer blocks
    if (/<script/i.test(line)) inScript = true;
    if (/<\/script>/i.test(line)) { inScript = false; continue; }
    if (/<style/i.test(line)) inStyle = true;
    if (/<\/style>/i.test(line)) { inStyle = false; continue; }
    if (/class="footer"/.test(line)) inFooter = true;
    if (inScript || inStyle || inFooter) continue;

    // Skip already-templated lines
    if (line.includes('{{t.')) continue;

    // --- Headings (h1-h4) ---
    for (let level = 1; level <= 4; level++) {
      const tag = `h${level}`;
      const re = new RegExp(`(<${tag}[^>]*>)(.+?)(<\\/${tag}>)`);
      const m = line.match(re);
      if (m && !shouldSkip(m[2])) {
        const k = nextKey(tag);
        addString(pk, k, m[2].trim());
        lines[i] = line.replace(re, `$1{{t.${pk}.${k}}}$3`);
      }
    }

    // --- Paragraphs (single-line) ---
    {
      const re = /(<p[^>]*>)(.+?)(<\/p>)/;
      const m = lines[i].match(re);
      if (m && !shouldSkip(m[2])) {
        const k = nextKey('p');
        addString(pk, k, m[2].trim());
        lines[i] = lines[i].replace(re, `$1{{t.${pk}.${k}}}$3`);
      }
    }

    // --- Table headers ---
    {
      const re = /<th[^>]*>([^<{]+)<\/th>/g;
      let m;
      while ((m = re.exec(lines[i])) !== null) {
        const text = m[1].trim();
        if (text && !shouldSkip(text)) {
          const shKey = `th_${text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`;
          addShared(shKey, text);
          lines[i] = lines[i].replace(`>${text}</th>`, `>{{t.shared.${shKey}}}</th>`);
        }
      }
    }

    // --- data-label attributes ---
    {
      const re = /data-label="([^"]+)"/g;
      let m;
      while ((m = re.exec(lines[i])) !== null) {
        const val = m[1];
        if (!val.startsWith('{{')) {
          const shKey = `dl_${val.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
          addShared(shKey, val);
          lines[i] = lines[i].replace(`data-label="${val}"`, `data-label="{{t.shared.${shKey}}}"`);
        }
      }
    }

    // --- Span classes with translatable text ---
    const spanClasses = [
      'section-tag', 'review-badge', 'score-label', 'stat-label',
      'stat-key', 'savings-text', 'savings-amount', 'code-label',
      'partner-desc', 'partner-discount', 'spec-label',
      'finding-value', 'finding-basis', 'tldr-highlight-label',
      'review-updated', 'discount-badge-new', 'discount-badge',
      'discount-badge-none', 'region-popup-subtitle',
    ];

    for (const cls of spanClasses) {
      const re = new RegExp(`(<span class="${escRegex(cls)}[^"]*">)([^<]+)(</span>)`);
      const m = lines[i].match(re);
      if (m && !shouldSkip(m[2]) && !m[2].includes('{{')) {
        const k = nextKey(`span_${cls.replace(/-/g, '_')}`);
        addString(pk, k, m[2].trim());
        lines[i] = lines[i].replace(re, `$1{{t.${pk}.${k}}}$3`);
      }
    }

    // --- Div classes with translatable text ---
    const divClasses = ['stat-number', 'stat-label', 'footer-logo'];
    for (const cls of divClasses) {
      const re = new RegExp(`(<div class="${escRegex(cls)}">)([^<]+)(</div>)`);
      const m = lines[i].match(re);
      if (m && !shouldSkip(m[2]) && !m[2].includes('{{')) {
        const k = nextKey(`div_${cls.replace(/-/g, '_')}`);
        addString(pk, k, m[2].trim());
        lines[i] = lines[i].replace(re, `$1{{t.${pk}.${k}}}$3`);
      }
    }

    // --- Buttons and links with btn-* class ---
    {
      const re = /(<(?:button|a)[^>]*class="[^"]*btn[^"]*"[^>]*>)([^<]+)(<\/(?:button|a)>)/;
      const m = lines[i].match(re);
      if (m && !shouldSkip(m[2]) && !m[2].includes('{{')) {
        const text = m[2].trim();
        // Common shared button texts
        const sharedBtns = {
          'Review': 'btn_review', 'Buy': 'btn_buy',
          'Buy Now': 'btn_buy_now',
        };
        if (sharedBtns[text]) {
          addShared(sharedBtns[text], text);
          lines[i] = lines[i].replace(re, `$1{{t.shared.${sharedBtns[text]}}}$3`);
        } else {
          const k = nextKey('btn');
          addString(pk, k, text);
          lines[i] = lines[i].replace(re, `$1{{t.${pk}.${k}}}$3`);
        }
      }
    }

    // --- Links with specific classes (discount-details-link, etc.) ---
    {
      const linkClasses = ['discount-details-link', 'discount-cta-btn'];
      for (const cls of linkClasses) {
        const re = new RegExp(`(<a[^>]*class="[^"]*${escRegex(cls)}[^"]*"[^>]*>)([^<]+)(</a>)`);
        const m = lines[i].match(re);
        if (m && !shouldSkip(m[2]) && !m[2].includes('{{')) {
          const k = nextKey(`link_${cls.replace(/-/g, '_')}`);
          addString(pk, k, m[2].trim());
          lines[i] = lines[i].replace(re, `$1{{t.${pk}.${k}}}$3`);
        }
      }
    }
  }

  return lines.join('\n');
}

// ============================================================
// PHASE 6: Footer templating
// ============================================================
function templateFooter(html, pk) {
  // Extract footer block
  html = html.replace(
    /(<footer class="footer">)([\s\S]*?)(<\/footer>)/,
    (match, open, content, close) => {
      // footer-tagline
      content = content.replace(
        /(<p class="footer-tagline">)([^<]+)(<\/p>)/,
        (m, o, text, c) => {
          addShared('footer_tagline', text.trim());
          return `${o}{{t.shared.footer_tagline}}${c}`;
        }
      );

      // footer-logo
      content = content.replace(
        /(<div class="footer-logo">)([^<]+)(<\/div>)/,
        (m, o, text, c) => {
          // "Teslamattress" brand name — don't translate
          return m;
        }
      );

      // footer column h4 headings
      const h4Map = {
        'Model Y Mattresses': 'footer_col_model_y',
        'Model 3 Mattresses': 'footer_col_model_3',
        'Discount Codes': 'footer_col_discounts',
        'Resources': 'footer_col_resources',
        'Compare': 'footer_col_compare',
        'Comparisons': 'footer_col_comparisons',
      };
      for (const [text, key] of Object.entries(h4Map)) {
        addShared(key, text);
        content = content.replace(
          `<h4>${text}</h4>`,
          `<h4>{{t.shared.${key}}}</h4>`
        );
      }

      // footer link texts
      const footerLinks = {
        'Snuuzu Model Y Review': 'fl_snuuzu_y',
        'Havnby Autolevel Review': 'fl_havnby_autolevel',
        'TESMAT Luxe Model Y': 'fl_tesmat_luxe_y',
        'Havnby Solo Review': 'fl_havnby_solo',
        'TESMAT Solo Model Y': 'fl_tesmat_solo_y',
        'NovaPads Air-Foam Pro Review': 'fl_novapads',
        'Snuuzu Model 3 Review': 'fl_snuuzu_3',
        'TESMAT Luxe Model 3': 'fl_tesmat_luxe_3',
        'TESMAT Solo Model 3': 'fl_tesmat_solo_3',
        'Havnby Foam Y/3 Review': 'fl_havnby_foam',
        'All Discount Codes': 'fl_all_discounts',
        'Snuuzu Discount Code': 'fl_snuuzu_discount',
        'Havnby Discount Code': 'fl_havnby_discount',
        'NovaPads Discount Code': 'fl_novapads_discount',
        'Mattress Comparison': 'fl_comparison',
        'Exclusive Codes': 'fl_exclusive_codes',
        'Partner Brands': 'fl_partner_brands',
        'About Us': 'fl_about',
        'All Comparisons': 'fl_all_comparisons',
        'Methodology': 'fl_methodology',
        'Affiliate Disclosure': 'fl_disclosure',
      };

      for (const [text, key] of Object.entries(footerLinks)) {
        addShared(key, text);
        content = content.replace(
          new RegExp(`>${escRegex(text)}</a>`, 'g'),
          `>{{t.shared.${key}}}</a>`
        );
      }

      // disclaimer
      content = content.replace(
        /(<p class="disclaimer">)([^<]+)(<\/p>)/,
        (m, o, text, c) => {
          addShared('footer_disclaimer', text.trim());
          return `${o}{{t.shared.footer_disclaimer}}${c}`;
        }
      );

      // copyright line: "&copy; 2026 Teslamattress. All rights reserved. <a>...</a>"
      // Link text already templated by fl_disclosure above, only extract "All rights reserved."
      content = content.replace(
        /(&copy; \d+ Teslamattress\. )([^<]+)(<a)/,
        (m, prefix, rights, aOpen) => {
          addShared('footer_rights', rights.trim());
          return `${prefix}{{t.shared.footer_rights}} ${aOpen}`;
        }
      );

      return `${open}${content}${close}`;
    }
  );

  return html;
}

// ============================================================
// PHASE 7: Region popup templating
// ============================================================
function templateRegionPopup(html) {
  // Popup heading
  html = html.replace(
    /(<div class="region-popup-content">[\s\S]*?<button[^>]*>[^<]*<\/button>\s*\n\s*<h3>)([^<]+)(<\/h3>)/,
    (m, before, text, after) => {
      addShared('region_title', text.trim());
      return `${before}{{t.shared.region_title}}${after}`;
    }
  );

  // Popup subtitle
  html = html.replace(
    /(<p class="region-popup-subtitle">)([^<]+)(<\/p>)/,
    (m, o, text, c) => {
      addShared('region_subtitle', text.trim());
      return `${o}{{t.shared.region_subtitle}}${c}`;
    }
  );

  // Popup discount text
  html = html.replace(
    /(<p class="region-discount">)([\s\S]*?)(<\/p>)/,
    (m, o, text, c) => {
      addShared('region_discount_text', text.trim());
      return `${o}{{t.shared.region_discount_text}}${c}`;
    }
  );

  // Region names in JS template literals
  html = html.replace(
    /(<span class="region-name">)Europe(<\/span>)/g,
    (m, o, c) => {
      addShared('region_europe', 'Europe');
      return `${o}{{t.shared.region_europe}}${c}`;
    }
  );
  html = html.replace(
    /(<span class="region-name">)United States(<\/span>)/g,
    (m, o, c) => {
      addShared('region_us', 'United States');
      return `${o}{{t.shared.region_us}}${c}`;
    }
  );

  return html;
}

// ============================================================
// PHASE 8: Internal link href prefixing
// ============================================================
function templateInternalLinks(html) {
  // Match href="/..." that are internal page links (not assets)
  html = html.replace(/href="(\/[^"]*?)"/g, (match, p) => {
    // Skip static assets
    if (/\.(css|js|svg|png|jpg|jpeg|webp|json|ico|xml|txt)(\?|$)/.test(p)) return match;
    if (p.startsWith('/images/') || p.startsWith('/_vercel/')) return match;
    if (p.startsWith('/favicon') || p.startsWith('/apple-touch')) return match;
    // Skip already-templated
    if (p.includes('{{')) return match;

    const cleaned = p.replace(/^\//, '');
    return `href="/{{localePath}}${cleaned}"`;
  });

  return html;
}

// ============================================================
// Main processing
// ============================================================
function processPage(page) {
  const { template: templatePath, pageKey } = page;
  const srcPath = path.join(ROOT, templatePath);

  if (!fs.existsSync(srcPath)) {
    console.warn(`SKIP: ${srcPath} not found`);
    return;
  }

  let html = fs.readFileSync(srcPath, 'utf8');
  locale[pageKey] = {};

  // Handle redirect pages minimally
  if (pageKey === 'discount_tesery') {
    html = html.replace('<html lang="en">', '<html lang="{{htmlLang}}">');
    html = html.replace(
      /<link rel="canonical" href="[^"]*">/,
      '<link rel="canonical" href="{{canonicalUrl}}">'
    );
    html = html.replace(
      /<meta http-equiv="refresh" content="0;url=\/discounts\/novapads">/,
      '<meta http-equiv="refresh" content="0;url=/{{localePath}}discounts/novapads">'
    );
    html = html.replace(
      /href="\/discounts\/novapads"/,
      'href="/{{localePath}}discounts/novapads"'
    );
    writeTemplate(templatePath, html);
    console.log(`  ${templatePath} (redirect - minimal templating)`);
    return;
  }

  // Process in order
  html = extractMeta(html, pageKey);
  html = templateStructural(html, page);
  html = extractJsonLd(html, pageKey);
  html = templateNav(html);
  html = extractBodyText(html, pageKey);
  html = templateFooter(html, pageKey);
  html = templateRegionPopup(html);
  html = templateInternalLinks(html);

  writeTemplate(templatePath, html);

  const count = Object.keys(locale[pageKey]).length;
  console.log(`  ${templatePath} → ${count} page strings`);
}

// ============================================================
// Run
// ============================================================
console.log('Extracting strings from HTML files...\n');

for (const page of PAGES) {
  processPage(page);
}

// Write en.json
const enJson = { _meta: locale._meta.en, shared: locale.shared };
for (const page of PAGES) {
  if (locale[page.pageKey] && Object.keys(locale[page.pageKey]).length > 0) {
    enJson[page.pageKey] = locale[page.pageKey];
  }
}

fs.mkdirSync(LOCALE_DIR, { recursive: true });
fs.writeFileSync(
  path.join(LOCALE_DIR, 'en.json'),
  JSON.stringify(enJson, null, 2),
  'utf8'
);

// Summary
const totalShared = Object.keys(locale.shared).length;
const totalPage = PAGES.reduce((sum, p) => sum + Object.keys(locale[p.pageKey] || {}).length, 0);
console.log(`\nDone!`);
console.log(`  Shared strings: ${totalShared}`);
console.log(`  Page strings: ${totalPage}`);
console.log(`  Total: ${totalShared + totalPage}`);
console.log(`  Output: src/locales/en.json`);
console.log(`  Templates: src/templates/`);
