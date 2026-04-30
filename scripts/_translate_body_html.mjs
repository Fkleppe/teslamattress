// Translate body_html as plain HTML (not JSON) - avoids escaping issues
// Each body translated individually, streaming, tolerant of failures, saves after each

import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';

const ROOT = process.cwd();
const LOCALE_DIR = path.join(ROOT, 'src', 'locales');

const TARGET_LOCALES = {
  de: { name: 'German', extra: 'Use informal "du". Natural, conversational.' },
  fr: { name: 'French', extra: 'Use informal "tu". Natural, modern French.' },
  no: { name: 'Norwegian Bokmaal', extra: 'Use Bokmaal. Informal tone.' },
  da: { name: 'Danish', extra: 'Informal, conversational Danish.' },
  sv: { name: 'Swedish', extra: 'Informal, conversational Swedish.' },
};

const SYSTEM_PROMPT = `You are translating HTML content from English to {{LANG}}.

CRITICAL RULES:
1. Translate ONLY the visible text content
2. Preserve ALL HTML tags exactly: <h2>, <p>, <ul>, <li>, <strong>, <em>, <a href="...">, <table>, <tr>, <td>, <th>, <div>, <figure>, <img>, etc.
3. Preserve ALL HTML attributes exactly (href, class, style, src, alt, etc.) — do NOT translate URLs
4. Preserve HTML entities (&deg;, &mdash;, &rsaquo;, etc.)
5. Do NOT translate brand names: Snuuzu, Havnby, TESMAT, NovaPads, Tesla, Teslamattress, Dreamcase, Jowua, Shop4Tesla, Yeslak, Hansshow
6. Do NOT translate model names: Model Y, Model 3, Model X, Cybertruck
7. Do NOT translate discount codes: KLEPPE, AWD, FREDRIK, DISCOUNT, "10"
8. Do NOT translate person names: Fredrik Mastouri
9. Do NOT translate prices, scores, measurements (cm, kg, °C, $, €, NOK), dates, internal slug paths
10. Tone: confident, friendly, independent reviewer — first-person ("I tested" → "Ich habe getestet" / "J'ai testé" / "Jeg testet" / etc.)
11. {{EXTRA}}

Return ONLY the translated HTML — no markdown fences, no explanations, no preamble.`;

async function translateHtml(client, html, locale) {
  const info = TARGET_LOCALES[locale];
  const sys = SYSTEM_PROMPT.replace('{{LANG}}', info.name).replace('{{EXTRA}}', info.extra);

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const stream = client.messages.stream({
        model: 'claude-sonnet-4-6',
        max_tokens: 16384,
        system: sys,
        messages: [{ role: 'user', content: html }],
      });
      const resp = await stream.finalMessage();
      let text = resp.content[0].text.trim();
      // Strip any markdown fence wrappers
      const fence = text.match(/```(?:html)?\s*\n?([\s\S]*?)\n?```/);
      if (fence) text = fence[1].trim();
      return text;
    } catch (err) {
      if (attempt < 3) await new Promise(r => setTimeout(r, 2000));
      else { console.log(`  ! ${err.message?.slice(0,60)}`); return null; }
    }
  }
}

const SECTIONS_TO_TRANSLATE = [
  // Reviews (10)
  'review_snuuzu_model_y','review_snuuzu_model_3','review_havnby_autolevel','review_havnby_foam','review_havnby_solo',
  'review_tesery_novapads','review_tesmat_luxe_y','review_tesmat_luxe_3','review_tesmat_solo_y','review_tesmat_solo_3',
  // Discounts (8)
  'discount_snuuzu','discount_havnby','discount_novapads','discount_shop4tesla','discount_yeslak','discount_jowua','discount_hansshow','discount_tesery',
  // PAA (10)
  'paa_sleep_in_tesla_overnight','paa_tesla_camp_mode_safe','paa_battery_camping','paa_need_mattress','paa_winter_camping',
  'paa_what_size_mattress_y','paa_camping_legal','paa_couples_camping','paa_kid_friendly','paa_pump_required',
  // CK (8)
  'ck_couples_mattress','ck_tall_mattress','ck_winter_mattress','ck_side_sleepers','ck_with_pump','ck_quietest','ck_lightest','ck_under_300',
  // VS (4 new)
  'vs_tesmat_vs_novapads','vs_havnby_vs_novapads','vs_tesla_vs_air_mattress','vs_tesla_vs_sleeping_bag'
];

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) { console.error('No API key'); process.exit(1); }
  const client = new Anthropic();
  const en = JSON.parse(fs.readFileSync(path.join(LOCALE_DIR, 'en.json'), 'utf8'));

  // Stats
  const totalToTranslate = SECTIONS_TO_TRANSLATE.length * Object.keys(TARGET_LOCALES).length;
  let processed = 0;
  console.log(`Translating body_html for ${SECTIONS_TO_TRANSLATE.length} sections × ${Object.keys(TARGET_LOCALES).length} locales = ${totalToTranslate} translations\n`);

  for (const locale of Object.keys(TARGET_LOCALES)) {
    console.log(`\n=== ${TARGET_LOCALES[locale].name} (${locale}) ===`);
    const localePath = path.join(LOCALE_DIR, `${locale}.json`);
    const localeData = JSON.parse(fs.readFileSync(localePath, 'utf8'));

    let done = 0, skip = 0, fail = 0;
    for (const sec of SECTIONS_TO_TRANSLATE) {
      processed++;
      const enBody = en[sec]?.body_html;
      if (!enBody) { skip++; continue; }

      // Skip if already translated (locale body differs from EN body)
      if (localeData[sec]?.body_html && localeData[sec].body_html !== enBody && !localeData[sec].body_html.startsWith('<h2>Why I bought')) {
        skip++;
        continue;
      }

      const wordCount = enBody.replace(/<[^>]+>/g,' ').split(/\s+/).filter(Boolean).length;
      process.stdout.write(`  ${sec} (${wordCount}w) [${processed}/${totalToTranslate}]: `);

      const translated = await translateHtml(client, enBody, locale);

      if (translated && translated.length > enBody.length * 0.5) {
        if (!localeData[sec]) localeData[sec] = { ...en[sec] };
        localeData[sec].body_html = translated;
        done++;
        console.log(`✓ (${translated.length} chars)`);
      } else {
        fail++;
        console.log(`✗ (got ${translated?.length || 0} chars)`);
      }

      // Save after each section
      fs.writeFileSync(localePath, JSON.stringify(localeData, null, 2), 'utf8');
      await new Promise(r => setTimeout(r, 300));
    }

    console.log(`  ${locale}: ${done} translated, ${skip} skipped, ${fail} failed`);
  }
  console.log('\nAll body_html translated.');
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
