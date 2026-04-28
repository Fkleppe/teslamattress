from playwright.sync_api import sync_playwright
import os

SCREENSHOT_DIR = "/Users/kleppe14/teslamattress/screenshots"

pages = [
    {"name": "homepage_desktop", "url": "https://teslamattress.com", "width": 1920, "height": 1080},
    {"name": "homepage_mobile", "url": "https://teslamattress.com", "width": 375, "height": 812},
    {"name": "guides_desktop", "url": "https://teslamattress.com/guides", "width": 1920, "height": 1080},
    {"name": "guides_mobile", "url": "https://teslamattress.com/guides", "width": 375, "height": 812},
    {"name": "review_snuuzu_desktop", "url": "https://teslamattress.com/reviews/snuuzu-model-y", "width": 1920, "height": 1080},
    {"name": "norwegian_desktop", "url": "https://teslamattress.com/no/", "width": 1920, "height": 1080},
    {"name": "norwegian_mobile", "url": "https://teslamattress.com/no/", "width": 375, "height": 812},
]

with sync_playwright() as p:
    browser = p.chromium.launch()
    for info in pages:
        print(f"Capturing {info['name']}...")
        page = browser.new_page(viewport={"width": info["width"], "height": info["height"]})
        try:
            page.goto(info["url"], wait_until="networkidle", timeout=30000)
            path = os.path.join(SCREENSHOT_DIR, f"{info['name']}.png")
            page.screenshot(path=path, full_page=False)
            print(f"  Saved: {path}")
            if "guides" in info["name"]:
                full_path = os.path.join(SCREENSHOT_DIR, f"{info['name']}_full.png")
                page.screenshot(path=full_path, full_page=True)
                print(f"  Saved full: {full_path}")
        except Exception as e:
            print(f"  ERROR: {e}")
        finally:
            page.close()
    browser.close()
    print("Done!")
