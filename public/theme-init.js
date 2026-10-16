// Applies the saved or preferred colour theme before first paint (external file so CSP can stay 'self').
try {
  var t = localStorage.getItem('pyai.theme');
  var d = t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle('dark', d);
} catch (e) {
  /* storage unavailable */
}
