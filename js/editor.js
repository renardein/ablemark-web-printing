/**
 * editor.js — канвас-редактор наклеек, повторяющий LabelEditorActivity из AbleMark:
 * свободное перетаскивание элементов по канвасу, выделение с рамкой, тулбар
 * (удалить/копировать/масштаб/поворот/выравнивание/слои), панель добавления
 * (Текст/Дата/Штрихкод/QR/Линия/Фигура/Картинка/Серийный номер), панель свойств
 * текста (жирный/подчёркнутый/курсив/инверсия/размер/межбуквенное).
 */
'use strict';

const Editor = (() => {

  // -------------------------------------------------- Code128 (sets B/C) ---
  const C128_PATTERNS = [
    '11011001100','11001101100','11001100110','10010011000','10010001100',
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
    '11010011100','11000111010',
  ];
  const C128_START_B = 104, C128_START_C = 105, C128_STOP = 106;

  function code128Encode(text) {
    const codes = [];
    let i = 0;
    if (/^\d{4}/.test(text) && text.match(/^\d+/)[0].length % 2 === 0) {
      codes.push(C128_START_C);
      const digits = text.match(/^\d+/)[0];
      for (let j = 0; j < digits.length; j += 2) codes.push(parseInt(digits.substr(j, 2), 10));
      i = digits.length;
    } else {
      codes.push(C128_START_B);
    }
    while (i < text.length) {
      if (/^\d{4}/.test(text.slice(i))) {
        const digits = text.slice(i).match(/^\d+/)[0];
        const take = digits.length - (digits.length % 2);
        if (take >= 4) {
          codes.push(C128_START_C);
          for (let j = 0; j < take; j += 2) codes.push(parseInt(digits.substr(j, 2), 10));
          i += take;
          continue;
        }
      }
      const ch = text.charCodeAt(i);
      if (ch >= 32 && ch <= 126) codes.push(ch - 32);
      else codes.push(0);
      i++;
    }
    let sum = codes[0];
    for (let k = 1; k < codes.length; k++) sum += codes[k] * k;
    codes.push(sum % 103);
    codes.push(C128_STOP);
    let bits = '';
    for (const c of codes) bits += C128_PATTERNS[c];
    return bits;
  }

  // ------------------------------------------------------------ шрифт ---
  const FONT_STACK = '"Arial", "Helvetica Neue", Helvetica, sans-serif';

  // --------------------------------------------------------- состояние ---
  const state = {
    labelWmm: 40,
    labelHmm: 30,
    dpi: 8,
    round: false,
    zoom: 4,             // экранный px на печатную точку (в канвасе подбирается сам)
    elements: [],        // стикеры
    selected: null,      // выделенный стикер
    viewScale: 4,        // текущий масштаб канваса (точка → экран)
  };

  const widthDots = () => Math.max(8, Math.round(state.labelWmm * state.dpi));
  const heightDots = () => Math.max(8, Math.round(state.labelHmm * state.dpi));

  function setPaper(wmm, hmm, dpi, round) {
    if (wmm) state.labelWmm = wmm;
    if (hmm) state.labelHmm = hmm;
    if (dpi) state.dpi = dpi;
    if (round != null) state.round = !!round;
  }

  let nextId = 1;
  const defaults = {
    text:    { type: 'text', text: 'Текст', fontSize: 28, bold: false, underline: false, italic: false, invert: false, vertical: false, letterSpacing: 0, lineSpacing: 1.25, x: null, y: null, rotation: 0 },
    date:    { type: 'text', text: '', datePattern: 'yyyy-MM-dd HH:mm', isDate: true, fontSize: 24, bold: false, x: null, y: null, rotation: 0 },
    qr:      { type: 'qr', text: '123456', ecLevel: 'M', module: 3, x: null, y: null, rotation: 0 },
    barcode: { type: 'barcode', text: '1234567890', height: 60, showText: true, increment: false, incrementStep: 1, x: null, y: null, rotation: 0 },
    image:   { type: 'image', src: null, img: null, w: null, x: null, y: null, rotation: 0 },
    line:    { type: 'line', thickness: 2, horizontal: true, length: null, x: null, y: null, rotation: 0 },
    shape:   { type: 'shape', shape: 'rect', w: 120, h: 80, thickness: 2, filled: false, x: null, y: null, rotation: 0 },
    serial:  { type: 'serial', text: '00001', prefix: '', suffix: '', startNumber: 1, interval: 1, digits: 5, fontSize: 24, bold: false, x: null, y: null, rotation: 0 },
    // страница 2
    table:   { type: 'table', rows: 3, cols: 2, cellW: 70, cellH: 30, thickness: 1, x: null, y: null, rotation: 0 },
    rect:    { type: 'shape', shape: 'rect', w: 160, h: 100, thickness: 2, filled: false, x: null, y: null, rotation: 0 },
    price:   { type: 'text', text: '99 ₽', fontSize: 48, bold: true, priceMode: true, x: null, y: null, rotation: 0 },
    wifi:    { type: 'qr', text: '', qrKind: 'wifi', ssid: 'MyWiFi', password: '', encryption: 'WPA', ecLevel: 'M', module: 3, x: null, y: null, rotation: 0 },
    vcard:   { type: 'qr', text: '', qrKind: 'vcard', vcName: 'Иван Иванов', vcPhone: '+7 900 000-00-00', ecLevel: 'M', module: 3, x: null, y: null, rotation: 0 },
    url:     { type: 'qr', text: 'https://example.com', qrKind: 'url', ecLevel: 'M', module: 3, x: null, y: null, rotation: 0 },
    orgline: { type: 'text', text: 'ООО «Компания»\nИНН 7700000000', fontSize: 18, bold: false, x: null, y: null, rotation: 0 },
  };

  /**
   * Инкрементальная печать (как SerialNumberDrawView):
   * значение = prefix + (startNumber + index*interval) + suffix.
   * Вызывается перед рендерением каждой копии.
   */
  function serialValue(el, index) {
    const start = Number.isFinite(el.startNumber) ? el.startNumber : 0;
    const interval = Number.isFinite(el.interval) && el.interval !== 0 ? el.interval : 1;
    const digits = Math.max(1, el.digits | 0) || 1;
    const num = start + index * interval;
    let numStr = String(Math.abs(num));
    if (num >= 0 && numStr.length < digits) numStr = numStr.padStart(digits, '0');
    if (num < 0) numStr = '-' + numStr;
    return (el.prefix || '') + numStr + (el.suffix || '');
  }

  /** Пересчитать серийный элемент под копию №index (копия данных, как setSequenceIndex). */
  function applySequence(el, index) {
    if (el.type === 'serial') {
      return Object.assign({}, el, { text: serialValue(el, index) });
    }
    if (el.type === 'barcode' && el.increment) {
      // как refreshSpvContainer: буквы сохраняем, число + step*index
      const m = String(el.text || '').match(/^(.*?)(\d+)(\D*)$/);
      if (m) {
        const digits = m[2].length;
        let num = parseInt(m[2], 10) + (el.incrementStep || 1) * index;
        let numStr = String(Math.abs(num)).padStart(digits, '0');
        if (numStr.length > digits) numStr = numStr.slice(-digits);
        return Object.assign({}, el, { text: m[1] + numStr + m[3] });
      }
    }
    return el;
  }

  /**
   * Растеризовать копию №index (инкрементальная печать).
   * @param {number} index номер копии (0-based)
   */
  function rasterizeCopy(index, scale = 1) {
    if (!index) return rasterize(scale);
    const saved = state.elements;
    state.elements = saved.map(e => applySequence(e, index));
    try {
      return rasterize(scale);
    } finally {
      state.elements = saved;
    }
  }

  /** QR-пресеты: сборка данных из полей. */
  function applyQrKind(el) {
    if (el.type !== 'qr' || !el.qrKind) return;
    if (el.qrKind === 'wifi') {
      el.text = `WIFI:T:${el.encryption || 'WPA'};S:${el.ssid || ''};P:${el.password || ''};;`;
    } else if (el.qrKind === 'vcard') {
      el.text = `BEGIN:VCARD\nVERSION:3.0\nFN:${el.vcName || ''}\nTEL:${el.vcPhone || ''}\nEND:VCARD`;
    } else if (el.qrKind === 'url') {
      let t = el.text || '';
      if (t && !/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(t)) t = 'https://' + t;
      el.text = t;
    }
  }

  /** Добавить стикер (в центр канваса, с накоплением, как addSticker в оригинале). */
  function add(type, patch) {
    const el = JSON.parse(JSON.stringify(defaults[type]));
    Object.assign(el, patch || {});
    el.id = nextId++;
    if (el.isDate && !el.text) el.text = formatDate(new Date(), el.datePattern);
    applyQrKind(el);
    if (el.type === 'serial') el.text = serialValue(el, 0);
    // автопозиция — свободное размещение: центр + накопление вниз
    if (el.x == null || el.y == null) {
      const m = measure(el);
      const n = state.elements.length;
      el.x = Math.round((widthDots() - m.w) / 2);
      el.y = Math.round(Math.min(
        Math.max(4, (heightDots() - m.h) / 2 + (n % 4) * 12 - 18),
        Math.max(4, heightDots() - m.h - 4)));
    }
    state.elements.push(el);
    state.selected = el;
    return el;
  }

  function formatDate(d, pattern) {
    const p2 = (n) => String(n).padStart(2, '0');
    return (pattern || 'yyyy-MM-dd HH:mm')
      .replace('yyyy', d.getFullYear()).replace('MM', p2(d.getMonth() + 1))
      .replace('dd', p2(d.getDate())).replace('HH', p2(d.getHours()))
      .replace('mm', p2(d.getMinutes())).replace('ss', p2(d.getSeconds()));
  }

  // ------------------------------------------------------- измерение ---
  const measurer = typeof document !== 'undefined'
    ? document.createElement('canvas').getContext('2d') : null;

  function fontOf(el) {
    return `${el.italic ? 'italic ' : ''}${el.bold ? 'bold ' : ''}${el.fontSize}px ${FONT_STACK}`;
  }

  function measure(el) {
    switch (el.type) {
      case 'text': case 'serial': {
        if (!measurer) return { w: 0, h: 0 };
        measurer.font = fontOf(el);
        const lines = String(el.text).split('\n');
        if (el.vertical) {
          // вертикальный текст: столбец символов
          const ch = Math.max(...lines.map(l => l.length));
          return { w: el.fontSize * lines.length * 1.15, h: ch * el.fontSize * 1.15 };
        }
        let w = 0;
        for (const l of lines) {
          let lw = 0;
          for (const ch of l) lw += measurer.measureText(ch).width + (el.letterSpacing || 0);
          w = Math.max(w, lw);
        }
        return { w, h: lines.length * el.fontSize * (el.lineSpacing || 1.25) };
      }
      case 'qr': {
        const qr = qrcode(0, el.ecLevel || 'M');
        qr.addData(el.text || ' ');
        qr.make();
        const n = qr.getModuleCount();
        const eff = Math.max(1, Math.min(el.module, Math.floor((widthDots() - 2) / n)));
        return { w: n * eff, h: n * eff, qr, effModule: eff };
      }
      case 'barcode': {
        const bits = code128Encode(el.text || '');
        let mod = Math.max(1, Math.min(3, Math.floor((widthDots() - 8) / bits.length)));
        const w = bits.length * mod;
        const h = el.height || 60;
        const th = el.showText ? 16 : 0;
        return { w, h: h + th, bits, mod, barH: h };
      }
      case 'image': {
        if (!el.img) return { w: 0, h: 0 };
        const w = el.w || widthDots();
        return { w, h: Math.round(el.img.height * (w / el.img.width)) };
      }
      case 'line': {
        const len = el.length || Math.round(widthDots() * 0.6);
        return el.horizontal ? { w: len, h: el.thickness } : { w: el.thickness, h: len };
      }
      case 'table': {
        return { w: el.cols * el.cellW, h: el.rows * el.cellH };
      }
      case 'shape':
        return { w: el.w, h: el.h };
      default:
        return { w: 0, h: 0 };
    }
  }

  // --------------------------------------------------------- отрисовка ---
  function drawElement(ctx, el, m, forPrint) {
    const pad = 1; // безопасный внутренний отступ для инверсии
    switch (el.type) {
      case 'text': case 'serial': {
        ctx.font = fontOf(el);
        ctx.textBaseline = 'top';
        const lines = String(el.text).split('\n');
        const lh = el.fontSize * (el.lineSpacing || 1.25);
        const drawLine = (str, x, y) => {
          if (el.invert) {
            const tw = textWidth(el, str);
            ctx.fillStyle = '#000';
            ctx.fillRect(x - 2, y - 1, tw + 4, lh);
            ctx.fillStyle = '#fff';
          } else {
            ctx.fillStyle = '#000';
          }
          let cx = x;
          for (const ch of str) {
            ctx.fillText(ch, cx, y);
            cx += ctx.measureText(ch).width + (el.letterSpacing || 0);
          }
          if (el.underline) {
            const tw = textWidth(el, str);
            ctx.fillRect(x, y + el.fontSize * 1.02, tw, Math.max(1, el.fontSize / 14));
          }
          if (el.invert) ctx.fillStyle = '#000';
        };
        if (el.vertical) {
          lines.forEach((line, li) => {
            [...line].forEach((ch, ci) => {
              drawLine(ch, li * el.fontSize * 1.15, ci * el.fontSize * 1.15);
            });
          });
        } else {
          lines.forEach((line, li) => drawLine(line, 0, li * lh));
        }
        break;
      }
      case 'qr': {
        const n = m.qr.getModuleCount();
        const mod = m.effModule;
        ctx.fillStyle = '#000';
        for (let r = 0; r < n; r++) {
          for (let c = 0; c < n; c++) {
            if (m.qr.isDark(r, c)) ctx.fillRect(c * mod, r * mod, mod, mod);
          }
        }
        break;
      }
      case 'barcode': {
        ctx.fillStyle = '#000';
        let x = 0;
        for (let i = 0; i < m.bits.length; i++) {
          if (m.bits[i] === '1') ctx.fillRect(x, 0, m.mod, m.barH);
          x += m.mod;
        }
        if (el.showText) {
          ctx.font = `14px ${FONT_STACK}`;
          ctx.textBaseline = 'top';
          const tw = ctx.measureText(el.text).width;
          ctx.fillText(el.text, (m.w - tw) / 2, m.barH + 2);
        }
        break;
      }
      case 'image': {
        ctx.drawImage(el.img, 0, 0, m.w, m.h);
        break;
      }
      case 'line': {
        ctx.fillStyle = '#000';
        if (el.horizontal) ctx.fillRect(0, 0, m.w, el.thickness);
        else ctx.fillRect(0, 0, el.thickness, m.h);
        break;
      }
      case 'table': {
        ctx.strokeStyle = '#000';
        ctx.lineWidth = el.thickness;
        for (let c = 0; c <= el.cols; c++) {
          const x = Math.min(c * el.cellW, m.w);
          ctx.beginPath();
          ctx.moveTo(x + 0.5, 0);
          ctx.lineTo(x + 0.5, m.h);
          ctx.stroke();
        }
        for (let r = 0; r <= el.rows; r++) {
          const y = Math.min(r * el.cellH, m.h);
          ctx.beginPath();
          ctx.moveTo(0, y + 0.5);
          ctx.lineTo(m.w, y + 0.5);
          ctx.stroke();
        }
        break;
      }
      case 'shape': {
        ctx.fillStyle = '#000';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = el.thickness;
        if (el.shape === 'rect') {
          if (el.filled) ctx.fillRect(0, 0, m.w, m.h);
          else ctx.strokeRect(el.thickness / 2, el.thickness / 2, m.w - el.thickness, m.h - el.thickness);
        } else if (el.shape === 'circle' || el.shape === 'ellipse') {
          ctx.beginPath();
          ctx.ellipse(m.w / 2, m.h / 2, m.w / 2 - el.thickness / 2, m.h / 2 - el.thickness / 2, 0, 0, Math.PI * 2);
          if (el.filled) ctx.fill(); else ctx.stroke();
        } else if (el.shape === 'triangle') {
          ctx.beginPath();
          ctx.moveTo(m.w / 2, el.thickness / 2);
          ctx.lineTo(m.w - el.thickness / 2, m.h - el.thickness / 2);
          ctx.lineTo(el.thickness / 2, m.h - el.thickness / 2);
          ctx.closePath();
          if (el.filled) ctx.fill(); else ctx.stroke();
        }
        break;
      }
    }
  }

  function textWidth(el, str) {
    if (!measurer) return 0;
    measurer.font = fontOf(el);
    let w = 0;
    for (const ch of str) w += measurer.measureText(ch).width + (el.letterSpacing || 0);
    return w;
  }

  /** Элемент в собственном канвасе (кэш для hit-теста и предпросмотра). */
  function elementCanvas(el, scale = 1) {
    const m = measure(el);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil((m.w + 4) * scale));
    c.height = Math.max(1, Math.ceil((m.h + 4) * scale));
    const ctx = c.getContext('2d');
    if (scale !== 1) { ctx.scale(scale, scale); ctx.imageSmoothingQuality = 'high'; }
    ctx.translate(2, 2);
    drawElement(ctx, el, m, true);
    return c;
  }

  /** Печатный растр: суперсэмплинг + box-даунсемпл (чёткость!). */
  function rasterize(scale = 1) {
    const W = widthDots(), H = heightDots();
    const s = scale;
    const canvas = document.createElement('canvas');
    canvas.width = W * s;
    canvas.height = H * s;
    const ctx = canvas.getContext('2d');
    if (s !== 1) ctx.scale(s, s);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    for (const el of state.elements) {
      if (el.hidden) continue; // скрытый слой (глаз в списке слоёв)
      const m = measure(el);
      ctx.save();
      ctx.translate(el.x, el.y);
      if (el.rotation) {
        ctx.translate(m.w / 2, m.h / 2);
        ctx.rotate(el.rotation * Math.PI / 180);
        ctx.translate(-m.w / 2, -m.h / 2);
      }
      ctx.beginPath();
      ctx.rect(0, 0, m.w + 4, m.h + 4);
      ctx.clip();
      ctx.translate(2, 2);
      drawElement(ctx, el, m, true);
      ctx.restore();
    }
    if (s === 1) return canvas;
    return boxDownsample(canvas, W, H, s);
  }

  function boxDownsample(srcCanvas, W, H, scale) {
    const src = srcCanvas.getContext('2d').getImageData(0, 0, W * scale, H * scale).data;
    const out = new Uint8ClampedArray(W * H * 4);
    const SW = W * scale;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let r = 0, g = 0, b = 0;
        for (let dy = 0; dy < scale; dy++) {
          let srow = ((y * scale + dy) * SW + x * scale) * 4;
          for (let dx = 0; dx < scale; dx++) {
            r += src[srow]; g += src[srow + 1]; b += src[srow + 2];
            srow += 4;
          }
        }
        const n = scale * scale, o = (y * W + x) * 4;
        out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
      }
    }
    const small = document.createElement('canvas');
    small.width = W;
    small.height = H;
    small.getContext('2d').putImageData(new ImageData(out, W, H), 0, 0);
    return small;
  }

  function renderScale() {
    const W = widthDots(), H = heightDots();
    const area = W * H;
    for (const s of [3, 2]) {
      if (Math.max(W, H) * s <= 8192 && area * s * s <= 16000000) return s;
    }
    return 1;
  }

  /** WYSIWYG-превью финального 1bpp-растра. */
  function renderMono(previewCanvas, mono) {
    const z = state.zoom;
    const w = mono.bpr * 8 * z, h = mono.height * z;
    if (previewCanvas.width !== w || previewCanvas.height !== h) {
      previewCanvas.width = w;
      previewCanvas.height = h;
    }
    const ctx = previewCanvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    const off = document.createElement('canvas');
    off.width = mono.bpr * 8;
    off.height = mono.height;
    const octx = off.getContext('2d');
    const id = octx.createImageData(off.width, off.height);
    for (let y = 0; y < off.height; y++) {
      const rowOff = y * mono.bpr;
      for (let x = 0; x < off.width; x++) {
        const on = mono.data[rowOff + (x >> 3)] & (0x80 >> (x & 7));
        const i = (y * off.width + x) * 4;
        const v = on ? 0 : 255;
        id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
        id.data[i + 3] = 255;
      }
    }
    octx.putImageData(id, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, w, h);
  }

  // -------------------------------------------- интерактивный канвас ---
  const CANVAS_EVENTS = {};
  let interaction = null; // {mode: 'move'|'scale', ...}

  /**
   * Главный интерактивный канвас (как EditorView в оригинале).
   * Рисует: сетку-фон, наклейку, элементы, рамку выделения с ручками.
   */
  function renderEditor(canvas, uiCallbacks) {
    const W = widthDots(), H = heightDots();
    const host = canvas.parentElement;
    const availW = Math.max(80, host.clientWidth - 32);
    const availH = Math.max(80, host.clientHeight - 32);
    const vs = Math.max(1, Math.min(Math.floor(availW / W * 10) / 10, Math.floor(availH / H * 10) / 10));
    state.viewScale = vs;

    const cw = Math.round(W * vs), ch = Math.round(H * vs);
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    // фон-«миллиметровка»
    ctx.fillStyle = '#e8ebf2';
    ctx.fillRect(0, 0, cw, ch);

    // тень + белая наклейка
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.25)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cw, ch);
    ctx.restore();

    // контур круглой наклейки
    if (state.round && W === H) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cw / 2, ch / 2, cw / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.restore();
    }

    // элементы
    ctx.save();
    ctx.scale(vs, vs);
    for (const el of state.elements) {
      if (el.hidden) continue;
      const m = measure(el);
      ctx.save();
      ctx.translate(el.x, el.y);
      if (el.rotation) {
        ctx.translate(m.w / 2, m.h / 2);
        ctx.rotate(el.rotation * Math.PI / 180);
        ctx.translate(-m.w / 2, -m.h / 2);
      }
      ctx.translate(2, 2);
      drawElement(ctx, el, m, false);
      ctx.restore();
    }
    ctx.restore();

    // рамка выделения
    const sel = state.selected;
    if (sel) {
      const m = measure(sel);
      const selW = (m.w + 4) * vs, selH = (m.h + 4) * vs;
      ctx.save();
      ctx.translate(sel.x * vs, sel.y * vs);
      if (sel.rotation) {
        ctx.translate(selW / 2, selH / 2);
        ctx.rotate(sel.rotation * Math.PI / 180);
        ctx.translate(-selW / 2, -selH / 2);
      }
      ctx.strokeStyle = '#4f8cff';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(0, 0, selW, selH);
      ctx.setLineDash([]);
      // ручки масштаба (углы)
      const hs = 7;
      ctx.fillStyle = '#4f8cff';
      for (const [hx, hy, cur] of [
        [0, 0, 'nwse-resize'], [selW, 0, 'nesw-resize'],
        [0, selH, 'nesw-resize'], [selW, selH, 'nwse-resize'],
      ]) {
        ctx.beginPath();
        ctx.arc(hx, hy, hs / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      // ручка поворота (над верхней гранью)
      ctx.beginPath();
      ctx.moveTo(selW / 2, selH);
      ctx.lineTo(selW / 2, selH + 14);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(selW / 2, selH + 14, hs / 2, 0, Math.PI * 2);
      ctx.fillStyle = '#e05a5a';
      ctx.fill();
      ctx.restore();
    }
    return vs;
  }

  /** Приводит экранные координаты к координатам наклейки (точки). */
  function toLabelPoint(canvas, clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    const vs = state.viewScale;
    return { x: (clientX - r.left) / vs, y: (clientY - r.top) / vs };
  }

  /** Hit-тест: верхний элемент под точкой (учитывая поворот). */
  function hitTest(pt) {
    for (let i = state.elements.length - 1; i >= 0; i--) {
      const el = state.elements[i];
      const m = measure(el);
      if (m.w <= 0 && m.h <= 0) continue;
      let px = pt.x - el.x, py = pt.y - el.y;
      if (el.rotation) {
        const cx = (m.w + 4) / 2, cy = (m.h + 4) / 2;
        const a = -el.rotation * Math.PI / 180;
        const dx = px - cx, dy = py - cy;
        px = dx * Math.cos(a) - dy * Math.sin(a) + cx;
        py = dx * Math.sin(a) + dy * Math.cos(a) + cy;
      }
      if (px >= 0 && py >= 0 && px <= m.w + 4 && py <= m.h + 4) return el;
    }
    return null;
  }

  /** Зона указателя над выделением (углы/поворот) в экранных координатах. */
  function handleAt(canvas, clientX, clientY) {
    const sel = state.selected;
    if (!sel) return null;
    const m = measure(sel);
    const vs = state.viewScale;
    const r = canvas.getBoundingClientRect();
    const sx = clientX - r.left, sy = clientY - r.top;
    const w = (m.w + 4) * vs, h = (m.h + 4) * vs;
    let px = sx - sel.x * vs, py = sy - sel.y * vs;
    if (sel.rotation) {
      const cx = w / 2, cy = h / 2;
      const a = -sel.rotation * Math.PI / 180;
      const dx = px - cx, dy = py - cy;
      px = dx * Math.cos(a) - dy * Math.sin(a) + cx;
      py = dx * Math.sin(a) + dy * Math.cos(a) + cy;
    }
    const near = (x, y) => Math.hypot(px - x, py - y) <= 9;
    if (near(w / 2, h + 14)) return 'rotate';
    if (near(0, 0)) return 'nw';
    if (near(w, 0)) return 'ne';
    if (near(0, h)) return 'sw';
    if (near(w, h)) return 'se';
    if (px >= -3 && py >= -3 && px <= w + 3 && py <= h + 3) return 'move';
    return null;
  }

  /** Подключить события мыши/тача к канвасу редактора. */
  function attachCanvas(canvas, onChange, onCommit) {
    if (canvas._amAttached) return;
    canvas._amAttached = true;

    const getPos = (e) => {
      const t = e.touches ? (e.touches[0] || e.changedTouches[0]) : e;
      return { clientX: t.clientX, clientY: t.clientY };
    };

    const down = (e) => {
      const { clientX, clientY } = getPos(e);
      const h = handleAt(canvas, clientX, clientY);
      const pt = toLabelPoint(canvas, clientX, clientY);
      const hit = hitTest(pt);
      if (h === 'rotate') {
        const m = measure(state.selected);
        const r = canvas.getBoundingClientRect();
        const cx = r.left + (state.selected.x + (m.w + 4) / 2) * state.viewScale;
        const cy = r.top + (state.selected.y + (m.h + 4) / 2) * state.viewScale;
        interaction = { mode: 'rotate', cx, cy, startAngle: Math.atan2(clientY - cy, clientX - cx), startRot: state.selected.rotation };
      } else if (h === 'move' && state.selected) {
        // тянем за тело выделенного элемента
        interaction = { mode: 'move', startPt: pt, startX: state.selected.x, startY: state.selected.y, moved: false };
      } else if (h && state.selected) {
        interaction = { mode: 'scale', corner: h, startW: measure(state.selected).w, startH: measure(state.selected).h, startPt: pt };
      } else if (hit) {
        state.selected = hit;
        interaction = { mode: 'move', startPt: pt, startX: hit.x, startY: hit.y, moved: false };
        // перенос наверх слоя (как в оригинале при перетаскивании)
        const idx = state.elements.indexOf(hit);
        if (idx >= 0 && idx < state.elements.length - 1) {
          state.elements.splice(idx, 1);
          state.elements.push(hit);
        }
      } else {
        state.selected = null;
      }
      onChange && onChange();
      if (e.cancelable) e.preventDefault();
    };

    const move = (e) => {
      const { clientX, clientY } = getPos(e);
      if (!interaction) {
        // курсор
        const h = handleAt(canvas, clientX, clientY);
        canvas.style.cursor = h === 'rotate' ? 'grab'
          : (h === 'nw' || h === 'se') ? 'nwse-resize'
          : (h === 'ne' || h === 'sw') ? 'nesw-resize'
          : h === 'move' ? 'move' : 'default';
        return;
      }
      if (e.cancelable) e.preventDefault();
      const pt = toLabelPoint(canvas, clientX, clientY);
      if (interaction.mode === 'move') {
        const el = state.selected;
        el.x = Math.round(interaction.startX + (pt.x - interaction.startPt.x));
        el.y = Math.round(interaction.startY + (pt.y - interaction.startPt.y));
        interaction.moved = true;
      } else if (interaction.mode === 'scale') {
        const el = state.selected;
        const k = 1 + (pt.y - interaction.startPt.y) / Math.max(20, interaction.startH);
        const kk = Math.max(0.2, Math.min(4, k));
        scaleElement(el, interaction.startW, interaction.startH, kk);
      } else if (interaction.mode === 'rotate') {
        const a = Math.atan2(clientY - interaction.cy, clientX - interaction.cx);
        let deg = interaction.startRot + (a - interaction.startAngle) * 180 / Math.PI;
        deg = Math.round(deg);
        if (Math.abs(deg % 15) < 4) deg = Math.round(deg / 15) * 15; // магнит к 15°
        state.selected.rotation = ((deg % 360) + 360) % 360;
      }
      onChange && onChange();
    };

    const up = () => {
      const mutated = !!(interaction && (interaction.moved || interaction.mode === 'scale' || interaction.mode === 'rotate'));
      interaction = null;
      onChange && onChange();
      if (mutated && onCommit) onCommit();
    };

    canvas.addEventListener('mousedown', down);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    canvas.addEventListener('touchstart', down, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', up);
  }

  /** Пропорциональное изменение размера элемента относительно стартовых измерений. */
  function scaleElement(el, fromW, fromH, k) {
    const kk = Math.max(0.2, Math.min(4, k));
    switch (el.type) {
      case 'text': case 'serial':
        if (!el._baseFont) el._baseFont = el.fontSize;
        el.fontSize = Math.max(6, Math.min(200, Math.round(el._baseFont * kk)));
        break;
      case 'qr':
        if (!el._baseMod) el._baseMod = el.module;
        el.module = Math.max(1, Math.min(8, Math.round(el._baseMod * kk)));
        break;
      case 'barcode':
        if (!el._baseH) el._baseH = el.height;
        el.height = Math.max(20, Math.min(300, Math.round(el._baseH * kk)));
        break;
      case 'image':
        if (!el._baseW) el._baseW = el.w || widthDots();
        el.w = Math.max(16, Math.round(el._baseW * kk));
        break;
      case 'line':
        if (!el._baseT) el._baseT = el.thickness;
        el.thickness = Math.max(1, Math.min(20, Math.round(el._baseT * kk)));
        break;
      case 'table':
        if (!el._baseCW) { el._baseCW = el.cellW; el._baseCH = el.cellH; }
        el.cellW = Math.max(8, Math.round(el._baseCW * kk));
        el.cellH = Math.max(8, Math.round(el._baseCH * kk));
        break;
      case 'shape':
        if (!el._baseW) { el._baseW = el.w; el._baseH = el.h; }
        el.w = Math.max(12, Math.round(el._baseW * kk));
        el.h = Math.max(12, Math.round(el._baseH * kk));
        break;
    }
  }

  /** Тулбар: относительное масштабирование +/-10%. */
  function nudgeScale(factor) {
    const el = state.selected;
    if (!el) return;
    switch (el.type) {
      case 'text': case 'serial':
        el.fontSize = Math.max(6, Math.min(200, Math.round(el.fontSize * factor)));
        break;
      case 'qr':
        el.module = Math.max(1, Math.min(8, Math.round(el.module * factor)));
        break;
      case 'barcode':
        el.height = Math.max(20, Math.min(300, Math.round(el.height * factor)));
        break;
      case 'image': {
        const base = el.w || widthDots();
        el.w = Math.max(16, Math.round(base * factor));
        break;
      }
      case 'line':
        el.thickness = Math.max(1, Math.min(20, Math.round(el.thickness * factor)));
        break;
      case 'table':
        el.cellW = Math.max(8, Math.round(el.cellW * factor));
        el.cellH = Math.max(8, Math.round(el.cellH * factor));
        break;
      case 'shape':
        el.w = Math.max(12, Math.round(el.w * factor));
        el.h = Math.max(12, Math.round(el.h * factor));
        break;
    }
  }

  /** Выравнивание выделения (как itsv_align). */
  function align(kind) {
    const el = state.selected;
    if (!el) return;
    const m = measure(el);
    const W = widthDots(), H = heightDots();
    if (kind === 'left') el.x = 2;
    else if (kind === 'right') el.x = W - m.w - 2;
    else if (kind === 'hcenter') el.x = Math.round((W - m.w) / 2);
    else if (kind === 'top') el.y = 2;
    else if (kind === 'bottom') el.y = H - m.h - 2;
    else if (kind === 'vcenter') el.y = Math.round((H - m.h) / 2);
  }

  // ------------------------------------------------------- сериализация ---
  function serialize() {
    const els = state.elements.map(e => ({ ...e, img: undefined }));
    return JSON.stringify({ labelWmm: state.labelWmm, labelHmm: state.labelHmm, dpi: state.dpi, round: state.round, elements: els });
  }

  function deserialize(json) {
    const o = typeof json === 'string' ? JSON.parse(json) : json;
    state.labelWmm = o.labelWmm || 40;
    state.labelHmm = o.labelHmm || 30;
    state.dpi = o.dpi || 8;
    state.round = !!o.round;
    state.elements = (o.elements || []).filter(e => e.type !== 'image');
    state.selected = null;
  }

  return {
    state, add, setPaper, widthDots, heightDots, measure,
    rasterize, rasterizeCopy, renderScale, renderMono, renderEditor,
    attachCanvas, toLabelPoint, hitTest, handleAt, nudgeScale, align,
    scaleElement, formatDate, elementCanvas, serialValue, applySequence,
    serialize, deserialize, code128Encode, applyQrKind, FONT_STACK,
  };
})();
