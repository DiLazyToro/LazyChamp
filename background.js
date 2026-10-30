// Toolbar button: open the LazyChamp tab on the current Showdown page.
const api = globalThis.browser || globalThis.chrome;
api.action.onClicked.addListener(tab => {
  const fallback = () => api.tabs.create({ url: 'https://play.pokemonshowdown.com/' });
  if (!tab || tab.id == null) return fallback();
  Promise.resolve(api.tabs.sendMessage(tab.id, { type: 'lazychamp:open' })).catch(fallback);
});
