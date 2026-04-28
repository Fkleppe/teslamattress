#!/usr/bin/env python3
"""Fix hardcoded English URLs in hub page JSON-LD schemas."""

import re
import os

hub_files = [
    'src/templates/reviews/index.html',
    'src/templates/discounts/index.html',
    'src/templates/vs/index.html',
    'src/templates/guides/index.html',
]

for filepath in hub_files:
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    original = content

    def replace_url(m):
        section = m.group(1)
        path = m.group(2) or ""
        return f'"url": "https://teslamattress.com/{{{{localePath}}}}{section}{path}"'

    content = re.sub(
        r'"url": "https://teslamattress\.com/(reviews|discounts|vs|guides)(/[^"]*)"',
        replace_url,
        content
    )
    # Also match URLs without trailing path (e.g., .com/vs")
    content = re.sub(
        r'"url": "https://teslamattress\.com/(reviews|discounts|vs|guides)"',
        lambda m: f'"url": "https://teslamattress.com/{{{{localePath}}}}{m.group(1)}"',
        content
    )

    if content != original:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        changes = content.count('{{localePath}}') - original.count('{{localePath}}')
        print(f"  {os.path.basename(filepath)}: {changes} URLs localized")
