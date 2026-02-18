#!/usr/bin/env node
// translate.js - Translate en.json into other locales using Claude Sonnet API
// Usage: node scripts/translate.js [--locales de,fr] [--sections shared,home]
// Requires: ANTHROPIC_API_KEY env var

const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const ROOT = path.join(__dirname, '..');
const LOCALE_DIR = path.join(ROOT, 'src', 'locales');

// Parse CLI args
const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1].split(',') : null;
}

const selectedLocales = getArg('--locales');
const selectedSections = getArg('--sections');

const TARGET_LOCALES = {
  de: {
    name: 'German',
    instructions: 'Use informal "du" (not "Sie"). Natural, conversational tone. German compound nouns are fine.',
  },
  fr: {
    name: 'French',
    instructions: 'Use informal "tu" (not "vous"). Natural, modern French.',
  },
  no: {
    name: 'Norwegian Bokmaal',
    instructions: 'Use Bokmaal (not Nynorsk). Informal tone.',
  },
  da: {
    name: 'Danish',
    instructions: 'Informal, conversational Danish.',
  },
  sv: {
    name: 'Swedish',
    instructions: 'Informal, conversational Swedish.',
  },
};

const LOCALE_META = {
  de: { locale: 'de', locale_path: 'de/', og_locale: 'de_DE', html_lang: 'de' },
  fr: { locale: 'fr', locale_path: 'fr/', og_locale: 'fr_FR', html_lang: 'fr' },
  no: { locale: 'no', locale_path: 'no/', og_locale: 'nb_NO', html_lang: 'nb' },
  da: { locale: 'da', locale_path: 'da/', og_locale: 'da_DK', html_lang: 'da' },
  sv: { locale: 'sv', locale_path: 'sv/', og_locale: 'sv_SE', html_lang: 'sv' },
};

const SYSTEM_PROMPT = `You are a professional translator for a Tesla car camping mattress review website. Translate the JSON values from English to {{LANG}}.

CRITICAL RULES:
1. ONLY translate the VALUES, never the keys
2. Return valid JSON with identical structure
3. Preserve ALL HTML tags (<br>, <span>, <strong>, <a>, etc.) exactly as-is
4. Do NOT translate: brand names (Snuuzu, Havnby, TESMAT, NovaPads, Tesla, Teslamattress, Dreamcase, Jowua, Shop4Tesla, Yeslak, Hansshow), model names (Model Y, Model 3), discount codes (KLEPPE, AWD, FREDRIK), person names (Fredrik Mastouri)
5. Do NOT translate: prices, scores, measurements, dates, URLs, CSS classes
6. Preserve the tone: confident, friendly, independent reviewer. Not corporate or stiff.
7. {{EXTRA_INSTRUCTIONS}}
8. For meta_title and og_title: keep them under 60 characters when possible
9. For meta_description: keep under 160 characters
10. Preserve any {{t.xxx}} template placeholders exactly as-is`;

async function translateSection(client, sectionKey, sectionData, targetLocale) {
  const localeInfo = TARGET_LOCALES[targetLocale];
  const systemPrompt = SYSTEM_PROMPT
    .replace('{{LANG}}', localeInfo.name)
    .replace('{{EXTRA_INSTRUCTIONS}}', localeInfo.instructions);

  const userPrompt = `Translate this JSON section ("${sectionKey}") to ${localeInfo.name}. Return ONLY the translated JSON object, no markdown fences:\n\n${JSON.stringify(sectionData, null, 2)}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8192,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content[0].text.trim();

  // Extract JSON from response (strip markdown fences if present)
  let jsonStr = text;
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  try {
    return JSON.parse(jsonStr);
  } catch (err) {
    console.error(`    Failed to parse JSON for ${sectionKey} → ${targetLocale}:`);
    console.error(`    ${err.message}`);
    console.error(`    Response: ${jsonStr.slice(0, 200)}...`);
    return null;
  }
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('Error: ANTHROPIC_API_KEY environment variable not set');
    process.exit(1);
  }

  const client = new Anthropic();

  // Load English source
  const enPath = path.join(LOCALE_DIR, 'en.json');
  const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));

  // Get sections to translate
  const allSections = Object.keys(en).filter(k => k !== '_meta');
  const sections = selectedSections || allSections;

  // Get target locales
  const locales = selectedLocales || Object.keys(TARGET_LOCALES);

  console.log(`Translating ${sections.length} sections into ${locales.length} languages...\n`);
  console.log(`  Sections: ${sections.join(', ')}`);
  console.log(`  Locales: ${locales.join(', ')}`);
  console.log(`  Estimated API calls: ${sections.length * locales.length}\n`);

  for (const locale of locales) {
    if (!TARGET_LOCALES[locale]) {
      console.warn(`  Unknown locale: ${locale}, skipping`);
      continue;
    }

    console.log(`\n  Translating to ${TARGET_LOCALES[locale].name} (${locale})...`);

    // Load existing locale file or start fresh
    const localePath = path.join(LOCALE_DIR, `${locale}.json`);
    let localeData = {};
    if (fs.existsSync(localePath)) {
      localeData = JSON.parse(fs.readFileSync(localePath, 'utf8'));
    }

    // Set meta
    localeData._meta = LOCALE_META[locale];

    let translated = 0;
    let failed = 0;

    for (const section of sections) {
      if (!en[section]) {
        console.warn(`    Section "${section}" not found in en.json, skipping`);
        continue;
      }

      // Skip if already translated and not forced
      if (localeData[section] && Object.keys(localeData[section]).length === Object.keys(en[section]).length) {
        console.log(`    ${section}: already translated (${Object.keys(localeData[section]).length} keys)`);
        continue;
      }

      process.stdout.write(`    ${section}: translating ${Object.keys(en[section]).length} keys...`);

      const result = await translateSection(client, section, en[section], locale);

      if (result) {
        localeData[section] = result;
        translated++;
        console.log(` done`);
      } else {
        failed++;
        console.log(` FAILED`);
      }

      // Save after each section (crash recovery)
      fs.writeFileSync(localePath, JSON.stringify(localeData, null, 2), 'utf8');

      // Rate limit: small delay between calls
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log(`    ${TARGET_LOCALES[locale].name}: ${translated} sections translated, ${failed} failed`);
  }

  console.log('\nDone! Locale files written to src/locales/');
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
