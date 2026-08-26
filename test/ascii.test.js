/* Диагностика: рендер наклейки → ASCII-арт + регрессия чёткости (линия 2px). */
'use strict';
const puppeteer = require('puppeteer-core');
const path = require('path');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--font-render-hinting=none'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 900 });
  const url = 'file:///' + path.join(__dirname, '..', 'index.html').replace(/\\/g, '/');
  await page.goto(url, { waitUntil: 'load', timeout: 15000 });
  await new Promise(r => setTimeout(r, 700));

  // ASCII-дамп стартового макета (через печатный растр)
  const art = await page.evaluate(() => {
    const scale = Editor.renderScale();
    const raster = Editor.rasterize(scale);
    const imgData = raster.getContext('2d').getImageData(0, 0, raster.width, raster.height);
    const mono = AM.imageDataTo1bpp(imgData, raster.width, raster.height);
    const W = mono.bpr * 8, H = mono.height;
    const lines = [];
    for (let y = 0; y < H; y += 3) {
      let line = '';
      for (let x = 0; x < W; x += 2) {
        let on = 0, cnt = 0;
        for (let dy = 0; dy < 3 && y + dy < H; dy++) {
          for (let dx = 0; dx < 2 && x + dx < W; dx++) {
            cnt++;
            if (mono.data[(y + dy) * mono.bpr + ((x + dx) >> 3)] & (0x80 >> ((x + dx) & 7))) on++;
          }
        }
        line += on * 2 >= cnt ? '#' : (on > 0 ? '+' : '.');
      }
      lines.push(line.replace(/\.*$/, ''));
    }
    while (lines.length && !lines[lines.length - 1]) lines.pop();
    return { art: lines.join('\n'), W, H };
  });

  console.log(`=== стартовый макет: ${art.W}x${art.H} dots ===`);
  console.log(art.art);

  // Регрессия чёткости: линия 2px горизонтальная во всю ширину
  const lineCheck = await page.evaluate(() => {
    const saved = Editor.state.elements.slice();
    Editor.state.elements = [];
    Editor.state.selected = null;
    Editor.add('line', { thickness: 2, horizontal: true, length: Editor.widthDots() - 4, x: 2, y: 8 });
    const scale = Editor.renderScale();
    const raster = Editor.rasterize(scale);
    const imgData = raster.getContext('2d').getImageData(0, 0, raster.width, raster.height);
    const mono = AM.imageDataTo1bpp(imgData, raster.width, raster.height);
    Editor.state.elements = saved;
    Editor.state.selected = null;
    const W = mono.bpr * 8;
    let solidRows = 0;
    for (let y = 0; y < mono.height; y++) {
      let cnt = 0;
      for (let x = 0; x < W; x++) {
        if (mono.data[y * mono.bpr + (x >> 3)] & (0x80 >> (x & 7))) cnt++;
      }
      if (cnt >= W - 8) solidRows++;
    }
    return { solidRows, expect: 2 };
  });
  console.log(`=== Линия 2px: сплошных строк ${lineCheck.solidRows} (ожидается ${lineCheck.expect}) ===`);

  await browser.close();
  if (lineCheck.solidRows !== lineCheck.expect) {
    console.error('FAIL: линия не сплошная — box-даунсемпл сломан');
    process.exit(1);
  }
  console.log('ASCII-ДИАГНОСТИКА OK');
})().catch(e => { console.error('FATAL', e); process.exit(1); });
