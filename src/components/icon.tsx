/*
 * Icon set. The 33 glyphs below are ported verbatim from the approved design mock
 * (`docs/design/pickyourai-complete.html`): one inline sprite plus an `Icon` that references it by id.
 * Icons are decorative (aria-hidden); every interactive control carries its own accessible name.
 */
export type IconName =
  | 'arrow-right'
  | 'arrow-up-right'
  | 'check'
  | 'check-circle'
  | 'alert'
  | 'x-circle'
  | 'plus'
  | 'x'
  | 'search'
  | 'layers'
  | 'cpu'
  | 'brain'
  | 'server'
  | 'database'
  | 'workflow'
  | 'chart'
  | 'cloud'
  | 'terminal'
  | 'shield'
  | 'spark'
  | 'list'
  | 'code'
  | 'download'
  | 'copy'
  | 'sun'
  | 'moon'
  | 'menu'
  | 'compare'
  | 'book'
  | 'wand'
  | 'message'
  | 'github'
  | 'info';

export const ICON_NAMES: IconName[] = [
  'arrow-right',
  'arrow-up-right',
  'check',
  'check-circle',
  'alert',
  'x-circle',
  'plus',
  'x',
  'search',
  'layers',
  'cpu',
  'brain',
  'server',
  'database',
  'workflow',
  'chart',
  'cloud',
  'terminal',
  'shield',
  'spark',
  'list',
  'code',
  'download',
  'copy',
  'sun',
  'moon',
  'menu',
  'compare',
  'book',
  'wand',
  'message',
  'github',
  'info',
];

/** Mounted once per document, before any <Icon> (see Layout). */
export function IconSprite() {
  return (
    <svg
      aria-hidden="true"
      style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}
    >
      <defs>
        <symbol id="i-arrow-right" viewBox="0 0 24 24">
          <path d="M5 12h14m-7-7 7 7-7 7"></path>
        </symbol>
        <symbol id="i-arrow-up-right" viewBox="0 0 24 24">
          <path d="M7 17 17 7M8 7h9v9"></path>
        </symbol>
        <symbol id="i-check" viewBox="0 0 24 24">
          <path d="m5 12 4 4L19 6"></path>
        </symbol>
        <symbol id="i-check-circle" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9"></circle>
          <path d="m8 12 3 3 5-6"></path>
        </symbol>
        <symbol id="i-alert" viewBox="0 0 24 24">
          <path d="M10.3 4.2 2.5 18.1a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z"></path>
          <path d="M12 9v5m0 3h.01"></path>
        </symbol>
        <symbol id="i-x-circle" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9"></circle>
          <path d="m9 9 6 6m0-6-6 6"></path>
        </symbol>
        <symbol id="i-plus" viewBox="0 0 24 24">
          <path d="M12 5v14M5 12h14"></path>
        </symbol>
        <symbol id="i-x" viewBox="0 0 24 24">
          <path d="m18 6-12 12M6 6l12 12"></path>
        </symbol>
        <symbol id="i-search" viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="7"></circle>
          <path d="m20 20-4-4"></path>
        </symbol>
        <symbol id="i-layers" viewBox="0 0 24 24">
          <path d="m12 2 9 5-9 5-9-5 9-5Zm-9 10 9 5 9-5M3 17l9 5 9-5"></path>
        </symbol>
        <symbol id="i-cpu" viewBox="0 0 24 24">
          <rect height="14" rx="2" width="14" x="5" y="5"></rect>
          <path d="M9 9h6v6H9zM9 1v4m6-4v4M9 19v4m6-4v4M1 9h4m-4 6h4m14-6h4m-4 6h4"></path>
        </symbol>
        <symbol id="i-brain" viewBox="0 0 24 24">
          <path d="M12 18V5a3 3 0 0 0-5.7-1.3A4 4 0 0 0 3 10a4.5 4.5 0 0 0 1 7 3.5 3.5 0 0 0 6 3M12 18V5a3 3 0 0 1 5.7-1.3A4 4 0 0 1 21 10a4.5 4.5 0 0 1-1 7 3.5 3.5 0 0 1-6 3"></path>
          <path d="M8 8c-1 2-1 3 1 4m7-4c1 2 1 3-1 4"></path>
        </symbol>
        <symbol id="i-server" viewBox="0 0 24 24">
          <rect height="8" rx="2" width="18" x="3" y="3"></rect>
          <rect height="8" rx="2" width="18" x="3" y="13"></rect>
          <path d="M7 7h.01M7 17h.01M11 7h6m-6 10h6"></path>
        </symbol>
        <symbol id="i-database" viewBox="0 0 24 24">
          <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
          <path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5M3 12c0 1.7 4 3 9 3s9-1.3 9-3"></path>
        </symbol>
        <symbol id="i-workflow" viewBox="0 0 24 24">
          <rect height="6" rx="1" width="7" x="2" y="3"></rect>
          <rect height="6" rx="1" width="7" x="15" y="15"></rect>
          <rect height="6" rx="1" width="7" x="2" y="15"></rect>
          <path d="M9 6h8a2 2 0 0 1 2 2v7M5.5 9v6"></path>
        </symbol>
        <symbol id="i-chart" viewBox="0 0 24 24">
          <path d="M3 3v18h18M7 16l4-5 4 3 5-8"></path>
        </symbol>
        <symbol id="i-cloud" viewBox="0 0 24 24">
          <path d="M7 18h12a4 4 0 0 0 .5-8A7 7 0 0 0 6 10a4 4 0 0 0 1 8Z"></path>
        </symbol>
        <symbol id="i-terminal" viewBox="0 0 24 24">
          <rect height="18" rx="2" width="20" x="2" y="3"></rect>
          <path d="m6 9 4 3-4 3m7 0h5"></path>
        </symbol>
        <symbol id="i-shield" viewBox="0 0 24 24">
          <path d="m12 2 9 4v6c0 6-4 9-9 10-5-1-9-4-9-10V6l9-4Z"></path>
          <path d="m8 12 3 3 5-6"></path>
        </symbol>
        <symbol id="i-spark" viewBox="0 0 24 24">
          <path d="m12 2 2.1 7.9L22 12l-7.9 2.1L12 22l-2.1-7.9L2 12l7.9-2.1L12 2Z"></path>
        </symbol>
        <symbol id="i-list" viewBox="0 0 24 24">
          <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"></path>
        </symbol>
        <symbol id="i-code" viewBox="0 0 24 24">
          <path d="m8 5-7 7 7 7m8-14 7 7-7 7m-3-18-2 22"></path>
        </symbol>
        <symbol id="i-download" viewBox="0 0 24 24">
          <path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4"></path>
        </symbol>
        <symbol id="i-copy" viewBox="0 0 24 24">
          <rect height="13" rx="2" width="13" x="8" y="8"></rect>
          <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"></path>
        </symbol>
        <symbol id="i-sun" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="4"></circle>
          <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"></path>
        </symbol>
        <symbol id="i-moon" viewBox="0 0 24 24">
          <path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z"></path>
        </symbol>
        <symbol id="i-menu" viewBox="0 0 24 24">
          <path d="M4 6h16M4 12h16M4 18h16"></path>
        </symbol>
        <symbol id="i-compare" viewBox="0 0 24 24">
          <path d="M3 3v18M9 8h12M9 16h12M9 4v8M16 12v8"></path>
        </symbol>
        <symbol id="i-book" viewBox="0 0 24 24">
          <path d="M4 19.5c0-1.4 1.1-2.5 2.5-2.5H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14ZM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"></path>
        </symbol>
        <symbol id="i-wand" viewBox="0 0 24 24">
          <path d="m4 20 12-12 4 4L8 24m5-14 4 4M3 4h3m-1.5-1.5v3M19 2v4m-2-2h4"></path>
        </symbol>
        <symbol id="i-message" viewBox="0 0 24 24">
          <path d="M21 11.5a8.4 8.4 0 0 1-9 8.5 9 9 0 0 1-4-1l-5 2 1.5-5A8.5 8.5 0 1 1 21 11.5Z"></path>
          <path d="M8 11h8m-8 4h5"></path>
        </symbol>
        <symbol id="i-github" viewBox="0 0 24 24">
          <path d="M9 19c-4 1-4-2-6-2m12 4v-3.2a2.8 2.8 0 0 0-.8-2.2c3-.4 6-1.4 6-6.5a5.1 5.1 0 0 0-1.4-3.5 4.6 4.6 0 0 0-.1-3.5S17.6 1.7 15 3.6a11 11 0 0 0-6 0C6.4 1.7 5.3 2.1 5.3 2.1a4.6 4.6 0 0 0-.1 3.5A5.1 5.1 0 0 0 3.8 9c0 5.1 3 6.1 6 6.5A2.8 2.8 0 0 0 9 17.7V21"></path>
        </symbol>
        <symbol id="i-info" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10"></circle>
          <path d="M12 11v6m0-10h.01"></path>
        </symbol>
      </defs>
    </svg>
  );
}

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg className={className ? `ico ${className}` : 'ico'} aria-hidden="true" focusable="false">
      <use href={`#i-${name}`} />
    </svg>
  );
}
