/**
 * app.js — связка UI ↔ протокол ↔ канвас-редактор.
 * Десктопный layout: слева вставка+слои, центр канвас, справа свойства.
 * Двуязычный интерфейс (RU/EN) через I18N.
 */
'use strict';

(() => {

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const t = I18N.t;

  const els = {
    editorCanvas: $('#editorCanvas'),
    canvasWrap: $('#canvasWrap'),
    labelSubtitle: $('#labelSubtitle'),
    zoomLabel: $('#zoomLabel'),
    layersList: $('#layersList'),
    propsBody: $('#propsBody'),
    noSelection: $('#noSelection'),
    toolInfo: $('#toolInfo'),
    // модалки
    settingsModal: $('#settingsModal'),
    paperModal: $('#paperModal'),
    previewModal: $('#previewModal'),
    logModal: $('#logModal'),
    connectModal: $('#connectModal'),
    templatesModal: $('#templatesModal'),
    paletteModal: $('#paletteModal'),
    deviceModal: $('#deviceModal'),
    tplList: $('#tplList'),
    tplNameInput: $('#tplNameInput'),
    tplFileInput: $('#tplFileInput'),
    previewCanvas: $('#previewCanvas'),
    previewInfo: $('#previewInfo'),
    // настройки
    selProtocol: $('#selProtocol'),
    selDirection: $('#selDirection'),
    selPaperType: $('#selPaperType'),
    selRender: $('#selRender'),
    rngDensity: $('#rngDensity'),
    densityLabel: $('#densityLabel'),
    numCopies: $('#numCopies'),
    numFeed: $('#numFeed'),
    chkCompressed: $('#chkCompressed'),
    // бумага
    selPaperPreset: $('#selPaperPreset'),
    numLabelW: $('#numLabelW'),
    numLabelH: $('#numLabelH'),
    // статус
    connBadge: $('#connBadge'),
    wsBadge: $('#wsBadge'),
    printStatus: $('#printStatus'),
    progressBar: $('#progressBar'),
    btnPrint: $('#btnPrint'),
    btnPrint2: $('#btnPrint2'),
    log: $('#log'),
    fileInput: $('#fileInput'),
  };

  // ------------------------------------------------------------------ log ---
  function log(msg, cls = '') {
    const time = new Date().toLocaleTimeString();
    const div = document.createElement('div');
    div.innerHTML = `<span class="t">[${time}]</span> ${cls ? `<span class="${cls}">` : ''}${escapeHtml(msg)}${cls ? '</span>' : ''}`;
    els.log.appendChild(div);
    while (els.log.children.length > 400) els.log.removeChild(els.log.firstChild);
    els.log.scrollTop = els.log.scrollHeight;
  }
  const escapeHtml = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------------------------------------------------------------- port ---
  const port = new AM.AbleMarkPort((m) => log(m));

  port.onRx((v) => handlePrinterReply(v));
  port.onDisconnect(() => {
    log(t('disconnected'), 'err');
    setConnected(false);
  });

  function setConnected(on) {
    $('#btnConnect').disabled = on;
    $('#btnDisconnect').disabled = !on;
    $('#btnDeviceInfo').disabled = !on;
    els.connBadge.innerHTML = on
      ? `${t('printer')}: <b>${escapeHtml(port.device.name || '(?)')}</b>`
      : `${t('printer')}: ${t('not_connected')}`;
    els.connBadge.className = 'badge' + (on ? ' on' : '');
  }

  function handlePrinterReply(v) {
    if (v.length >= 2 && v[0] === 0xff) {
      const key = AM.Parsers.status(v);
      if (key) log(`${t('printer')}: ${t('status_' + key)}`, key === 'cover_closed' ? 'ok' : 'warn');
      return;
    }
    const printable = Array.from(v, b => (b >= 32 && b < 127) ? String.fromCharCode(b) : '').join('');
    if (printable.length > 2 && /^[A-Za-z0-9 :._\/-]+$/.test(printable)) {
      log(t('reply', { t: printable }), 'ok');
    }
  }

  // ----------------------------------------------------------- connecting ---
  function explainError(e) {
    const m = String((e && e.message) || e);
    if (/User cancelled|cancelled by user|отмен/i.test(m)) return t('err_pick_cancel');
    if (/No Services Found/i.test(m)) return t('err_no_services');
    if (/Connection failed|already in progress|NetworkError/i.test(m)) return t('err_conn_failed');
    if (/Подходящий сервис не найден|no transport/i.test(m)) return t('err_no_transport');
    if (/Web Bluetooth не поддерживается|Web Bluetooth недоступен/i.test(m)) return t('err_wb');
    return m;
  }

  let profile = AM.modelProfile(null);

  async function doConnect(mode) {
    $('#btnConnect').disabled = true;
    try {
      await port.pickAndConnect(mode);
      setConnected(true);
      applyModelProfile(port.device.name || '');
      log(t('connected_log', {
        n: port.device.name || '(?)', s: port.serviceKind, pk: port.packetSize, pr: profile.title,
      }), 'ok');
    } catch (e) {
      const hint = explainError(e);
      log(t('connect_failed', { t: hint }), /cancel|отмен/i.test(hint) ? '' : 'err');
    } finally {
      $('#btnConnect').disabled = port.connected;
    }
  }

  $('#btnConnect').addEventListener('click', () => {
    if (!AM.AbleMarkPort.available()) {
      log(t('wb_unavailable'), 'err');
      return;
    }
    els.connectModal.classList.remove('hidden');
  });
  $('#btnDisconnect').addEventListener('click', () => {
    port.disconnect();
    setConnected(false);
  });

  // ------------------------------------------------------------- язык ---
  $('#btnLang').addEventListener('click', () => {
    I18N.toggle();
    renderAll();
    renderLayers();
    refreshProps();
    updateDensityLabel();
    updateSubtitle();
  });

  // ------------------------------------------------------------ модалки ---
  const openModal = (m) => m.classList.remove('hidden');
  const closeModal = (m) => m.classList.add('hidden');
  $$('.modal').forEach(m => {
    m.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => closeModal(m)));
    m.addEventListener('click', (e) => { if (e.target === m) closeModal(m); });
  });
  $$('#connectModal [data-mode]').forEach(btn =>
    btn.addEventListener('click', () => {
      closeModal(els.connectModal);
      doConnect(btn.dataset.mode);
    }));
  $('#btnSettings').addEventListener('click', () => openModal(els.settingsModal));
  $('#btnPaper').addEventListener('click', () => openModal(els.paperModal));
  $('#btnLog').addEventListener('click', () => openModal(els.logModal));
  $('#btnTemplates').addEventListener('click', () => { renderTplList(); openModal(els.templatesModal); });

  // -------------------------------------------------------------- profile ---
  const DIR_NAMES = { 0: '← 90° CW', 1: '→ 90° CCW', 2: '↑ 0°', 3: '↓ 180°' };
  const dirText = (d) => DIR_NAMES[d] || '↑ 0°';

  function applyModelProfile(name) {
    profile = AM.modelProfile(name);
    port.setModelProfile(profile); // аппаратный лимит пакета + межпакетная задержка
    log(t('profile_log', { t: profile.title, p: profile.protocol, d: dirText(profile.direction), dpi: profile.dpi }) +
        ` · packet≤${profile.packetSize}B/${profile.packetDelayMs}ms`, 'ok');
    setPaperSize(profile.paper[0], profile.paper[1], profile.dpi, false);
  }

  function effectiveDirection() {
    const v = els.selDirection.value;
    return v === 'auto' ? profile.direction : parseInt(v, 10);
  }

  function selectedProtocol() {
    const v = els.selProtocol.value;
    return v === 'auto' ? profile.protocol : v;
  }

  // ----------------------------------------------------------- канвас-UI ---
  function updateSubtitle() {
    els.labelSubtitle.textContent =
      `${Editor.state.labelWmm}×${Editor.state.labelHmm} mm · ` +
      `${Editor.widthDots()}×${Editor.heightDots()} · ${dirText(effectiveDirection())}`;
  }

  function renderAll() {
    Editor.renderEditor(els.editorCanvas);
    updateSubtitle();
    refreshProps();
  }

  function renderLayers() {
    const list = els.layersList;
    list.innerHTML = '';
    const ICONS = {
      text: 'T', serial: '#', date: '🕐', qr: '▣', barcode: '|||',
      image: '🖼', line: '─', shape: '▭', table: '▦',
    };
    const NAME = (el) => {
      if (el.qrKind) return t('type_' + el.qrKind);
      if (el.priceMode) return t('type_price');
      if (el.isDate) return t('type_date');
      return t('type_' + el.type);
    };
    // сверху — последние (верхний слой), отображаем сверху вниз
    const arr = Editor.state.elements.slice().reverse();
    for (const el of arr) {
      const item = document.createElement('div');
      item.className = 'layer-item' + (Editor.state.selected === el ? ' sel' : '') + (el.hidden ? ' hidden-el' : '');
      item.innerHTML = `<span class="l-ico">${ICONS[el.type] || '?'}</span>
        <span class="l-name">${escapeHtml(NAME(el))}</span>
        <button class="l-vis" title="visibility">${el.hidden ? '🚫' : '👁'}</button>`;
      item.addEventListener('click', (e) => {
        if (e.target.closest('.l-vis')) return;
        Editor.state.selected = el;
        renderAll();
        renderLayers();
      });
      item.querySelector('.l-vis').addEventListener('click', () => {
        pushHistory();
        el.hidden = !el.hidden;
        renderAll();
        renderLayers();
      });
      list.appendChild(item);
    }
  }

  // unified refresh: канвас + слои
  const refreshAll = () => { renderAll(); renderLayers(); };

  // ------------------------------------------------------ undo/redo ---
  // Снапшоты Editor.serialize(): изображения не сериализуются (как в шаблонах) —
  // откат через их добавление теряет картинки сессии.
  const MAX_HISTORY = 50;
  const history = { past: [], future: [], burstTimer: null };

  const snapshot = () => Editor.serialize();

  function pushHistory() {
    history.past.push(snapshot());
    if (history.past.length > MAX_HISTORY) history.past.shift();
    history.future.length = 0;
  }

  /** Захват «пачкой»: первый ввод серии фиксирует состояние ДО изменения. */
  function beginHistoryBurst() {
    if (history.burstTimer == null) pushHistory();
    clearTimeout(history.burstTimer);
    history.burstTimer = setTimeout(() => { history.burstTimer = null; }, 800);
  }

  function syncPaperInputs() {
    els.numLabelW.value = Editor.state.labelWmm;
    els.numLabelH.value = Editor.state.labelHmm;
    const key = `${Editor.state.labelWmm}x${Editor.state.labelHmm}`;
    const opts = Array.from(els.selPaperPreset.options).filter(o => o.value.replace(/r$/, '') === key);
    els.selPaperPreset.value = opts.length ? opts[0].value : 'custom';
  }

  function undo() {
    if (!history.past.length) return false;
    history.future.push(snapshot());
    Editor.deserialize(history.past.pop());
    syncPaperInputs();
    refreshAll();
    return true;
  }

  function redo() {
    if (!history.future.length) return false;
    history.past.push(snapshot());
    Editor.deserialize(history.future.pop());
    syncPaperInputs();
    refreshAll();
    return true;
  }

  Editor.attachCanvas(els.editorCanvas, () => { renderAll(); renderLayers(); }, () => pushHistory());

  const ro = new ResizeObserver(() => renderAll());
  ro.observe(els.canvasWrap);

  // масштаб просмотра
  let viewZoom = 1;
  const applyZoom = (z) => {
    viewZoom = Math.max(0.3, Math.min(4, Math.round(z * 10) / 10));
    els.editorCanvas.style.width = (Editor.widthDots() * Editor.state.viewScale * viewZoom) + 'px';
    els.zoomLabel.textContent = viewZoom.toFixed(1) + '×';
  };
  $('#btnZoomIn').addEventListener('click', () => applyZoom(viewZoom + 0.2));
  $('#btnZoomOut').addEventListener('click', () => applyZoom(viewZoom - 0.2));

  // ---------------------------------------------------------- бумага ---
  function setPaperSize(wmm, hmm, dpi, round) {
    Editor.setPaper(wmm, hmm, dpi, round);
    els.numLabelW.value = wmm;
    els.numLabelH.value = hmm;
    const key = `${wmm}x${hmm}`;
    const opts = Array.from(els.selPaperPreset.options).filter(o => o.value.replace(/r$/, '') === key);
    els.selPaperPreset.value = opts.length
      ? (round ? (opts.find(o => o.value.endsWith('r')) || opts[0]).value : opts[0].value)
      : 'custom';
    renderAll();
    applyZoom(viewZoom);
  }

  els.selPaperPreset.addEventListener('change', () => {
    const v = els.selPaperPreset.value;
    if (v === 'custom') return;
    const round = v.endsWith('r');
    const [w, h] = v.replace(/r$/, '').split('x').map(Number);
    setPaperSize(w, h, Editor.state.dpi, round);
  });
  els.numLabelW.addEventListener('input', () => {
    Editor.setPaper(parseFloat(els.numLabelW.value) || 40, null, null, false);
    els.selPaperPreset.value = 'custom';
    renderAll();
  });
  els.numLabelH.addEventListener('input', () => {
    Editor.setPaper(null, parseFloat(els.numLabelH.value) || 30, null, false);
    els.selPaperPreset.value = 'custom';
    renderAll();
  });

  // ------------------------------------------------------ добавление ---
  /** Добавить элемент типа type (общий путь для кнопок и quick-add клавиш). */
  function addElement(type) {
    if (type === 'clear') {
      if (Editor.state.elements.length && confirm(t('confirm_clear'))) {
        pushHistory();
        Editor.state.elements = [];
        Editor.state.selected = null;
        refreshAll();
        log(t('layout_cleared'));
      }
      return;
    }

    if (type === 'wifi' || type === 'vcard' || type === 'url') {
      pushHistory();
      Editor.add(type);
      refreshAll();
      return;
    }

    if (type === 'image') {
      els.fileInput.onchange = () => {
        const file = els.fileInput.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const img = new Image();
          img.onload = () => {
            pushHistory();
            Editor.add('image', { img, src: reader.result, w: Math.min(Editor.widthDots(), Math.round(Editor.widthDots() * 0.8)) });
            refreshAll();
          };
          img.src = reader.result;
        };
        reader.readAsDataURL(file);
        els.fileInput.value = '';
      };
      els.fileInput.click();
      return;
    }

    pushHistory();
    Editor.add(type);
    refreshAll();
  }

  $$('[data-add]').forEach(btn => {
    btn.addEventListener('click', () => addElement(btn.dataset.add));
  });

  // ------------------------------------------------------ тулбар ---
  function deleteSelected() {
    const sel = Editor.state.selected;
    if (!sel) return;
    pushHistory();
    const i = Editor.state.elements.indexOf(sel);
    if (i >= 0) Editor.state.elements.splice(i, 1);
    Editor.state.selected = null;
    refreshAll();
  }

  function duplicateSelected() {
    const sel = Editor.state.selected;
    if (!sel) return null;
    pushHistory();
    const copy = JSON.parse(JSON.stringify({ ...sel, img: undefined }));
    copy.id = Date.now();
    copy.x += 10; copy.y += 10;
    delete copy._baseFont; delete copy._baseMod; delete copy._baseH; delete copy._baseW; delete copy._baseT;
    if (sel.type === 'image' && sel.img) copy.img = sel.img;
    Editor.state.elements.push(copy);
    Editor.state.selected = copy;
    refreshAll();
    return copy;
  }

  let clipboard = null;

  function clipboardCopy() {
    const sel = Editor.state.selected;
    if (!sel) return;
    clipboard = JSON.parse(JSON.stringify({ ...sel, img: undefined }));
    if (sel.type === 'image' && sel.img) clipboard.img = sel.img;
    log(t('copied_clipboard', { n: TITLES[sel.type] || sel.type }));
  }

  function clipboardPaste() {
    if (!clipboard) return;
    pushHistory();
    const pasted = JSON.parse(JSON.stringify(clipboard));
    pasted.id = Date.now();
    pasted.x += 12; pasted.y += 12;
    delete pasted._baseFont; delete pasted._baseMod; delete pasted._baseH; delete pasted._baseW; delete pasted._baseT;
    if (clipboard.type === 'image' && clipboard.img) pasted.img = clipboard.img;
    Editor.state.elements.push(pasted);
    Editor.state.selected = pasted;
    refreshAll();
  }

  $('#toolDel').addEventListener('click', deleteSelected);
  $('#toolCopy').addEventListener('click', duplicateSelected);
  $('#toolBigger').addEventListener('click', () => { beginHistoryBurst(); Editor.nudgeScale(1.15); refreshAll(); });
  $('#toolSmaller').addEventListener('click', () => { beginHistoryBurst(); Editor.nudgeScale(0.87); refreshAll(); });

  $('#toolRotate').addEventListener('click', () => {
    const sel = Editor.state.selected;
    if (!sel) return;
    beginHistoryBurst();
    sel.rotation = ((sel.rotation || 0) + 90) % 360;
    refreshAll();
  });

  $('#toolLayerUp').addEventListener('click', () => {
    const sel = Editor.state.selected;
    if (!sel) return;
    beginHistoryBurst();
    const arr = Editor.state.elements;
    const i = arr.indexOf(sel);
    if (i < arr.length - 1) { arr.splice(i, 1); arr.splice(i + 1, 0, sel); }
    refreshAll();
  });
  $('#toolLayerDown').addEventListener('click', () => {
    const sel = Editor.state.selected;
    if (!sel) return;
    const arr = Editor.state.elements;
    const i = arr.indexOf(sel);
    if (i > 0) { arr.splice(i, 1); arr.splice(i - 1, 0, sel); }
    refreshAll();
  });

  const ALIGN_CYCLE = ['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'];
  let alignIdx = 0;
  $('#toolAlign').addEventListener('click', () => {
    if (!Editor.state.selected) return;
    beginHistoryBurst();
    const kind = ALIGN_CYCLE[alignIdx % ALIGN_CYCLE.length];
    Editor.align(kind);
    log(t('align_log', { t: t('aligned.' + kind) }));
    alignIdx++;
    refreshAll();
  });

  $('#btnRotateAll').addEventListener('click', () => {
    pushHistory();
    const w = Editor.state.labelWmm, h = Editor.state.labelHmm;
    Editor.setPaper(h, w, null, null);
    els.numLabelW.value = h; els.numLabelH.value = w;
    const key = `${h}x${w}`;
    const opts = Array.from(els.selPaperPreset.options).filter(o => o.value.replace(/r$/, '') === key);
    els.selPaperPreset.value = opts.length ? opts[0].value : 'custom';
    log(t('layout_rotated', { w: h, h: w }));
    refreshAll();
    applyZoom(viewZoom);
  });

  // ------------------------------------------------------ свойства (правая панель) ---
  const TITLES = {
    text: () => t('type_text'), serial: () => t('type_serial'), qr: () => t('type_qr'),
    barcode: () => t('type_barcode'), image: () => t('type_image'), line: () => t('type_line'),
    shape: () => t('type_shape'), table: () => t('type_table'),
  };

  /** Информация о выделении в тулбаре. */
  function updateToolInfo() {
    const sel = Editor.state.selected;
    if (!sel) { els.toolInfo.textContent = ''; return; }
    const m = Editor.measure(sel);
    els.toolInfo.textContent = `${(TITLES[sel.type] || (() => '?'))()} · ${Math.round(m.w)}×${Math.round(m.h)} · X:${sel.x} Y:${sel.y}${sel.rotation ? ' · ' + sel.rotation + '°' : ''}`;
  }

  function refreshProps() {
    updateToolInfo();
    const el = Editor.state.selected;
    const body = els.propsBody;
    body.innerHTML = '';
    if (!el || el.hidden) {
      body.appendChild(els.noSelection);
      return;
    }
    buildProps(el, body);
  }

  function buildProps(el, body) {
    const row = (label, control) => {
      const r = document.createElement('div');
      r.className = 'prop-row';
      const s = document.createElement('span');
      s.textContent = label;
      r.appendChild(s);
      r.appendChild(control);
      body.appendChild(r);
    };
    const header = (txt) => {
      const h = document.createElement('div');
      h.className = 'prop-header';
      h.textContent = txt;
      body.appendChild(h);
    };
    const slider = (val, min, max, cb, fmt) => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;gap:8px;align-items:center;flex:1';
      const inp = document.createElement('input');
      inp.type = 'range'; inp.min = min; inp.max = max; inp.value = val;
      const out = document.createElement('output');
      out.textContent = fmt ? fmt(val) : val;
      inp.addEventListener('input', () => {
        beginHistoryBurst();
        cb(parseInt(inp.value, 10));
        out.textContent = fmt ? fmt(inp.value) : inp.value;
        refreshAll();
      });
      wrap.appendChild(inp); wrap.appendChild(out);
      return wrap;
    };
    const seg = (options, value, cb) => {
      const wrap = document.createElement('div');
      wrap.className = 'prop-seg';
      for (const [v, label] of options) {
        const b = document.createElement('button');
        b.textContent = label;
        if (String(v) === String(value)) b.classList.add('on');
        b.addEventListener('click', () => {
          beginHistoryBurst();
          cb(v);
          refreshAll();
        });
        wrap.appendChild(b);
      }
      return wrap;
    };
    const numField = (val, min, max, cb) => {
      const inp = document.createElement('input');
      inp.type = 'number'; inp.min = min; inp.max = max; inp.value = val;
      inp.addEventListener('input', () => { beginHistoryBurst(); cb(parseInt(inp.value, 10) || min); refreshAll(); });
      return inp;
    };
    const textField = (val, cb, multiline) => {
      const inp = document.createElement(multiline ? 'textarea' : 'input');
      if (!multiline) inp.type = 'text';
      inp.value = val;
      inp.addEventListener('input', () => { beginHistoryBurst(); cb(inp.value); refreshAll(); });
      return inp;
    };
    const change = () => refreshAll();

    header((el.qrKind ? t('type_' + el.qrKind) : null)
      || (el.priceMode ? t('type_price') : null)
      || (el.isDate ? t('type_date') : null)
      || (TITLES[el.type] ? TITLES[el.type]() : el.type));

    switch (el.type) {
      case 'serial': {
        row(t('prefix'), textField(el.prefix || '', v => { el.prefix = v; el.text = Editor.serialValue(el, 0); }));
        row(t('suffix'), textField(el.suffix || '', v => { el.suffix = v; el.text = Editor.serialValue(el, 0); }));
        row(t('start'), numField(el.startNumber ?? 0, -999999, 999999, v => { el.startNumber = v; el.text = Editor.serialValue(el, 0); }));
        row(t('step_num'), numField(el.interval ?? 1, -999, 999, v => { el.interval = v || 1; el.text = Editor.serialValue(el, 0); }));
        row(t('digits'), slider(el.digits || 1, 1, 12, v => { el.digits = v; el.text = Editor.serialValue(el, 0); }));
        row(t('font_size'), slider(el.fontSize, 8, 120, v => el.fontSize = v));
        row(t('bold_lbl'), seg([['n', '✕'], ['y', '✓']], el.bold ? 'y' : 'n', v => el.bold = v === 'y'));
        break;
      }
      case 'text': {
        row(t('text'), textField(el.text, v => el.text = v, true));
        if (el.isDate) {
          row(t('date_format'), seg([
            ['yyyy-MM-dd', '2025-01-01'], ['dd.MM.yyyy', '01.01.2025'],
            ['yyyy-MM-dd HH:mm', '01.01 12:00'], ['HH:mm:ss', '12:00:00'],
          ], el.datePattern, v => { el.datePattern = v; el.text = Editor.formatDate(new Date(), v); }));
          row('', seg([['now', t('now')]], '', () => { el.text = Editor.formatDate(new Date(), el.datePattern); change(); }));
        }
        row(t('font_size'), slider(el.fontSize, 8, 120, v => el.fontSize = v));
        row(t('letter_space'), slider(el.letterSpacing || 0, 0, 20, v => el.letterSpacing = v));
        row(t('line_space'), slider(el.lineSpacing || 1.25, 1, 3, v => el.lineSpacing = v / 100 * 2, v => (v / 100 * 2).toFixed(2)));
        row(t('style'), seg([
          ['b', t('bold')], ['u', t('underline')], ['i', t('italic')], ['inv', t('invert')],
        ], '', (v) => {
          if (v === 'b') el.bold = !el.bold;
          if (v === 'u') el.underline = !el.underline;
          if (v === 'i') el.italic = !el.italic;
          if (v === 'inv') el.invert = !el.invert;
          refreshProps(); // пересобрать, чтобы обновить подсветку кнопок
        }));
        // подсветка активных стилей
        body.querySelectorAll('.prop-seg button').forEach(b => {
          const label = b.textContent;
          if (label === t('bold') && el.bold) b.classList.add('on');
          if (label === t('underline') && el.underline) b.classList.add('on');
          if (label === t('italic') && el.italic) b.classList.add('on');
          if (label === t('invert') && el.invert) b.classList.add('on');
        });
        row(t('orientation'), seg([['h', t('horizontal')], ['v', t('vertical')]], el.vertical ? 'v' : 'h', v => el.vertical = v === 'v'));
        break;
      }
      case 'qr': {
        if (el.qrKind === 'wifi') {
          row(t('ssid'), textField(el.ssid, v => { el.ssid = v; Editor.applyQrKind(el); }));
          row(t('password'), textField(el.password || '', v => { el.password = v; Editor.applyQrKind(el); }));
          row(t('encryption'), seg([['WPA', 'WPA/WPA2'], ['WEP', 'WEP'], ['nopass', '–']], el.encryption, v => { el.encryption = v; Editor.applyQrKind(el); }));
        } else if (el.qrKind === 'vcard') {
          row(t('name'), textField(el.vcName, v => { el.vcName = v; Editor.applyQrKind(el); }));
          row(t('phone'), textField(el.vcPhone, v => { el.vcPhone = v; Editor.applyQrKind(el); }));
          row(t('email'), textField(el.vcEmail || '', v => { el.vcEmail = v; Editor.applyQrKind(el); }));
        } else if (el.qrKind === 'url') {
          row(t('link'), textField(el.text, v => { el.text = v; Editor.applyQrKind(el); }));
        } else {
          row(t('data'), textField(el.text, v => el.text = v, true));
        }
        row(t('correction'), seg([['L', 'L'], ['M', 'M'], ['Q', 'Q'], ['H', 'H']], el.ecLevel, v => el.ecLevel = v));
        row(t('module'), slider(el.module, 1, 8, v => el.module = v));
        break;
      }
      case 'barcode': {
        row(t('data'), textField(el.text, v => el.text = v, true));
        row(t('barcode_height'), slider(el.height, 20, 300, v => el.height = v));
        row(t('caption'), seg([['n', t('hide')], ['y', t('show')]], el.showText ? 'y' : 'n', v => el.showText = v === 'y'));
        row(t('increment'), seg([['n', '✕'], ['y', '✓']], el.increment ? 'y' : 'n', v => el.increment = v === 'y'));
        if (el.increment) {
          row(t('step'), numField(el.incrementStep || 1, 1, 999, v => el.incrementStep = v || 1));
        }
        break;
      }
      case 'image': {
        row(t('width_dots'), slider(el.w || Editor.widthDots(), 16, Editor.widthDots(), v => el.w = v));
        break;
      }
      case 'line': {
        row(t('thickness'), slider(el.thickness, 1, 20, v => el.thickness = v));
        row(t('direction'), seg([['h', t('horizontal')], ['v', t('vertical')]], el.horizontal ? 'h' : 'v', v => el.horizontal = v === 'h'));
        row(t('length'), slider(el.length || Math.round(Editor.widthDots() * 0.6), 8, Math.max(Editor.widthDots(), Editor.heightDots()), v => el.length = v));
        break;
      }
      case 'shape': {
        row(t('form'), seg([['rect', '▭'], ['ellipse', '◯'], ['triangle', '△']], el.shape, v => el.shape = v));
        row(t('width'), slider(el.w, 12, Editor.widthDots(), v => el.w = v));
        row(t('height'), slider(el.h, 12, Editor.heightDots(), v => el.h = v));
        row(t('thickness'), slider(el.thickness, 1, 12, v => el.thickness = v));
        row(t('fill'), seg([['n', t('outline')], ['y', t('fill_yes')]], el.filled ? 'y' : 'n', v => el.filled = v === 'y'));
        break;
      }
      case 'table': {
        row(t('rows'), slider(el.rows, 1, 12, v => el.rows = v));
        row(t('cols'), slider(el.cols, 1, 8, v => el.cols = v));
        row(t('cell_w'), slider(el.cellW, 8, 200, v => el.cellW = v));
        row(t('cell_h'), slider(el.cellH, 8, 120, v => el.cellH = v));
        row(t('thickness'), slider(el.thickness, 1, 6, v => el.thickness = v));
        break;
      }
    }

    // общее: позиция и поворот
    header(t('rotation'));
    row(t('rotation'), slider(el.rotation || 0, 0, 359, v => el.rotation = v, v => v + '°'));
    row('X', numField(el.x, -500, 500, v => el.x = v));
    row('Y', numField(el.y, -500, 500, v => el.y = v));
  }

  // ------------------------------------------------------ command palette (Ctrl+K) ---
  const paletteInput = $('#paletteInput');
  const paletteList = $('#paletteList');
  let paletteSelIdx = 0;
  let paletteFlat = []; // отфильтрованные команды текущего просмотра

  const paletteCommands = () => ([
    { group: 'add', ico: 'T',  key: 'cmd_add_text', hint: 'T', act: () => addElement('text') },
    { group: 'add', ico: '▣',  key: 'cmd_add_qr', hint: 'Q', act: () => addElement('qr') },
    { group: 'add', ico: '|||', key: 'cmd_add_barcode', hint: 'B', act: () => addElement('barcode') },
    { group: 'add', ico: '🖼', key: 'cmd_add_image', hint: 'I', act: () => addElement('image') },
    { group: 'add', ico: '🕐', key: 'cmd_add_date', hint: '', act: () => addElement('date') },
    { group: 'add', ico: '#',  key: 'cmd_add_serial', hint: '', act: () => addElement('serial') },
    { group: 'add', ico: '─',  key: 'cmd_add_line', hint: 'L', act: () => addElement('line') },
    { group: 'add', ico: '▭',  key: 'cmd_add_shape', hint: 'S', act: () => addElement('shape') },
    { group: 'add', ico: '▦',  key: 'cmd_add_table', hint: '', act: () => addElement('table') },
    { group: 'add', ico: '₽',  key: 'cmd_add_price', hint: '', act: () => addElement('price') },
    { group: 'add', ico: '📶', key: 'cmd_add_wifi', hint: '', act: () => addElement('wifi') },
    { group: 'add', ico: '👤', key: 'cmd_add_vcard', hint: '', act: () => addElement('vcard') },
    { group: 'add', ico: '🔗', key: 'cmd_add_url', hint: '', act: () => addElement('url') },
    { group: 'file', ico: '↶', key: 'cmd_undo', hint: 'Ctrl+Z', act: () => { if (undo()) log(t('undo_log')); } },
    { group: 'file', ico: '↷', key: 'cmd_redo', hint: 'Ctrl+Y', act: () => { if (redo()) log(t('redo_log')); } },
    { group: 'file', ico: '🖨', key: 'cmd_print', hint: 'Ctrl+P', act: () => doPrint() },
    { group: 'file', ico: '👁', key: 'cmd_preview', hint: '', act: () => $('#btnPreview').click() },
    { group: 'file', ico: '💾', key: 'cmd_save_label', hint: 'Ctrl+S', act: () => $('#btnSave').click() },
    { group: 'file', ico: '🗂', key: 'cmd_templates', hint: '', act: () => { renderTplList(); openModal(els.templatesModal); } },
    { group: 'file', ico: '✕',  key: 'cmd_clear', hint: '', act: () => addElement('clear') },
    { group: 'view', ico: '▦',  key: 'cmd_grid', hint: 'G', act: () => { Editor.state.showGrid = !Editor.state.showGrid; renderAll(); } },
    { group: 'view', ico: '⤢',  key: 'cmd_fit', hint: '1', act: () => applyZoom(1) },
    { group: 'view', ico: '🌐', key: 'cmd_lang', hint: '', act: () => $('#btnLang').click() },
    { group: 'device', ico: 'ℹ', key: 'cmd_device_info', hint: '', act: () => $('#btnDeviceInfo').click() },
    { group: 'device', ico: '⚙', key: 'cmd_settings', hint: '', act: () => openModal(els.settingsModal) },
    { group: 'device', ico: '📜', key: 'cmd_journal', hint: '', act: () => openModal(els.logModal) },
  ]);

  const GROUP_ORDER = ['add', 'file', 'view', 'device'];

  /** Подборка: подстрока или подпоследовательность в названии. */
  function paletteMatch(cmd, query) {
    const name = t(cmd.key).toLowerCase();
    if (name.includes(query)) return true;
    let qi = 0;
    for (const ch of name) { if (qi < query.length && ch === query[qi]) qi++; }
    return qi === query.length;
  }

  function renderPalette(query) {
    const q = String(query || '').trim().toLowerCase();
    const cmds = paletteCommands().filter(c => !q || paletteMatch(c, q));
    paletteFlat = cmds;
    paletteSelIdx = Math.min(paletteSelIdx, Math.max(0, cmds.length - 1));
    paletteList.innerHTML = '';
    if (!cmds.length) {
      const empty = document.createElement('div');
      empty.className = 'palette-empty';
      empty.textContent = t('palette_empty');
      paletteList.appendChild(empty);
      return;
    }
    let lastGroup = null;
    cmds.forEach((c, i) => {
      if (c.group !== lastGroup) {
        lastGroup = c.group;
        const g = document.createElement('div');
        g.className = 'palette-group';
        g.textContent = t('cmd_group_' + c.group);
        paletteList.appendChild(g);
      }
      const item = document.createElement('div');
      item.className = 'palette-item' + (i === paletteSelIdx ? ' sel' : '');
      item.innerHTML = `<span class="p-ico">${c.ico}</span><span class="p-name">${escapeHtml(t(c.key))}</span>` +
        (c.hint ? `<span class="p-kbd">${c.hint}</span>` : '');
      item.addEventListener('click', () => { execPalette(c); });
      paletteList.appendChild(item);
    });
  }

  function execPalette(cmd) {
    closeModal(els.paletteModal);
    try { cmd.act(); } catch (err) { log(`${t('error')}: ${err.message}`, 'err'); }
  }

  function openPalette() {
    paletteInput.value = '';
    paletteSelIdx = 0;
    renderPalette('');
    openModal(els.paletteModal);
    setTimeout(() => paletteInput.focus(), 50);
  }

  paletteInput.addEventListener('input', () => { paletteSelIdx = 0; renderPalette(paletteInput.value); });
  paletteInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      paletteSelIdx = Math.min(paletteSelIdx + 1, paletteFlat.length - 1);
      renderPalette(paletteInput.value);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      paletteSelIdx = Math.max(paletteSelIdx - 1, 0);
      renderPalette(paletteInput.value);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (paletteFlat[paletteSelIdx]) execPalette(paletteFlat[paletteSelIdx]);
    }
  });

  // ------------------------------------------------------ горячие клавиши ---
  let lastArrowTs = 0;

  const isTypingTarget = (t) =>
    t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const open = $$('.modal').filter(m => !m.classList.contains('hidden'))[0];
      if (open) { open.classList.add('hidden'); e.preventDefault(); }
      return;
    }
    const ctrlEarly = e.ctrlKey || e.metaKey;
    if (ctrlEarly && (e.key === 'k' || e.key === 'K' || e.key === 'л' || e.key === 'Л')) {
      e.preventDefault();
      if (!els.paletteModal.classList.contains('hidden')) closeModal(els.paletteModal);
      else openPalette();
      return;
    }
    if (isTypingTarget(e.target)) return;

    const sel = Editor.state.selected;
    const ctrl = e.ctrlKey || e.metaKey;

    if (ctrl && (e.key === 'c' || e.key === 'C' || e.key === 'с' || e.key === 'С')) {
      if (sel) { clipboardCopy(); e.preventDefault(); }
      return;
    }
    if (ctrl && (e.key === 'v' || e.key === 'V' || e.key === 'м' || e.key === 'М')) {
      clipboardPaste(); e.preventDefault();
      return;
    }
    if (ctrl && (e.key === 'x' || e.key === 'X' || e.key === 'ч' || e.key === 'Ч')) {
      if (sel) { clipboardCopy(); deleteSelected(); e.preventDefault(); }
      return;
    }
    if (ctrl && (e.key === 'd' || e.key === 'D' || e.key === 'в' || e.key === 'В')) {
      if (sel) { duplicateSelected(); e.preventDefault(); }
      return;
    }
    // undo / redo (Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y; ЙЦУКЕН: я/н)
    if (ctrl && (e.key === 'z' || e.key === 'Z' || e.key === 'я' || e.key === 'Я')) {
      if (e.shiftKey) { if (redo()) log(t('redo_log')); }
      else if (undo()) log(t('undo_log'));
      e.preventDefault();
      return;
    }
    if (ctrl && (e.key === 'y' || e.key === 'Y' || e.key === 'н' || e.key === 'Н')) {
      if (redo()) log(t('redo_log'));
      e.preventDefault();
      return;
    }
    // Ctrl+P — печать (откроет подключение, если принтера нет), Ctrl+S — сохранить
    if (ctrl && (e.key === 'p' || e.key === 'P' || e.key === 'з' || e.key === 'З')) {
      e.preventDefault();
      doPrint();
      return;
    }
    if (ctrl && (e.key === 's' || e.key === 'S' || e.key === 'ы' || e.key === 'Ы')) {
      e.preventDefault();
      $('#btnSave').click();
      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (sel) { deleteSelected(); e.preventDefault(); }
      return;
    }

    if (e.key === 'Tab') {
      const arr = Editor.state.elements;
      if (!arr.length) return;
      let i = sel ? arr.indexOf(sel) : -1;
      i = e.shiftKey ? (i <= 0 ? arr.length - 1 : i - 1) : (i >= arr.length - 1 ? 0 : i + 1);
      Editor.state.selected = arr[i];
      refreshAll();
      log(t('selected_elem', { i: i + 1, n: arr.length, t: TITLES[arr[i].type] ? TITLES[arr[i].type]() : arr[i].type }));
      e.preventDefault();
      return;
    }

    // quick-add и утилиты (одиночные клавиши, без модификаторов;
    // R занята поворотом — фигура на S)
    if (!ctrl && !e.altKey) {
      const k = e.key.toLowerCase();
      const quick = { t: 'text', q: 'qr', b: 'barcode', i: 'image', l: 'line', s: 'shape' }[k];
      if (quick) {
        if (e.repeat) { e.preventDefault(); return; }
        addElement(quick);
        e.preventDefault();
        return;
      }
      if (k === 'g') {
        Editor.state.showGrid = !Editor.state.showGrid;
        renderAll();
        log(Editor.state.showGrid ? t('grid_on') : t('grid_off'));
        e.preventDefault();
        return;
      }
      if (k === 'v') {
        Editor.state.selected = null;
        refreshAll();
        e.preventDefault();
        return;
      }
      if (e.key === '1') {
        applyZoom(1);
        e.preventDefault();
        return;
      }
    }

    if (!sel) return;

    const step = e.shiftKey ? 10 : 1;
    const rep = e.repeat;
    let moved = false;
    switch (e.key) {
      case 'ArrowLeft':  sel.x -= step; moved = true; break;
      case 'ArrowRight': sel.x += step; moved = true; break;
      case 'ArrowUp':    sel.y -= step; moved = true; break;
      case 'ArrowDown':  sel.y += step; moved = true; break;
    }
    if (moved) {
      beginHistoryBurst();
      const m = Editor.measure(sel);
      sel.x = Math.max(-m.w, Math.min(Editor.widthDots(), sel.x));
      sel.y = Math.max(-m.h, Math.min(Editor.heightDots(), sel.y));
      sel.x = Math.round(sel.x); sel.y = Math.round(sel.y);
      refreshAll();
      if (!rep) log(t('moving', { x: sel.x, y: sel.y }));
      e.preventDefault();
      return;
    }

    if (e.key === 'Enter') { e.preventDefault(); return; }

    if (ctrl && e.key === 'ArrowUp') { $('#toolLayerUp').click(); e.preventDefault(); return; }
    if (ctrl && e.key === 'ArrowDown') { $('#toolLayerDown').click(); e.preventDefault(); return; }

    if (e.key === '+' || e.key === '=') { beginHistoryBurst(); Editor.nudgeScale(1.15); refreshAll(); e.preventDefault(); return; }
    if (e.key === '-') { beginHistoryBurst(); Editor.nudgeScale(0.87); refreshAll(); e.preventDefault(); return; }

    if (e.key === 'r' || e.key === 'R' || e.key === 'к' || e.key === 'К') {
      beginHistoryBurst();
      sel.rotation = ((sel.rotation || 0) + 90) % 360;
      refreshAll();
      e.preventDefault();
    }
  });

  // ------------------------------------------------------ инфо об устройстве ---
  const devEls = {
    name: $('#devName'),
    battery: $('#devBattery'),
    batteryBar: $('#devBatteryBar'),
    paper: $('#devPaper'),
    paperBar: $('#devPaperBar'),
    version: $('#devVersion'),
    sn: $('#devSN'),
    mac: $('#devMAC'),
    status: $('#devStatus'),
    shutInput: $('#devShutInput'),
  };

  const setVal = (el, html) => { el.innerHTML = html; };
  const dash = () => `<span class="muted">—</span>`;

  /** Последовательный опрос атрибутов (как getNextAttrIfNeed в DeviceDetailActivity). */
  let devQuerySeq = 0; // инкремент при каждом новом опросе — отменяет прежний
  async function queryDeviceInfo() {
    if (!port.connected) return;
    const seq = ++devQuerySeq;
    const name = port.device.name || '';
    devEls.name.textContent = name;
    // сброс
    setVal(devEls.battery, dash()); devEls.batteryBar.style.width = '0%';
    setVal(devEls.paper, dash()); devEls.paperBar.style.width = '0%';
    setVal(devEls.version, dash());
    setVal(devEls.sn, dash());
    setVal(devEls.mac, dash());
    setVal(devEls.status, dash());

    // блокируем кнопки на время опроса
    const modal = els.deviceModal;
    modal.querySelectorAll('button, input').forEach(b => { b.disabled = true; });
    const done = () => {
      if (seq === devQuerySeq) modal.querySelectorAll('button, input').forEach(b => { b.disabled = false; });
    };

    // опрос с короткими таймаутами; если первые команды без ответа — прекращаем
    let noReply = 0;
    const step = async (cmd, parse, timeout = 1200) => {
      try {
        const reply = await port.command(cmd, timeout);
        if (seq !== devQuerySeq) return null; // опрос отменён
        if (reply && reply.length) { noReply = 0; return parse(reply); }
        noReply++;
        return null;
      } catch (_) { noReply++; return null; }
    };

    // статус (10 FF 40 → [FF, код]; fallback — детальный 1F 20 00 с флагами)
    const stKey = await step(AM.CMD.queryStatus(), (v) => AM.Parsers.status(v));
    if (stKey != null) {
      const isOk = stKey === 'ok' || stKey === 'cover_closed';
      setVal(devEls.status, `<span class="${isOk ? 'ok' : 'crit'}">${t('status_' + stKey)}</span>`);
    } else {
      const detKey = await step(AM.CMD.queryDetailedStatus(), (v) => AM.Parsers.status(v));
      if (detKey != null) {
        const isOk = detKey === 'ok' || detKey === 'cover_closed';
        setVal(devEls.status, `<span class="${isOk ? 'ok' : 'crit'}">${t('status_' + detKey)}</span>`);
      } else {
        setVal(devEls.status, `<span class="muted">${t('no_reply')}</span>`);
      }
    }

    // батарея
    const bat = await step(AM.CMD.queryBattery(), (v) => AM.Parsers.battery(v, name));
    if (seq !== devQuerySeq) return done();
    if (noReply >= 2) { // принтер молчит — не дёргаем дальше
      log(t('no_reply'), 'warn');
      return done();
    }
    if (bat != null) {
      const cls = bat <= 20 ? 'crit' : (bat <= 50 ? 'low' : 'ok');
      setVal(devEls.battery, `<span class="${cls}">${bat}%</span>`);
      devEls.batteryBar.style.width = Math.min(100, bat) + '%';
      devEls.batteryBar.style.background = bat <= 20
        ? 'linear-gradient(90deg, var(--err), #ff8a8a)'
        : bat <= 50
          ? 'linear-gradient(90deg, var(--warn), #f0c46a)'
          : 'linear-gradient(90deg, var(--ok), #7ed9a0)';
    } else {
      setVal(devEls.battery, `<span class="muted">${t('no_reply')}</span>`);
    }

    // версия прошивки
    const ver = await step(AM.CMD.queryVersion(), (v) => AM.Parsers.version(v));
    if (seq !== devQuerySeq) return done();
    setVal(devEls.version, ver ? escapeHtml(ver) : `<span class="muted">${t('no_reply')}</span>`);

    // SN
    const sn = await step(AM.CMD.querySN(), (v) => AM.Parsers.sn(v));
    if (seq !== devQuerySeq) return done();
    setVal(devEls.sn, sn ? escapeHtml(sn) : `<span class="muted">${t('no_reply')}</span>`);

    // MAC
    const mac = await step(AM.CMD.queryMAC(), (v) => AM.Parsers.mac(v));
    if (seq !== devQuerySeq) return done();
    setVal(devEls.mac, mac ? escapeHtml(mac) : `<span class="muted">${t('no_reply')}</span>`);

    // остаток бумаги (mileage) — есть не у всех моделей
    const mil = await step(AM.CMD.queryMileage(), (v) => AM.Parsers.mileage(v), 1800);
    if (seq !== devQuerySeq) return done();
    if (mil) {
      const cls = mil.percent <= 5 ? 'crit' : (mil.percent <= 15 ? 'low' : 'ok');
      setVal(devEls.paper, `<span class="${cls}">${mil.percent}%</span> <span class="muted small">(${mil.remain}/${mil.capacity} m)</span>`);
      devEls.paperBar.style.width = Math.min(100, mil.percent) + '%';
    } else {
      setVal(devEls.paper, `<span class="muted">${t('paper_unknown')}</span>`);
    }

    // время автоотключения
    const shut = await step(AM.CMD.queryShutTime(), (v) => AM.Parsers.shutTime(v, name));
    if (seq !== devQuerySeq) return done();
    if (shut != null && shut > 0) devEls.shutInput.value = shut;
    done();
  }

  $('#btnDeviceInfo').addEventListener('click', () => {
    openModal(els.deviceModal);
    queryDeviceInfo();
  });
  $('#btnDevRefresh').addEventListener('click', () => queryDeviceInfo());
  // закрытие модалки отменяет текущий опрос
  els.deviceModal.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]') || e.target === els.deviceModal) devQuerySeq++;
  });

  // установка времени автоотключения: 10 FF 12 hi lo, ответ «OK»
  $('#btnSetShut').addEventListener('click', async () => {
    if (!port.connected) return;
    const min = Math.max(1, Math.min(120, parseInt(devEls.shutInput.value, 10) || 15));
    devEls.shutInput.value = min;
    try {
      const reply = await port.command(AM.CMD.setShutTime(min), 4000);
      const okReply = reply && Array.from(reply, b => (b >= 32 && b < 127) ? String.fromCharCode(b) : '').join('').trim();
      if (okReply === 'OK' || (reply && (reply[0] === 0xaa || reply[0] === 0x4f))) {
        log(t('shutdown_set_ok') + ` (${min} ${t('shutdown_min')})`, 'ok');
      } else {
        // некоторые прошивки не отвечают на set — считаем успешно, если не было ошибки
        log(t('shutdown_set_ok') + ` (${min} ${t('shutdown_min')})`);
      }
    } catch (e) {
      log(t('shutdown_set_fail'), 'err');
    }
  });

  // ------------------------------------------------------ сервисные операции ---
  /** Отправить команду и залогировать hex-ответ. */
  async function sendSvc(cmd, successMsg, timeout = 3000) {
    if (!port.connected) return;
    try {
      const reply = await port.command(cmd, timeout);
      if (reply && reply.length) {
        const txt = Array.from(reply, b => (b >= 32 && b < 127) ? String.fromCharCode(b) : '').join('').trim();
        log(`${successMsg} · ${t('raw_reply')}: ${AM.hex(reply)}${txt ? ' («' + txt + '»)' : ''}`, 'ok');
      } else {
        log(successMsg, 'ok');
      }
    } catch (e) {
      log(`${successMsg}: ${e.message}`, 'warn');
    }
  }

  $('#svcCalibrate').addEventListener('click', () => sendSvc(AM.CMD.calibrate(), t('calibrate_done'), 8000));
  $('#svcLearnGap').addEventListener('click', () => sendSvc(AM.CMD.learnGap(), t('learn_gap_done'), 8000));
  $('#svcBeep').addEventListener('click', () => sendSvc(AM.CMD.beep(), t('beep')));
  let screenOn = true;
  $('#svcScreen').addEventListener('click', async () => {
    screenOn = !screenOn;
    await sendSvc(AM.CMD.screenOn(screenOn), screenOn ? t('screen_on') : t('screen_off'));
    $('#svcScreen').textContent = screenOn ? t('screen') + ': ON' : t('screen') + ': OFF';
  });
  $('#svcSyncTime').addEventListener('click', async () => {
    const d = new Date();
    await sendSvc(AM.CMD.setTime(d.getHours(), d.getMinutes(), d.getSeconds()), t('sync_time_done'));
  });
  $('#svcFeedMark').addEventListener('click', () => sendSvc(AM.CMD.feedToBlackMark(), t('feed_to_mark')));
  $('#svcInduction').addEventListener('click', () => sendSvc(AM.CMD.inductionPrint(), t('induction')));
  $('#svcFactoryReset').addEventListener('click', async () => {
    if (!confirm(t('factory_reset_confirm'))) return;
    await sendSvc(AM.CMD.factoryReset(), t('factory_reset_done'), 5000);
  });

  // ------------------------------------------------------ BT-консоль ---
  async function sendHex() {
    if (!port.connected) return;
    const raw = $('#hexInput').value;
    const bytes = AM.parseHex(raw);
    if (!bytes) { log(t('bad_hex'), 'err'); return; }
    log(t('sent_cmd', { h: AM.hex(bytes) }));
    try {
      const reply = await port.command(bytes, 3000);
      if (reply && reply.length) {
        const txt = Array.from(reply, b => (b >= 32 && b < 127) ? String.fromCharCode(b) : '').join('').trim();
        log(`${t('raw_reply')} ← ${AM.hex(reply)}${txt ? ' «' + txt + '»' : ''}`, 'rx');
      }
    } catch (e) {
      log(`${t('error')}: ${e.message}`, 'err');
    }
  }
  $('#btnHexSend').addEventListener('click', sendHex);
  $('#hexInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendHex();
  });
  $$('.console-presets [data-hex]').forEach(btn => {
    btn.addEventListener('click', () => {
      $('#hexInput').value = btn.dataset.hex;
      sendHex();
    });
  });

  // ------------------------------------------------------ печать/превью ---
  function buildMonoFor(copyIndex) {
    const scale = Editor.renderScale();
    const raster = Editor.rasterizeCopy(copyIndex, scale);
    const imgData = raster.getContext('2d').getImageData(0, 0, raster.width, raster.height);
    const mode = els.selRender.value;
    const mono = mode === 'photo'
      ? AM.imageDataTo1bppDither(imgData, raster.width, raster.height)
      : AM.imageDataTo1bpp(imgData, raster.width, raster.height);
    mono.srcWidth = raster.width;
    mono.srcHeight = raster.height;
    mono.scale = scale;
    return mono;
  }

  function hasIncremental() {
    return Editor.state.elements.some(e =>
      (e.type === 'serial') || (e.type === 'barcode' && e.increment));
  }

  $('#btnPreview').addEventListener('click', () => {
    const mono = buildMonoFor(0);
    Editor.state.zoom = 2;
    Editor.renderMono(els.previewCanvas, mono);
    Editor.state.zoom = 4;
    const copies = Math.max(1, parseInt(els.numCopies.value, 10) || 1);
    let info = `— ${Editor.state.labelWmm}×${Editor.state.labelHmm} mm · ${mono.srcWidth}×${mono.srcHeight} px · ${dirText(effectiveDirection())}`;
    if (hasIncremental() && copies > 1) {
      const serialEl = Editor.state.elements.find(e => e.type === 'serial') ||
                       Editor.state.elements.find(e => e.type === 'barcode' && e.increment);
      info += ` · ${Editor.applySequence(serialEl, 0).text} … ${Editor.applySequence(serialEl, copies - 1).text}`;
    }
    els.previewInfo.textContent = info;
    openModal(els.previewModal);
  });

  async function doPrint() {
    if (!port.connected) {
      log(t('printer_not_connected'), 'warn');
      els.connectModal.classList.remove('hidden');
      return;
    }

    const direction = effectiveDirection();
    const opts = {
      protocol: selectedProtocol(),
      density: parseInt(els.rngDensity.value, 10),
      copies: Math.max(1, parseInt(els.numCopies.value, 10) || 1),
      paperType: parseInt(els.selPaperType.value, 10),
      feedDots: parseInt(els.numFeed.value, 10) || 0,
      compressed: els.chkCompressed.checked ? true : null,
    };

    const incremental = hasIncremental();
    const serialEl = Editor.state.elements.find(e => e.type === 'serial') ||
                     Editor.state.elements.find(e => e.type === 'barcode' && e.increment);
    if (incremental) log(t('incremental_print', { n: opts.copies }));

    els.btnPrint.disabled = true;
    els.btnPrint.textContent = t('sending') + '…';
    try {
      let totalBytes = 0;
      for (let copy = 0; copy < opts.copies; copy++) {
        const mono = buildMonoFor(copy);
        if (!mono.height) { log(t('empty_label'), 'warn'); return; }
        const rotated = AM.rotate1bpp(mono, direction);
        const copyOpts = incremental ? { ...opts, copies: 1 } : opts;
        // preamble/bulk: setup отдельно, затем пауза на пополнение кредитов,
        // затем растр непрерывным потоком (как Printer.printBitmap в thermoprint)
        const parts = AM.buildPrintParts(rotated, copyOpts)[0];
        totalBytes += parts.preamble.length + parts.bulk.length;

        log(t('print_log', {
          w: Editor.state.labelWmm, h: Editor.state.labelHmm,
          sw: mono.srcWidth, sh: mono.srcHeight, sc: mono.scale,
          d: dirText(direction), rw: rotated.bpr * 8, rh: rotated.height,
          p: opts.protocol, n: parts.preamble.length + parts.bulk.length,
        }) + (incremental ? ' · ' + t('copy_log', { i: copy + 1, n: opts.copies }) +
              (serialEl ? ' · ' + Editor.applySequence(serialEl, copy).text : '') : ''));
        if (copy > 0) await AM.sleep(300);
        if (parts.preamble.length) {
          await port.write(parts.preamble, (pct) => {
            els.btnPrint.textContent = `${t('sending')} ${pct}%`;
          });
          // даём принтеру обработать setup и вернуть кредиты — растр пойдёт без «дыр»
          await port.waitForCredits(3, 1000);
        }
        await port.write(parts.bulk, (pct) => {
          els.btnPrint.textContent = incremental
            ? `${t('copy_log', { i: copy + 1, n: opts.copies })} · ${pct}%`
            : `${t('sending')} ${pct}%`;
          els.progressBar.style.width = pct + '%';
        });
      }
      els.btnPrint.textContent = t('sent');
      els.printStatus.textContent = t('sent');
      log(t('sent_bytes', { n: totalBytes }), 'ok');

      const reply = await new Promise((resolve) => {
        // разрыв после отправки всех данных = неявный успех:
        // принтер отпечатал и выключился (как waitForPrintResult в thermoprint)
        const offDisc = port.onceDisconnect(() => { resolve({ implicit: true }); });
        const timer = setTimeout(() => {
          const i = port._rxListeners.indexOf(fn);
          if (i >= 0) port._rxListeners.splice(i, 1);
          offDisc();
          resolve(null);
        }, 5000);
        const fn = (v) => {
          clearTimeout(timer);
          offDisc();
          const i = port._rxListeners.indexOf(fn);
          if (i >= 0) port._rxListeners.splice(i, 1);
          resolve(v);
        };
        port._rxListeners.push(fn);
      });
      if (reply && (reply.implicit || reply[0] === 0xaa || reply[0] === 0x4f || reply[0] === 0x4b)) {
        log(reply.implicit ? t('ack_implicit') : t('ack_ok'), 'ok');
        els.btnPrint.textContent = t('done_ok');
        els.printStatus.textContent = t('done_ok');
      } else {
        log(t('ack_none'), 'warn');
        els.printStatus.textContent = t('sent');
      }
    } catch (e) {
      log(`${t('error')}: ${e.message}`, 'err');
      els.btnPrint.textContent = t('error');
      els.printStatus.textContent = t('error');
    } finally {
      setTimeout(() => {
        els.btnPrint.disabled = false;
        els.btnPrint.textContent = t('print');
        els.progressBar.style.width = '0%';
      }, 1200);
    }
  }

  els.btnPrint.addEventListener('click', doPrint);
  els.btnPrint2.addEventListener('click', () => { closeModal(els.previewModal); doPrint(); });

  // ------------------------------------------------------ шаблоны ---
  const ICONS = {
    text: 'T', serial: '#', date: '🕐', qr: '▣', barcode: '|||',
    image: '🖼', line: '─', shape: '▭', table: '▦',
  };
  const tplIcon = (data) => {
    const el = (data && data.elements && data.elements[0]) || {};
    return ICONS[el.type] || '📄';
  };

  function renderTplList() {
    const list = els.tplList;
    list.innerHTML = '';
    const tpls = Templates.list();
    if (!tpls.length) {
      const empty = document.createElement('div');
      empty.className = 'tpl-empty';
      empty.textContent = t('no_templates');
      list.appendChild(empty);
      return;
    }
    for (const tpl of tpls) {
      const item = document.createElement('div');
      item.className = 'tpl-item';
      const nElems = (tpl.data && tpl.data.elements ? tpl.data.elements.length : 0);
      const dateStr = new Date(tpl.date).toLocaleString();
      item.innerHTML = `
        <span class="tpl-ico">${tplIcon(tpl.data)}</span>
        <div class="tpl-info">
          <span class="tpl-name">${escapeHtml(tpl.name)}</span>
          <span class="tpl-meta">${nElems} ${t('elements_count')} · ${t('created')} ${dateStr} · ${tpl.data.labelWmm}×${tpl.data.labelHmm} mm</span>
        </div>`;
      const btnUse = document.createElement('button');
      btnUse.className = 'btn';
      btnUse.textContent = t('use_template');
      btnUse.addEventListener('click', () => {
        pushHistory();
        Editor.deserialize(tpl.data);
        Editor.state.selected = null;
        els.numLabelW.value = Editor.state.labelWmm;
        els.numLabelH.value = Editor.state.labelHmm;
        refreshAll();
        closeModal(els.templatesModal);
        log(t('template_loaded', { n: tpl.name }), 'ok');
      });
      const btnExport = document.createElement('button');
      btnExport.className = 'btn';
      btnExport.textContent = t('export_template');
      btnExport.addEventListener('click', () => {
        const file = Templates.exportOne(tpl);
        log(t('export_done', { f: file }), 'ok');
      });
      const btnDelete = document.createElement('button');
      btnDelete.className = 'btn danger';
      btnDelete.textContent = t('delete');
      btnDelete.addEventListener('click', () => {
        if (confirm(t('confirm_delete_template', { n: tpl.name }))) {
          Templates.remove(tpl.id);
          renderTplList();
          log(t('template_deleted', { n: tpl.name }));
        }
      });
      item.appendChild(btnUse);
      item.appendChild(btnExport);
      item.appendChild(btnDelete);
      list.appendChild(item);
    }
  }

  // сохранить текущий макет как шаблон
  $('#btnTplSave').addEventListener('click', () => {
    const name = els.tplNameInput.value.trim();
    if (!name) { els.tplNameInput.focus(); return; }
    const existing = Templates.list().find(x => x.name === name);
    if (existing && !confirm(t('template_overwrite', { n: name }))) return;
    const tpl = Templates.save(name, Editor.serialize(), existing ? existing.id : null);
    els.tplNameInput.value = '';
    renderTplList();
    log(t('template_saved', { n: tpl.name }), 'ok');
  });
  els.tplNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#btnTplSave').click();
  });

  // экспорт всех
  $('#btnTplExportAll').addEventListener('click', () => {
    const file = Templates.exportAll();
    if (file) log(t('export_done', { f: file }), 'ok');
    else log(t('no_templates'), 'warn');
  });

  // импорт из файла
  els.tplFileInput.addEventListener('change', () => {
    const file = els.tplFileInput.files[0];
    if (!file) { log(t('import_no_file'), 'warn'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const { imported, skipped } = Templates.importJson(reader.result, { overwrite: true });
        if (imported.length) {
          renderTplList();
          for (const tpl of imported) log(t('import_done', { n: tpl.name }), 'ok');
          if (skipped.length) log(t('import_failed') + `: ${skipped.map(s => s.name).join(', ')}`, 'warn');
        } else {
          log(t('import_failed'), 'err');
        }
      } catch (e) {
        log(`${t('import_failed')}: ${t('wrong_file')}`, 'err');
      }
    };
    reader.onerror = () => log(t('import_failed'), 'err');
    reader.readAsText(file);
    els.tplFileInput.value = '';
  });
  $('#btnTplImport').addEventListener('click', () => els.tplFileInput.click());

  // ------------------------------------------------------ сохранить/загрузить ---
  $('#btnSave').addEventListener('click', () => {
    localStorage.setItem('ablemark.label', Editor.serialize());
    log(t('label_saved'), 'ok');
  });
  $('#btnLoad').addEventListener('click', () => {
    const s = localStorage.getItem('ablemark.label');
    if (!s) { log(t('no_saved'), 'warn'); return; }
    pushHistory();
    Editor.deserialize(s);
    syncPaperInputs();
    refreshAll();
    log(t('label_loaded'), 'ok');
  });

  // ------------------------------------------------------ настройки ---
  function updateDensityLabel() {
    els.densityLabel.textContent = [t('density_0'), t('density_1'), t('density_2')][els.rngDensity.value];
  }
  els.rngDensity.addEventListener('input', updateDensityLabel);
  els.selRender.addEventListener('change', () => {
    log(`${t('render_mode')}: ${els.selRender.value === 'photo' ? t('render_photo_log') : t('render_sharp_log')}`);
  });

  // ------------------------------------------------------------------- init ---
  function updateWsBadge() {
    if (!AM.AbleMarkPort.available()) {
      els.wsBadge.textContent = `Web Bluetooth: ${t('web_bt_unavailable')}`;
      log(t('bt_no_support'), 'warn');
    } else {
      navigator.bluetooth.getAvailability().then(ok => {
        els.wsBadge.textContent = `Web Bluetooth: ${ok ? t('web_bt_ready') : t('web_bt_no_adapter')}`;
        els.wsBadge.className = 'badge' + (ok ? ' on' : ' muted-badge');
      });
    }
  }

  // i18n: переводим статические элементы + optgroup'ы
  I18N.apply();
  document.querySelectorAll('[data-i18n-label]').forEach(el => { el.label = t(el.dataset.i18nLabel); });

  // стартовый шаблон
  Editor.add('text', { text: 'AbleMark Web', fontSize: 40, bold: true });
  Editor.add('text', { text: t('app_sub'), fontSize: 26 });
  Editor.add('qr', { text: 'https://example.com', module: 3 });
  refreshAll();
  updateDensityLabel();
  updateWsBadge();
  log('AbleMark V1.4.1 reverse-engineered · PROTOCOL.md');

  // отладочный хук для тестов
  window.__am = { renderAll, refreshAll, renderLayers, refreshProps, doPrint, buildMonoFor, openProps: refreshProps, port, queryDeviceInfo, undo, redo, pushHistory };
})();
