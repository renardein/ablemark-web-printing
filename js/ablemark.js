/**
 * ablemark.js — реализация протокола AbleMark / yxqapp SDK (BLE) поверх Web Bluetooth.
 *
 * Реверс-инжиниринг приложения com.feioou.deliprint.ablemark V1.4.1:
 *  - BLE сервис 0xFF00: write ff02, notify ff01, control notify ff03 (credit flow-control)
 *  - BLE сервис 49535343-fe7d-...: write ...8841, notify ...1e4d (P80)
 *  - BLE сервис 0xFD00: write fd01, notify fd02 (fallback)
 *  - Печать: GS v 0 (несжатый растр) либо 0x1F 0x10 + zlib (bprH bprL hH hL len4BE + zlib-поток)
 */
'use strict';

const AM = (() => {

  // ---------------------------------------------------------------- UUID ---
  const UUIDS = {
    SERVICE_A: 0xff00,
    SVC_A_FULL: '0000ff00-0000-1000-8000-00805f9b34fb',
    SVC_A_WRITE: '0000ff02-0000-1000-8000-00805f9b34fb',
    SVC_A_NOTIFY: '0000ff01-0000-1000-8000-00805f9b34fb',
    SVC_A_CTRL: '0000ff03-0000-1000-8000-00805f9b34fb',
    SERVICE_B: '49535343-fe7d-4ae5-8fa9-9fafd205e455',
    SVC_B_WRITE: '49535343-8841-43f4-a8d4-ecbe34729bb3',
    SVC_B_NOTIFY: '49535343-1e4d-4bd9-ba61-23c647249616',
    SERVICE_C: 0xfd00,
    SVC_C_FULL: '0000fd00-0000-1000-8000-00805f9b34fb',
    SVC_C_WRITE: '0000fd01-0000-1000-8000-00805f9b34fb',
    SVC_C_NOTIFY: '0000fd02-0000-1000-8000-00805f9b34fb',
  };

  const SERVICE_FILTERS = [
    { services: [UUIDS.SERVICE_A] },
    { services: [UUIDS.SERVICE_B] },
    { services: [UUIDS.SERVICE_C] },
  ];

  /**
   * optionalServices: все сервисы, к которым может понадобиться доступ.
   * ОБЯЗАТЕЛЬНЫ при acceptAllDevices / name-фильтрах — иначе getPrimaryService() упадёт.
   * Включаем известные serial-сервисы термопринтеров (ff00, fd00, ffe0, fff0, 18f0, fee9 …).
   */
  const OPTIONAL_SERVICES = [
    0xff00, 0xfd00, 0xffe0, 0xffe1, 0xffe5, 0xffe9, 0xfff0, 0x18f0, 0xaf30, 0xae00,
    0xfee7, 0xfee8, 0xfee9, 0xffe9,
    UUIDS.SERVICE_B,
  ];

  /**
   * Префиксы имён принтеров (из Contants.java / DeviceManager.write() и BluetoothContext).
   * Android-приложение ищет устройства именно по имени — сервис в advertising не рекламируется.
   */
  const NAME_PREFIXES = [
    'P1', 'P5', 'P7', 'P80', 'S1', 'S2', 'S8', 'M1', 'M5', 'M6',
    'A1', 'A3', 'A5', 'X2', 'X4', 'X8', 'D1', 'D2', 'T2', 'T3',
    'L1', 'L5', 'L8', 'LP', 'LuckP', 'R15', 'U210', 'GD-', 'ET-Z', 'ewtto',
    'iSPACE', 'Jammuk', 'YEW', 'HM-', 'J-', 'DP_', '210', 'BARABOGO', 'Silvertec',
    'CLabel', 'M60', 'M57', 'M50', 'B32', 'GB0', 'MX0', 'PT-', 'LP-', 'AM-',
  ];

  // ------------------------------------------------------------ helpers ---
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  /** «10 FF 3D» / «10ff3d» / «10, FF, 3D» → Uint8Array (для отладочной консоли). */
  function parseHex(text) {
    let clean = String(text).replace(/0x/gi, ' ').replace(/[,;\s]+/g, ' ').trim();
    if (!clean) return null;
    // слитная запись чётной длины: «10ff3d» → «10 ff 3d»
    if (!clean.includes(' ') && clean.length > 2 && clean.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(clean)) {
      clean = clean.match(/.{2}/g).join(' ');
    }
    const parts = clean.split(' ').filter(Boolean);
    const out = [];
    for (const p of parts) {
      if (!/^[0-9a-fA-F]{1,2}$/.test(p)) return null;
      out.push(parseInt(p, 16));
    }
    if (!out.length || out.length > 512) return null;
    return new Uint8Array(out);
  }
  const concat = (...arrays) => {
    const total = arrays.reduce((s, a) => s + a.length, 0);
    const r = new Uint8Array(total);
    let off = 0;
    for (const a of arrays) { r.set(a, off); off += a.length; }
    return r;
  };
  const u8 = (...bytes) => new Uint8Array(bytes);
  const hex = (arr) => Array.from(arr, b => b.toString(16).padStart(2, '0')).join(' ');

  // ------------------------------------------------------------- commands ---
  /**
   * Растровая печать GS v 0 (несжатая) — как PrintL11.printBitmap1.
   * @param {Uint8Array} data  1bpp MSB-first, length = bpr * height
   */
  function gsV0(data, bpr, height, mode = 0) {
    const hdr = u8(0x1d, 0x76, 0x30, mode,
      bpr & 0xff, (bpr >> 8) & 0xff,
      height & 0xff, (height >> 8) & 0xff);
    return concat(hdr, data);
  }

  /**
   * Сжатая печать 0x1F 0x10 — как CommandPort.printBitmap / BaseProtocol.commonGetBitmap.
   * Заголовок: 1F 10 bprH bprL hH hL len(4B BE) + zlib(data) c windowBits=14, level=6.
   */
  function compressedImage(data, bpr, height) {
    const z = pako.deflate(data, { windowBits: 14, level: 6, memLevel: 8 });
    const hdr = u8(0x1f, 0x10,
      (bpr >> 8) & 0xff, bpr & 0xff,
      (height >> 8) & 0xff, height & 0xff,
      (z.length >>> 24) & 0xff, (z.length >>> 16) & 0xff,
      (z.length >>> 8) & 0xff, z.length & 0xff);
    return concat(hdr, z);
  }

  const CMD = {
    // L-серия
    wakeupL: () => new Uint8Array(15),
    enableL: () => u8(0x10, 0xff, 0xf1, 0x02),
    stopL: () => u8(0x10, 0xff, 0xf1, 0x45),
    // P50/S2
    wakeupP: () => new Uint8Array(6),
    startJobP: () => u8(0x1f, 0xc0, 0x01, 0x00),
    stopJobP: () => u8(0x1f, 0xc0, 0x01, 0x01),
    adjustAuto: (n) => u8(0x1f, 0x11, n & 0xff),
    printerLocation: (n, m) => u8(0x1f, 0x12, n & 0xff, m & 0xff),
    // общие
    setDensity: (t, d) => u8(0x1f, 0x70, t & 0xff, d & 0xff),
    feedDots: (n) => u8(0x1b, 0x4a, n & 0xff),
    feedRows: (n) => u8(0x1b, 0x64, n & 0xff),
    feedToMark: () => u8(0x1d, 0x0c),
    escInit: () => u8(0x1b, 0x40),
    beep: () => u8(0x07),
    // запросы
    // Статус: 10 FF 40 (Guava SignedBytes.MAX_POWER_OF_TWO в оригинале,
    // подтверждено thermoprint). Ответ: [FF, код].
    queryStatus: () => u8(0x10, 0xff, 0x40),
    /** Детальный статус: 1F 20 00 — ответ с битовыми флагами. */
    queryDetailedStatus: () => u8(0x1f, 0x20, 0x00),
    queryBattery: () => u8(0x10, 0xff, 0x50, 0xf1),
    queryVersion: () => u8(0x10, 0xff, 0x20, 0xf1),
    querySN: () => u8(0x10, 0xff, 0x20, 0xf2),
    queryInfo: () => u8(0x10, 0xff, 0x20, 0xf0),
    queryMAC: () => u8(0x10, 0xff, 0x20, 0xf3),
    queryShutTime: () => u8(0x10, 0xff, 0x13),
    queryMileage: () => u8(0x1a, 0x1f, 0x06),
    setShutTime: (min) => u8(0x10, 0xff, 0x12, (min >> 8) & 0xff, min & 0xff),

    // --- служебные операции (BT_OPERATIONS.md) ---
    beep: () => u8(0x07),
    /** Калибровка позиции (adjustPositionAuto 80 = Calibration в DeviceManager). */
    calibrate: () => u8(0x1f, 0x11, 80),
    /** Калибровка label gap (learnLabelGap). */
    learnGap: () => u8(0x10, 0xff, 0x03),
    /** Позиционирование по метке (PrintPP). */
    feedToMarkPP: () => u8(0x0e),
    /** Экран принтера вкл/выкл (openScreen). */
    screenOn: (on) => u8(0x10, 0xff, 0x60, on ? 1 : 0),
    /** Сброс к заводским настройкам (resetFactoryData). */
    factoryReset: () => u8(0x1f, 0x50, 0xbe),
    /** Установка времени принтера: 10 FF BB 01 h m s (setCurrentTime). */
    setTime: (h, m, s) => u8(0x10, 0xff, 0xbb, 0x01, h & 0xff, m & 0xff, s & 0xff),
    /** Запрос времени принтера (getCurrentTime). */
    queryTime: () => u8(0x10, 0xff, 0xbb, 0x02),
    /** Установка интервала обратного отсчёта (setCountdownTime). */
    setCountdown: (sec) => u8(0x10, 0xff, 0xbb, 0x03, (sec >> 8) & 0xff, sec & 0xff),
    /** Режим показа времени (intoShowtime). */
    showTimeMode: () => u8(0x10, 0xff, 0xbb, 0x04),
    /** Режим обратного отсчёта (intoCountdown). */
    countdownMode: () => u8(0x10, 0xff, 0xbb, 0x05),
    /** Запуск обратного отсчёта (startCountdown). */
    startCountdown: () => u8(0x10, 0xff, 0xbb, 0x06, 0x01),
    /** Запрос даты/времени (PrintPP, 10 FF EF EE). */
    queryDate: () => u8(0x10, 0xff, 0xef, 0xee),
    /** Запрос BT-версии (printerBtVersion). */
    queryBtVersion: () => u8(0x10, 0xff, 0x30, 0x10),
    /** Запрос BT-имени (printerBtname). */
    queryBtName: () => u8(0x10, 0xff, 0x30, 0x11),
    /** Индукционная печать (PrintL11.inductionPrint / PrintPP variant). */
    inductionPrint: () => u8(0x1a, 0x1f, 0x01),
    /** Прогон до чёрной метки (GS FF). */
    feedToBlackMark: () => u8(0x1d, 0x0c),
    /** Запрос готовности X8 (QueryPrinterPrepareProcessor). */
    prepareX8: () => u8(0x1b, 0x3d, 0x5d, 0xa5),
    /** Запрос скорости (getSpeed). */
    querySpeed: () => u8(0x1f, 0x60, 0x00),
    /** Установка скорости (setSpeed). */
    setSpeed: (a, b) => u8(0x1f, 0x60, a & 0xff, b & 0xff),
    /** Запрос плотности (getDensity). */
    queryDensity: () => u8(0x1f, 0x70, 0x00),
    /** Тип бумаги (setPaperType: 16=gap, 32=метка, 48). */
    setPaperType: (t, d) => u8(0x1f, 0x80, t & 0xff, d & 0xff),
    /** Толщина бумаги S8/L11 (setThickness). */
    setThickness: (n) => u8(0x10, 0xff, 0x10, 0x00, n & 0xff),
    /** Прогон строк (ESC d n). */
    feedRowsEsc: (n) => u8(0x1b, 0x64, n & 0xff),
    /** Тестовая страница (selfCheck). */
    selfCheck: () => u8(0x1f, 0x40),
    /** Обратный прогон бумаги (backoffPaper). */
    backoff: () => u8(0x10, 0xff, 0xf2),
  };

  // -------------------------------------------- парсеры ответов (YXQProtocolTools) ---
  const Parsers = {
    /**
     * Статус. Два формата:
     *  - [FF, код] — ответ на 10 FF 40 и асинхронные уведомления (коды 1-5);
     *  - битовые флаги — ответ на 1F 20 00 (детальный запрос):
     *    бит1=печать, бит2=крышка, бит4=нет бумаги, бит8=батарея, бит16=перегрев.
     * Возвращает ключ статуса ('ok'|'printing'|'no_paper'|'cover_open'|
     * 'overheat'|'low_bat'|'cover_closed') или null.
     */
    status(v) {
      if (!v || !v.length) return null;
      if (v[0] === 0xff && v.length >= 2) {
        return STATUS[v[1]] || null;
      }
      const b = v[0];
      if (!b) return 'ok';
      if (b & 1) return 'printing';
      if (b & 2) return 'cover_open';
      if (b & 4) return 'no_paper';
      if (b & 16) return 'overheat';
      if (b & 8) return 'low_bat';
      return 'ok';
    },

    /** Батарея: bArr[1] (или bArr[4] для LP90); для X8 — JSON {"bat":N}. */
    battery(v, deviceName) {
      if (!v || !v.length) return null;
      try {
        const asText = Array.from(v, b => (b >= 32 && b < 127) ? String.fromCharCode(b) : '').join('');
        if (asText.startsWith('{')) {
          const j = JSON.parse(asText);
          if (typeof j.bat === 'number') return j.bat;
        }
      } catch (_) { /* не JSON — обычный формат */ }
      if (deviceName && /^LP90/i.test(deviceName)) {
        return v.length === 2 ? v[1] : (v.length > 4 ? v[4] : v[1]);
      }
      return v.length > 1 ? v[1] : null;
    },

    /** Версия прошивки: текст (X8 — JSON {"sw":"..."}). */
    version(v) {
      if (!v || !v.length) return null;
      const s = Array.from(v, b => (b >= 32 && b < 127) ? String.fromCharCode(b) : '').join('').trim();
      try {
        if (s.startsWith('{')) {
          const j = JSON.parse(s);
          if (j.sw) return j.sw;
        }
      } catch (_) { /* обычный текст */ }
      return s || null;
    },

    /** SN: текст (X8 — JSON {"SN":"..."} с префиксом 5838 → X8). */
    sn(v) {
      if (!v || !v.length) return null;
      let s = Array.from(v, b => (b >= 32 && b < 127) ? String.fromCharCode(b) : '').join('').trim();
      try {
        if (s.startsWith('{')) {
          const j = JSON.parse(s);
          if (j.SN) {
            s = j.SN.startsWith('5838') ? 'X8' + j.SN.slice(3) : j.SN;
          }
        }
      } catch (_) { /* обычный текст */ }
      return s || null;
    },

    /** MAC: hex-байты → «AA:BB:CC:DD:EE:FF». */
    mac(v) {
      if (!v || v.length < 6) return null;
      // ответ может содержать префикс-эхо; берём последние 6 байт, похожие на MAC
      let start = v.length - 6;
      return Array.from(v.slice(start), b => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
    },

    /** Время автоотключения (мин): L-серия bArr[0], прочие bArr[1]; JSON для X8. */
    shutTime(v, deviceName) {
      if (!v || !v.length) return null;
      try {
        const asText = Array.from(v, b => (b >= 32 && b < 127) ? String.fromCharCode(b) : '').join('');
        if (asText.startsWith('{')) {
          const j = JSON.parse(asText);
          if (j.shutdownTime != null) return parseInt(j.shutdownTime, 10);
        }
      } catch (_) { /* обычный формат */ }
      const isL = deviceName && /^(P11|P12|Silvertec|P15|P7|P50S|P5OS|PS50|M1|S15|S12|A1|YEW12|LP15|P1S|LPC74)/i.test(deviceName);
      if (isL) return v[0];
      return v.length > 1 ? v[1] : v[0];
    },

    /**
     * Остаток бумаги (mileage) — ответ как «1A 1F 07 ...»:
     * 8 hex-байт; [3..4]=ёмкость BE, [5..6]=остаток LE, [7]=sum([3..6]).
     * Возврат: {capacity, remain, percent}.
     */
    mileage(v) {
      if (!v || v.length < 8) return null;
      const b = Array.from(v);
      const sum = (b[3] + b[4] + b[5] + b[6]) & 0xff;
      if (b[7] !== sum) return null;
      const capacity = (b[3] << 8) | b[4];
      const remain = b[6] | (b[5] << 8);
      if (!capacity) return null;
      return { capacity, remain, percent: Math.round((remain / capacity) * 100) };
    },
  };

  /** Код из ответа [FF, xx] (10 FF 40) → ключ i18n status_*. */
  const STATUS = {
    1: 'no_paper', 2: 'cover_open', 3: 'overheat',
    4: 'low_bat', 5: 'cover_closed',
  };

  // ------------------------------------------------------ модели принтеров ---
  /**
   * Профили моделей — из DeviceSeriesStyleFactory / DeviceStyle / LabelPrintActivity.
   * direction (paperDirection): 0=← (поворот +90°), 1=→ (−90°), 2=↑ (без поворота),
   * 3=↓ (180°). protocol: 'l' (p112Print/R15), 'p50' (printS2/p50Print/X2), 'escpos'.
   */
  const MODELS = [
    {
      id: 'l', title: 'L-серия (P11/P12/P15/P7/M1/S15/A1/LP…)',
      match: /^(P11|P12|P15|P7R?|P1S|S15|S12|M1|A1|LP15|LP90|LPC74|YEW12|Silvertec|BARABOGO|iSPACE)/i,
      protocol: 'l', direction: 1, dpi: 8, paper: [40, 30], paperType: 3,
      packetSize: 95, packetDelayMs: 30,
      // Marklife P15/P12/P7: плотность через толщину (10 FF 10 00 TT, hardware-проверено
      // в thermoprint); UI-плотность 0/1/2 → байты [0,1,2]
      densityCommand: 'thickness',
      densityMap: [0, 1, 2],
    },
    {
      id: 'p50', title: 'P50/S2/T2/M50/M57/X2/M60/ET-Z/Jammuk',
      match: /^(P50|P5OS|PS50|P50S|T2|M50|M57|S2|Jammuk|ET-Z|X2|M60|X8|D210)/i,
      protocol: 'p50', direction: 2, dpi: 8, paper: [50, 30], paperType: 2,
      packetSize: 95, packetDelayMs: 30,
      // X2Protocol: app-density 1→2, 2→5, 5→15 → наша шкала 0/1/2 → [2,5,15]
      densityCommand: 'density',
      densityMap: [2, 5, 15],
    },
    {
      id: 'p80', title: 'P80/P80S/T3',
      match: /^(P80S?|T3)/i,
      protocol: 'l', direction: 2, dpi: 8, paper: [40, 30], paperType: 3,
      packetSize: 237, packetDelayMs: 30,
      densityCommand: 'density',
      densityMap: [0, 1, 2],
    },
    {
      id: 'd100', title: 'D100/D200/X4/L100',
      match: /^(D100|D200|X4|L100|U210)/i,
      protocol: 'p50', direction: 3, dpi: 8, paper: [40, 30], paperType: 2,
      packetSize: 237, packetDelayMs: 30,
      // CAPrint: 1/7/15 (из RE thermoprint)
      densityCommand: 'density',
      densityMap: [1, 7, 15],
    },
  ];

  const DEFAULT_PROFILE = {
    id: 'default', title: 'неизвестная модель', protocol: 'l', direction: 2,
    dpi: 8, paper: [40, 30], paperType: 3,
    packetSize: 237, packetDelayMs: 30,
    densityCommand: 'density',
    densityMap: [0, 1, 2],
  };

  /**
   * Команда установки плотности для профиля: Marklife L-серия использует
   * толщину (10 FF 10 00 TT), остальные — 1F 70 t d. Значение берётся из
   * densityMap профиля (индекс = UI-плотность 0=светлая/1=норма/2=тёмная).
   */
  function densityCommandFor(profile, uiDensity) {
    const d = Math.max(0, Math.min(2, uiDensity | 0));
    const value = (profile && profile.densityMap) ? profile.densityMap[d] : d;
    if (profile && profile.densityCommand === 'thickness') {
      return CMD.setThickness(value);
    }
    return CMD.setDensity(2, value);
  }

  /** Профиль модели по имени устройства. */
  function modelProfile(name) {
    if (!name) return DEFAULT_PROFILE;
    for (const m of MODELS) {
      if (m.match.test(name)) {
        const p = { ...m };
        // S2 Pro / X2 Pro — 11.8 dot/mm; таймер передачи 10 мс для S2 Pro, 1 мс для X2/M60
        if (/^(S2|X2).*pro/i.test(name)) { p.dpi = 11.8; }
        if (/^S2.*pro/i.test(name)) p.packetDelayMs = 10;
        if (/^(X2|M60)/i.test(name)) p.packetDelayMs = 1;
        if (/D210H/i.test(name)) p.dpi = 12;
        // жёсткие лимиты пакета из оригинального BluetoothPort.write():
        // P11/P12/LP90 → 90 байт (остальная L-серия и S2-семейство уже 95)
        if (/^(P11|P12|LP90)/i.test(name)) p.packetSize = 90;
        return p;
      }
    }
    return DEFAULT_PROFILE;
  }

  // -------------------------------------------- поворот 1bpp-растра ---
  /**
   * Поворот монохромного растра по paperDirection (как Matrix.postRotate в LabelPrintActivity).
   * dir 0 → +90° CW, dir 1 → −90° (CCW), dir 2 → без изменений, dir 3 → 180°.
   */
  function rotate1bpp(m, dir) {
    if (dir == null || dir === 2) return m;
    const W = m.bpr * 8, H = m.height;
    if (dir === 3) { // 180°
      const data = new Uint8Array(m.bpr * H);
      for (let y = 0; y < H; y++) {
        const srcRow = (H - 1 - y) * m.bpr;
        const dstRow = y * m.bpr;
        for (let x = 0; x < W; x++) {
          const sx = W - 1 - x;
          if (m.data[srcRow + (sx >> 3)] & (0x80 >> (sx & 7))) {
            data[dstRow + (x >> 3)] |= (0x80 >> (x & 7));
          }
        }
      }
      return { data, bpr: m.bpr, height: H };
    }
    // ±90°: новая ширина = старая высота (направление подачи меняется местами)
    const NW = H, NH = W;
    const nbpr = Math.ceil(NW / 8);
    const data = new Uint8Array(nbpr * NH);
    for (let y = 0; y < H; y++) {
      const srcRow = y * m.bpr;
      for (let x = 0; x < W; x++) {
        if (!(m.data[srcRow + (x >> 3)] & (0x80 >> (x & 7)))) continue;
        let nx, ny;
        if (dir === 0) { nx = H - 1 - y; ny = x; }   // +90° CW
        else { nx = y; ny = W - 1 - x; }             // dir 1: −90° CCW
        data[ny * nbpr + (nx >> 3)] |= (0x80 >> (nx & 7));
      }
    }
    return { data, bpr: nbpr, height: NH };
  }


  // ------------------------------------------------------ bitmap → 1bpp ---
  /**
   * CanvasImageData → 1bpp MSB-first (порог 128, яркость по BT.601).
   * @returns {{data: Uint8Array, bpr: number, height: number}}
   */
  function imageDataTo1bpp(imgData, width, height, threshold = 128) {
    const bpr = Math.ceil(width / 8);
    const out = new Uint8Array(bpr * height);
    const px = imgData.data;
    for (let y = 0; y < height; y++) {
      const rowOff = y * bpr;
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        const alpha = px[i + 3];
        if (alpha > 32 && lum < threshold) {
          out[rowOff + (x >> 3)] |= (0x80 >> (x & 7));
        }
      }
    }
    return { data: out, bpr, height };
  }

  /**
   * Полутона: серпантинный Floyd–Steinberg (как PrintAlgorithmTools.serpentineDither
   * в оригинале и thermoprint). Чётные строки идут слева направо, нечётные —
   * справа налево: меньше направленных артефактов (бандинга).
   * Для фото/градиентов. Возвращает 1bpp MSB-first.
   */
  function imageDataTo1bppDither(imgData, width, height) {
    const bpr = Math.ceil(width / 8);
    const out = new Uint8Array(bpr * height);
    const px = imgData.data;
    const gray = new Float32Array(width * height);
    for (let i = 0, j = 0; j < gray.length; i += 4, j++) {
      gray[j] = px[i + 3] <= 32 ? 255 : 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    }
    for (let y = 0; y < height; y++) {
      const rowOff = y * bpr;
      const leftToRight = y % 2 === 0;
      const startX = leftToRight ? 0 : width - 1;
      const endX = leftToRight ? width : -1;
      const step = leftToRight ? 1 : -1;
      for (let x = startX; x !== endX; x += step) {
        const idx = y * width + x;
        const old = gray[idx];
        const dark = old < 128;
        if (dark) out[rowOff + (x >> 3)] |= (0x80 >> (x & 7));
        const err = old - (dark ? 0 : 255);
        // сосед «вперёд» по ходу строк; «назад» — в противоположную сторону
        const fwd = x + step, back = x - step;
        const hasFwd = leftToRight ? fwd < width : fwd >= 0;
        const hasBack = leftToRight ? back >= 0 : back < width;
        if (hasFwd) gray[idx + step] += err * 7 / 16;
        if (y + 1 < height) {
          if (hasBack) gray[(y + 1) * width + back] += err * 3 / 16;
          gray[(y + 1) * width + x] += err * 5 / 16;
          if (hasFwd) gray[(y + 1) * width + fwd] += err * 1 / 16;
        }
      }
    }
    return { data: out, bpr, height };
  }

  // --------------------------------------------------------------- порт ---
  class AbleMarkPort {
    constructor(logger) {
      this.log = logger || (() => {});
      this.device = null;
      this.server = null;
      this.writeChar = null;
      this.notifyChar = null;
      this.ctrlChar = null;
      this.serviceKind = null; // 'A' | 'B' | 'C' | 'GEN'
      this.packetSize = 20;    // безопасный старт; уточняется по MTU-нотификации
      this._packetCap = null;  // аппаратный лимит пакета модели (из профиля)
      this._packetDelayMs = 30; // пауза между пакетами (pacing, как в оригинале)
      this.credit = 0;
      this.creditMode = false;
      this.connected = false;
      this._rxListeners = [];
      this._disconnectListeners = [];
      this._creditsWaiters = [];
      this._sending = false;
      this._creditTimeouts = 0;
    }

    /**
     * Применить профиль модели: аппаратный лимит размера пакета (каппинг MTU)
     * и межпакетную задержку. Большой BLE MTU не значит, что буфер принтера
     * переварит большие записи — оригинальное приложение жёстко ограничивает
     * пакет по модели (P11/P12/LP90=90, P15-семейство/S2=95, прочие=237).
     */
    setModelProfile(profile) {
      if (!profile) return;
      this._packetCap = profile.packetSize || null;
      this._packetDelayMs = profile.packetDelayMs != null ? profile.packetDelayMs : 30;
      if (this._packetCap && this.packetSize > this._packetCap) {
        this.packetSize = this._packetCap;
      }
    }

    onRx(fn) { this._rxListeners.push(fn); }
    onDisconnect(fn) { this._disconnectListeners.push(fn); }
    /** Одноразовый слушатель разрыва связи; возвращает функцию отписки. */
    onceDisconnect(fn) {
      const wrap = () => { this._offDisconnect(wrap); fn(); };
      this._disconnectListeners.push(wrap);
      return () => this._offDisconnect(wrap);
    }
    _offDisconnect(fn) {
      const i = this._disconnectListeners.indexOf(fn);
      if (i >= 0) this._disconnectListeners.splice(i, 1);
    }
    _emitRx(v) { for (const f of this._rxListeners) { try { f(v); } catch (e) { /* ignore */ } } }
    _removeRx(fn) {
      const i = this._rxListeners.indexOf(fn);
      if (i >= 0) this._rxListeners.splice(i, 1);
    }

    static available() { return !!navigator.bluetooth && !!navigator.bluetooth.requestDevice; }

    /**
     * Показать диалог выбора принтера.
     * @param {'name'|'service'|'all'} mode
     *  - 'name'    — фильтр по префиксам имён принтеров (как делает Android-приложение);
     *                НЕ требует, чтобы сервис рекламировался в эфире. Рекомендуется.
     *  - 'service' — фильтр по рекламируемым сервисам (узкий список, но не все принтеры
     *                публикуют UUID сервисов в advertising).
     *  - 'all'     — все BLE-устройства рядом (acceptAllDevices).
     */
    async pickAndConnect(mode = 'name') {
      if (!AbleMarkPort.available()) {
        throw new Error('Web Bluetooth не поддерживается этим браузером (нужен Chrome/Edge/Opera).');
      }
      let requestOpts;
      if (mode === 'service') {
        requestOpts = { filters: SERVICE_FILTERS, optionalServices: OPTIONAL_SERVICES };
      } else if (mode === 'all') {
        requestOpts = { acceptAllDevices: true, optionalServices: OPTIONAL_SERVICES };
      } else {
        requestOpts = { filters: NAME_PREFIXES.map(p => ({ namePrefix: p })), optionalServices: OPTIONAL_SERVICES };
      }
      this.device = await navigator.bluetooth.requestDevice(requestOpts);
      this.device.addEventListener('gattserverdisconnected', () => this._onDisconnected());
      this.log(`Выбрано устройство: ${this.device.name || '(без имени)'} [${this.device.id}]`);
      return this.connect();
    }

    async connect() {
      const MAX_RETRY = 4;
      const DELAYS = [0, 300, 800, 1500];
      let lastErr = null;
      for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
        try {
          this.log(`Подключение GATT (попытка ${attempt}/${MAX_RETRY})…`);
          this.server = await this.device.gatt.connect();
          // некоторым принтерам нужна пауза между connect и discover
          await sleep(150);
          await this._setupCharacteristics();
          // Ждём стартовые кредиты на CX (обычно [01 04] приходит сразу после
          // подписки): без них первая печать стартует с 0 кредитов и полагается
          // на starvation recovery. Только если CX есть; до 3 с — потом идём дальше.
          if (this.ctrlChar && this.credit <= 0) {
            await this._waitForInitialCredits(3000);
          }
          this.connected = true;
          this.log(`Подключено. Сервис ${this.serviceKind}, пакет ${this.packetSize} байт, credits: ${this.credit}`);
          return true;
        } catch (e) {
          lastErr = e;
          this.log(`Ошибка подключения: ${e.message}`);
          try { this.device.gatt.disconnect(); } catch (_) { /* noop */ }
          if (attempt < MAX_RETRY) await sleep(DELAYS[attempt] || 1000);
        }
      }
      throw lastErr || new Error('Не удалось подключиться');
    }

    async _setupCharacteristics() {
      const services = await this.server.getPrimaryServices();
      this.log(`GATT-сервисы устройства: ${services.map(s => s.uuid).join(', ')}`);

      const pickFrom = async (kind, svc, writeUuid, notifyUuid, ctrlUuid) => {
        const chars = await svc.getCharacteristics();
        this.log(`Сервис ${kind} (${svc.uuid}): ${chars.map(c => `${c.uuid.slice(0, 8)}[${props(c)}]`).join(', ')}`);

        let writeC = chars.find(c => c.uuid === writeUuid) || null;
        let notifyC = chars.find(c => c.uuid === notifyUuid) || null;
        let ctrlC = ctrlUuid ? (chars.find(c => c.uuid === ctrlUuid) || null) : null;
        // автодетект по свойствам, если UUID не совпали
        if (!writeC) writeC = chars.find(c => c.properties.write || c.properties.writeWithoutResponse) || null;
        if (!notifyC) notifyC = chars.find(c => (c.properties.notify || c.properties.indicate) && c !== writeC) || null;
        if (!ctrlC && ctrlUuid) {
          ctrlC = chars.find(c => (c.properties.notify || c.properties.indicate) && c !== notifyC && c !== writeC) || null;
        }
        if (!writeC) return false;

        this.serviceKind = kind;
        this.writeChar = writeC;
        this.notifyChar = notifyC;
        this.ctrlChar = ctrlC;

        if (notifyC && (notifyC.properties.notify || notifyC.properties.indicate)) {
          await notifyC.startNotifications();
          notifyC.addEventListener('characteristicvaluechanged', (ev) => {
            const v = new Uint8Array(ev.target.value.buffer);
            this.log(`RX ← ${hex(v)}`);
            this._emitRx(v);
          });
        }
        if (ctrlC && (ctrlC.properties.notify || ctrlC.properties.indicate)) {
          await ctrlC.startNotifications();
          ctrlC.addEventListener('characteristicvaluechanged', (ev) => this._onCtrl(new Uint8Array(ev.target.value.buffer)));
        }
        return true;
      };

      const byUuid = (u) => services.find(s => s.uuid === u) || null;
      const svcA = byUuid(UUIDS.SVC_A_FULL);
      const svcB = byUuid(UUIDS.SERVICE_B);
      const svcC = byUuid(UUIDS.SVC_C_FULL);

      if (svcA && await pickFrom('A', svcA, UUIDS.SVC_A_WRITE, UUIDS.SVC_A_NOTIFY, UUIDS.SVC_A_CTRL)) return;
      if (svcB && await pickFrom('B', svcB, UUIDS.SVC_B_WRITE, UUIDS.SVC_B_NOTIFY, null)) return;
      if (svcC && await pickFrom('C', svcC, UUIDS.SVC_C_WRITE, UUIDS.SVC_C_NOTIFY, null)) return;

      // Generic: ищем любой сервис с write+notify характеристиками (serial-подобный)
      this.log('Известные сервисы не найдены — пробую автоопределение по свойствам характеристик…');
      for (const svc of services) {
        const chars = await svc.getCharacteristics();
        const writable = chars.filter(c => c.properties.write || c.properties.writeWithoutResponse);
        const notifiable = chars.filter(c => c.properties.notify || c.properties.indicate);
        if (writable.length && notifiable.length) {
          const ok = await pickFrom('GEN', svc, null, null, null);
          if (ok) {
            this.log(`Автоопределение: сервис ${svc.uuid} (write: ${this.writeChar.uuid}, notify: ${this.notifyChar ? this.notifyChar.uuid : '—'})`);
            return;
          }
        }
      }
      throw new Error(`Подходящий сервис не найден. Сервисы устройства: ${services.map(s => s.uuid).join(', ')}. ` +
        'Возможно, принтер поддерживает только Bluetooth Classic (SPP) — браузер его не подключит.');
    }

    _onCtrl(v) {
      if (v.length === 3 && v[0] === 0x02) {
        const mtu = (v[2] << 8) | v[1];
        // пакет = MTU−3, но не выше аппаратного лимита модели
        let size = Math.max(20, Math.min(244, mtu - 3));
        if (this._packetCap && size > this._packetCap) {
          this.log(`Контроль: MTU=${mtu} → пакет ${size}, ограничен до ${this._packetCap} (лимит модели)`);
          size = this._packetCap;
        }
        this.packetSize = size;
        this.log(`Контроль: MTU=${mtu}, пакет=${this.packetSize}`);
      } else if (v.length === 2 && v[0] === 0x01) {
        this.creditMode = true;
        this._creditTimeouts = 0;
        this.credit += v[1];
        this.log(`Контроль: +${v[1]} credit (всего ${this.credit})`);
        for (const w of this._creditsWaiters.splice(0)) w();
      }
    }

    _onDisconnected() {
      this.connected = false;
      this.credit = 0;
      for (const f of this._disconnectListeners) { try { f(); } catch (_) { /* noop */ } }
    }

    disconnect() {
      try { this.device && this.device.gatt.disconnect(); } catch (_) { /* noop */ }
      this.connected = false;
    }

    async _waitCredits(ms) {
      if (this.credit > 0 || !this.creditMode) return true;
      return new Promise(resolve => {
        const t = setTimeout(() => {
          this._removeRxWaiter(fn);
          resolve(false);
        }, ms);
        const fn = () => { clearTimeout(t); resolve(true); };
        this._creditsWaiters.push(fn);
      });
    }
    _removeRxWaiter(fn) {
      const i = this._creditsWaiters.indexOf(fn);
      if (i >= 0) this._creditsWaiters.splice(i, 1);
    }

    /** Ожидание стартовых кредитов после подписки на CX (как Printer.connect в thermoprint). */
    _waitForInitialCredits(timeoutMs = 3000) {
      if (this.credit > 0) return Promise.resolve();
      return new Promise(resolve => {
        const started = Date.now();
        this.log('Ожидание стартовых кредитов…');
        const timer = setTimeout(() => {
          this.log('Стартовые кредиты не пришли — продолжаю без них (включится starvation recovery)');
          resolve();
        }, timeoutMs);
        const check = () => {
          if (this.credit > 0 || !this.device.gatt.connected) {
            clearTimeout(timer);
            resolve();
          } else if (Date.now() - started < timeoutMs) {
            setTimeout(check, 50);
          }
        };
        check();
      });
    }

    async _writeOnce(chunk) {
      // оригинал ставит TX в WRITE_NO_RESPONSE (setWriteType(1));
      // с pacing + кредитами это надёжнее — не ждём ACK BLE-стека на каждый пакет
      const canNoResp = this.writeChar.properties.writeWithoutResponse;
      for (let t = 0; t < 4; t++) {
        try {
          if (canNoResp) await this.writeChar.writeValueWithoutResponse(chunk);
          else await this.writeChar.writeValueWithResponse(chunk);
          return;
        } catch (e) {
          const m = String(e && e.message || e);
          if (/already in progress/i.test(m)) { await sleep(150 + t * 100); continue; }
          throw e;
        }
      }
      throw new Error('GATT write: слишком много попыток (operation in progress)');
    }

    /** Отправить поток байт с учётом фрагментации и кредитов (клон BluetoothPort.write). */
    async write(bytes, onProgress) {
      if (!this.connected) throw new Error('Принтер не подключён');
      if (this._sending) throw new Error('Предыдущая передача ещё идёт');
      this._sending = true;
      try {
        const total = bytes.length;
        let index = 0, lastReport = -1;
        while (index < total) {
          if (!this.device.gatt.connected) throw new Error('Соединение потеряно');
          if (this.creditMode && this.credit <= 0) {
            // starvation recovery (как в оригинале): ждём кредиты до 1 с,
            // затем форсируем 1 кредит и продолжаем — потерянные BLE-нотификации
            // не должны намертво вешать печать
            const ok = await this._waitCredits(1000);
            if (!ok && this.credit <= 0) {
              this.credit = 1;
              this._creditTimeouts++;
              this.log(`Starvation recovery: форсирую 1 credit (эпизод #${this._creditTimeouts})`, 'warn');
            }
          }
          let len = Math.min(this.packetSize, total - index);
          let sent = false;
          for (let t = 0; t < 3 && !sent; t++) {
            const chunk = bytes.slice(index, index + len);
            try {
              await this._writeOnce(chunk);
              sent = true;
            } catch (e) {
              const m = String(e && e.message || e);
              // запись не влезает в MTU — уменьшаем пакет
              if (len > 20 && /length|mtu|too long|invalid|overflow/i.test(m)) {
                len = Math.max(20, Math.floor(len / 2));
                this.packetSize = len;
                this.log(`Снижаю размер пакета до ${len} байт`);
                continue;
              }
              throw e;
            }
          }
          if (!sent) throw new Error('Не удалось записать данные в характеристику');
          if (this.creditMode) this.credit--;
          index += len;
          const pct = Math.floor((index / total) * 100);
          if (pct !== lastReport) { lastReport = pct; onProgress && onProgress(pct, index, total); }
          // pacing: ровно один пакет за интервал профиля (30 мс по умолчанию,
          // как таймер в оригинальном приложении) — более быстрая отправка
          // перегружает BLE-стек принтера, и он перестаёт выдавать кредиты
          if (index < total && this._packetDelayMs > 0) {
            await sleep(this._packetDelayMs);
          }
        }
      } finally {
        this._sending = false;
      }
    }

    /** Ожидание накопления кредитов (до min штук или timeout). Для preamble/bulk ритма. */
    waitForCredits(min = 3, timeoutMs = 1000) {
      if (this.credit >= min) return Promise.resolve(true);
      return new Promise(resolve => {
        const started = Date.now();
        const check = () => {
          if (!this.device.gatt.connected) { resolve(false); return; }
          if (this.credit >= min) { resolve(true); return; }
          if (Date.now() - started >= timeoutMs) { resolve(false); return; }
          setTimeout(check, 20);
        };
        check();
      });
    }

    /** Короткая команда + ожидание ответа. Ставится в очередь (не конкурирует с опросом). */
    async command(bytes, timeoutMs = 5000) {
      // сериализация: ждём, пока предыдущая команда/передача завершится
      const prev = this._cmdChain || Promise.resolve();
      let release;
      this._cmdChain = new Promise(r => { release = r; });
      try {
        await prev.catch(() => {});
        if (this._sending) {
          // активная большая передача — ждём её окончания (до timeoutMs)
          const waitStart = Date.now();
          while (this._sending && Date.now() - waitStart < timeoutMs) {
            await sleep(50);
          }
          if (this._sending) throw new Error('printer busy');
        }
        const p = new Promise(resolve => {
          const fn = (v) => { this._removeRx(fn); clearTimeout(t); resolve(v); };
          const t = setTimeout(() => { this._removeRx(fn); resolve(null); }, timeoutMs);
          this._rxListeners.push(fn);
        });
        await this.write(bytes);
        return await p;
      } finally {
        release();
      }
    }
  }

  function props(c) {
    const p = c.properties;
    return ['broadcast', 'read', 'writeWithoutResponse', 'write', 'notify', 'indicate', 'authenticatedSignedWrites']
      .filter(k => p[k]).join(',').replace(/writeWithoutResponse/g, 'wrNR').replace(/authenticatedSignedWrites/g, 'signed') || 'none';
  }

  // ------------------------------------------------------- print builder ---
  /**
   * Собирает команды печати по типу протокола. Возвращает массив команд,
   * где команда-растр помечена bulk:true (см. buildPrintParts).
   * @param {object} m {data, bpr, height} — 1bpp (уже повёрнут по paperDirection)
   * @param {object} opts {protocol, density, copies, paperType, feedDots, compressed}
   *   paperType: 1=непрерывная, 2=чёрная метка, 3=наклейка (gap)
   */
  function buildPrintCommands(m, opts) {
    const parts = [];
    const proto = opts.protocol || 'l';
    const copies = Math.max(1, opts.copies || 1);
    const paperType = opts.paperType || 3;
    // чёрная метка → сжатый растр (как R15Protocol: paperType 2 → printBitmap + getLocation)
    const compressed = opts.compressed != null ? opts.compressed : paperType === 2;

    if (proto === 'l') {
      // p112Print / R15Protocol: плотность → [wakeup → enable → растр → прогон → stop] × N
      parts.push(densityCommandFor(opts.profile, opts.density ?? 1));
      for (let i = 0; i < copies; i++) {
        parts.push(CMD.wakeupL());
        parts.push(CMD.enableL());
        parts.push(compressed ? compressedImage(m.data, m.bpr, m.height) : gsV0(m.data, m.bpr, m.height));
        if (paperType === 1) parts.push(CMD.feedDots(opts.feedDots ?? 100));
        else if (paperType === 2) parts.push(CMD.feedToMark());
        parts.push(CMD.stopL());
      }
    } else if (proto === 'p50') {
      // printS2 / p50Print: wakeup → density → [start → калибровка → растр → позиция → stop] × N
      parts.push(CMD.wakeupP());
      parts.push(densityCommandFor(opts.profile, opts.density ?? 1));
      for (let i = 0; i < copies; i++) {
        parts.push(CMD.startJobP());
        if (i === 0) parts.push(CMD.adjustAuto(81));
        parts.push(compressedImage(m.data, m.bpr, m.height));
        if (paperType !== 1) parts.push(CMD.printerLocation(32, 0));
        parts.push(CMD.stopJobP());
        if (i === copies - 1) parts.push(CMD.adjustAuto(80));
      }
    } else { // escpos
      parts.push(CMD.escInit());
      for (let i = 0; i < copies; i++) {
        parts.push(gsV0(m.data, m.bpr, m.height));
        parts.push(CMD.feedDots(opts.feedDots || 30));
        parts.push(CMD.feedRows(opts.feedRows || 3));
      }
      parts.push(u8(0x0a));
    }
    return parts;
  }

  /** Конкатенация команд в один байтовый поток (совместимость со старым API). */
  function buildPrintStream(m, opts) {
    let out = new Uint8Array(0);
    for (const p of buildPrintCommands(m, opts)) out = concat(out, p);
    return out;
  }

  /**
   * Разбиение потока на {preamble, bulk} для кредитного ритма печати
   * (как Printer.printBitmap в thermoprint): сначала уходят setup-команды
   * (плотность/wakeup/enable/start), затем — после пополнения кредитов —
   * растр с хвостовыми командами одним непрерывным потоком. Без этого
   * принтер может начать печатать, имея в буфере лишь несколько строк.
   * Для copies>1 возвращается массив пар [{preamble, bulk}] — по одной на копию.
   */
  function buildPrintParts(m, opts) {
    const proto = opts.protocol || 'l';
    const copies = Math.max(1, opts.copies || 1);
    const concatAll = (arr) => {
      let out = new Uint8Array(0);
      for (const b of arr) out = concat(out, b);
      return out;
    };
    // разрез: preamble = всё до первого bulk (команды растра), bulk = растр + хвост
    const isImageCmd = (bytes) => {
      if (proto === 'p50') return bytes[0] === 0x1f && bytes[1] === 0x10; // сжатый растр
      return bytes[0] === 0x1d && bytes[1] === 0x76; // GS v 0
    };

    const commands = buildPrintCommands(m, { ...opts, copies: 1 });
    let preamble = [], bulk = [], inBulk = false;
    for (const cmd of commands) {
      if (!inBulk && isImageCmd(cmd)) inBulk = true;
      if (inBulk) bulk.push(cmd);
      else preamble.push(cmd);
    }
    const pair = { preamble: concatAll(preamble), bulk: concatAll(bulk) };

    // каждая копия — полная пара (как Printer.printBitmap в thermoprint)
    const result = [];
    for (let i = 0; i < copies; i++) result.push(pair);
    return result;
  }

  return {
    UUIDS, SERVICE_FILTERS, OPTIONAL_SERVICES, NAME_PREFIXES, CMD, STATUS, Parsers,
    MODELS, DEFAULT_PROFILE, modelProfile, rotate1bpp, parseHex, densityCommandFor,
    AbleMarkPort, buildPrintStream, buildPrintCommands, buildPrintParts, compressedImage, gsV0,
    imageDataTo1bpp, imageDataTo1bppDither, concat, u8, hex, sleep,
  };
})();
