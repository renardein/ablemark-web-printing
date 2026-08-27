# AbleMark — полный реестр Bluetooth-операций

Обнаружено при анализе декомпилированных исходников (jadx). Константы префиксов
(`com.google.common.base.a`): `D=0x1A`, `E=0x1B(ESC)`, `F=0x1C(FS)`, `G=0x1D(GS)`,
`I=0x1F`, `SignedBytes.f60315a=0x3D`, `r.f66606e=0x30`, `f.f37842e=0x04`.
Java-байты со знаком: `-1=0xFF`, `-13=0xF3`, `-14=0xF2`, `-15=0xF1`, `-16=0xF0`,
`-17=0xEF`, `-78=0xB2`, `-69=0xBB`, `-66=0xBE`, `-91=0xA5`, `-86=0xAA`, `-32=0xE0`.

Источники: `CommandPort.java`, `PrintL11.java`, `PrintS8.java`, `PrinterPortWithSpp.java`,
`Printer_ESC.java`, `Printer_TSPL.java`, `BluetoothPort.java`, `HomeCommendContext.java`,
`HomeActivity.java`, `X8Protocol.java`, `D100Protocol.java`, `D100Attrs.java`/`D200Attrs.java`,
`X2Attrs.java`/`X8Attrs.java`, `QueryPrinterPrepareProcessor.java`, `LPrinter.java`,
`PrintPP.java`, `DeviceManager.java`.

## 1. Печать — растровые команды

| Байты | Назначение | Где |
|---|---|---|
| `1F 10 bprH bprL hH hL len(4BE) + zlib` | сжатый растр (zlib wbits=14 lvl=6) | CommandPort.printBitmap, BaseProtocol.commonGetBitmap, X8Protocol.commonGetBitmapNew |
| `1D 76 30 m bprL bprH hL hH + data` | GS v 0 — несжатый растр 1bpp MSB | PrintL11.printBitmap1, Printer_ESC.printBitmap |
| `1F 1F 05 A5 bprL bprH hL hH lenL lenH + JBIG` | JBIG-сжатый растр (X8, JNI `JniJbigCodec.encodeV2`) | X8Protocol.getData |
| `1F 1F 05 …` (сплит по 512 байт) | тот же поток по частям | X8Protocol.getData |

## 2. Управление печатью / бумагой

| Байты | Назначение | Где |
|---|---|---|
| `1F C0 01 00` | start print job (P50/S2) | CommandPort.startPrintjob |
| `1F C0 01 01` | stop print job | CommandPort.stopPrintjob |
| `10 FF F1 02` | enable printer (L-серия) | PrintL11.enablePrinter |
| `10 FF F1 03` | enable printer (S8) | BaseProtocol |
| `10 FF F1 45` | stop print job (L-серия) | PrintL11.stopPrintJob |
| `10 FF F1 1D` | неизвестный stop-вариант | PrintS8.stopPrintJob |
| `1F 11 n` / `1F 11 n lo hi` | позиционирование/авто-калибровка (80=калибровка, 81=к метке) | CommandPort.adjustPosition(Auto) |
| `1F 12 n m` | printerLocation (позиция после печати) | CommandPort.printerLocation |
| `1F 70 t d` | плотность (density) | CommandPort.setDensity |
| `1F 80 t d` | тип бумаги / paperType (16=gap,32=метка,40,48) | CommandPort.setPaperType, X2Protocol |
| `1F 70 70 00` | запрос плотности (get) | CommandPort.getDensity |
| `1F 60 00` | запрос скорости (get) | CommandPort.getSpeed |
| `1F 60 s d` | установка скорости | CommandPort.setSpeed |
| `1F 30 n` | толщина бумаги (S8/L11: 1F 30 10 00 n) | PrintL11.setThickness |
| `1F 04 05` | запрос готовности принтера (S8/qr) | PrintPP:336, QueryPrinterPrepareProcessor |
| `1F 04 0A A5` | статус X8-серии | HomeCommendContext (queryStatusType=2) |
| `1F 04 0F A5` | отмена печати (X8) | X8Protocol |
| `1F 01 06 A5 02` | конец задания — успех (X8) | X8Protocol |
| `1F 01 06 A5 01` | конец задания — продолжение (X8) | X8Protocol |
| `1F 01 05 A5 bprL bprH hL hH lenL lenH` | заголовок JBIG-блока (X8) | X8Protocol |
| `1F 17 50` | getNextLocation (X8) | X8Protocol |
| `10 04 0D A5 n` | shutdown-время X8 (set) | X8Attrs |
| `16 23 d` | плотность D100 (1/7/10/15) | D100Protocol |
| `1D 4C 00 00` | left margin D100 | D100Protocol |
| `1D 57 60 03` | скорость D100 | D100Protocol |
| `1B 61 01` | выравнивание D100 | D100Protocol |
| `1A 0C FF` / `1A 0C 00` | индукционная печать вкл/выкл (D100, paperType 2) | D100Protocol |
| `1D 0C` | GS FF — прогон до чёрной метки | Printer_ESC |
| `1F 28 4B 3 0 53 1 52` | режим повторной печати наклеек (D100, paperType 3, не-последняя копия) | D100Protocol |
| `1F 28 73 2 0 spdL spdH` | установка скорости печати D100 (авто-расчёт) | D100Protocol |
| `00 × 15` / `00 × 6` | wakeup (L-серия / P50) | PrintL11/BaseProtocol |

## 3. ESC/POS-команды (Printer_ESC)

| Байты | Назначение |
|---|---|
| `1B 40` | init |
| `1B 4A n` | feed n точек |
| `1B 64 n` | feed n строк |
| `1B 4C n` / `0C` | feedToBlack |
| `1B 21 n` | выбрать шрифт |
| `1B 45 n` | bold |
| `1B 47 n` | double strike |
| `1D 21 n` | размер шрифта |
| `1D 7C m` | QR: печать сохранённого |
| `1B 4D n` | chooseFont |
| `1B 33 n` | line space |
| `1B 20 n` | char space |
| `1B 24 lo hi` / `1B 5C lo hi` | abs/rel позиция |
| `1B 56 n` | поворот |
| `1B 61 n` | snap mode |
| `1B 2D n` | underline |
| `1C 4C 70 …` | createPage (page mode) |
| `1C 4C 6F …` | printPage (page mode) |
| `1C 4C 74 …` / `1C 4C 6D …` | setText / textBox |
| `1C 4C 6C …` / `1C 4C 72 …` | drawLine / Area_Reverse |
| `1C 4C 42 …` | PDF417 |
| `1C 4C 6D …` | drawLine v2 |
| `1D 6C n m` | QR (кастомный `GS l`) |
| `07` | beep |
| `0A` / `0D 0A` | LF / CR+LF |

## 4. TSPL-команды (Printer_TSPL / LPrinter — текстовый протокол)

`SIZE w mm,h mm` · `CLS` · `DENSITY n` · `SPEED n` · `DIRECTION n,m` · `REFERENCE` ·
`SET CUTTER 1/OFF` · `SET GAP ON/OFF` · `TEXT` · `TEXTBOX` · `BARCODE` · `QRCODE` ·
`DMATRIX` · `BAR` · `LINE …,M1..M4` · `BOX` · `CIRCLE` · `BITMAP x,y,bpr,h,3,len,DATA` ·
`PRINT n`

## 5. CPCL-команды (PrintPP — D-серия qr-принтеры)

`! 0 200 200 h 1\r\nPAGE-WIDTH w\r\n` · `GAP-SENSE` · `FORM` · `PRINT` · `POPRINT` ·
`B/VB 128|39|93|CODABAR|EAN8|EAN13|UPCA|UPCE|I2OF5 …` · `BOX …` · `EG … hex` ·
`CG w h x y DATA` · `ZG … DATA` · `LINE/LPLINE …` · `SETQRVER n` · `B/VB QR … M 2 U n\nL|Q|M|H A,data\nENDQR`

## 6. Служебные запросы (0x10FF — «P850/CommandPort»)

| Байты | Ответ | Назначение |
|---|---|---|
| `10 FF 40` | `[FF, код]` (1=нет бумаги, 2=крышка, 3=перегрев, 4=батарея, 5=крышка закрыта) | статус |
| `1F 20 00` | байтовые флаги (1=печать, 2=крышка, 4=нет бумаги, 8=батарея, 16=перегрев) | детальный статус |
| `10 FF 20 F0` | строка | инфо |
| `10 FF 20 F1` | строка / JSON `{"sw"}` | версия прошивки |
| `10 FF 20 F2` | строка / JSON `{"SN"}` | серийный номер |
| `10 FF 20 F3` | 6 байт | MAC-адрес |
| `10 FF 50 F1` | `[.., N]` / LP90 `[..4,N]` / JSON `{"bat"}` | батарея |
| `10 FF 13` | L `[N,..]` / прочие `[..,N]` | автоотключение (get) |
| `10 FF 12 hi lo` | `OK` | автоотключение (set) |
| `10 FF BB 01 h m s` | | установка времени (setCurrentTime) |
| `10 FF BB 02` | | запрос текущего времени |
| `10 FF BB 03 hi lo` | | установка интервала обратного отсчёта |
| `10 FF BB 04` | | режим показа времени |
| `10 FF BB 05` | | режим обратного отсчёта |
| `10 FF BB 06 01` | | запуск обратного отсчёта |
| `10 FF 60 01` / `10 FF 60 00` | | экран принтера вкл/выкл (openScreen) |
| `10 FF 03` | | калибровка label gap (learnLabelGap) |
| `10 FF 10 00 n` | | толщина бумаги (S8: thickness) |
| `10 FF 12` (без параметров) | | ? (см. setShutTime) |
| `10 FF EF EE` | | запрос даты (PrintPP:326 — получение времени) |
| `10 FF EF F1` | | запрос инфо №2 (PrintPP:358) |
| `10 FF 20 F1 10` | | BT-версия (PrintL11.printerBtVersion) |
| `10 FF 20 F1 11` | | BT-имя (PrintL11.printerBtname) |
| `10 FF 70 00` | | сброс к заводским (resetFactoryData `1F 50 BE`) |
| `1F 40` | | тест-страница / самопроверка (selfCheck, подтверждено thermoprint) |
| `10 FF F2` | | обратный прогон бумаги (backoffPaper, подтверждено thermoprint) |
| `1A 1F 01` | | индукционная печать |
| `1A 1F 02` | | индукционная печать (вариант 2) |
| `1A 1F 05` | payload | encryption payload (P15R/A1/S12) |
| `1A 1F 06` | `1A 1F 07 …cap rem… sum` | остаток бумаги (mileage) |
| `1A 1F 07 …` | | ответ mileage (см. парсер) |
| `0E` | | позиционирование по метке (PrintPP:316) |
| `1B 3D 5D A5` | hex | запрос готовности X8 (QueryPrinterPrepareProcessor) |

## 7. Bootloader / прошивка (OTA)

| Байты | Назначение |
|---|---|
| `10 FF E0 AA AA` | вход в режим обновления прошивки (update) |
| `10 FF FF rand` | handshake (случайный байт, flag_current=1) |
| `10 FF 04 04 nKB BE-len(4)` | firmwareSending — старт передачи (nKB пакетов) |
| `10 FF 04 05 idx lenL lenH data… sum` |分包 по 1024 байта + чексумма |
| `10 FF 04 06` | sendComplete |
| `10 FF 04 1D BE rand` | intoBoot (`1F 04 04 BE 66 88`) |
| `1F 75 BE-len(4)` + data | p50SFirmwareSendig (прошивка P50S) |
| D100 handshake (45 байт) | `10 05 FF 01 02 …` — вход в режим D100 (D100Connect.writeBeforeConnectSuccess) |
| `1F FD 01 A5 …` (серия из 10 команд) | X8: конфигурация печати (density/speed/algorithm/paperType/…) |
| `10 04 13 A5 n` | X8: shutdown-время (set) |

## 8. Транспортные операции

| Операция | Описание |
|---|---|
| BLE connect: сервис 0xFF00, write ff02, notify ff01, ctrl ff03 | основной канал |
| BLE connect: 49535343-fe7d… (write …8841, notify …1e4d) | P80/T3 |
| BLE connect: 0xFD00 (write fd01, notify fd02) | fallback |
| SPP connect: RFCOMM `00001101-0000-1000-8000-00805F9B34FB` | Classic Bluetooth (D100/D200/S8) |
| Кредитный flow-control на ff03 (`01 xx`, `02 MTU`) | контроль потока |
| MTU negotiation (`requestMtu`) | размер пакета = MTU−3 |
| Отключение/закрытие: `gatt.disconnect()`, `socket.close()` | |
| Обнаружение: BLE scan по имени/сервису, SPP bonded devices | DeviceManager |

## 9. Не реализовано в веб-версии (браузер не даёт)

- SPP/RFCOMM (Classic Bluetooth) — D100/D200/S8/A50/часть P80
- OTA-прошивка (требует нативных JNI-кодеков и boot-режима)
- JBIG-кодек (X8/D100) — нативная библиотека
- Переключение BT-имени/режима устройства
