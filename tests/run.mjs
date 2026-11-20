// MPD 자동 시험 — GitHub에 올릴 때마다 저절로 돌아요(.github/workflows/test.yml).
// 컴퓨터에서 돌리기: cd tests && npm i && npx playwright install chromium && npm test
// 시험은 사고 목록(CLAUDE.md '작업 방식')을 막는 것부터: 화면이 오류 없이 열리는지 · 지운 것이 되살아나지 않는지 · 앱이 계획을 저절로 바꾸지 않는지
// 바깥 서버(Firestore·지도·카카오 등)는 모두 막고, Leaflet은 tests/node_modules 것을, MQTT·카카오는 가짜를 씀
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEAF = path.join(ROOT, 'tests/node_modules/leaflet/dist');
const EXPOSE = ['photoPut', 'photoDel', 'photoList', 'planSave', 'planDel', 'planAll', 'planMerge'];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.webmanifest': 'application/json', '.txt': 'text/plain; charset=utf-8' };

// 저장소를 /mapdiary/ 주소로 띄움 (GitHub Pages와 같은 모양)
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!p.startsWith('/mapdiary/')) { res.writeHead(404); return res.end(); }
  p = p.slice('/mapdiary/'.length) || 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  if (p === 'index.html') {   // 화면 코드는 module이라 함수가 밖에서 안 보여서, 시험이 쓸 함수만 window.__T로 꺼냄(저장소 파일은 그대로)
    const h = fs.readFileSync(f, 'utf8'), i = h.lastIndexOf('</script>');
    return res.end(h.slice(0, i) + '\n;window.__T={' + EXPOSE.join(',') + '};\n' + h.slice(i));
  }
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/mapdiary/`;

const MQTT_STUB = `window.mqtt={connect(){const h={};const c={connected:false,on(e,f){(h[e]=h[e]||[]).push(f);return c},subscribe(){return c},unsubscribe(){return c},publish(){return c},end(){return c},removeListener(){return c}};return c}};`;
const KAKAO_STUB = `window.Kakao={init(){},isInitialized(){return true},Share:{sendDefault(){},uploadImage(){return Promise.reject(new Error('test'))}}};`;

const browser = await chromium.launch();
async function newPage() {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith(BASE)) return route.continue();
    if (/leaflet\.min\.js$/.test(u)) return route.fulfill({ path: path.join(LEAF, 'leaflet.js'), contentType: 'text/javascript' });
    if (/leaflet\.min\.css$/.test(u)) return route.fulfill({ path: path.join(LEAF, 'leaflet.css'), contentType: 'text/css' });
    if (/mqtt.*\.js/.test(u)) return route.fulfill({ body: MQTT_STUB, contentType: 'text/javascript' });
    if (/kakao.*\.js/.test(u)) return route.fulfill({ body: KAKAO_STUB, contentType: 'text/javascript' });
    if (/\.css(\?|$)/.test(u)) return route.fulfill({ body: '', contentType: 'text/css' });
    return route.abort();   // 그 밖의 바깥 요청(Firestore·지도 조각·날씨…)은 막음
  });
  const page = await ctx.newPage();
  page.errs = [];
  page.on('pageerror', e => page.errs.push(String(e && e.message || e)));
  page.ctx = ctx;
  return page;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const fails = [];
async function test(name, fn) {
  const page = await newPage();
  try { await fn(page); pass++; console.log('✅ ' + name); }
  catch (e) { fail++; fails.push(name); console.log('❌ ' + name + '\n   ' + String(e && e.message || e).split('\n').slice(0, 4).join('\n   ')); }
  finally { await page.ctx.close(); }
}
function ok(v, msg) { if (!v) throw new Error(msg); }
function noErr(page, where) { ok(page.errs.length === 0, `${where}: 화면 오류 ${page.errs.length}개 → ${page.errs.slice(0, 3).join(' | ')}`); }

// 시험용 기록 하나(화담숲 비슷한 짧은 걷기)를 이 브라우저에 넣음
async function seed(page) {
  await page.goto(BASE + '?my=1');
  await page.evaluate(() => {
    const t0 = new Date('2026-11-01T10:00:00+09:00').getTime(), id = 'walk_test0001', tr = [];
    for (let i = 0; i < 60; i++) tr.push([37.40 + i * 0.0002, 127.29 + i * 0.0001, t0 + i * 30000, 100 + i]);
    localStorage.setItem('track:' + id, JSON.stringify(tr));
    localStorage.setItem('trackName:' + id, JSON.stringify('시험 걷기'));
    localStorage.setItem('walkMode:' + id, JSON.stringify('trek'));
    localStorage.setItem('lastMode', JSON.stringify('trek'));
  });
  return 'walk_test0001';
}

// ─── 1. 화면이 오류 없이 열리는지 ───
const SCREENS = ['', '?my=1', '?my=1&t=walk_test0001', '?plan=1', '?walk=1&mode=hike', '?walk=1&mode=trek', '?walk=1&mode=run', '?walk=1&mode=bike', '?find=1', '?map=1'];
for (const s of SCREENS) {
  await test('화면 열림 · ' + (s || '첫 화면'), async page => {
    await seed(page);
    page.errs = [];
    await page.goto(BASE + s);
    await sleep(2500);
    noErr(page, s || '첫 화면');
    const txt = await page.evaluate(() => document.body.innerText.trim().length);
    ok(txt > 10, '화면이 비어 있어요');
  });
}

// ─── 2. 지운 사진은 되살아나지 않음 (2026-11-15 '경고') ───
await test('지운 사진은 다시 넣어도 안 살아남', async page => {
  const t = await seed(page);
  const n = await page.evaluate(async t => {
    const rec = { id: 'ph_test1', t, ts: Date.now(), lat: 37.4, lng: 127.29, blob: new Blob(['x'], { type: 'image/jpeg' }), thumb: new Blob(['x'], { type: 'image/jpeg' }) };
    await __T.photoPut(rec);
    const before = (await __T.photoList(t)).length;
    await __T.photoDel('ph_test1');
    await __T.photoPut(rec);   // 다른 기기·백업에서 같은 사진이 다시 와도
    return [before, (await __T.photoList(t)).length];
  }, t);
  ok(n[0] === 1, '사진이 처음에 안 들어갔어요');
  ok(n[1] === 0, '지운 사진이 되살아났어요');
});

// ─── 3. 지운 계획은 되살아나지 않음 (판 -192) ───
await test('지운 계획은 예전 화면이 저장해도 안 살아남', async page => {
  await seed(page);
  const r = await page.evaluate(() => {
    const p = { id: 'pl_test_a', name: '오사카 1안', start: '2026-12-11', nd: 3, it: [] };
    __T.planSave(JSON.parse(JSON.stringify(p)));
    __T.planDel('pl_test_a');
    __T.planSave(JSON.parse(JSON.stringify(p)));   // 열려 있던 예전 화면이 다시 저장
    return __T.planAll().some(x => x.id === 'pl_test_a');
  });
  ok(!r, '지운 계획이 되살아났어요');
});

await test('다른 기기에서 온 계획 모음에 지운 계획이 있어도 안 살아남', async page => {
  await seed(page);
  const r = await page.evaluate(() => {
    const p = { id: 'pl_test_b', name: '제주 여행', start: '2026-12-20', nd: 2, it: [], u: 1 };
    __T.planSave(JSON.parse(JSON.stringify(p)));
    __T.planDel('pl_test_b');
    __T.planMerge([p], {}, {}, {});
    return __T.planAll().some(x => x.id === 'pl_test_b');
  });
  ok(!r, '지운 계획이 되살아났어요');
});

// ─── 4. 앱이 계획을 저절로 바꾸지 않음 (2026-11-16 '1안·2안 섞임') ───
await test('1안·2안 계획을 열어도 그대로', async page => {
  await seed(page);
  const plans = await page.evaluate(() => {
    const mk = (id, name, n) => ({ id, name, start: '2026-12-11', nd: 3, it: n.map((x, i) => ({ id: id + '_' + i, d: 0, t: '1' + i + ':00', n: x, k: 'spot', lat: 34.66 + i * 0.01, lng: 135.5 + i * 0.01 })) });
    __T.planSave(mk('pl_test_1', '오사카 1안', ['도톤보리', '오사카성']));
    __T.planSave(mk('pl_test_2', '오사카 2안', ['도톤보리', '유니버설 스튜디오', '난바']));
    return JSON.stringify(__T.planAll().filter(p => /^pl_test_/.test(p.id)).map(p => [p.id, p.name, p.it.map(x => x.n)]).sort());
  });
  for (const s of ['', '?plan=1', '?plan=1&p=pl_test_1', '?plan=1&p=pl_test_2']) { await page.goto(BASE + s); await sleep(2500); }
  noErr(page, '계획 화면');
  const after = await page.evaluate(() => JSON.stringify(__T.planAll().filter(p => /^pl_test_/.test(p.id)).map(p => [p.id, p.name, p.it.map(x => x.n)]).sort()));
  ok(after === plans, `계획이 바뀌었어요\n전: ${plans}\n후: ${after}`);
});

// ─── 5. 기록을 보기만 해도 기록이 바뀌지 않음 ───
await test('기록 보기만 하면 길 자료 그대로', async page => {
  const t = await seed(page);
  const before = await page.evaluate(t => localStorage.getItem('track:' + t), t);
  await page.goto(BASE + '?my=1&t=' + t); await sleep(2500);
  await page.goto(BASE + '?my=1'); await sleep(1500);
  const after = await page.evaluate(t => localStorage.getItem('track:' + t), t);
  ok(before === after, '기록의 길 자료가 바뀌었어요');
});

await browser.close();
server.close();
console.log(`\n결과: 통과 ${pass} · 실패 ${fail}` + (fails.length ? '\n실패: ' + fails.join(', ') : ''));
process.exit(fail ? 1 : 0);
