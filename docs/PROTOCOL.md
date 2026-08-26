# AbleMark (com.feioou.deliprint.ablemark) — Reverse Engineering

Приложение для печати на Bluetooth термопринтерах (этикетки/чеки).
Версия: V1.4.1(1) (versionCode 16), XAPK из APKPure.

## Источники (классы оригинального приложения)

| Компонент | Класс |
|---|---|
| SDK транспорта | `com.yxqapp.sdk.BluetoothPort` |
| Команды принтера | `com.yxqapp.sdk.CommandPort`, `PrintL11`, `Printer_ESC`, `Printer_TSPL` |
| Протоколы устройств | `com.feioou.deliprint.yxq.factory.protocol.*` |
| Zlib-сжатие | `libyxqzlib.so` (export `code`) |
| Константы ESC/FS/GS | `com.google.common.base.a` (E=0x1B, F=0x1C, G=0x1D, I=0x1F) |

## 1. Транспорт

### 1.1 Bluetooth Classic (SPP) — НЕ поддерживается браузерами
- RFCOMM SPP UUID: `00001101-0000-1000-8000-00805F9B34FB`
- Используется для D100/D200/S8/A50 и др.

### 1.2 BLE (GATT) — то, что доступно в браузере (Web Bluetooth)

**Сервис A** (основной, «L»-серия: P11/P12/P15/P7/P50/M57/S2/L11/R15 и т.д.):
```
Service  0000ff00-0000-1000-8000-00805f9b34fb
  ff01 — READ/NOTIFY  (принтер → хост, ответы/статус)
  ff02 — WRITE        (хост → принтер, команды; write-with-response)
  ff03 — NOTIFY       (управление: credit flow-control + MTU)
```

**Сервис B** (P80/P80S/T3):
```
Service  49535343-fe7d-4ae5-8fa9-9fafd205e455
  49535343-1e4d-4bd9-ba61-23c647249616 — NOTIFY (принтер → хост)
  49535343-8841-43f4-a8d4-ecbe34729bb3 — WRITE  (хост → принтер)
```

**Сервис C** (скан-библиотека heaton Ble, некоторые модели):
```
Service 0000fd00-...  write: fd01, read: fd02, notify: fd03
```

### 1.3 Flow control (кредитный), только для сервиса ff00

На характеристике **ff03** принтер присылает уведомления:
- `01 04` — начальные 4 кредита (приходит сразу после подписки)
- `01 xx` — пополнение кредитов на xx
- `02 lo hi` — MTU (LE16). Размер пакета = MTU − 3 (по умолчанию 240 → 237)

Каждый записанный в ff02 пакет (до 237 байт) расходует 1 кредит.
Пока credit == 0 — ждать пополнения. При отсутствии ff03 (сервис B) — слать пакеты подряд, дожидаясь завершения write-колбэка.

Значение `size` по моделям (старый flow control): P12/LP90/P11 → 90; P15/P50/S2/LP15/HarmonyOS → 95; иначе 237.

## 2. Протокол печати

### 2.1 «L»-серия / R15 (protocolType 11) — этикетки с гэпом

```
1F 70 02 d          ; setDensity: d = 0(светлая)|1(норма)|2(тёмная)
00 × 15             ; wakeup (15 нулей)
10 FF F1 02         ; enablePrinter (start print job)
1D 76 30 m wL wH hL hH <data>   ; GS v 0 — растровый, m=0, w=bytesPerRow (LE), h=height (LE)
1B 4A 64            ; ESC J 100 — прогон 100 точек (paperType=1)
10 FF F1 45         ; stopPrintJob
```
1bpp MSB-first, порог <128 (по яркости 0.299R+0.587G+0.114B в PrintL11; либо avg<128 в CommandPort).

### 2.2 «L»-серия — непрерывная бумага (paperType=2), с zlib

```
1F 70 02 d
00 × 15
10 FF F1 02
1F 10 bprH bprL hH hL len(4B BE) <zlib(data)>   ; bpr = bytesPerRow, len = длина сжатых данных
1D 0C                                            ; GS FF — прогон до метки
10 FF F1 45
```

### 2.3 P50/S2/D210 (protocolType 2/3/8/9)

```
00 × 6              ; wakeup
1F 70 t d           ; setDensity(type, value)
1F C0 01 00         ; startPrintjob
1F 11 51            ; adjustPositionAuto(81) — калибровка позиции (только первая копия)
1F 10 bprH bprL hH hL len(4B BE) <zlib(data)>
1F 12 20 00         ; printerLocation(32, 0)
1F C0 01 01         ; stopPrintjob
1F 11 50            ; adjustPositionAuto(80) — на последней копии
```

### 2.4 ESC/POS (receipt-принтеры)
- `1B 40` init, `1D 76 30 m ...` растр, `1B 4A n` прогон, `1B 64 n` прогон строк, `1B E n` bold, `1D 21 n` размер, `1D 6C ...` QR (кастомный).

### 2.5 TSPL (S8-подобные)
Текстовые команды `SIZE/CLS/TEXT/BARCODE/QRCODE/BITMAP/PRINT\r\n` (GB2312).

## 3. Zlib-сжатие (`1F 10`)

`YxqZLib.code(data, windowBits, bufSize, level)` → `deflateInit2(level, Z_DEFLATED, windowBits, memLevel=8, strategy=0)`.
- CommandPort: windowBits=14, level=6
- DFunction: windowBits=10, level=6
→ обычный **zlib-поток с заголовком** (78 xx). В браузере: pako.deflate(data, {windowBits:14, level:6}).

## 4. Служебные команды (0x10FF…)

| Команда | Ответ | Назначение |
|---|---|---|
| `10 FF 3D` | байт статуса (биты: 1=печать, 2=крышка, 4=нет бумаги, 8=батарея, 16=перегрев) | статус (YXQProtocolTools.getDeviceStatusErrorCode) |
| `10 FF 20 F0` | строка | инфо о принтере |
| `10 FF 20 F1` | строка / JSON `{"sw":"…"}` | версия прошивки |
| `10 FF 20 F2` | строка / JSON `{"SN":"…"}` (5838…→X8…) | серийный номер |
| `10 FF 20 F3` | 6 hex-байт | MAC-адрес |
| `10 FF 50 F1` | `[.., N]` (LP90 `[..,..,..,..,N]`, X8 JSON `{"bat":N}`) | уровень батареи |
| `10 FF 13` | L-серия `[N, ..]`, прочие `[.., N]` | автоотключение (get) |
| `10 FF 12 hi lo` | `OK` | автоотключение (set, минуты BE) |
| `1A 1F 06` | `1A 1F 07 .. cap hi cap lo rem hi rem lo sum` (sum=сумма байт 3..6; cap BE, rem LE) | остаток бумаги (mileage) |
| `10 FF F1 02` / `10 FF F1 45` | | enable / stop print job (L-серия) |
| `10 FF F1 03` | | enable (S8) |
| `1A 1F 01` | | индукционная печать |

ACK успешной печати: ответ, начинающийся с `AA` | `O` | `K`.

## 5. Прочее

- Ширина печати по умолчанию 384 точек (48 мм @ 8 dot/mm); S2 Pro/X2 Pro — 11.8 dot/mm.
- Список имён BLE-устройств начинается с: P11/P12/P15/P7/P50/P80/S2/S8/S15/M1/M57/M60/A1/A50/D100/D200/D210/X2/X4/X8/LP15/LP90/L100/L11/R15/YEW12/U210/HM-24-28/J-28/T2/T3/A31/GD-88 …
- Печать: приложение рендерит этикетку в Bitmap (ARGB_8888) → дизеринг-порог 128 → 1bpp MSB-first → команды выше.

## 5. Ориентация и размеры наклеек (LabelPrintActivity / DeviceStyle)

**paperDirection** (0–3) — направление печати, применяется поворотом растра перед отправкой
(`Matrix.postRotate`):
| Значение | Стрелка | Поворот растра |
|---|---|---|
| 0 | ← | +90° CW |
| 1 | → | −90° (CCW) |
| 2 | ↑ | 0° |
| 3 | ↓ | 180° |

При повороте ±90° ширина/высота меняются местами (`i17 = height*8`, `i18 = width*8`).

**Дефолты по моделям** (DeviceStyle.defaultDirection / LabelPrintActivity):
- L-серия (P11/P12/P15/P7/P1S/M1/S15/S12/A1/LP15/LP90/LPC74/YEW12/Silvertec/BRBGP12) → **1**
- P50/P5OS/PS50/P50S/T2/T3/P80/P80S/S2/Jammuk_S2/ET-Z05xx/LuckP_D1/M50/M57/X2/X2 Pro/M60/M50ByP50 → **2**
- D100/D200/X4/L100 → **3**

**Разрешение**: 8 dot/mm (S2 Pro / X2 Pro — 11.8, D210H — 12).
**Размер наклейки** по умолчанию: P50/X2 — 40×30, S2/M50/Jammuk/ET-Z0535 — 50×30 мм.

**paperType**: 1 = непрерывная лента (feed `ESC J n`), 2 = чёрная метка
(сжатый растр `1F 10` + `GS FF` до метки), 3 = наклейка с gap (без доп. прогона).

## 6. Структура проекта

```
index.html         — веб-приложение (SPA, Web Bluetooth)
css/style.css      — стили
js/ablemark.js     — реализация протокола (GATT, flow-control, команды)
js/editor.js       — канвас-редактор этикеток (canvas → 1bpp)
js/templates.js    — шаблоны (localStorage + импорт/экспорт)
js/i18n.js         — локализация (RU/EN)
js/app.js          — UI-логика
vendor/            — pako (zlib), qrcode-generator
test/              — node-тесты протокола, i18n, шаблонов + puppeteer smoke
docs/              — PROTOCOL.md, BT_OPERATIONS.md
```
