#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const BASE = 'https://teslamattress.com';
const pages = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/pages.json'), 'utf8'));

const decode = value => String(value || '')
  .replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'")
  .replace(/&nbsp;/g, ' ')
  .replace(/&[a-zA-Z0-9#]+;/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const textContent = html => decode(html
  .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
  .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
  .replace(/<[^>]+>/g, ' '));

const cleanPath = output => {
  if (output === 'index.html') return '/';
  return `/${output.replace(/\/index\.html$/, '').replace(/\.html$/, '')}`;
};

const records = pages.map(page => {
  const file = path.join(DIST, page.output);
  const html = fs.readFileSync(file, 'utf8');
  const pagePath = cleanPath(page.output);
  const title = decode((html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]);
  const description = decode((html.match(/<meta\s+name="description"\s+content="([^"]*)"/i) || [])[1]);
  const canonical = decode((html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/i) || [])[1]);
  const robots = decode((html.match(/<meta\s+name="robots"\s+content="([^"]+)"/i) || [])[1]);
  const ogImage = decode((html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i) || [])[1]);
  const h1s = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(match => textContent(match[1]));
  const headings = [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)]
    .map(match => ({ level: Number(match[1]), text: textContent(match[2]) }));
  const images = [...html.matchAll(/<img\b([^>]*)>/gi)].map(match => {
    const attrs = match[1];
    return {
      src: decode((attrs.match(/\bsrc="([^"]*)"/i) || [])[1]),
      hasAlt: /\balt="/i.test(attrs),
      alt: decode((attrs.match(/\balt="([^"]*)"/i) || [])[1]),
      lazy: /\bloading="lazy"/i.test(attrs),
    };
  });
  const hrefs = [...html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/gi)].map(match => decode(match[1]));
  const jsonLd = [...html.matchAll(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi)].map(match => match[1].trim());
  const schemaTypes = [];
  const schemaErrors = [];
  jsonLd.forEach((block, index) => {
    try {
      const parsed = JSON.parse(block);
      const visit = value => {
        if (Array.isArray(value)) return value.forEach(visit);
        if (!value || typeof value !== 'object') return;
        if (value['@type']) schemaTypes.push(...(Array.isArray(value['@type']) ? value['@type'] : [value['@type']]));
        Object.values(value).forEach(visit);
      };
      visit(parsed);
    } catch (error) {
      schemaErrors.push(`block ${index + 1}: ${error.message}`);
    }
  });
  const words = textContent(html).split(/\s+/).filter(Boolean).length;
  const headingJumps = [];
  headings.forEach((heading, index) => {
    if (index && heading.level > headings[index - 1].level + 1) {
      headingJumps.push(`H${headings[index - 1].level}→H${heading.level}: ${heading.text}`);
    }
  });

  return {
    key: page.pageKey,
    template: page.template,
    output: page.output,
    path: pagePath,
    title,
    titleLength: title.length,
    description,
    descriptionLength: description.length,
    canonical,
    expectedCanonical: pagePath === '/' ? `${BASE}/` : `${BASE}${pagePath}`,
    robots,
    indexable: !/noindex/i.test(robots),
    ogImage,
    h1s,
    headings,
    headingJumps,
    images,
    hrefs,
    jsonLdCount: jsonLd.length,
    schemaTypes: [...new Set(schemaTypes)],
    schemaErrors,
    words,
  };
});

const byPath = new Map(records.map(record => [record.path, record]));
for (const record of records) record.inlinks = 0;
for (const record of records) {
  record.internalTargets = [...new Set(record.hrefs
    .filter(href => href.startsWith('/') && !href.startsWith('//'))
    .map(href => href.split(/[?#]/)[0].replace(/\/$/, '') || '/')
    .filter(href => byPath.has(href)))];
  record.internalTargets.forEach(target => byPath.get(target).inlinks++);
}

const duplicates = field => {
  const groups = new Map();
  records.filter(record => record.indexable).forEach(record => {
    const value = record[field];
    if (!value) return;
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(record.path);
  });
  return [...groups.entries()].filter(([, paths]) => paths.length > 1).map(([value, paths]) => ({ value, paths }));
};

const issues = {
  missingTitles: records.filter(record => !record.title).map(record => record.path),
  longTitles: records.filter(record => record.titleLength > 65).map(record => ({ path: record.path, length: record.titleLength })),
  shortTitles: records.filter(record => record.titleLength > 0 && record.titleLength < 25).map(record => ({ path: record.path, length: record.titleLength })),
  missingDescriptions: records.filter(record => !record.description).map(record => record.path),
  longDescriptions: records.filter(record => record.descriptionLength > 165).map(record => ({ path: record.path, length: record.descriptionLength })),
  shortDescriptions: records.filter(record => record.descriptionLength > 0 && record.descriptionLength < 110).map(record => ({ path: record.path, length: record.descriptionLength })),
  duplicateTitles: duplicates('title'),
  duplicateDescriptions: duplicates('description'),
  canonicalMismatch: records.filter(record => record.canonical !== record.expectedCanonical).map(record => ({ path: record.path, canonical: record.canonical, expected: record.expectedCanonical })),
  h1Issues: records.filter(record => record.h1s.length !== 1).map(record => ({ path: record.path, count: record.h1s.length })),
  headingJumps: records.filter(record => record.headingJumps.length).map(record => ({ path: record.path, jumps: record.headingJumps })),
  missingAlt: records.flatMap(record => record.images.filter(image => !image.hasAlt).map(image => ({ path: record.path, src: image.src }))),
  schemaErrors: records.filter(record => record.schemaErrors.length).map(record => ({ path: record.path, errors: record.schemaErrors })),
  missingSchema: records.filter(record => record.indexable && record.jsonLdCount === 0).map(record => record.path),
  thinPages: records.filter(record => record.indexable && record.words < 300).map(record => ({ path: record.path, words: record.words, template: record.template })),
  orphanPages: records.filter(record => record.indexable && record.path !== '/' && record.inlinks === 0).map(record => record.path),
  missingOgImages: records.filter(record => record.indexable && !record.ogImage).map(record => record.path),
};

const schemaCounts = {};
records.forEach(record => record.schemaTypes.forEach(type => { schemaCounts[type] = (schemaCounts[type] || 0) + 1; }));
const imageCounts = records.map(record => record.images.length).sort((a, b) => a - b);
const wordCounts = records.filter(record => record.indexable).map(record => record.words).sort((a, b) => a - b);
const median = values => values.length ? values[Math.floor(values.length / 2)] : 0;

const report = {
  generatedAt: new Date().toISOString(),
  summary: {
    pages: records.length,
    indexablePages: records.filter(record => record.indexable).length,
    noindexPages: records.filter(record => !record.indexable).map(record => record.path),
    totalWords: records.filter(record => record.indexable).reduce((sum, record) => sum + record.words, 0),
    medianWords: median(wordCounts),
    minWords: wordCounts[0],
    maxWords: wordCounts[wordCounts.length - 1],
    totalImages: records.reduce((sum, record) => sum + record.images.length, 0),
    medianImages: median(imageCounts),
    totalInternalTargetLinks: records.reduce((sum, record) => sum + record.internalTargets.length, 0),
    schemaCounts,
  },
  issues,
  pages: records.map(({ headings, hrefs, images, ...record }) => ({
    ...record,
    imageCount: images.length,
    emptyAltCount: images.filter(image => image.hasAlt && !image.alt).length,
    missingAltCount: images.filter(image => !image.hasAlt).length,
  })),
};

const output = process.argv[2] || path.join(ROOT, 'seo-audit.json');
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);

console.log(JSON.stringify(report.summary, null, 2));
for (const [name, value] of Object.entries(issues)) {
  console.log(`${name}: ${value.length}`);
}
console.log(`Report: ${output}`);
