// Applies the saved colour theme before first paint (external file so CSP can stay 'self').
// The design's default is the dark palette; light is an explicit opt-in, exactly as in the mock.
try {
  var t = localStorage.getItem('pyai.theme');
  var light = t === 'light';
  var root = document.documentElement;
  root.classList.toggle('light', light);
  root.classList.toggle('dark', !light);
  root.style.colorScheme = light ? 'light' : 'dark';
} catch (e) {
  /* storage unavailable: keep the default dark palette */
}
