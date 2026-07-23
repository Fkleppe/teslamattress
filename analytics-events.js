(() => {
  'use strict';

  const BRAND_BY_HOST = {
    'www.snuuzu.com': 'Snuuzu EU',
    'us.snuuzu.com': 'Snuuzu US',
    'havnby.com': 'Havnby',
    'novapads.com': 'NovaPads',
    'www.tesmat.com': 'TESMAT',
    'www.irockbrook.com': 'Rockbrook',
    'hamphi.com': 'HAMPHI',
    'yeslak.com': 'Yeslak',
    'shop4tesla.com': 'Shop4Tesla',
    'www.jowua-life.com': 'Jowua',
    'hansshow.com': 'Hansshow',
    'www.hautopart.com': 'Hansshow',
    'www.teslaacessories.com': 'TESMAG'
  };

  const INTERNAL_CTA_SELECTOR = [
    '.article-pick-actions a',
    '.btn-primary',
    '.btn-review',
    '.btn-secondary',
    '.cta-link-primary',
    '.cta-link-secondary',
    '.full-details-link',
    '.guide-card',
    '.guide-topic-card',
    '.rb-secondary-cta',
    '.review-card-link',
    '.vs-card'
  ].join(',');

  function ensureAnalyticsQueue() {
    if (window.va) return;
    window.va = (...params) => {
      window.vaq = window.vaq || [];
      window.vaq.push(params);
    };
  }

  function track(name, data) {
    ensureAnalyticsQueue();
    window.va('event', { name, data });
  }

  function placementFor(element) {
    if (element.closest('.table-cta-cell, .guide-comparison-table, .comparison-table')) return 'comparison_table';
    if (element.closest('.review-tldr, .review-verdict')) return 'review_summary';
    if (element.closest('.rb-sidebar, .guide-sidebar, .review-sidebar')) return 'sidebar';
    if (element.closest('.rb-final-cta, .final-cta, .article-pick-cta, .reviews-cta')) return 'final_cta';
    if (element.closest('.discount-main, .brand-discount-card, .discount-card')) return 'discount_card';
    if (element.closest('.guide-card, .guide-topic-card, .review-card-link, .vs-card')) return 'content_card';
    if (element.closest('header')) return 'hero';
    if (element.closest('footer')) return 'footer';
    return 'article';
  }

  function couponCodeFor(button) {
    const container = button.closest('.big-code-box, .discount-card, .discount-code-card, section');
    const displayedCode = container && container.querySelector('code');
    if (displayedCode && displayedCode.textContent.trim()) {
      return displayedCode.textContent.trim().slice(0, 64);
    }

    const onclick = button.getAttribute('onclick') || '';
    const match = onclick.match(/copyCode\(\s*['"]([^'"]+)['"]/);
    return match ? match[1].slice(0, 64) : 'unknown';
  }

  ensureAnalyticsQueue();

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const copyButton = target.closest('button.copy-btn, button.copy-btn-large, button[data-copy-code]');
    if (copyButton) {
      track('Coupon Copy', {
        code: couponCodeFor(copyButton),
        placement: placementFor(copyButton)
      });
      return;
    }

    const regionButton = target.closest('button.discount-cta-btn, button[onclick*="showRegionPopup"]');
    if (regionButton) {
      track('Offer Region Open', {
        brand: 'Snuuzu',
        placement: placementFor(regionButton)
      });
      return;
    }

    const link = target.closest('a[href]');
    if (!link) return;

    let destination;
    try {
      destination = new URL(link.href, window.location.href);
    } catch {
      return;
    }

    const rel = (link.getAttribute('rel') || '').toLowerCase();
    if (destination.origin !== window.location.origin && rel.split(/\s+/).includes('sponsored')) {
      track('Affiliate Click', {
        brand: BRAND_BY_HOST[destination.hostname] || destination.hostname.replace(/^www\./, '').slice(0, 64),
        placement: placementFor(link)
      });
      return;
    }

    if (destination.origin === window.location.origin && link.matches(INTERNAL_CTA_SELECTOR)) {
      track('Content CTA Click', {
        destination: destination.pathname.slice(0, 180),
        placement: placementFor(link)
      });
    }
  }, { passive: true });
})();
