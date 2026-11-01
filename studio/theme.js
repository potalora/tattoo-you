// Instrument is the public default. Presentation stays outside saved study data.
(() => {
  const params = new URLSearchParams(location.search);
  const requestedTheme = params.get('theme') || 'instrument';
  const colors = { glass: '#d8d9d2', precision: '#1b1b1b', gallery: '#ffffff', soft: '#e5e5e5', instrument: '#dedfd9' };
  const theme = Object.hasOwn(colors,requestedTheme) ? requestedTheme : 'instrument';
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]').content = colors[theme];
  const serif = theme === 'instrument' ? 'original' : theme === 'glass' ? 'bodoni' : params.get('serif') || 'bodoni';
  if (serif === 'original') {
    delete document.documentElement.dataset.serif;
  } else if (['fraunces', 'gloock', 'bodoni', 'kalnia'].includes(serif)) {
    document.documentElement.dataset.serif = serif;
  }
})();
