#!/usr/bin/env python3
"""Remove non-standard discountCode and discountPercentage from discount page schemas."""

import re
import glob

files = sorted(glob.glob("src/templates/discounts/*.html"))
total = 0

for filepath in files:
    with open(filepath, 'r') as f:
        content = f.read()

    original = content

    # Remove lines with discountCode and discountPercentage
    content = re.sub(r'\s*"discountCode": "[^"]*",?\n', '\n', content)
    content = re.sub(r'\s*"discountPercentage": \d+,?\n', '\n', content)

    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        print(f"  Fixed: {filepath}")
        total += 1

print(f"\nRemoved non-standard properties from {total} files")
