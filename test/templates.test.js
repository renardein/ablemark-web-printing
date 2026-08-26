/* Тесты модуля шаблонов (templates.js) — localStorage-заглушка, без DOM-части. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failed = 0;
const ok = (name, cond) => {
  if (cond) console.log('ok ', name);
  else { failed++; console.error('FAIL', name); }
};
const eq = (name, a, b) => ok(name, JSON.stringify(a) === JSON.stringify(b));

// --- песочница с localStorage-заглушкой ---
function makeSandbox(store) {
  const ctx = {
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    document: { createElement: () => ({ click() {}, remove() {}, style: {} }), body: { appendChild() {} } },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    Blob: class {},
    setTimeout: () => {},
  };
  vm.createContext(ctx);
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'templates.js'), 'utf8');
  vm.runInContext(src + '; globalThis.__T = Templates;', ctx);
  return ctx.__T;
}

{
  const store = {};
  const T = makeSandbox(store);

  // пусто
  eq('список пуст', T.list(), []);

  // сохранить
  const data1 = { labelWmm: 40, labelHmm: 30, dpi: 8, elements: [{ type: 'text', text: 'A' }] };
  const tpl1 = T.save('Ценник', data1);
  ok('id назначен', !!tpl1.id);
  eq('список = 1', T.list().length, 1);
  eq('данные шаблона', T.get(tpl1.id).data, data1);

  // второй
  const data2 = { labelWmm: 12, labelHmm: 40, dpi: 8, elements: [] };
  T.save('Кабельная', data2);
  eq('список = 2', T.list().length, 2);
  ok('свежий сверху', T.list()[0].name === 'Кабельная');

  // перезапись по existingId
  T.save('Ценник v2', data1, tpl1.id);
  eq('перезапись не добавляет', T.list().length, 2);
  eq('имя обновлено', T.get(tpl1.id).name, 'Ценник v2');

  // удаление
  const removed = T.remove(tpl1.id);
  eq('удалён верный', removed.id, tpl1.id);
  eq('после удаления 1', T.list().length, 1);
  eq('remove несуществующего', T.remove('nope'), null);
}

{
  // --- импорт/экспорт ---
  const store = {};
  const T = makeSandbox(store);

  // экспорт-payload одного
  const tpl = T.save('Test', { labelWmm: 40, labelHmm: 30, elements: [{ type: 'qr' }] });
  const payload = T.exportPayload ? null : null; // exportPayload не экспортирован — ок
  const file = T.exportOne(tpl);
  ok('имя файла .amlbl', /\.amlbl$/.test(file));
  ok('safeName чистит слэши', /\.amlbl$/.test(T.exportOne({ name: 'a/b\\c:d?', data: {} })));

  // exportAll пусто
  const store2 = {};
  const T2 = makeSandbox(store2);
  eq('exportAll пусто → null', T2.exportAll(), null);

  // импорт: обёртка с templates
  const importText = JSON.stringify({
    format: 'ablemark-label/1',
    exported: '2026-01-01T00:00:00Z',
    templates: [{ name: 'Imported A', date: '2026-01-01', data: { labelWmm: 50, labelHmm: 30, elements: [] } }],
  });
  const res = T2.importJson(importText);
  eq('импортирован 1', res.imported.length, 1);
  eq('в списке', T2.list().length, 1);
  eq('имя', T2.list()[0].name, 'Imported A');

  // импорт: дубликат имени без overwrite → skipped
  const res2 = T2.importJson(importText, { overwrite: false });
  eq('пропущен дубликат', res2.skipped.length, 1);
  eq('список не вырос', T2.list().length, 1);

  // импорт: дубликат с overwrite → заменён
  const res3 = T2.importJson(JSON.stringify({
    templates: [{ name: 'Imported A', data: { labelWmm: 58, labelHmm: 40, elements: [{ type: 'line' }] } }],
  }), { overwrite: true });
  eq('перезаписан', res3.imported.length, 1);
  eq('список не вырос', T2.list().length, 1);
  eq('данные обновлены', T2.list()[0].data.labelWmm, 58);

  // импорт: голые данные макета
  const res4 = T2.importJson(JSON.stringify({ labelWmm: 30, labelHmm: 20, elements: [{ type: 'text' }] }));
  eq('голый макет импортирован', res4.imported.length, 1);
  eq('теперь 2', T2.list().length, 2);

  // импорт: мусор → исключение
  let threw = false;
  try { T2.importJson('{"foo": 1}'); } catch (_) { threw = true; }
  ok('мусор бросает', threw);
  threw = false;
  try { T2.importJson('not json'); } catch (_) { threw = true; }
  ok('битый JSON бросает', threw);
}

console.log(failed === 0 ? '\nTEMPLATES OK' : `\nTEMPLATES FAILED: ${failed}`);
process.exit(failed ? 1 : 0);
