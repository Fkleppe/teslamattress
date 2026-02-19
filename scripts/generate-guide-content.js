#!/usr/bin/env node
// generate-guide-content.js - Extract translation keys from guide templates
// and generate English content using Claude API
// Usage: node scripts/generate-guide-content.js [--section guide_best_mattresses]

const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const ROOT = path.join(__dirname, '..');
const TEMPLATE_DIR = path.join(ROOT, 'src', 'templates', 'guides');
const LOCALE_DIR = path.join(ROOT, 'src', 'locales');
const PAGES = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'pages.json'), 'utf8'));

// Parse CLI args
const args = process.argv.slice(2);
const sectionIdx = args.indexOf('--section');
const selectedSection = sectionIdx !== -1 ? args[sectionIdx + 1] : null;

// Guide page configs with context for content generation
const GUIDE_CONFIGS = {
  guides_index: {
    title: 'Tesla Camping Guides Hub Page',
    context: 'Hub page listing all guide articles. Cards with titles, descriptions, badges. Tone: helpful, inviting.',
  },
  guide_best_mattresses: {
    title: '10 Best Tesla Camping Mattresses (2026)',
    context: 'Listicle ranking 10 Tesla camping mattresses. Products: Snuuzu Model Y (9.4/10, €899, best overall), Havnby Autolevel (8.6/10, $359.99, best value), TESMAT Luxe Y (8.5/10, $379, best kit), Snuuzu Model 3 (9.2/10, €899), Havnby Foam (7.8/10, $169.99, budget), NovaPads (7.5/10, ~$199), TESMAT Solo Y (7.6/10, ~$249), Havnby Solo (7.4/10, $159.99), TESMAT Luxe M3 (8.3/10, $379), TESMAT Solo M3 (7.5/10, ~$249). Include comparison, buying guide section, methodology mention. Author: Fredrik Mastouri, since 2017.',
  },
  guide_best_model_y: {
    title: 'Best Tesla Model Y Mattress (2025 Juniper Update)',
    context: 'Model Y-specific mattress guide. Cover 2025 Juniper refresh compatibility. Products: Snuuzu Y (9.4, best), Havnby Autolevel (8.6, best value), TESMAT Luxe Y (8.5), NovaPads (7.5), Havnby Foam (7.8), TESMAT Solo Y (7.6), Havnby Solo (7.4). Model Y cargo: 83" long when seats folded, 41" wide, panoramic roof. Juniper has one-touch electric seat fold.',
  },
  guide_best_model_3: {
    title: 'Best Tesla Model 3 Mattress: Ranked & Reviewed',
    context: 'Model 3-specific guide. Model 3 challenges: smaller cargo (76" long, 37" wide), not perfectly flat (hinge gap), sedan form factor. Products: Snuuzu M3 (9.2, best), TESMAT Luxe M3 (8.3), TESMAT Solo M3 (7.5), Havnby Foam (7.8, fits both). Address trunk hinge problem.',
  },
  guide_budget: {
    title: 'Budget Tesla Mattress: Best Options Under $250',
    context: 'Budget-focused guide. Products: Havnby Foam ($169.99, best budget), Havnby Solo ($159.99, lightest), NovaPads (~$199, budget hybrid), TESMAT Solo Y (~$249, near-budget). Include cost-per-use calculations. Compare budget vs premium. When to save vs invest.',
  },
  guide_cybertruck: {
    title: 'Tesla Cybertruck Camping Mattress Guide',
    context: 'Cybertruck camping guide. Cover truck bed AND rear cabin sleeping. Products: Tesery Cybertruck mattress, generic options. V2L power advantage (bidirectional charging). Cybertruck-specific Camp Mode. Newer market, fewer dedicated products.',
  },
  guide_model_x: {
    title: 'Tesla Model X Camping Mattress: Best Options',
    context: 'Model X guide. Larger cabin than Model Y, falcon wing doors. Most Model Y mattresses fit ~90% of Model X. Products: Havnby Autolevel (confirmed compatible), Havnby Foam, Snuuzu (may fit). Unique advantages: more headroom, falcon wing doors for ventilation.',
  },
  guide_buying: {
    title: 'Tesla Mattress Buying Guide: How to Choose',
    context: 'Educational buyers guide. Types: foam (dense, no puncture risk), air (lightweight, adjustable), hybrid (best of both). Key factors: thickness (4-8 inches), storage size, weight, compatibility, price ($150-$900). Model-specific considerations. Testing methodology: 6 criteria. Decision matrix.',
  },
  guide_tesla_vs_generic: {
    title: 'Tesla-Specific vs Generic Car Mattress: Is It Worth It?',
    context: 'Addresses buyer objection "why not a regular air mattress?" Differences: custom fit vs gap at trunk hinge, sub-trunk storage, surface leveling. Tesla-specific: perfect fit, integrated pump, no shifting. Generic: cheaper, multi-car, easy replace. Recommendations by tier: Havnby Foam ($170 entry), TESMAT Luxe ($379 mid), Snuuzu ($899 premium).',
  },
  guide_getting_started: {
    title: 'Getting Started With Tesla Camping: Complete Beginner\'s Guide',
    context: 'First-timer guide. Why camp in Tesla (Camp Mode, no engine, climate controlled). What is Camp Mode (step-by-step, 5-15% battery overnight). Essential gear checklist. Step-by-step setup: charge to 50%, fold seats, lay mattress, install shades, activate Camp Mode. Morning routine. Common mistakes.',
  },
  guide_dogs: {
    title: 'Tesla Camping With Dogs: Setup, Tips & Best Mattress',
    context: 'Pet owner guide. Dog Mode vs Camp Mode (Dog Mode shows screen message, Camp Mode better overnight). Mattress for dogs: claw resistance (foam safer than air), easy clean, durability. Products: Havnby Foam ($170, no puncture), Havnby Autolevel ($360, wipe-clean), Snuuzu ($899, waterproof TPU base). Safety: temperature monitoring, never Sentry Mode only.',
  },
};

// Extract all {{t.section.key}} placeholders from a template
function extractKeys(templatePath) {
  const html = fs.readFileSync(templatePath, 'utf8');
  const regex = /\{\{t\.([a-zA-Z0-9_]+)\.([a-zA-Z0-9_&+'"(). -]+)\}\}/g;
  const keys = {};
  let match;
  while ((match = regex.exec(html)) !== null) {
    const [, section, key] = match;
    if (section === 'shared') continue; // shared keys already exist
    if (!keys[section]) keys[section] = new Set();
    keys[section].add(key);
  }
  // Convert sets to arrays
  for (const section of Object.keys(keys)) {
    keys[section] = [...keys[section]];
  }
  return keys;
}

// Generate content for a section using Claude API
async function generateContent(client, section, keys, config) {
  const keyList = keys.join('\n- ');

  const systemPrompt = `You are a content writer for teslamattress.com, an independent Tesla camping mattress review website run by Fredrik Mastouri since 2017. Write natural, confident, helpful content. Not corporate or stiff. You're an experienced reviewer who has tested 100+ nights.

CRITICAL RULES:
1. Return ONLY a valid JSON object with the exact keys provided
2. Every key must have a non-empty string value
3. For meta_title: keep under 60 characters
4. For meta_description: keep under 160 characters
5. For og_title and twitter_title: include site name context
6. For h1, h2, h3 keys: write clear, descriptive headings
7. For p_* keys: write substantial paragraphs (2-4 sentences, informative)
8. For li_* keys: write concise list items (1-2 sentences)
9. For span_* keys: write short labels or values
10. For btn_* keys: write action-oriented button text
11. For badge_* keys: write short category labels
12. For jsonld_* keys: write appropriate schema.org content
13. Do NOT include brand names in translated content where the key suggests a label/description
14. Preserve any HTML tags if the key suggests they should contain HTML
15. Write in English`;

  const userPrompt = `Generate English content for the article "${config.title}" on teslamattress.com.

Context: ${config.context}

Generate a JSON object with these exact keys and appropriate English content values:
- ${keyList}

Return ONLY the JSON object, no markdown fences or explanation.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 16384,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content[0].text.trim();
  let jsonStr = text;
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(jsonStr);
    // Verify all keys are present
    const missing = keys.filter(k => !(k in parsed));
    if (missing.length > 0) {
      console.warn(`  Warning: ${missing.length} missing keys for ${section}:`);
      missing.forEach(k => console.warn(`    - ${k}`));
      // Fill missing with key-based defaults
      for (const k of missing) {
        parsed[k] = k.replace(/_/g, ' ').replace(/^(h\d|p|li|span|btn|badge|meta|og|twitter|jsonld \d+) /, '');
      }
    }
    return parsed;
  } catch (err) {
    console.error(`  Failed to parse JSON for ${section}: ${err.message}`);
    console.error(`  First 200 chars: ${jsonStr.slice(0, 200)}`);
    return null;
  }
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('Error: ANTHROPIC_API_KEY not set');
    process.exit(1);
  }
  const client = new Anthropic();

  // Extract keys from all guide templates
  console.log('Extracting translation keys from guide templates...\n');
  const allKeys = {};
  const guideFiles = fs.readdirSync(TEMPLATE_DIR).filter(f => f.endsWith('.html'));
  for (const file of guideFiles) {
    const fileKeys = extractKeys(path.join(TEMPLATE_DIR, file));
    for (const [section, keys] of Object.entries(fileKeys)) {
      if (allKeys[section]) {
        keys.forEach(k => {
          if (!allKeys[section].includes(k)) allKeys[section].push(k);
        });
      } else {
        allKeys[section] = keys;
      }
    }
  }

  // Filter to selected section if specified
  const sections = selectedSection
    ? { [selectedSection]: allKeys[selectedSection] }
    : allKeys;

  // Count
  let totalKeys = 0;
  for (const [section, keys] of Object.entries(sections)) {
    if (keys) {
      console.log(`  ${section}: ${keys.length} keys`);
      totalKeys += keys.length;
    }
  }
  console.log(`\n  Total: ${totalKeys} keys to generate\n`);

  // Load existing en.json
  const enPath = path.join(LOCALE_DIR, 'en.json');
  const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));

  // Generate content for each section
  for (const [section, keys] of Object.entries(sections)) {
    if (!keys || keys.length === 0) continue;
    const config = GUIDE_CONFIGS[section];
    if (!config) {
      console.warn(`  No config for ${section}, skipping`);
      continue;
    }

    // Skip if section already exists with same key count
    if (en[section] && Object.keys(en[section]).length >= keys.length) {
      console.log(`  ${section}: already has ${Object.keys(en[section]).length} keys, skipping`);
      continue;
    }

    // Split into chunks if too many keys (API limit)
    const CHUNK_SIZE = 150;
    const chunks = [];
    for (let i = 0; i < keys.length; i += CHUNK_SIZE) {
      chunks.push(keys.slice(i, i + CHUNK_SIZE));
    }

    console.log(`  ${section}: generating ${keys.length} keys (${chunks.length} chunk(s))...`);

    en[section] = en[section] || {};

    for (let ci = 0; ci < chunks.length; ci++) {
      const chunk = chunks[ci];
      if (chunks.length > 1) {
        process.stdout.write(`    chunk ${ci + 1}/${chunks.length}...`);
      }

      const result = await generateContent(client, section, chunk, config);
      if (result) {
        Object.assign(en[section], result);
        if (chunks.length > 1) console.log(` done (${Object.keys(result).length} keys)`);
      } else {
        if (chunks.length > 1) console.log(` FAILED`);
      }

      // Save after each chunk
      fs.writeFileSync(enPath, JSON.stringify(en, null, 2), 'utf8');

      // Rate limit
      await new Promise(r => setTimeout(r, 500));
    }

    console.log(`  ${section}: done (${Object.keys(en[section]).length} keys)`);
  }

  console.log(`\nDone! Updated ${enPath}`);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
