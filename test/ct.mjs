// Ct validation unit tests
// Usage: node test/ct.mjs

import { parseCt, isValidCt, filterValidCts, CT_MIN, CT_MAX } from '../core/ct.js';

let failures = 0;

function check(label, actual, expected) {
  const ok = typeof expected === 'object'
    ? JSON.stringify(actual) === JSON.stringify(expected)
    : typeof expected === 'number'
      ? Number.isFinite(actual) && Math.abs(actual - expected) < 1e-9
      : actual === expected;
  if (!ok) {
    failures += 1;
    console.log(`FAIL ${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  } else {
    console.log(`ok   ${label}`);
  }
}

// ---- T1: Boundary values ----
check('T1 Ct=50 valid', parseCt(50), { valid: true, value: 50 });
check('T1 Ct=50.01 invalid', parseCt(50.01).valid, false);
check('T1 Ct=51 invalid', parseCt(51).valid, false);
check('T1 Ct=999 invalid', parseCt(999).valid, false);
check('T1 Ct=0 invalid', parseCt(0).valid, false);
check('T1 Ct=0.01 valid', parseCt(0.01), { valid: true, value: 0.01 });
check('T1 Ct=0.001 valid', parseCt(0.001), { valid: true, value: 0.001 });

// ---- T2: Invalid types ----
check('T2 Negative invalid', parseCt(-1).valid, false);
check('T2 NaN invalid', parseCt(NaN).valid, false);
check('T2 Infinity invalid', parseCt(Infinity).valid, false);
check('T2 null invalid', parseCt(null).valid, false);
check('T2 undefined invalid', parseCt(undefined).valid, false);
check('T2 empty string invalid', parseCt('').valid, false);
check('T2 whitespace invalid', parseCt('   ').valid, false);

// ---- T3: Clean numeric input ----
check('T3 "25.12"', parseCt('25.12'), { valid: true, value: 25.12 });
check('T3 " 25.12 "', parseCt(' 25.12 '), { valid: true, value: 25.12 });
check('T3 string "50"', parseCt('50'), { valid: true, value: 50 });
check('T3 string "50.01"', parseCt('50.01').valid, false);
check('T3 string "0"', parseCt('0').valid, false);

// ---- T4: Clean vs messy input same result ----
const clean = parseCt('25.12');
const messy = parseCt(' 25.12 ');
check('T4 clean vs messy valid', clean.valid, messy.valid);
check('T4 clean vs messy value', clean.value, messy.value);

// ---- T5: isValidCt ----
check('T5 isValidCt(25)', isValidCt(25), true);
check('T5 isValidCt(51)', isValidCt(51), false);
check('T5 isValidCt("25.5")', isValidCt('25.5'), true);
check('T5 isValidCt("")', isValidCt(''), false);

// ---- T6: filterValidCts ----
const mixed = ['25.1', '', '51', '30.5', '0', null, '18.2'];
const filtered = filterValidCts(mixed);
check('T6 filtered length', filtered.length, 3);
check('T6 filtered[0]', filtered[0], 25.1);
check('T6 filtered[1]', filtered[1], 30.5);
check('T6 filtered[2]', filtered[2], 18.2);

// ---- T7: Constants ----
check('T7 CT_MIN', CT_MIN, 0);
check('T7 CT_MAX', CT_MAX, 50);

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
