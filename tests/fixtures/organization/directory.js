'use strict';
const search = document.querySelector('#search');
const kind = document.querySelector('#kind');
const mapping = document.querySelector('#mapping');
const rows = [...document.querySelectorAll('tbody tr')];
function filter() {
  let shown = 0;
  for (const row of rows) {
    const text = row.textContent.toLocaleLowerCase();
    row.hidden = !(text.includes(search.value.toLocaleLowerCase()) &&
      (!kind.value || kind.value === row.dataset.kind) &&
      (!mapping.value || text.includes('unmapped')));
    if (!row.hidden) shown++;
  }
  document.querySelector('#count').textContent = `${shown} of ${rows.length} entities shown`;
}
for (const control of [search, kind, mapping]) control.addEventListener('input', filter);
function age() {
  const status = document.querySelector('#freshness');
  const observed = Date.parse(status.dataset.observed);
  const stale = !Number.isFinite(observed) || observed > Date.now() + 60000 || Date.now() - observed > 10800000;
  status.textContent = `${stale ? 'STALE — verify before relying on this directory.' : 'Within proposed three-hour freshness threshold.'} Last observed: ${status.dataset.observed}. See refresh run status and pending publication reviews below. Publication time requires deployment readback.`;
}
filter(); age(); setInterval(age, 60000);
