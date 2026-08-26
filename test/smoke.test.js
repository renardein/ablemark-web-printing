/* Smoke-тест десктопного редактора: layout, i18n, канвас, слои, свойства, хоткеи. */
'use strict';
const puppeteer = require('puppeteer-core');
const path = require('path');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--enable-features=WebBluetooth', '--no-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 950 });

  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });

  const url = 'file:///' + path.join(__dirname, '..', 'index.html').replace(/\\/g, '/');
  await page.goto(url, { waitUntil: 'load', timeout: 15000 });
  await new Promise(r => setTimeout(r, 800));

  // 1) десктопный layout: три колонки workspace
  const layout = await page.evaluate(() => {
    const ws = document.querySelector('.workspace');
    return {
      cols: getComputedStyle(ws).gridTemplateColumns.split(' ').length,
      left: !!document.querySelector('.left-panel'),
      right: !!document.querySelector('.right-panel'),
      toolbar: !!document.querySelector('.canvas-toolbar'),
      statusbar: !!document.querySelector('.statusbar'),
      layers: document.querySelectorAll('.layer-item').length,
    };
  });
  console.log('layout:', JSON.stringify(layout));
  if (layout.cols !== 3) errors.push('workspace не 3 колонки: ' + layout.cols);
  if (!layout.left || !layout.right) errors.push('нет боковых панелей');
  if (layout.layers !== 3) errors.push('слоёв в списке не 3: ' + layout.layers);

  // 2) канвас отрисован
  const canvasState = await page.evaluate(() => {
    const c = document.getElementById('editorCanvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 128) dark++;
    return { w: c.width, h: c.height, dark, elements: Editor.state.elements.length };
  });
  console.log('canvas:', canvasState.w + 'x' + canvasState.h, 'dark:', canvasState.dark, 'els:', canvasState.elements);
  if (canvasState.dark < 100) errors.push('канвас пуст');

  // 3) панель свойств: показывает свойства выделенного
  const propsRu = await page.evaluate(() => {
    Editor.state.selected = Editor.state.elements[0];
    window.__am.refreshProps();
    return Array.from(document.querySelectorAll('#propsBody .prop-row span:first-child')).map(e => e.textContent);
  });
  console.log('props RU:', propsRu.slice(0, 6).join(' | '));
  if (!propsRu.includes('Текст')) errors.push('нет свойства «Текст» в RU');

  // 4) переключение языка: кнопка btnLang → EN
  await page.click('#btnLang');
  await new Promise(r => setTimeout(r, 300));
  const propsEn = await page.evaluate(() => {
    Editor.state.selected = Editor.state.elements[0];
    window.__am.refreshProps();
    return Array.from(document.querySelectorAll('#propsBody .prop-row span:first-child')).map(e => e.textContent);
  });
  const btnPrintEn = await page.$eval('#btnPrint', el => el.textContent);
  const insertEn = await page.$eval('.panel-card h3', el => el.textContent);
  console.log('props EN:', propsEn.slice(0, 6).join(' | '), '| btnPrint:', btnPrintEn, '| insert:', insertEn);
  if (!propsEn.includes('Text')) errors.push('после переключения нет «Text»: ' + propsEn.join(','));
  if (btnPrintEn !== 'Print') errors.push('кнопка печати не перевелась: ' + btnPrintEn);
  if (insertEn !== 'Insert') errors.push('панель вставки не перевелась: ' + insertEn);

  // назад в RU
  await page.click('#btnLang');
  await new Promise(r => setTimeout(r, 300));
  const backRu = await page.$eval('#btnPrint', el => el.textContent);
  if (backRu !== 'Печать') errors.push('возврат в RU не сработал: ' + backRu);

  // 5) список слоёв: клик выделяет
  await page.evaluate(() => {
    document.querySelectorAll('.layer-item')[2].click();
  });
  const selLayer = await page.evaluate(() => ({
    sel: Editor.state.selected && Editor.state.elements.indexOf(Editor.state.selected),
  }));
  console.log('клик по слою → выделен элемент №', selLayer.sel + 1);
  if (selLayer.sel !== 0) errors.push('клик по слою выделил не тот элемент (ожидался №1): ' + (selLayer.sel + 1));

  // 6) скрытие слоя глазом
  const darkBefore = await page.evaluate(() => {
    const c = document.getElementById('editorCanvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 128) dark++;
    return dark;
  });
  await page.evaluate(() => { document.querySelector('.layer-item .l-vis').click(); });
  const darkAfter = await page.evaluate(() => {
    const c = document.getElementById('editorCanvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 128) dark++;
    return dark;
  });
  console.log('скрытие слоя: dark', darkBefore, '→', darkAfter);
  if (darkAfter >= darkBefore) errors.push('скрытие слоя не влияет на канвас');
  await page.evaluate(() => { document.querySelector('.layer-item .l-vis').click(); }); // вернуть

  // 7) добавление из левой панели
  const n0 = await page.evaluate(() => Editor.state.elements.length);
  await page.click('[data-add="barcode"]');
  await new Promise(r => setTimeout(r, 300));
  const n1 = await page.evaluate(() => Editor.state.elements.length);
  console.log('+штрихкод:', n0, '→', n1);
  if (n1 !== n0 + 1) errors.push('добавление не работает');

  // 8) drag мышью
  const pos0 = await page.evaluate(() => ({ x: Editor.state.elements[0].x, y: Editor.state.elements[0].y }));
  const info = await page.evaluate(() => {
    const e = Editor.state.elements[0];
    const c = document.getElementById('editorCanvas');
    const r = c.getBoundingClientRect();
    return { x: e.x, y: e.y, vs: Editor.state.viewScale, left: r.left, top: r.top };
  });
  const sx = info.left + (info.x + 30) * info.vs;
  const sy = info.top + (info.y + 10) * info.vs;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 40, sy + 25, { steps: 6 });
  await page.mouse.up();
  const pos1 = await page.evaluate(() => ({ x: Editor.state.elements[0].x, y: Editor.state.elements[0].y }));
  console.log('drag:', JSON.stringify(pos0), '→', JSON.stringify(pos1));
  if (Math.abs(pos1.x - pos0.x) < 5 || Math.abs(pos1.y - pos0.y) < 5) errors.push('drag не работает');

  // 9) горячие клавиши: стрелки, Ctrl+C/V, Tab, Delete
  await page.evaluate(() => { Editor.state.selected = Editor.state.elements[0]; window.__am.refreshAll(); });
  const p0 = await page.evaluate(() => ({ x: Editor.state.selected.x, y: Editor.state.selected.y }));
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  const p1 = await page.evaluate(() => ({ x: Editor.state.selected.x, y: Editor.state.selected.y }));
  if (p1.x !== p0.x + 1 || p1.y !== p0.y + 1) errors.push('стрелки не работают');

  const nA = await page.evaluate(() => Editor.state.elements.length);
  await page.keyboard.down('Control'); await page.keyboard.press('KeyC'); await page.keyboard.up('Control');
  await page.keyboard.down('Control'); await page.keyboard.press('KeyV'); await page.keyboard.up('Control');
  const nB = await page.evaluate(() => Editor.state.elements.length);
  if (nB !== nA + 1) errors.push('Ctrl+C/V не работает');
  console.log('ctrl+c/v:', nA, '→', nB);

  await page.keyboard.press('Tab');
  await page.keyboard.press('Delete');
  const nC = await page.evaluate(() => Editor.state.elements.length);
  if (nC !== nB - 1) errors.push('Tab+Delete не работает');
  console.log('tab+del:', nB, '→', nC);

  // 10) инкрементальная печать
  const inc = await page.evaluate(() => {
    Editor.state.elements = [];
    Editor.state.selected = null;
    const s = Editor.add('serial', { startNumber: 7, interval: 1, digits: 4, prefix: 'SN', fontSize: 40, x: 10, y: 10 });
    const copies = [0, 1, 2].map(i => Editor.applySequence(s, i).text);
    const r0 = Editor.rasterizeCopy(0, 1);
    const r1 = Editor.rasterizeCopy(1, 1);
    const d0 = r0.getContext('2d').getImageData(0, 0, r0.width, r0.height).data;
    const d1 = r1.getContext('2d').getImageData(0, 0, r1.width, r1.height).data;
    let diff = 0;
    for (let i = 0; i < d0.length; i += 4) if (d0[i] !== d1[i]) diff++;
    Editor.state.elements = [];
    Editor.add('text', { text: 'AbleMark Web', fontSize: 40, bold: true });
    Editor.add('text', { text: 'Печать из браузера', fontSize: 26 });
    Editor.add('qr', { text: 'https://example.com', module: 3 });
    window.__am.refreshAll();
    return { copies, diff };
  });
  console.log('инкремент:', JSON.stringify(inc.copies), 'diff:', inc.diff);
  if (JSON.stringify(inc.copies) !== JSON.stringify(['SN0007', 'SN0008', 'SN0009'])) errors.push('инкремент неверен');
  if (inc.diff < 10) errors.push('rasterizeCopy одинаков');

  // 11) пресеты наклеек + поворот макета
  await page.select('#selPaperPreset', '12x40');
  await new Promise(r => setTimeout(r, 300));
  const sub = await page.$eval('#labelSubtitle', el => el.textContent);
  if (!/12×40/.test(sub)) errors.push('пресет 12×40: ' + sub);
  console.log('12x40:', sub);

  // 12) предпросмотр бинарный
  await page.evaluate(() => document.getElementById('btnPreview').click());
  await new Promise(r => setTimeout(r, 500));
  const pv = await page.evaluate(() => {
    const c = document.getElementById('previewCanvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let dark = 0, mid = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] < 128) dark++;
      else if (d[i] < 250) mid++;
    }
    return { dark, mid };
  });
  console.log('preview dark:', pv.dark, 'mid:', pv.mid);
  if (pv.mid > 0) errors.push('превью не бинарное');
  await page.evaluate(() => document.getElementById('previewModal').classList.add('hidden'));

  // 13) шаблоны: сохранение в localStorage, список, применение, экспорт-объект
  await page.evaluate(() => { localStorage.removeItem('ablemark.templates'); });
  await page.click('#btnTemplates');
  await new Promise(r => setTimeout(r, 300));
  const tplEmpty = await page.$eval('#tplList', el => el.textContent.trim());
  console.log('templates empty:', tplEmpty);

  // сохраняем текущий макет как шаблон
  await page.type('#tplNameInput', 'Test Template 1');
  await page.click('#btnTplSave');
  await new Promise(r => setTimeout(r, 300));
  const tplItems = await page.$$eval('.tpl-item', els => els.length);
  console.log('шаблонов в списке:', tplItems);
  if (tplItems !== 1) errors.push('шаблон не сохранился в списке');

  // localStorage реально содержит шаблон
  const lsTpls = await page.evaluate(() => {
    const arr = JSON.parse(localStorage.getItem('ablemark.templates') || '[]');
    return { n: arr.length, name: arr[0] && arr[0].name, elems: arr[0] && arr[0].data.elements.length };
  });
  console.log('localStorage:', JSON.stringify(lsTpls));
  if (lsTpls.n !== 1 || lsTpls.name !== 'Test Template 1') errors.push('шаблон не в localStorage');
  if (lsTpls.elems !== 3) errors.push('в шаблоне не 3 элемента: ' + lsTpls.elems);

  // изменение макета + применение шаблона возвращает сохранённое
  await page.evaluate(() => {
    Editor.state.elements = [];
    window.__am.refreshAll();
  });
  const elsAfterClear = await page.evaluate(() => Editor.state.elements.length);
  if (elsAfterClear !== 0) errors.push('макет не очистился');
  await page.evaluate(() => {
    document.querySelector('.tpl-item .btn').click(); // кнопка «Применить» (первая)
  });
  await new Promise(r => setTimeout(r, 300));
  const elsRestored = await page.evaluate(() => Editor.state.elements.length);
  console.log('применение шаблона: элементов', elsRestored);
  if (elsRestored !== 3) errors.push('шаблон не применился: ' + elsRestored);

  // импорт файла .amlbl через скрытый input (эмулируем выбор файла)
  const importResult = await page.evaluate(() => {
    const payload = JSON.stringify({
      format: 'ablemark-label/1',
      templates: [{ name: 'ImportedFromFile', date: new Date().toISOString(), data: { labelWmm: 58, labelHmm: 40, dpi: 8, elements: [{ type: 'text', text: 'X', x: 1, y: 1, fontSize: 20 }] } }],
    });
    const dt = new DataTransfer();
    const file = new File([payload], 'import.amlbl', { type: 'application/json' });
    dt.items.add(file);
    const input = document.getElementById('tplFileInput');
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
    return true;
  });
  await new Promise(r => setTimeout(r, 500));
  const afterImport = await page.evaluate(() => JSON.parse(localStorage.getItem('ablemark.templates') || '[]').map(x => x.name));
  console.log('импорт файла:', importResult, '→', JSON.stringify(afterImport));
  if (!afterImport.includes('ImportedFromFile')) errors.push('импорт .amlbl не сработал');

  // удаление шаблона (подтверждение диалога)
  page.on('dialog', d => d.accept());
  const delCount = await page.$$eval('.tpl-item', els => els.length);
  await page.evaluate(() => {
    const items = document.querySelectorAll('.tpl-item');
    items[items.length - 1].querySelector('.btn.danger').click();
  });
  await new Promise(r => setTimeout(r, 300));
  const delAfter = await page.$$eval('.tpl-item', els => els.length);
  console.log('удаление:', delCount, '→', delAfter);
  if (delAfter !== delCount - 1) errors.push('удаление шаблона не сработало');

  await page.evaluate(() => document.getElementById('templatesModal').classList.add('hidden'));

  // 14) панель «Об устройстве»: кнопка, модалка, запросы с мок-ответами
  await page.evaluate(() => {
    // эмулируем подключение и мокаем порт
    window.__devMock = {
      battery: null, version: null, sn: null, mac: null, shut: null, mileage: null, status: null,
    };
    const origCommand = AM.AbleMarkPort.prototype.command;
    AM.AbleMarkPort.prototype.command = async function (bytes) {
      await this.write(bytes).catch(() => {});
      const h = AM.hex(bytes).replace(/\s+/g, ' ');
      if (h.startsWith('10 ff 3d')) return window.__devMock.status;
      if (h.startsWith('10 ff 50')) return window.__devMock.battery;
      if (h.startsWith('10 ff 20 f1')) return window.__devMock.version;
      if (h.startsWith('10 ff 20 f2')) return window.__devMock.sn;
      if (h.startsWith('10 ff 20 f3')) return window.__devMock.mac;
      if (h.startsWith('10 ff 13')) return window.__devMock.shut;
      if (h.startsWith('1a 1f 06')) return window.__devMock.mileage;
      return null;
    };
    // подключённый вид
    const port = window.__am.port; port.connected = true;
    port.device = { name: 'P50' };
    port.writeChar = null;
    document.getElementById('btnDeviceInfo').disabled = false;
    window.__setConn = () => {};
  });

  // задаём мок-ответы
  await page.evaluate(() => {
    const str = (s) => new Uint8Array(Array.from(s, c => c.charCodeAt(0)));
    window.__devMock.status = new Uint8Array([0x00]);
    window.__devMock.battery = new Uint8Array([0x10, 87]);
    window.__devMock.version = str('V2.1.7');
    window.__devMock.sn = str('P50A1234567');
    window.__devMock.mac = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]);
    window.__devMock.shut = new Uint8Array([0x00, 30]);
    const cap = 1000, rem = 250;
    const b = [0x1a, 0x1f, 0x07, (cap >> 8) & 0xff, cap & 0xff, (rem >> 8) & 0xff, rem & 0xff, 0];
    b[7] = (b[3] + b[4] + b[5] + b[6]) & 0xff;
    window.__devMock.mileage = new Uint8Array(b);
  });

  await page.click('#btnDeviceInfo');
  await new Promise(r => setTimeout(r, 1500));
  const dev = await page.evaluate(() => ({
    name: document.getElementById('devName').textContent,
    battery: document.getElementById('devBattery').textContent,
    batteryBar: document.getElementById('devBatteryBar').style.width,
    paper: document.getElementById('devPaper').textContent,
    paperBar: document.getElementById('devPaperBar').style.width,
    version: document.getElementById('devVersion').textContent,
    sn: document.getElementById('devSN').textContent,
    mac: document.getElementById('devMAC').textContent,
    status: document.getElementById('devStatus').textContent,
    shut: document.getElementById('devShutInput').value,
  }));
  console.log('device:', JSON.stringify(dev, null, 1));
  if (dev.name !== 'P50') errors.push('имя устройства не отобразилось');
  if (!/87%/.test(dev.battery)) errors.push('батарея не отобразилась: ' + dev.battery);
  if (dev.batteryBar !== '87%') errors.push('полоса батареи: ' + dev.batteryBar);
  if (!/25%/.test(dev.paper)) errors.push('остаток бумаги не отобразился: ' + dev.paper);
  if (dev.paperBar !== '25%') errors.push('полоса бумаги: ' + dev.paperBar);
  if (dev.version !== 'V2.1.7') errors.push('версия: ' + dev.version);
  if (dev.sn !== 'P50A1234567') errors.push('SN: ' + dev.sn);
  if (dev.mac !== 'AA:BB:CC:DD:EE:FF') errors.push('MAC: ' + dev.mac);
  if (!/готов|ready/.test(dev.status)) errors.push('статус: ' + dev.status);
  if (dev.shut !== '30') errors.push('shutdown time не подставился: ' + dev.shut);

  // установка shutdown: мокаем write и ответ OK
  await page.evaluate(() => {
    window.__am.port.write = async (bytes, cb) => { cb && cb(100); window.__lastWritten = AM.hex(bytes); return true; };
  });
  await page.evaluate(() => { document.getElementById('devShutInput').value = '45'; });
  await page.click('#btnSetShut');
  await new Promise(r => setTimeout(r, 300));
  const lastWritten = await page.evaluate(() => window.__lastWritten);
  console.log('setShutTime sent:', lastWritten);
  if (lastWritten !== '10 ff 12 00 2d') errors.push('команда setShutTime неверна: ' + lastWritten);

  // восстановим write для остальных тестов
  await page.evaluate(() => {
    window.__am.port.connected = false;
    document.getElementById('deviceModal').classList.add('hidden');
  });

  // 15) сервисные операции и BT-консоль (с мок-портом)
  await page.evaluate(() => {
    const port = window.__am.port;
    port.connected = true;
    port.device = { name: 'P50' };
    window.__sentHex = [];
    port.write = async (bytes) => { window.__sentHex.push(AM.hex(bytes)); return true; };
    document.getElementById('btnDeviceInfo').disabled = false;
  });
  await page.click('#btnDeviceInfo');
  await new Promise(r => setTimeout(r, 2000)); // ждём окончания queryDeviceInfo
  await page.evaluate(() => { window.__sentHex = []; });

  // калибровка
  await page.click('#svcCalibrate');
  await new Promise(r => setTimeout(r, 200));
  // beep
  await page.click('#svcBeep');
  await new Promise(r => setTimeout(r, 200));
  // синхронизация времени
  await page.click('#svcSyncTime');
  await new Promise(r => setTimeout(r, 200));

  const sentSvc = await page.evaluate(() => window.__sentHex.slice(0, 3));
  console.log('svc sent:', JSON.stringify(sentSvc));
  if (sentSvc[0] !== '1f 11 50') errors.push('калибровка: ' + sentSvc[0]);
  if (sentSvc[1] !== '07') errors.push('beep: ' + sentSvc[1]);
  if (!/^10 ff bb 01 [0-9a-f]{2} [0-9a-f]{2} [0-9a-f]{2}$/.test(sentSvc[2])) errors.push('sync time: ' + sentSvc[2]);

  // BT-консоль: hex-команда
  await page.evaluate(() => { window.__sentHex = []; });
  await page.type('#hexInput', '1A 1F 06');
  await page.click('#btnHexSend');
  await new Promise(r => setTimeout(r, 300));
  let hexSent = await page.evaluate(() => window.__sentHex[0]);
  console.log('console sent:', hexSent);
  if (hexSent !== '1a 1f 06') errors.push('консоль: ' + hexSent);

  // пресет-кнопка
  await page.evaluate(() => { window.__sentHex = []; });
  await page.evaluate(() => {
    document.querySelector('[data-hex="10 FF 3D"]').click();
  });
  await new Promise(r => setTimeout(r, 300));
  hexSent = await page.evaluate(() => window.__sentHex[0]);
  console.log('preset sent:', hexSent);
  if (hexSent !== '10 ff 3d') errors.push('пресет консоли: ' + hexSent);

  // слитный hex
  await page.evaluate(() => { window.__sentHex = []; document.getElementById('hexInput').value = ''; });
  await page.type('#hexInput', '10FF20F2');
  await page.keyboard.press('Enter');
  await new Promise(r => setTimeout(r, 300));
  hexSent = await page.evaluate(() => window.__sentHex[0]);
  console.log('compact hex sent:', hexSent);
  if (hexSent !== '10 ff 20 f2') errors.push('слитный hex: ' + hexSent);

  // мусорный hex не отправляется
  await page.evaluate(() => { window.__sentHex = []; });
  await page.type('#hexInput', 'ZZ QQ');
  await page.click('#btnHexSend');
  await new Promise(r => setTimeout(r, 200));
  const badSent = await page.evaluate(() => window.__sentHex.length);
  if (badSent !== 0) errors.push('мусорный hex отправился');
  console.log('мусорный hex отклонён:', badSent === 0);

  await page.evaluate(() => {
    window.__am.port.connected = false;
    document.getElementById('deviceModal').classList.add('hidden');
  });

  await page.screenshot({ path: path.join(__dirname, 'screenshot.png') });

  console.log(errors.length ? ('ОШИБКИ:\n' + errors.join('\n')) : 'SMOKE-TEST OK');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
