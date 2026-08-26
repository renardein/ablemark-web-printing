/**
 * templates.js — сохранение/загрузка/импорт/экспорт шаблонов наклеек.
 * Хранение: localStorage (ablemark.templates) — массив {id, name, date, data}.
 * Экспорт: файл .amlbl (JSON), одиночный шаблон или все сразу.
 */
'use strict';

const Templates = (() => {

  const LS_KEY = 'ablemark.templates';
  const EXT = 'amlbl';
  const FORMAT = 'ablemark-label/1';

  /** Список шаблонов (свежие сверху). */
  function list() {
    try {
      const arr = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch (_) { return []; }
  }

  function saveAll(arr) {
    localStorage.setItem(LS_KEY, JSON.stringify(arr));
  }

  /** Нормализация данных шаблона: Editor.serialize() возвращает строку — парсим. */
  function normalizeData(data) {
    if (typeof data === 'string') {
      try { return JSON.parse(data); } catch (_) { return null; }
    }
    return data || null;
  }

  /**
   * Сохранить текущий макет как шаблон.
   * @param {string} name название
   * @param {object|string} labelData данные Editor.serialize() (объект или JSON-строка)
   * @param {string|null} existingId — если задан, перезаписать шаблон
   * @returns {object} сохранённый шаблон
   */
  function save(name, labelData, existingId) {
    const arr = list();
    const now = new Date().toISOString();
    const data = normalizeData(labelData) || { labelWmm: 40, labelHmm: 30, dpi: 8, elements: [] };
    let tpl;
    if (existingId) {
      tpl = arr.find(x => x.id === existingId);
    }
    if (tpl) {
      tpl.name = name;
      tpl.date = now;
      tpl.data = data;
    } else {
      tpl = {
        id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        name: name || 'Template',
        date: now,
        data,
      };
      arr.unshift(tpl);
    }
    saveAll(arr);
    return tpl;
  }

  function get(id) {
    const tpl = list().find(x => x.id === id) || null;
    if (tpl) tpl.data = normalizeData(tpl.data) || tpl.data;
    return tpl;
  }

  function remove(id) {
    const arr = list();
    const i = arr.findIndex(x => x.id === id);
    if (i < 0) return null;
    const [removed] = arr.splice(i, 1);
    saveAll(arr);
    return removed;
  }

  // ------------------------------------------------------------- экспорт ---
  /** Объект-файл для одного шаблона. */
  function exportPayload(tpl) {
    return {
      format: FORMAT,
      exported: new Date().toISOString(),
      templates: [tpl],
    };
  }

  /** Скачать файл .amlbl. */
  function download(fileName, payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** Безопасное имя файла. */
  function safeName(name) {
    return (name || 'template')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60) || 'template';
  }

  /**
   * Экспорт одного шаблона в файл .amlbl.
   * @returns {string} имя файла
   */
  function exportOne(tpl) {
    const fileName = `${safeName(tpl.name)}.${EXT}`;
    download(fileName, exportPayload(tpl));
    return fileName;
  }

  /** Экспорт всех шаблонов. @returns {string|null} имя файла или null, если пусто. */
  function exportAll() {
    const arr = list();
    if (!arr.length) return null;
    const fileName = `ablemark-templates-${new Date().toISOString().slice(0, 10)}.${EXT}`;
    download(fileName, { format: FORMAT, exported: new Date().toISOString(), templates: arr });
    return fileName;
  }

  // ------------------------------------------------------------- импорт ---
  /**
   * Импорт шаблонов из JSON-строки (файл .amlbl или экспортированный ранее).
   * @param {string} jsonText
   * @param {object} opts { overwrite: bool } — перезаписывать совпадающие по имени
   * @returns {{imported: object[], skipped: object[]}}
   */
  function importJson(jsonText, opts = {}) {
    const parsed = JSON.parse(jsonText); // бросит исключение при невалидном JSON
    let incoming = null;
    if (Array.isArray(parsed)) {
      // допускаем и голый массив
      incoming = parsed;
    } else if (parsed && Array.isArray(parsed.templates)) {
      incoming = parsed.templates;
    } else if (parsed && parsed.format === FORMAT && parsed.data) {
      // одиночный шаблон без обёртки
      incoming = [parsed];
    } else if (parsed && parsed.labelWmm && parsed.elements) {
      // просто данные макета — оборачиваем
      incoming = [{ id: 't' + Date.now().toString(36), name: 'Imported ' + new Date().toLocaleDateString(), date: new Date().toISOString(), data: parsed }];
    }
    if (!incoming) throw new Error('invalid format');

    const valid = incoming.filter(x => x && x.data && x.data.elements);
    if (!valid.length) throw new Error('invalid format');

    const arr = list();
    const imported = [], skipped = [];
    for (const tpl of valid) {
      const clean = {
        id: tpl.id || ('t' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)),
        name: String(tpl.name || 'Template').slice(0, 100),
        date: tpl.date || new Date().toISOString(),
        data: normalizeData(tpl.data) || tpl.data,
      };
      // картинка не сериализуется в файл — данные без img валидны
      const existing = arr.findIndex(x => x.name === clean.name);
      if (existing >= 0) {
        if (opts.overwrite) {
          clean.id = arr[existing].id; // сохраняем id, чтобы не плодить дубли
          arr[existing] = clean;
          imported.push(clean);
        } else {
          skipped.push(clean);
        }
      } else {
        arr.unshift(clean);
        imported.push(clean);
      }
    }
    saveAll(arr);
    return { imported, skipped };
  }

  return { EXT, list, save, get, remove, exportOne, exportAll, importJson };
})();
