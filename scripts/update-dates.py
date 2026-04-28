#!/usr/bin/env python3
"""Update all dateModified and article:modified_time to today."""

import re
import glob

TODAY = "2026-02-19"
TEMPLATES_DIR = "src/templates"

total_jsonld = 0
total_meta = 0
files_changed = 0

for filepath in sorted(glob.glob(f"{TEMPLATES_DIR}/**/*.html", recursive=True)):
    with open(filepath, 'r') as f:
        content = f.read()

    original = content

    # Update dateModified in JSON-LD (but not datePublished)
    content, n1 = re.subn(
        r'"dateModified": "20\d{2}-\d{2}-\d{2}"',
        f'"dateModified": "{TODAY}"',
        content
    )

    # Update article:modified_time meta tags
    content, n2 = re.subn(
        r'content="20\d{2}-\d{2}-\d{2}">\s*(?=\n.*article:modified_time|\n)',
        f'content="{TODAY}">',
        content
    )

    # Simpler approach for article:modified_time
    content, n2 = re.subn(
        r'(<meta property="article:modified_time" content=")20\d{2}-\d{2}-\d{2}(")',
        rf'\g<1>{TODAY}\2',
        content
    )

    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        total_jsonld += n1
        total_meta += n2
        files_changed += 1
        print(f"  {filepath}: {n1} dateModified + {n2} article:modified_time")

print(f"\nTotal: {total_jsonld} dateModified + {total_meta} article:modified_time across {files_changed} files")
