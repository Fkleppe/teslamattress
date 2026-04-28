#!/usr/bin/env python3
"""Remove deprecated FAQPage and HowTo JSON-LD schema blocks from templates.

- FAQPage: Restricted to government/healthcare sites since Aug 2023
- HowTo: Rich results deprecated since Sep 2023

Removes entire <script type="application/ld+json"> blocks containing these types.
Skips methodology.html HowTo (nested inside WebPage mainEntity).
"""

import re
import os
import glob
import json

TEMPLATES_DIR = os.path.join(os.path.dirname(__file__), '..', 'src', 'templates')

# Pattern to match entire JSON-LD script blocks
JSONLD_PATTERN = re.compile(
    r'(\s*<script\s+type="application/ld\+json">\s*\n)(.*?)(</script>)',
    re.DOTALL
)

def should_remove_block(json_text, filepath):
    """Check if a JSON-LD block should be removed."""
    try:
        # Strip template placeholders for JSON parsing check
        # We can't parse the JSON due to {{}} placeholders, so check raw text
        text = json_text.strip()

        # Check for FAQPage type
        if '"@type": "FAQPage"' in text or '"@type":"FAQPage"' in text:
            return True

        # Check for standalone HowTo type (not nested in WebPage)
        # In discount pages, HowTo is the root @type
        # In methodology.html, HowTo is nested inside mainEntity
        if ('"@type": "HowTo"' in text or '"@type":"HowTo"' in text):
            # Only remove if it's a standalone HowTo block (root level @type)
            # Don't remove from methodology.html where it's nested
            if 'methodology.html' not in filepath:
                return True

        return False
    except Exception:
        return False

def process_file(filepath):
    """Process a single template file and remove deprecated schema blocks."""
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    original = content
    removed_types = []

    def replacer(match):
        script_open = match.group(1)
        json_content = match.group(2)
        script_close = match.group(3)

        if should_remove_block(json_content, filepath):
            # Determine what type we're removing
            if '"FAQPage"' in json_content:
                removed_types.append('FAQPage')
            elif '"HowTo"' in json_content:
                removed_types.append('HowTo')
            # Remove the entire block plus surrounding whitespace
            return ''

        return match.group(0)

    content = JSONLD_PATTERN.sub(replacer, content)

    # Clean up any double blank lines left behind
    content = re.sub(r'\n{3,}', '\n\n', content)

    if content != original:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        return removed_types

    return []

def main():
    templates = glob.glob(os.path.join(TEMPLATES_DIR, '**', '*.html'), recursive=True)
    templates.sort()

    total_faq = 0
    total_howto = 0

    for filepath in templates:
        rel_path = os.path.relpath(filepath, TEMPLATES_DIR)
        removed = process_file(filepath)

        if removed:
            faq_count = removed.count('FAQPage')
            howto_count = removed.count('HowTo')
            total_faq += faq_count
            total_howto += howto_count
            print(f"  {rel_path}: removed {', '.join(removed)}")

    print(f"\nTotal: {total_faq} FAQPage + {total_howto} HowTo blocks removed from {total_faq + total_howto} locations")

if __name__ == '__main__':
    main()
