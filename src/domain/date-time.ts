/** Order schema-validated contract timestamps without losing their recorded precision. */
function dateTimeOrder(timestamp: string) {
  // Contract timestamps include offsets, arbitrary fractional precision and leap seconds.
  // Compare UTC whole seconds first, keeping a leap second after :59 and before the next minute.
  const wholeSecond = timestamp
    .replace(/\.\d+/, '')
    .replace(/:60(?=[Zz+-])/, ':59')
    .replace(/([+-]\d{2})$/, '$1:00');
  return {
    wholeSecond: Date.parse(wholeSecond),
    leapSecond: timestamp.slice(17, 19) === '60' ? 1 : 0,
    fraction: timestamp.match(/\.(\d+)/)?.[1] ?? '',
  };
}

export function compareDateTimes(left: string, right: string): number {
  const a = dateTimeOrder(left);
  const b = dateTimeOrder(right);
  const seconds = a.wholeSecond - b.wholeSecond || a.leapSecond - b.leapSecond;
  if (seconds) return seconds;
  // Padding compares every recorded decimal digit without rounding through a JS number.
  const precision = Math.max(a.fraction.length, b.fraction.length);
  const aFraction = a.fraction.padEnd(precision, '0');
  const bFraction = b.fraction.padEnd(precision, '0');
  return aFraction < bFraction ? -1 : aFraction > bFraction ? 1 : 0;
}
