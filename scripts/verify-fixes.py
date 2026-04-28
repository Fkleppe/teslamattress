#!/usr/bin/env python3
"""Verify all SEO fixes in built output."""

import subprocess, os, re

def check(label, condition):
    status = "PASS" if condition else "FAIL"
    print(f"  {status}: {label}")
    return condition

all_pass = True

# 1: No FAQPage schema
result = subprocess.run(['grep', '-rl', '"FAQPage"', 'dist/'], capture_output=True, text=True)
faq_files = [f for f in result.stdout.strip().split('\n') if f]
all_pass &= check(f"No FAQPage JSON-LD ({len(faq_files)} files)", len(faq_files) == 0)

# 2: No HowTo in discount pages
result = subprocess.run(['grep', '-rl', '"HowTo"', 'dist/discounts/'], capture_output=True, text=True)
howto_files = [f for f in result.stdout.strip().split('\n') if f]
all_pass &= check(f"No HowTo in discounts ({len(howto_files)} files)", len(howto_files) == 0)

# 3: German breadcrumbs localized
with open('dist/de/reviews/snuuzu-model-y.html', 'r') as f:
    c = f.read()
all_pass &= check("German breadcrumbs (Startseite)", 'Startseite' in c)

# 4: Hub URLs localized
with open('dist/de/reviews/index.html', 'r') as f:
    c = f.read()
all_pass &= check("German hub URLs (/de/reviews/...)", '/de/reviews/snuuzu-model-y' in c)

# 5: No #comparison
with open('dist/reviews/snuuzu-model-y.html', 'r') as f:
    c = f.read()
all_pass &= check("No #comparison in breadcrumbs", '#comparison' not in c)

# 6: No aggregateRating in discount pages
with open('dist/discounts/snuuzu.html', 'r') as f:
    c = f.read()
all_pass &= check("No aggregateRating in discounts", 'aggregateRating' not in c)

# 7: Image dimensions
with open('dist/vs/snuuzu-vs-tesmat.html', 'r') as f:
    c = f.read()
w120 = 'width="120"'
all_pass &= check("Image dimensions on VS pages", w120 in c)

# 8: No trailing slashes
with open('dist/index.html', 'r') as f:
    c = f.read()
trailing = re.findall(r'/(reviews|vs|guides|discounts)/"', c)
all_pass &= check(f"No trailing slashes on hub links ({len(trailing)} found)", len(trailing) == 0)

# 9: CSS minified
src_size = os.path.getsize('styles.css')
dst_size = os.path.getsize('dist/styles.css')
reduction = 100 - dst_size * 100 // src_size
all_pass &= check(f"CSS minified {src_size//1024}KB -> {dst_size//1024}KB ({reduction}% smaller)", reduction > 20)

# 10: Image cache
with open('vercel.json', 'r') as f:
    vc = f.read()
all_pass &= check("Image cache 1 year (31536000)", '31536000' in vc)

print(f"\n{'ALL CHECKS PASSED' if all_pass else 'SOME CHECKS FAILED'}")
