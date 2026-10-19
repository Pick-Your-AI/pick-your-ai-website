/*
 * Icon set. The 33 glyphs are ported verbatim from the approved design mock
 * (`docs/design/pickyourai-complete.html`) into a single sprite, referenced by id.
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
/*
 * The sprite itself is a static asset (`public/icons.svg`), not inline JSX. Building 33 symbols as
 * React elements cost ~110 kB of parsed JavaScript on every route; as a cached SVG file it costs one
 * request that is not on the JS critical path.
 */
const SPRITE = '/icons.svg';

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg className={className ? `ico ${className}` : 'ico'} aria-hidden="true" focusable="false">
      <use href={`${SPRITE}#i-${name}`} />
    </svg>
  );
}
