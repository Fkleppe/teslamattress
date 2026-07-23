(() => {
  'use strict';

  const originalToggle = document.querySelector('.menu-toggle');
  const originalNav = document.querySelector('.nav-links');
  const originalOverlay = document.querySelector('.menu-overlay');

  if (!originalToggle || !originalNav || !originalOverlay) return;

  // Legacy templates attached slightly different inline handlers. Replacing
  // these three small nodes removes those listeners and gives every page the
  // same predictable, accessible controller.
  const menuToggle = originalToggle.cloneNode(true);
  const navLinks = originalNav.cloneNode(true);
  const menuOverlay = originalOverlay.cloneNode(true);
  originalToggle.replaceWith(menuToggle);
  originalNav.replaceWith(navLinks);
  originalOverlay.replaceWith(menuOverlay);

  if (!navLinks.id) navLinks.id = 'primary-navigation';
  menuToggle.type = 'button';
  menuToggle.setAttribute('aria-controls', navLinks.id);
  menuToggle.setAttribute('aria-expanded', 'false');
  menuToggle.setAttribute('aria-label', 'Open menu');
  menuOverlay.setAttribute('aria-hidden', 'true');

  const mobileQuery = window.matchMedia('(max-width: 1024px)');
  let lastFocused = null;

  const focusable = () => [
    menuToggle,
    ...navLinks.querySelectorAll('a[href], button:not([disabled])')
  ].filter((element) => element.offsetParent !== null);

  function setOpen(open, restoreFocus = true) {
    const shouldOpen = Boolean(open && mobileQuery.matches);

    navLinks.classList.toggle('active', shouldOpen);
    menuToggle.classList.toggle('active', shouldOpen);
    menuOverlay.classList.toggle('active', shouldOpen);
    document.body.classList.toggle('nav-open', shouldOpen);
    document.documentElement.classList.toggle('nav-open', shouldOpen);
    menuToggle.setAttribute('aria-expanded', String(shouldOpen));
    menuToggle.setAttribute('aria-label', shouldOpen ? 'Close menu' : 'Open menu');
    menuOverlay.setAttribute('aria-hidden', String(!shouldOpen));
    if (mobileQuery.matches) {
      navLinks.setAttribute('aria-hidden', String(!shouldOpen));
    } else {
      navLinks.removeAttribute('aria-hidden');
    }

    if (shouldOpen) {
      lastFocused = document.activeElement;
      navLinks.scrollTop = 0;
      window.requestAnimationFrame(() => {
        navLinks.scrollTop = 0;
        menuToggle.focus({ preventScroll: true });
      });
    } else if (restoreFocus && lastFocused instanceof HTMLElement) {
      lastFocused.focus({ preventScroll: true });
      lastFocused = null;
    }
  }

  menuToggle.addEventListener('click', () => {
    setOpen(menuToggle.getAttribute('aria-expanded') !== 'true');
  });

  menuOverlay.addEventListener('click', () => setOpen(false));

  navLinks.addEventListener('click', (event) => {
    if (event.target.closest('a')) setOpen(false, false);
  });

  document.addEventListener('keydown', (event) => {
    if (menuToggle.getAttribute('aria-expanded') !== 'true') return;

    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      return;
    }

    if (event.key !== 'Tab') return;
    const items = focusable();
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  const syncForViewport = () => setOpen(false, false);

  if (typeof mobileQuery.addEventListener === 'function') {
    mobileQuery.addEventListener('change', syncForViewport);
  } else {
    mobileQuery.addListener(syncForViewport);
  }

  syncForViewport();
})();

(() => {
  'use strict';

  const table = document.querySelector('.comparison-table');
  const filter = document.querySelector('.table-filter');
  const status = document.querySelector('.table-filter-status');
  if (!table || !filter || !status) return;

  const rows = [...table.querySelectorAll('tbody tr[data-model]')];
  const buttons = [...filter.querySelectorAll('[data-table-filter]')];
  if (!rows.length || !buttons.length) return;

  function applyFilter(value) {
    let visible = 0;

    rows.forEach((row) => {
      const models = (row.dataset.model || '').split(/\s+/);
      const show = value === 'all'
        || (value === 'top' && row.dataset.top === 'true')
        || models.includes(value);
      row.hidden = !show;
      if (show) visible += 1;
    });

    buttons.forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.tableFilter === value));
    });

    if (value === 'top') {
      status.textContent = 'Showing the four strongest current picks.';
    } else if (value === 'all') {
      status.textContent = `Showing all ${visible} mattresses.`;
    } else {
      status.textContent = `Showing ${visible} mattresses for Model ${value.toUpperCase()}.`;
    }
  }

  filter.addEventListener('click', (event) => {
    const button = event.target.closest('[data-table-filter]');
    if (!button) return;
    applyFilter(button.dataset.tableFilter);
  });

  applyFilter('top');
})();

(() => {
  'use strict';

  const table = document.querySelector('.guide-comparison-table');
  const filter = document.querySelector('.guide-table-filter');
  const status = document.querySelector('.guide-table-filter-status');
  if (!table || !filter || !status) return;

  const rows = [...table.querySelectorAll('tbody tr[data-guide-model]')];
  const buttons = [...filter.querySelectorAll('[data-guide-filter]')];
  if (!rows.length || !buttons.length) return;

  function applyGuideFilter(value) {
    let visible = 0;

    rows.forEach((row) => {
      const models = (row.dataset.guideModel || '').split(/\s+/);
      const show = value === 'all'
        || (value === 'top' && row.dataset.guideTop === 'true')
        || models.includes(value);
      row.hidden = !show;
      if (show) visible += 1;
    });

    buttons.forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.guideFilter === value));
    });

    if (value === 'top') {
      status.textContent = 'Showing the four leading current picks.';
    } else if (value === 'all') {
      status.textContent = `Showing all ${visible} mattresses.`;
    } else {
      status.textContent = `Showing ${visible} mattresses for Model ${value.toUpperCase()}.`;
    }
  }

  filter.addEventListener('click', (event) => {
    const button = event.target.closest('[data-guide-filter]');
    if (!button) return;
    applyGuideFilter(button.dataset.guideFilter);
  });

  applyGuideFilter('top');
})();
