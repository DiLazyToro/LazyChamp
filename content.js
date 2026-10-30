// LazyChamp content script: injects the panel into the Showdown page and relays the toolbar click.
(() => {
  const api = globalThis.browser || globalThis.chrome;
  if (!api || !api.runtime || !api.runtime.getURL) return;
  const base = api.runtime.getURL('');
  document.documentElement.dataset.lazychampBase = base;
  const parent = () => document.head || document.documentElement;

  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = base + 'panel.css';
  parent().appendChild(css);

  const addScript = file => new Promise(resolve => {
    const s = document.createElement('script');
    s.src = base + file;
    s.async = false;
    s.onload = s.onerror = resolve;
    parent().appendChild(s);
  });
  const loaded = addScript('core.js').then(() => addScript('panel.js')).then(() => addScript('converter.js'));

  api.runtime.onMessage.addListener(msg => {
    if (msg && msg.type === 'lazychamp:open') {
      loaded.then(() => window.postMessage({ source: 'lazychamp-ext', type: 'open' }, window.location.origin));
    }
  });
})();
