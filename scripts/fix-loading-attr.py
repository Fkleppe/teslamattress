#!/usr/bin/env python3
"""Add loading="eager" to VS detail page brand logos missing loading attribute."""

import re
import glob

# VS detail pages (not index.html which already has loading="lazy")
vs_detail_files = [
    "src/templates/vs/snuuzu-vs-tesmat.html",
    "src/templates/vs/snuuzu-vs-dreamcase.html",
    "src/templates/vs/snuuzu-vs-havnby.html",
    "src/templates/vs/tesmat-vs-havnby.html",
]

total = 0
for filepath in vs_detail_files:
    with open(filepath, 'r') as f:
        content = f.read()
    original = content

    # Add loading="eager" to img tags that don't have a loading attribute
    content = re.sub(
        r'(<img\s+src="[^"]*"[^>]*alt="[^"]*")\s+(width="120"\s+height="40">)',
        r'\1 loading="eager" \2',
        content
    )

    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        count = content.count('loading="eager"') - original.count('loading="eager"')
        print(f"  {filepath}: +{count} loading='eager'")
        total += count

# Also fix discounts/index.html Snuuzu logo (above fold, missing loading)
filepath = "src/templates/discounts/index.html"
with open(filepath, 'r') as f:
    content = f.read()
original = content

# Add loading="eager" to Snuuzu logo that's missing it
content = content.replace(
    'alt="Snuuzu Logo" class="brand-logo-large" width="200" height="60">',
    'alt="Snuuzu Logo" class="brand-logo-large" loading="eager" width="200" height="60">'
)

if content != original:
    with open(filepath, 'w') as f:
        f.write(content)
    print(f"  {filepath}: +1 loading='eager'")
    total += 1

print(f"\nTotal: {total} loading attributes added")
