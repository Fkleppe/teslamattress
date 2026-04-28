"""Add discount codes, buy links, and CTAs to all guide product cards and comparison tables.
Fully idempotent - cleans previous additions before re-applying."""
import re
import glob

PRODUCTS = {
    'Snuuzu Model Y': {'code': 'KLEPPE', 'slug': 'snuuzu-model-y', 'buy_url': 'https://www.snuuzu.com/products/snuuzu-model-y?bg_ref=s7fluA5re6'},
    'Snuuzu Model 3': {'code': 'KLEPPE', 'slug': 'snuuzu-model-3', 'buy_url': 'https://www.snuuzu.com/products/snuuzu-model-3?bg_ref=s7fluA5re6'},
    'Snuuzu': {'code': 'KLEPPE', 'slug': 'snuuzu-model-y', 'buy_url': 'https://www.snuuzu.com?bg_ref=s7fluA5re6'},
    'Havnby Autolevel': {'code': 'AWD', 'slug': 'havnby-autolevel', 'buy_url': 'https://havnby.com/products/autolevel-foam-tesla-model-y-mattress?ref=discount'},
    'Havnby Autolevel Foam': {'code': 'AWD', 'slug': 'havnby-autolevel', 'buy_url': 'https://havnby.com/products/autolevel-foam-tesla-model-y-mattress?ref=discount'},
    'Havnby Solo': {'code': 'AWD', 'slug': 'havnby-solo', 'buy_url': 'https://havnby.com/products/autolevel-foam-tesla-model-y-mattress-solo-edition?ref=discount'},
    'Havnby Foam': {'code': 'AWD', 'slug': 'havnby-foam', 'buy_url': 'https://havnby.com/products/tesla-model-y-3-x-foam-mattress?ref=discount'},
    'Havnby Foam Model Y/3': {'code': 'AWD', 'slug': 'havnby-foam', 'buy_url': 'https://havnby.com/products/tesla-model-y-3-x-foam-mattress?ref=discount'},
    'NovaPads Air-Foam Pro': {'code': 'AWD', 'slug': 'tesery-novapads', 'buy_url': 'https://novapads.com/products/tesla-model-y-air-foam-camping-mattress-pro-tesla-bed?ref=AWD'},
    'TESMAT Luxe Model Y': {'code': None, 'slug': 'tesmat-luxe-y', 'buy_url': 'https://www.tesmat.com/products/tesmat-luxe-for-model-y'},
    'TESMAT Luxe Model 3': {'code': None, 'slug': 'tesmat-luxe-3', 'buy_url': 'https://www.tesmat.com/products/tesmat-luxe-for-model-3'},
    'TESMAT Solo Model Y': {'code': None, 'slug': 'tesmat-solo-y', 'buy_url': 'https://www.tesmat.com/products/tesmat-solo-for-model-y'},
    'TESMAT Solo Model 3': {'code': None, 'slug': 'tesmat-solo-3', 'buy_url': 'https://www.tesmat.com/products/tesmat-solo-for-model-3'},
}

SLUG_TO_PRODUCT = {}
for v in PRODUCTS.values():
    if 'slug' in v:
        SLUG_TO_PRODUCT[v['slug']] = v


def find_product_by_name(name):
    name = name.strip()
    if name in PRODUCTS:
        return PRODUCTS[name]
    for key in PRODUCTS:
        if key.lower() == name.lower():
            return PRODUCTS[key]
    for key in PRODUCTS:
        if key.lower() in name.lower() or name.lower() in key.lower():
            return PRODUCTS[key]
    return None


def strip_html(s):
    return re.sub(r'<[^>]+>', '', s).strip()


def process_tables(content):
    """Process all comparison tables: add discount column + CTA column + linked product names."""
    changes = 0

    table_pattern = re.compile(
        r'(<div class="guide-comparison-table">\s*<table>)(.*?)(</table>\s*</div>)',
        re.DOTALL
    )

    def process_table(match):
        nonlocal changes
        prefix = match.group(1)
        table_inner = match.group(2)
        suffix = match.group(3)

        # PASS 1: Clean all previous additions
        lines = table_inner.split('\n')
        cleaned_lines = []
        for line in lines:
            stripped = line.strip()
            if stripped in ('<th>{{t.shared.th_discount}}</th>', '<th></th>'):
                continue
            if 'table-discount-code' in stripped or 'table-no-code' in stripped or 'table-cta-cell' in stripped:
                continue
            if stripped == '<td></td>':
                continue
            # Revert linked product names
            line = re.sub(
                r'<strong><a href="[^"]*" class="table-product-link">(.*?)</a></strong>',
                r'<strong>\1</strong>', line
            )
            line = re.sub(
                r'<td><a href="[^"]*" class="table-product-link">(.*?)</a></td>',
                r'<td>\1</td>', line
            )
            cleaned_lines.append(line)

        table_inner = '\n'.join(cleaned_lines)

        # Check if any row has a known product name
        rows = re.findall(r'<tr[^>]*>(.*?)</tr>', table_inner, re.DOTALL)
        is_product_table = False
        for row in rows:
            if '<th>' in row:
                continue
            tds = re.findall(r'<td[^>]*>(.*?)</td>', row, re.DOTALL)
            if tds and find_product_by_name(strip_html(tds[0])):
                is_product_table = True
                break

        if not is_product_table:
            return prefix + table_inner + suffix

        # PASS 2: Line-by-line processing with state tracking
        result_lines = []
        in_thead = False
        in_tbody = False
        current_row_lines = []
        in_row = False

        for line in table_inner.split('\n'):
            stripped = line.strip()

            if '<thead>' in stripped:
                in_thead = True
            if '</thead>' in stripped:
                in_thead = False
            if '<tbody>' in stripped:
                in_tbody = True
            if '</tbody>' in stripped:
                in_tbody = False

            # Track thead rows - add new headers
            if in_thead and '</tr>' in stripped:
                indent = re.match(r'(\s*)', line).group(1)
                result_lines.append(f'{indent}    <th>{{{{t.shared.th_discount}}}}</th>')
                result_lines.append(f'{indent}    <th></th>')
                result_lines.append(line)
                continue

            # Track tbody rows
            if in_tbody and re.search(r'<tr', stripped):
                in_row = True
                current_row_lines = [line]
                continue

            if in_row:
                current_row_lines.append(line)
                if '</tr>' in stripped:
                    in_row = False
                    # Process the complete row
                    row_text = '\n'.join(current_row_lines)

                    # Extract product name
                    strong_match = re.search(r'<strong>(.*?)</strong>', row_text)
                    if strong_match:
                        raw_name = strong_match.group(1).strip()
                    else:
                        tds = re.findall(r'<td[^>]*>(.*?)</td>', row_text, re.DOTALL)
                        raw_name = strip_html(tds[0]) if tds else ''

                    product = find_product_by_name(raw_name)
                    indent = re.match(r'(\s*)', current_row_lines[-1]).group(1)

                    if product:
                        slug = product['slug']
                        buy_url = product['buy_url']
                        review_url = f'/{{{{localePath}}}}reviews/{slug}'

                        # Link product name
                        for idx, rl in enumerate(current_row_lines):
                            if f'<strong>{raw_name}</strong>' in rl:
                                current_row_lines[idx] = rl.replace(
                                    f'<strong>{raw_name}</strong>',
                                    f'<strong><a href="{review_url}" class="table-product-link">{raw_name}</a></strong>'
                                )
                                break
                            elif f'<td>{raw_name}</td>' in rl:
                                current_row_lines[idx] = rl.replace(
                                    f'<td>{raw_name}</td>',
                                    f'<td><a href="{review_url}" class="table-product-link">{raw_name}</a></td>'
                                )
                                break

                        # Build new cells
                        if product.get('code'):
                            discount_td = f'{indent}    <td><span class="table-discount-code">{{{{t.shared.discount_percent_off}}}} <code>{product["code"]}</code></span></td>'
                        else:
                            discount_td = f'{indent}    <td><span class="table-no-code">{{{{t.shared.td_no_code}}}}</span></td>'

                        cta_td = f'{indent}    <td class="table-cta-cell"><a href="{buy_url}" target="_blank" rel="noopener sponsored" class="table-buy-btn">{{{{t.shared.btn_buy}}}}</a></td>'

                        # Insert before the </tr> line
                        closing_line = current_row_lines.pop()  # </tr>
                        current_row_lines.append(discount_td)
                        current_row_lines.append(cta_td)
                        current_row_lines.append(closing_line)
                        changes += 1

                    result_lines.extend(current_row_lines)
                    current_row_lines = []
                continue

            result_lines.append(line)

        return prefix + '\n'.join(result_lines) + suffix

    content = table_pattern.sub(process_table, content)
    return content, changes


def process_product_cards(content):
    """Add discount badges and fix buy links on product cards."""
    # Fix hardcoded English text
    content = re.sub(
        r'<span class="discount-code-tag">10% off: <code>(\w+)</code></span>',
        r'<span class="discount-code-tag">{{t.shared.discount_percent_off}} <code>\1</code></span>',
        content
    )

    lines = content.split('\n')
    new_lines = []
    changes = 0
    i = 0

    while i < len(lines):
        line = lines[i]
        review_match = re.search(r'reviews/([\w-]+)".*class="btn-review"', line)
        if review_match:
            slug = review_match.group(1)
            product = SLUG_TO_PRODUCT.get(slug)
            if product:
                prev_line = new_lines[-1] if new_lines else ''
                if 'discount-code-tag' not in prev_line:
                    indent = re.match(r'(\s*)', line).group(1)
                    if product.get('code'):
                        new_lines.append(f'{indent}<span class="discount-code-tag">{{{{t.shared.discount_percent_off}}}} <code>{product["code"]}</code></span>')
                new_lines.append(line)
                i += 1
                while i < len(lines):
                    buy_line = lines[i]
                    if 'btn-buy' in buy_line and 'href="#"' in buy_line:
                        buy_line = buy_line.replace('href="#"', f'href="{product["buy_url"]}"')
                        if 'target="_blank"' not in buy_line:
                            buy_line = buy_line.replace('class="btn-buy"', 'target="_blank" class="btn-buy"')
                        new_lines.append(buy_line)
                        changes += 1
                        i += 1
                        break
                    elif 'btn-buy' in buy_line:
                        new_lines.append(buy_line)
                        changes += 1
                        i += 1
                        break
                    else:
                        new_lines.append(buy_line)
                        i += 1
            else:
                new_lines.append(line)
                i += 1
        else:
            new_lines.append(line)
            i += 1

    return '\n'.join(new_lines), changes


def process_file(filepath):
    with open(filepath) as f:
        content = f.read()
    original = content
    content, card_changes = process_product_cards(content)
    content, table_changes = process_tables(content)
    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        print(f'  Updated {filepath} (cards: {card_changes}, tables: {table_changes})')
    else:
        print(f'  No changes: {filepath}')
    return card_changes + table_changes


total = 0
files = sorted(glob.glob('src/templates/guides/*.html'))
for f in files:
    if f.endswith('index.html'):
        continue
    total += process_file(f)
print(f'\nTotal: {total} elements updated')
