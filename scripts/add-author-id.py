#!/usr/bin/env python3
"""Add @id to author Person objects in guide templates that are missing it."""

import re

files_to_fix = [
    "src/templates/guides/getting-started-tesla-camping.html",
    "src/templates/guides/tesla-vs-generic-mattress.html",
    "src/templates/guides/best-model-3-mattress.html",
    "src/templates/guides/best-tesla-mattresses.html",
    "src/templates/guides/tesla-camping-with-dogs.html",
    "src/templates/guides/best-model-y-mattress.html",
]

AUTHOR_ID = '"@id": "https://teslamattress.com/#person"'
total = 0

for filepath in files_to_fix:
    with open(filepath, 'r') as f:
        content = f.read()
    original = content

    # Match author Person blocks missing @id - add @id after @type line
    # Handles varying indentation (tabs or spaces)
    content = re.sub(
        r'("@type": "Person",)\n(\s+)("name": "Fredrik Mastouri")',
        lambda m: f'{m.group(1)}\n{m.group(2)}"@id": "https://teslamattress.com/#person",\n{m.group(2)}{m.group(3)}',
        content
    )

    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        print(f"  {filepath}: added @id")
        total += 1

print(f"\nTotal: {total} files updated")
