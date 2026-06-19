// Unit tests for buildStatsUtils.
//
// Run with:
//     pnpm exec tsx src/lib/buildStatsUtils.test.ts

import {
  formatChartDate,
  truncateTitle,
  formatNumber,
  formatPrice,
  validatePrice,
} from './buildStatsUtils';

let failures = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) {
    console.log(`  ok  ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${label}`, detail ?? '');
  }
};

console.log('formatChartDate');
check('formats 2024-01-15 to 01/15', formatChartDate('2024-01-15') === '01/15');
check('formats 2024-12-01 to 12/01', formatChartDate('2024-12-01') === '12/01');
check('formats 2023-07-09 to 07/09', formatChartDate('2023-07-09') === '07/09');

console.log('\ntruncateTitle');
check(
  'returns short string unchanged',
  truncateTitle('Hello World') === 'Hello World',
);
check(
  'returns 60-char string unchanged',
  truncateTitle('a'.repeat(60)) === 'a'.repeat(60),
);
check(
  'truncates 61-char string with ellipsis',
  truncateTitle('a'.repeat(61)) === 'a'.repeat(60) + '\u2026',
);
check(
  'truncates long string with ellipsis',
  truncateTitle('a'.repeat(100)) === 'a'.repeat(60) + '\u2026',
);
check(
  'respects custom maxLen',
  truncateTitle('Hello World', 5) === 'Hello\u2026',
);

console.log('\nformatNumber');
check('formats 0', formatNumber(0) === '0');
check('formats 999', formatNumber(999) === '999');
check('formats 1000', formatNumber(1000) === '1,000');
check('formats 1234567', formatNumber(1234567) === '1,234,567');
check('formats 100', formatNumber(100) === '100');

console.log('\nformatPrice');
check('formats 2.5 to $2.5000', formatPrice(2.5) === '$2.5000');
check('formats 0 to $0.0000', formatPrice(0) === '$0.0000');
check('formats 10.1234 to $10.1234', formatPrice(10.1234) === '$10.1234');
check('formats 100 to $100.0000', formatPrice(100) === '$100.0000');

console.log('\nvalidatePrice');
check(
  'valid: "5.5" is valid',
  validatePrice('5.5').valid === true && validatePrice('5.5').parsed === 5.5,
);
check(
  'valid: "0" is valid',
  validatePrice('0').valid === true && validatePrice('0').parsed === 0,
);
check(
  'valid: "10000" is valid',
  validatePrice('10000').valid === true,
);
check(
  'valid: "1.123456" (6 decimals) is valid',
  validatePrice('1.123456').valid === true,
);
check(
  'invalid: "abc" is invalid_number',
  validatePrice('abc').valid === false &&
    validatePrice('abc').error === 'invalid_number',
);
check(
  'invalid: "-1" is negative',
  validatePrice('-1').valid === false &&
    validatePrice('-1').error === 'negative',
);
check(
  'invalid: "10001" exceeds_max',
  validatePrice('10001').valid === false &&
    validatePrice('10001').error === 'exceeds_max',
);
check(
  'invalid: "1.1234567" too_many_decimals',
  validatePrice('1.1234567').valid === false &&
    validatePrice('1.1234567').error === 'too_many_decimals',
);

if (failures > 0) {
  console.error(`\n${failures} buildStatsUtils assertion(s) failed.`);
  process.exit(1);
} else {
  console.log('\nAll buildStatsUtils assertions passed.');
}
