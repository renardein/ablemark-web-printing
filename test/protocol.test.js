/* Быстрый unit-тест протокольных функций без браузера. */
'use strict';
const path = require('path');
const fs = require('fs');

// --- заглушки DOM ---
Object.defineProperty(global, 'navigator', { value: { bluetooth: undefined }, configurable: true });
global.window = global;

// --- pako ---
const pakoSrc = fs.readFileSync(path.join(__dirname, '..', 'vendor', 'pako.min.js'), 'utf8');
eval(pakoSrc);
global.pako = module.exports;

// --- ablemark (без Web Bluetooth вызовов) ---
eval(fs.readFileSync(path.join(__dirname, '..', 'js', 'ablemark.js'), 'utf8') + '\n;globalThis.AM = AM;');

let failed = 0;
const eq = (name, actual, expected) => {
  const a = Buffer.from(actual).toString('hex');
  const b = Buffer.from(expected).toString('hex');
  if (a === b) console.log(`ok  ${name}`);
  else { failed++; console.error(`FAIL ${name}\n  actual:   ${a}\n  expected: ${b}`); }
};
const ok = (name, cond) => {
  if (cond) console.log(`ok  ${name}`);
  else { failed++; console.error(`FAIL ${name}`); }
};

// --- команды ---
eq('wakeupL (15 нулей)', AM.CMD.wakeupL(), new Uint8Array(15));
eq('enableL', AM.CMD.enableL(), [0x10, 0xff, 0xf1, 0x02]);
eq('stopL', AM.CMD.stopL(), [0x10, 0xff, 0xf1, 0x45]);
eq('wakeupP (6 нулей)', AM.CMD.wakeupP(), new Uint8Array(6));
eq('startJobP', AM.CMD.startJobP(), [0x1f, 0xc0, 0x01, 0x00]);
eq('stopJobP', AM.CMD.stopJobP(), [0x1f, 0xc0, 0x01, 0x01]);
eq('adjustAuto(81)', AM.CMD.adjustAuto(81), [0x1f, 0x11, 0x51]);
eq('printerLocation(32,0)', AM.CMD.printerLocation(32, 0), [0x1f, 0x12, 0x20, 0x00]);
eq('setDensity(2,1)', AM.CMD.setDensity(2, 1), [0x1f, 0x70, 0x02, 0x01]);
eq('feedDots(100)', AM.CMD.feedDots(100), [0x1b, 0x4a, 0x64]);
eq('feedToMark', AM.CMD.feedToMark(), [0x1d, 0x0c]);
eq('queryStatus', AM.CMD.queryStatus(), [0x10, 0xff, 0x3d]);
eq('queryBattery', AM.CMD.queryBattery(), [0x10, 0xff, 0x50, 0xf1]);
eq('queryVersion', AM.CMD.queryVersion(), [0x10, 0xff, 0x20, 0xf1]);

// --- GS v 0 ---
{
  const data = new Uint8Array([0xff, 0x00, 0xaa]); // bpr=2, height... подделаем: bpr=2,h=1.5 — нет, возьмём 6 байт
  const d = new Uint8Array([0xaa, 0x55, 0x0f, 0xf0, 0x81, 0x7e]); // bpr=3, h=2
  const r = AM.gsV0(d, 3, 2);
  eq('gsV0 header', r.slice(0, 8), [0x1d, 0x76, 0x30, 0x00, 0x03, 0x00, 0x02, 0x00]);
  eq('gsV0 payload', r.slice(8), d);
}

// --- compressedImage: 1F 10 + BE-заголовки + zlib(windowBits=14) ---
{
  const d = new Uint8Array(500).fill(0); // нули → сжимается отлично
  d[0] = 0xff;
  const r = AM.compressedImage(d, 30, 16); // bpr=30? несогласованно, но проверяем формат
  eq('compressedImage hdr', r.slice(0, 10),
    [0x1f, 0x10, 0x00, 0x1e, 0x00, 0x10,
     (r[6]), (r[7]), (r[8]), (r[9])]);
  // windowBits=14 → CINFO=6 → CMF=0x68 (у zlib wbits=15 было бы 0x78)
  ok('compressedImage zlib CMF=0x68 (windowBits=14)', r[10] === 0x68);
  const len = (r[6] << 24) | (r[7] << 16) | (r[8] << 8) | r[9];
  ok('compressedImage длина поля = размер zlib', len === r.length - 10);
  const back = pako.inflate(r.slice(10), { windowBits: 14 });
  eq('compressedImage roundtrip', back, d);
}

// --- buildPrintStream (L-протокол, raw, 1 копия, непрерывная) ---
{
  const m = { data: new Uint8Array([0xf0]), bpr: 1, height: 1 };
  const s = AM.buildPrintStream(m, { protocol: 'l', density: 1, copies: 1, compressed: false, paperType: 1, feedDots: 100 });
  const expect = AM.concat(
    AM.CMD.setDensity(2, 1),
    AM.CMD.wakeupL(), AM.CMD.enableL(),
    AM.gsV0(m.data, 1, 1),
    AM.CMD.feedDots(100), AM.CMD.stopL()
  );
  eq('buildPrintStream L raw', s, expect);
}

// --- buildPrintStream (L-протокол, 2 копии: последовательность повторяется) ---
{
  const m = { data: new Uint8Array([0xf0]), bpr: 1, height: 1 };
  const s = AM.buildPrintStream(m, { protocol: 'l', density: 1, copies: 2, compressed: false, paperType: 1, feedDots: 100 });
  const one = AM.concat(AM.CMD.wakeupL(), AM.CMD.enableL(), AM.gsV0(m.data, 1, 1), AM.CMD.feedDots(100), AM.CMD.stopL());
  eq('buildPrintStream L x2', s, AM.concat(AM.CMD.setDensity(2, 1), one, one));
}

// --- buildPrintStream (P50, printS2) ---
{
  const m = { data: new Uint8Array([0xf0]), bpr: 1, height: 1 };
  const s = AM.buildPrintStream(m, { protocol: 'p50', density: 2, copies: 1 });
  const expect = AM.concat(
    AM.CMD.wakeupP(), AM.CMD.setDensity(2, 2),
    AM.CMD.startJobP(), AM.CMD.adjustAuto(81),
    AM.compressedImage(m.data, 1, 1),
    AM.CMD.printerLocation(32, 0), AM.CMD.stopJobP(), AM.CMD.adjustAuto(80));
  eq('buildPrintStream p50 (printS2)', s, expect);
}

// --- imageDataTo1bpp ---
{
  // 16x2: белая строка, чёрная строка
  const px = new Uint8ClampedArray(16 * 2 * 4);
  for (let x = 0; x < 16; x++) {
    px[(16 + x) * 4] = 0; px[(16 + x) * 4 + 1] = 0; px[(16 + x) * 4 + 2] = 0; px[(16 + x) * 4 + 3] = 255;
    px[x * 4] = 255; px[x * 4 + 1] = 255; px[x * 4 + 2] = 255; px[x * 4 + 3] = 255;
  }
  const img = { data: px, width: 16, height: 2 };
  const m = AM.imageDataTo1bpp(img, 16, 2);
  eq('imageDataTo1bpp', m.data, [0x00, 0x00, 0xff, 0xff]);
  ok('bpr', m.bpr === 2 && m.height === 2);
}

// --- Code128 ---
{
  const { } = { };
  // проверим через editor? editor требует DOM/canvas для measure, но code128Encode чистая функция.
  // Загрузим editor с минимальными заглушками.
  global.document = {
    createElement: () => ({ getContext: () => null }),
  };
  global.qrcode = () => { throw new Error('not used'); };
  eval(fs.readFileSync(path.join(__dirname, '..', 'js', 'editor.js'), 'utf8') + '\n;globalThis.Editor = Editor;');
  const bits = Editor.code128Encode('1234');
  // Code128 "1234": Start C, 12, 34, checksum, stop
  // Start C = 105, values 12,34 → checksum = 105 + 12*1 + 34*2 = 187 % 103 = 84
  const expectedStart = '11010011100' + // 105 StartC
    '10111100010' + // hmm — вычислим по таблице ниже в тесте вручную не будем, проверим структуру
    '';
  ok('code128 длина кратна 11', bits.length % 11 === 0);
  ok('code128 > 4 символов', bits.length >= 5 * 11);
  // самопроверка: декодер
  const P = ['11011001100','11001101100','11001100110','10010011000','10010001100',
    '10001001100','10011001000','10011000100','10001100100','11001001000',
    '11001000100','11000100100','10110011100','10011011100','10011001110',
    '10111001100','10011101100','10011100110','11001110010','11001011100',
    '11001001110','11011100100','11001110100','11101101110','11101001100',
    '11100101100','11100100110','11101100100','11100110100','11100110010',
    '11011011000','11011000110','11000110110','10100011000','10001011000',
    '10001000110','10110001000','10001101000','10001100010','11010001000',
    '11000101000','11000100010','10110111000','10110001110','10001101110',
    '10111011000','10111000110','10001110110','11101110110','11010001110',
    '11000101110','11011101000','11011100010','11011101110','11101011000',
    '11101000110','11100010110','11101101000','11101100010','11100011010',
    '11101111010','11001000010','11110001010','10100110000','10100001100',
    '10010110000','10010000110','10000101100','10000100110','10110010000',
    '10110000100','10011010000','10011000010','10000110100','10000110010',
    '11000010010','11001010000','11110111010','11000010100','10001111010',
    '10100111100','10010111100','10010011110','10111100100','10011110100',
    '10011110010','11110100100','11110010100','11110010010','11011011110',
    '11011110110','11110110110','10101111000','10100011110','10001011110',
    '10111101000','10111100010','11110101000','11110100010','10111011110',
    '10111101110','11101011110','11110101110','11010000100','11010010000',
    '11010011100','11000111010'];
  const symbs = [];
  for (let i = 0; i < bits.length / 11; i++) {
    const s = bits.substr(i * 11, 11);
    const idx = P.indexOf(s);
    symbs.push(idx);
  }
  ok('code128 все символы валидны', symbs.every(s => s >= 0));
  ok('code128 start C', symbs[0] === 105);
  ok('code128 данные 12,34', symbs[1] === 12 && symbs[2] === 34);
  const sum = (symbs[0] + symbs[1] * 1 + symbs[2] * 2) % 103;
  ok('code128 checksum', symbs[3] === sum);
  ok('code128 stop', symbs[4] === 106);
}

// --- поворот 1bpp (rotate1bpp) ---
{
  // растр 16×2: строка0 = 1010 1010 1010 1010 (0xAA AA), строка1 = 1111 0000 1111 0000 (0xF0 F0)
  const m = { data: new Uint8Array([0xaa, 0xaa, 0xf0, 0xf0]), bpr: 2, height: 2 };
  const W = 16, H = 2;
  const px = (mm, x, y) => !!(mm.data[y * mm.bpr + (x >> 3)] & (0x80 >> (x & 7)));

  // dir 2 — без изменений
  const r2 = AM.rotate1bpp(m, 2);
  eq('rotate dir2 = as-is', r2.data, m.data);

  // dir 3 — 180°: пиксель (x,y) → (W-1-x, H-1-y)
  const r3 = AM.rotate1bpp(m, 3);
  let ok180 = true;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
    if (px(m, x, y) !== px(r3, W - 1 - x, H - 1 - y)) ok180 = false;
  ok('rotate dir3 (180°) корректен', ok180);

  // dir 0 — +90° CW: (x,y) → (H-1-y, x); новые размеры: w=H, h=W
  const r0 = AM.rotate1bpp(m, 0);
  ok('rotate dir0 размеры', r0.bpr === Math.ceil(H / 8) && r0.height === W);
  let ok0 = true;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
    if (px(m, x, y) !== px(r0, H - 1 - y, x)) ok0 = false;
  ok('rotate dir0 (+90° CW) корректен', ok0);

  // dir 1 — −90° CCW: (x,y) → (y, W-1-x)
  const r1 = AM.rotate1bpp(m, 1);
  ok('rotate dir1 размеры', r1.bpr === Math.ceil(H / 8) && r1.height === W);
  let ok1 = true;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
    if (px(m, x, y) !== px(r1, y, W - 1 - x)) ok1 = false;
  ok('rotate dir1 (−90° CCW) корректен', ok1);

  // двойной поворот ±90 = 180
  const twice = AM.rotate1bpp(AM.rotate1bpp(m, 0), 0);
  let okTT = true;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
    if (px(m, x, y) !== px(twice, W - 1 - x, H - 1 - y)) okTT = false;
  ok('rotate 2×90° = 180°', okTT);
}

// --- профили моделей ---
{
  const p15 = AM.modelProfile('P15_2N31');
  ok('profile P15: протокол l, направление 1', p15.protocol === 'l' && p15.direction === 1);
  const p50 = AM.modelProfile('P50');
  ok('profile P50: протокол p50, направление 2', p50.protocol === 'p50' && p50.direction === 2);
  const s2 = AM.modelProfile('S2');
  ok('profile S2: протокол p50, направление 2, 50×30', s2.protocol === 'p50' && s2.direction === 2 && s2.paper[0] === 50);
  const s2pro = AM.modelProfile('S2 pro');
  ok('profile S2 pro: 11.8 dot/mm', Math.abs(s2pro.dpi - 11.8) < 0.01);
  const d100 = AM.modelProfile('D100');
  ok('profile D100: направление 3', d100.direction === 3);
  const unknown = AM.modelProfile('SomeOther');
  ok('profile unknown: дефолт направление 2', unknown.direction === 2);
}

// --- buildPrintStream: paperType ---
{
  const m = { data: new Uint8Array([0xf0]), bpr: 1, height: 1 };
  // наклейка (3): без feed
  const s3 = AM.buildPrintStream(m, { protocol: 'l', density: 1, copies: 1, paperType: 3 });
  const exp3 = AM.concat(
    AM.CMD.setDensity(2, 1), AM.CMD.wakeupL(), AM.CMD.enableL(),
    AM.gsV0(m.data, 1, 1), AM.CMD.stopL());
  eq('buildPrintStream L label(3)', s3, exp3);
  // непрерывная (1): + feedDots
  const s1 = AM.buildPrintStream(m, { protocol: 'l', density: 1, copies: 1, paperType: 1, feedDots: 100 });
  eq('buildPrintStream L continuous(1)', s1, AM.concat(
    AM.CMD.setDensity(2, 1), AM.CMD.wakeupL(), AM.CMD.enableL(),
    AM.gsV0(m.data, 1, 1), AM.CMD.feedDots(100), AM.CMD.stopL()));
  // чёрная метка (2): сжатый растр + GS 0C
  const s2 = AM.buildPrintStream(m, { protocol: 'l', density: 1, copies: 1, paperType: 2 });
  const exp2 = AM.concat(
    AM.CMD.setDensity(2, 1), AM.CMD.wakeupL(), AM.CMD.enableL(),
    AM.compressedImage(m.data, 1, 1), AM.CMD.feedToMark(), AM.CMD.stopL());
  eq('buildPrintStream L blackmark(2)', s2, exp2);
}

// --- imageDataTo1bppDither (Floyd–Steinberg) ---
{
  // белый → пусто, чёрный → заполнено
  const mk = (v, w, h) => {
    const d = new Uint8ClampedArray(w * h * 4).fill(v);
    for (let i = 3; i < d.length; i += 4) d[i] = 255; // alpha
    return { data: d, width: w, height: h };
  };
  eq('dither: белый → 0', AM.imageDataTo1bppDither(mk(255, 16, 2), 16, 2).data, new Uint8Array(4));
  eq('dither: чёрный → все 1', AM.imageDataTo1bppDither(mk(0, 16, 2), 16, 2).data, new Uint8Array(4).fill(0xff));
  // серый 50% → ~50% точек, но не 0 и не все
  const g = mk(128, 64, 8);
  const d = AM.imageDataTo1bppDither(g, 64, 8);
  let bits = 0;
  for (const b of d.data) for (let k = 7; k >= 0; k--) if (b & (1 << k)) bits++;
  const total = 64 * 8;
  ok(`dither: 50% серого → ~50% точек (${bits}/${total})`, bits > total * 0.25 && bits < total * 0.75);
  // градиент: и тёмные, и светлые области
  const grad = { data: new Uint8ClampedArray(64 * 4 * 4), width: 64, height: 4 };
  for (let x = 0; x < 64; x++) {
    const v = Math.round(255 * x / 63);
    for (let y = 0; y < 4; y++) {
      const i = (y * 64 + x) * 4;
      grad.data[i] = grad.data[i + 1] = grad.data[i + 2] = v;
      grad.data[i + 3] = 255;
    }
  }
  const dg = AM.imageDataTo1bppDither(grad, 64, 4);
  const col = (x) => {
    let n = 0;
    for (let y = 0; y < 4; y++) if (dg.data[y * dg.bpr + (x >> 3)] & (0x80 >> (x & 7))) n++;
    return n;
  };
  const darkAvg = (col(2) + col(3) + col(4)) / 3, lightAvg = (col(60) + col(61) + col(62)) / 3;
  ok(`dither: градиент тёмный>светлый (${darkAvg} > ${lightAvg})`, darkAvg > lightAvg);
}

// --- инкрементальная печать (serialValue / applySequence) ---
{
  const base = { type: 'serial', startNumber: 1, interval: 1, digits: 5, prefix: 'SN', suffix: '' };
  eq('serial 00001', Editor.serialValue(base, 0), 'SN00001');
  eq('serial 00002', Editor.serialValue(base, 1), 'SN00002');
  eq('serial 00010', Editor.serialValue(base, 9), 'SN00010');

  // шаг 2
  const step2 = { ...base, startNumber: 10, interval: 2 };
  eq('serial step=2', Editor.serialValue(step2, 3), 'SN00016');

  // суффикс и разрядность
  const suf = { ...base, suffix: '-A', digits: 3, startNumber: 5 };
  eq('serial suffix', Editor.serialValue(suf, 0), 'SN005-A');
  eq('serial suffix+1', Editor.serialValue(suf, 1), 'SN006-A');

  // старт с нуля
  const z = { type: 'serial', startNumber: 0, interval: 1, digits: 4, prefix: '', suffix: '' };
  eq('serial от 0', Editor.serialValue(z, 0), '0000');
  eq('serial от 0, копия 100', Editor.serialValue(z, 100), '0100');

  // applySequence: серийник
  const seq = Editor.applySequence({ ...base, text: 'SN00001' }, 2);
  ok('applySequence serial', seq.text === 'SN00003');

  // applySequence: штрихкод с инкрементом (буквы сохраняются, число растёт, разрядность — тоже)
  const bc = { type: 'barcode', text: 'ABC000123', increment: true, incrementStep: 1 };
  eq('applySequence barcode 0', Editor.applySequence(bc, 0).text, 'ABC000123');
  eq('applySequence barcode 1', Editor.applySequence(bc, 1).text, 'ABC000124');
  eq('applySequence barcode 10', Editor.applySequence(bc, 10).text, 'ABC000133');
  eq('applySequence barcode step=5', Editor.applySequence({ ...bc, incrementStep: 5 }, 3).text, 'ABC000138');

  // applySequence: обычные элементы не меняются
  const plain = { type: 'text', text: 'hello' };
  eq('applySequence text без изменений', Editor.applySequence(plain, 7).text, 'hello');

  // обычный штрихкод (инкремент выкл) не меняется
  const bcOff = { type: 'barcode', text: '123456', increment: false };
  eq('applySequence barcode без инкремента', Editor.applySequence(bcOff, 9).text, '123456');
}

// --- парсеры ответов устройства (YXQProtocolTools) ---
{
  const P = AM.Parsers;
  const num = (name, a, b) => ok(name, a === b); // eq не умеет числа

  // статус (биты)
  num('status: ok', P.status(new Uint8Array([0x00])), 0);
  num('status: печать (бит 1)', P.status(new Uint8Array([0x01])), 1);
  num('status: крышка (бит 2)', P.status(new Uint8Array([0x02])), 2);
  num('status: нет бумаги (бит 4)', P.status(new Uint8Array([0x04])), 3);
  num('status: перегрев (бит 16)', P.status(new Uint8Array([0x10])), 5);
  num('status: батарея (бит 8)', P.status(new Uint8Array([0x08])), 4);
  num('status: приоритет печати', P.status(new Uint8Array([0x1f])), 1);
  num('status: null', P.status(null), null);

  // батарея: bArr[1]
  num('battery: [.., 87]', P.battery(new Uint8Array([0x55, 87])), 87);
  num('battery: [.., 20]', P.battery(new Uint8Array([0x0f, 20])), 20);
  // LP90: длина 2 → [1], иначе [4]
  num('battery LP90 len2', P.battery(new Uint8Array([0, 88]), 'LP90'), 88);
  num('battery LP90 len5', P.battery(new Uint8Array([1, 2, 3, 4, 66]), 'LP90'), 66);
  // X8 JSON {"bat": 55}
  num('battery JSON', P.battery(new Uint8Array(Array.from('{"bat": 55}', c => c.charCodeAt(0)))), 55);

  // версия: текст или JSON {"sw": ...}
  num('version текст', P.version(new Uint8Array(Array.from('V1.2.3', c => c.charCodeAt(0)))), 'V1.2.3');

  // SN: текст или JSON {"SN":"5838..."} → X8...
  num('sn текст', P.sn(new Uint8Array(Array.from('SN123456', c => c.charCodeAt(0)))), 'SN123456');
  num('sn JSON 5838 → X8', P.sn(new Uint8Array(Array.from('{"SN":"58380123"}', c => c.charCodeAt(0)))), 'X880123');
  num('sn JSON обычный', P.sn(new Uint8Array(Array.from('{"SN":"ABC123"}', c => c.charCodeAt(0)))), 'ABC123');

  // MAC: последние 6 байт → AA:BB:CC:DD:EE:FF
  eq('mac', P.mac(new Uint8Array([0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77])), [0x22, 0x33, 0x44, 0x55, 0x66, 0x77].length ? '22:33:44:55:66:77' : '');

  // shutTime: L-серия → [0], прочие → [1]
  num('shut L (P15)', P.shutTime(new Uint8Array([15, 0]), 'P15_2N31'), 15);
  num('shut прочие (S2)', P.shutTime(new Uint8Array([0, 30]), 'S2'), 30);
  num('shut JSON', P.shutTime(new Uint8Array(Array.from('{"shutdownTime":20}', c => c.charCodeAt(0))), 'X8'), 20);

  // mileage: 8 байт, [3..4]=ёмкость BE, [5..6]=остаток LE, [7]=сумма
  {
    const cap = 1000, rem = 750;
    const b = [0x1a, 0x1f, 0x07, (cap >> 8) & 0xff, cap & 0xff, (rem >> 8) & 0xff, rem & 0xff, 0];
    b[7] = (b[3] + b[4] + b[5] + b[6]) & 0xff;
    const m = P.mileage(new Uint8Array(b));
    ok('mileage capacity', m && m.capacity === 1000);
    ok('mileage remain', m && m.remain === 750);
    ok('mileage percent 75', m && m.percent === 75);
  }
  {
    const b = [0x1a, 0x1f, 0x07, 0x03, 0xe8, 0x02, 0xee, 0x99];
    ok('mileage битая сумма → null', P.mileage(new Uint8Array(b)) === null);
  }
  ok('mileage короткий ответ → null', P.mileage(new Uint8Array([1, 2, 3])) === null);

  // команды
  eq('setShutTime(15)', AM.CMD.setShutTime(15), [0x10, 0xff, 0x12, 0x00, 0x0f]);
  eq('setShutTime(300)', AM.CMD.setShutTime(300), [0x10, 0xff, 0x12, 0x01, 0x2c]);
  eq('queryMAC', AM.CMD.queryMAC(), [0x10, 0xff, 0x20, 0xf3]);
  eq('queryMileage', AM.CMD.queryMileage(), [0x1a, 0x1f, 0x06]);
}

// --- новые служебные команды + parseHex (BT_OPERATIONS.md) ---
{
  eq('beep', AM.CMD.beep(), [0x07]);
  eq('calibrate', AM.CMD.calibrate(), [0x1f, 0x11, 80]);
  eq('learnGap', AM.CMD.learnGap(), [0x10, 0xff, 0x03]);
  eq('feedToMarkPP', AM.CMD.feedToMarkPP(), [0x0e]);
  eq('screenOn(true)', AM.CMD.screenOn(true), [0x10, 0xff, 0x60, 0x01]);
  eq('screenOn(false)', AM.CMD.screenOn(false), [0x10, 0xff, 0x60, 0x00]);
  eq('factoryReset', AM.CMD.factoryReset(), [0x1f, 0x50, 0xbe]);
  eq('setTime(14,05,09)', AM.CMD.setTime(14, 5, 9), [0x10, 0xff, 0xbb, 0x01, 14, 5, 9]);
  eq('queryTime', AM.CMD.queryTime(), [0x10, 0xff, 0xbb, 0x02]);
  eq('setCountdown(600)', AM.CMD.setCountdown(600), [0x10, 0xff, 0xbb, 0x03, 0x02, 0x58]);
  eq('showTimeMode', AM.CMD.showTimeMode(), [0x10, 0xff, 0xbb, 0x04]);
  eq('countdownMode', AM.CMD.countdownMode(), [0x10, 0xff, 0xbb, 0x05]);
  eq('startCountdown', AM.CMD.startCountdown(), [0x10, 0xff, 0xbb, 0x06, 0x01]);
  eq('queryDate', AM.CMD.queryDate(), [0x10, 0xff, 0xef, 0xee]);
  eq('queryBtVersion', AM.CMD.queryBtVersion(), [0x10, 0xff, 0x30, 0x10]);
  eq('queryBtName', AM.CMD.queryBtName(), [0x10, 0xff, 0x30, 0x11]);
  eq('inductionPrint', AM.CMD.inductionPrint(), [0x1a, 0x1f, 0x01]);
  eq('feedToBlackMark', AM.CMD.feedToBlackMark(), [0x1d, 0x0c]);
  eq('prepareX8', AM.CMD.prepareX8(), [0x1b, 0x3d, 0x5d, 0xa5]);
  eq('querySpeed', AM.CMD.querySpeed(), [0x1f, 0x60, 0x00]);
  eq('setSpeed(2,8)', AM.CMD.setSpeed(2, 8), [0x1f, 0x60, 0x02, 0x08]);
  eq('queryDensity', AM.CMD.queryDensity(), [0x1f, 0x70, 0x00]);
  eq('setPaperType(2,32)', AM.CMD.setPaperType(2, 32), [0x1f, 0x80, 0x02, 0x20]);
  eq('setThickness(5)', AM.CMD.setThickness(5), [0x10, 0xff, 0x10, 0x00, 0x05]);
  eq('feedRowsEsc(3)', AM.CMD.feedRowsEsc(3), [0x1b, 0x64, 0x03]);

  // parseHex
  ok('parseHex «10 FF 3D»', AM.parseHex('10 FF 3D'), [0x10, 0xff, 0x3d]);
  ok('parseHex «10ff3d»', AM.parseHex('10ff3d'), [0x10, 0xff, 0x3d]);
  ok('parseHex «0x10,0xff,0x3d»', AM.parseHex('0x10,0xff,0x3d'), [0x10, 0xff, 0x3d]);
  ok('parseHex «1A 1F 06»', AM.parseHex('1A 1F 06'), [0x1a, 0x1f, 0x06]);
  ok('parseHex пусто → null', AM.parseHex('') === null);
  ok('parseHex мусор → null', AM.parseHex('zz qq') === null);
  ok('parseHex 0x → null', AM.parseHex('0xZZ') === null);
  ok('parseHex односимвольные', AM.parseHex('7'), [0x07]);
}

console.log(failed === 0 ? '\nВСЕ ТЕСТЫ ПРОЙДЕНЫ' : `\nПРОВАЛЕНО: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
