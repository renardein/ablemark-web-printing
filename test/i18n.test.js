/* Проверка полноты словарей i18n.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'i18n.js'), 'utf8');

const makeCtx = (lang) => {
  const ctx = {
    localStorage: { getItem: () => lang, setItem: () => {} },
    document: { querySelectorAll: () => [], documentElement: {} },
  };
  vm.createContext(ctx);
  vm.runInContext(src + '; globalThis.__I = I18N;', ctx);
  return ctx.__I;
};

const ru = makeCtx('ru');
const en = makeCtx('en');

// ключи извлекаем из исходника (плоские строки)
const keyRe = /(?:^|\n)\s+([a-z_0-9]+): '/g;
const keys = [...src.matchAll(keyRe)].map(m => m[1]);
const uniq = [...new Set(keys)];

let failed = 0;
// ключи, чьё значение может совпадать с самим ключом
const identityKeys = new Set(['mm', 'ssid', 'x', 'y', 'email', 'created', 'delete']);
for (const k of uniq) {
  const r = ru.t(k);
  const e = en.t(k);
  if (identityKeys.has(k)) continue;
  if (r === k) { failed++; console.log('MISSING ru:', k); }
  if (e === k) { failed++; console.log('MISSING en:', k); }
}
console.log('keys:', uniq.length, 'missing:', failed);

// плейсхолдеры
const tests = [
  ['selected_elem', { i: 2, n: 5, t: 'Text' }],
  ['print_log', { w: 40, h: 30, sw: 320, sh: 240, sc: 3, d: '↑', rw: 320, rh: 240, p: 'l', n: 500 }],
  ['incremental_print', { n: 3 }],
];
for (const [k, vars] of tests) {
  const r = ru.t(k, vars);
  const e = en.t(k, vars);
  const bad = /\{[a-z]+\}/.test(r) || /\{[a-z]+\}/.test(e);
  if (bad) { failed++; console.log('PLACEHOLDER LEFT:', k, '→', r, '|', e); }
  else console.log('ok placeholders:', k);
}

console.log(failed === 0 ? 'I18N OK' : 'I18N FAILED: ' + failed);
process.exit(failed ? 1 : 0);
