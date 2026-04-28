#!/usr/bin/env python3
"""Add inLanguage to top-level JSON-LD schemas."""

import re
import os
import glob

TEMPLATES_DIR = "src/templates"

# Match top-level JSON-LD blocks: find @type right after @context
# We want to add inLanguage after @type for: Product, Article, WebPage, WebSite
# But NOT for BreadcrumbList (not applicable) and NOT for nested types

TYPES_TO_TAG = {"Product", "Article", "WebPage", "WebSite"}

def process_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()

    original = content

    # Find all JSON-LD blocks
    blocks = list(re.finditer(
        r'<script type="application/ld\+json">\s*\n\s*\{',
        content
    ))

    if not blocks:
        return 0

    changes = 0
    # Process in reverse to keep offsets valid
    for match in reversed(blocks):
        block_start = match.start()

        # Find the end of this script block
        block_end = content.find('</script>', block_start)
        if block_end == -1:
            continue

        block = content[block_start:block_end]

        # Skip if already has inLanguage at top level
        # Check within first 200 chars of block for inLanguage
        first_part = block[:300]
        if '"inLanguage"' in first_part:
            continue

        # Find the @type line at top level (indented at the same level as @context)
        # Look for pattern: "@context": "...",\n        "@type": "SomeType",
        type_match = re.search(
            r'("@context":\s*"https://schema\.org",?\s*\n\s*"@type":\s*"(\w+)")',
            block
        )

        if not type_match:
            continue

        schema_type = type_match.group(2)
        if schema_type not in TYPES_TO_TAG:
            continue

        # Find the @type line position and insert inLanguage after it
        type_line_match = re.search(
            r'("@type":\s*"' + schema_type + r'")(,?)\s*\n',
            block
        )

        if not type_line_match:
            continue

        # Determine indentation
        type_line_start = block.rfind('\n', 0, type_line_match.start()) + 1
        indent = ''
        for ch in block[type_line_start:]:
            if ch in (' ', '\t'):
                indent += ch
            else:
                break

        # Build the insertion
        insert_pos = block_start + type_line_match.end()
        comma = type_line_match.group(2)

        if not comma:
            # Need to add comma after @type
            old_type_end = block_start + type_line_match.start() + len(type_line_match.group(1))
            content = content[:old_type_end] + ',' + content[old_type_end:]
            insert_pos += 1  # account for added comma

        new_line = indent + '"inLanguage": "{{htmlLang}}",\n'
        content = content[:insert_pos] + new_line + content[insert_pos:]
        changes += 1

    if changes > 0:
        with open(filepath, 'w') as f:
            f.write(content)

    return changes


total = 0
files_changed = 0

for filepath in sorted(glob.glob(os.path.join(TEMPLATES_DIR, "**/*.html"), recursive=True)):
    count = process_file(filepath)
    if count > 0:
        print(f"  {filepath}: +{count} inLanguage")
        total += count
        files_changed += 1

print(f"\nTotal: {total} inLanguage added across {files_changed} files")
