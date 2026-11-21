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
const EXPOSE = ['expWho', 'planAskName', 'permOf', 'permIsV', 'trSet', 'planPhotos', 'filmTripRange', 'filmInset', 'filmAutoStyle', 'photoPut', 'photoDel', 'photoList', 'planSave', 'planDel', 'planAll', 'planMerge', 'errSheet', 'trackAdd', 'trackLoad', 'trackStats', 'trackModes', 'flyFlags', 'planCopy', 'planPack', 'planUnpack', 'backupMake', 'backupLoad', 'goneMark', 'recMerge', 'trRoom', 'trSet', 'autoFix', 'autoSt', 'expCalc', 'expGuess', 'decoSync', 'planHeroAll', 'planHeroTake'];
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

// ─── 6. 오류가 나면 휴대폰에 적어 둠 (판 -293) · 주소의 # 뒤 열쇠·? 뒤 값은 안 적음 ───
await test('오류 기록 · 적고 보여 줌 · 열쇠는 안 적음', async page => {
  await page.goto(BASE + '?my=1&t=walk_secret1#k=SECRETKEY');
  await sleep(1500);
  await page.evaluate(() => { setTimeout(() => { throw new Error('시험 오류 하나'); }, 0); Promise.reject(new Error('시험 약속 오류')); });
  await sleep(500);
  const L = await page.evaluate(() => JSON.parse(localStorage.getItem('errLog') || '[]'));
  ok(L.some(e => e.m.includes('시험 오류 하나')), '오류가 안 적혔어요');
  ok(L.some(e => e.m.includes('시험 약속 오류')), '약속 오류가 안 적혔어요');
  const raw = JSON.stringify(L);
  ok(!raw.includes('SECRETKEY') && !raw.includes('walk_secret1'), '주소 속 열쇠·값이 적혔어요');
  ok(L[0].v && L[0].v !== '?', '판 번호가 안 적혔어요');
  await page.goto(BASE); await sleep(1500);
  page.errs = [];
  await page.evaluate(() => __T.errSheet());
  await sleep(300);
  const txt = await page.evaluate(() => document.body.innerText);
  ok(txt.includes('시험 오류 하나'), '오류 기록 창에 안 보여요');
  noErr(page, '오류 기록 창');
});

// ─── 7. 늦게 온 위치는 시각 자리에 끼움 (판 -259) ───
await test('늦게 온 위치가 출발 쪽으로 되돌아가는 선을 만들지 않음', async page => {
  await page.goto(BASE + '?my=1'); await sleep(800);
  const r = await page.evaluate(() => {
    const t = 'walk_late01', n = Date.now();
    __T.trackAdd(t, 37.50, 127.00, 5, null, null, null, null, n - 600000);
    __T.trackAdd(t, 37.52, 127.00, 5, null, null, null, null, n - 60000);
    __T.trackAdd(t, 37.51, 127.00, 5, null, null, null, null, n - 300000);   // 화면이 꺼진 동안 모였다 늦게 온 점
    return __T.trackLoad(t).map(q => [q[0], q[2]]);
  });
  ok(r.length === 3, '점 3개가 아니에요: ' + r.length);
  ok(r[0][0] === 37.5 && r[1][0] === 37.51 && r[2][0] === 37.52, '시각 순서가 아니에요: ' + JSON.stringify(r));
  ok(r[0][1] < r[1][1] && r[1][1] < r[2][1], '시각이 거꾸로예요');
});

// ─── 8. 차 기록에 GPS 튐이 있어도 비행으로 안 셈 (판 -258) ───
await test('GPS 한 번 튐은 비행이 아님 · 김포→제주는 비행', async page => {
  await page.goto(BASE + '?my=1'); await sleep(800);
  const r = await page.evaluate(() => {
    const car = __T.flyFlags([500, 3000, 500], [30, 20, 30]);   // 3km를 20초에 (GPS 튐)
    const jump = __T.flyFlags([450000], [3600]);               // 끊겼다가 450km를 1시간
    return { car: car.some(Boolean), jump: jump[0] };
  });
  ok(!r.car, 'GPS 튐을 비행으로 셌어요');
  ok(r.jump, '김포→제주 같은 큰 건너뜀을 비행으로 못 셌어요');
});

// ─── 9. 계획 복사(1안·2안)는 원래 계획을 안 건드림 (판 -210) ───
await test('계획 복사는 새 번호 · 원래 계획 그대로', async page => {
  await page.goto(BASE + '?plan=1'); await sleep(800);
  const r = await page.evaluate(() => {
    const p = { id: 'pl_cp_a', name: '부산 여행', start: '2026-12-01', nd: 2, it: [{ id: 'x1', d: 0, t: '10:00', n: '해운대', k: 'spot', lat: 35.16, lng: 129.16, ok: 1 }], room: { code: 'tabc' } };
    __T.planSave(p);
    const before = JSON.stringify(__T.planAll().find(x => x.id === 'pl_cp_a'));
    const c = __T.planCopy(__T.planAll().find(x => x.id === 'pl_cp_a'), '부산 여행 2안');
    const after = JSON.stringify(__T.planAll().find(x => x.id === 'pl_cp_a'));
    return { same: before === after, cid: c.id, cn: c.name, cit: c.it[0].id, ok: c.it[0].ok, room: c.room, n: __T.planAll().length };
  });
  ok(r.same, '복사하면서 원래 계획이 바뀌었어요');
  ok(r.cid !== 'pl_cp_a' && r.cit !== 'x1', '복사본이 같은 번호를 써요');
  ok(!r.ok && !r.room, '다녀옴 표시나 여행 방이 복사본에 따라왔어요');
  ok(r.n === 2, '계획이 2개가 아니에요: ' + r.n);
});

// ─── 10. 계획 링크로 보내고 받으면 일정이 그대로 ───
await test('계획 링크 묶기·풀기 하면 일정이 그대로', async page => {
  await page.goto(BASE + '?plan=1'); await sleep(800);
  const r = await page.evaluate(async () => {
    const p = { id: 'pl_pk', name: '오사카 1안', start: '2026-12-11', nd: 3, it: [
      { id: 'a', d: 0, t: '10:35', n: '인천공항', k: 'fly', m: '출발', lat: 37.46, lng: 126.44 },
      { id: 'b', d: 1, t: '18:00', n: '도톤보리', k: 'spot', m: '', lat: 34.6687, lng: 135.5013 },
      { id: 'c', d: 2, t: '', n: '숙소', k: 'stay', m: '', lat: null, lng: null }] };
    const q = await __T.planUnpack(await __T.planPack(p));
    return { name: q.name, start: q.start, nd: q.nd, it: q.it.map(x => [x.d, x.t, x.n, x.k, x.lat]) };
  });
  ok(r.name === '오사카 1안' && r.start === '2026-12-11' && r.nd === 3, '이름·날짜가 달라졌어요: ' + JSON.stringify(r));
  ok(JSON.stringify(r.it) === JSON.stringify([[0, '10:35', '인천공항', 'fly', 37.46], [1, '18:00', '도톤보리', 'spot', 34.6687], [2, '', '숙소', 'stay', null]]), '일정이 달라졌어요: ' + JSON.stringify(r.it));
});

// ─── 11. 백업을 불러와도 지운 사진·기록이 안 살아남 ───
await test('백업 불러오기: 지운 사진·기록은 안 살아남 · 남은 건 그대로', async page => {
  const t = await seed(page);
  const r = await page.evaluate(async t => {
    const mk = id => ({ id, t, ts: Date.now(), lat: 37.4, lng: 127.29, blob: new Blob([new Uint8Array([255, 216, 255, 217])], { type: 'image/jpeg' }), thumb: new Blob([new Uint8Array([255, 216, 255, 217])], { type: 'image/jpeg' }) });
    await __T.photoPut(mk('ph_bk1')); await __T.photoPut(mk('ph_bk2'));
    const { data } = await __T.backupMake();        // 두 장 다 있을 때 만든 백업
    await __T.photoDel('ph_bk1');                     // 그 뒤에 한 장 지움
    const t2 = 'walk_bkgone';
    localStorage.setItem('track:' + t2, JSON.stringify([[37, 127, 1], [37.01, 127, 2]]));
    const { data: d2 } = await __T.backupMake();
    localStorage.removeItem('track:' + t2); __T.goneMark([t2]);   // 기록 하나 지움
    const f = o => new File([JSON.stringify(o)], 'b.json', { type: 'application/json' });
    await __T.backupLoad(f(data)); await __T.backupLoad(f(d2));
    return { ph: (await __T.photoList(t)).map(p => p.id).sort(), rec: localStorage.getItem('track:' + t2), keep: !!localStorage.getItem('track:' + t) };
  }, t);
  ok(!r.ph.includes('ph_bk1'), '지운 사진이 백업에서 되살아났어요');
  ok(r.ph.includes('ph_bk2'), '남은 사진이 없어졌어요');
  ok(r.keep, '남은 기록이 없어졌어요');
  ok(r.rec == null, '지운 기록이 백업에서 되살아났어요');
});

// ─── 12. 더 많은 화면이 오류 없이 열림 ───
for (const s of ['?film=1&t=walk_test0001', '?plan=1&p=pl_scr', '?plan=1&p=pl_scr&info=1', '?walk=1&mode=date', '?walk=1&mode=pgolf', '?talk=1', '?game=1']) {
  await test('화면 열림 · ' + s, async page => {
    await seed(page);
    await page.evaluate(() => localStorage.setItem('tripPlans', JSON.stringify([{ id: 'pl_scr', name: '제주 2박 3일', start: '2026-12-20', nd: 3, at: 1, it: [{ id: 'q1', d: 0, t: '10:00', n: '성산일출봉', k: 'spot', lat: 33.458, lng: 126.942 }, { id: 'q2', d: 0, t: '13:00', n: '점심', k: 'food', lat: 33.46, lng: 126.93 }] }])));
    page.errs = [];
    await page.goto(BASE + s); await sleep(2500);
    noErr(page, s);
    ok(await page.evaluate(() => document.body.innerText.trim().length) > 10, '화면이 비어 있어요');
  });
}
await test('나(설정) 창이 오류 없이 열림', async page => {
  await seed(page); await page.goto(BASE); await sleep(1500); page.errs = [];
  await page.evaluate(() => __T.errSheet && document.querySelector('.c-ph-av') ? document.querySelector('.c-ph-av').click() : null);
  await sleep(600);
  noErr(page, '나 창');
  ok(await page.evaluate(() => /Claude 열쇠|오류 기록/.test(document.body.innerText)), '나 창의 줄이 안 보여요');
});

// ─── 13. 문지기: 바깥에서 오는 기록·사진·계획은 지운 표시가 있으면 못 들어옴 (판 -295) ───
await test('문지기 · 지운 기록·사진·계획은 어느 길로 와도 안 들어옴', async page => {
  await page.goto(BASE + '?my=1'); await sleep(800);
  const r = await page.evaluate(async () => {
    const id = 'run_wgate1', tr = JSON.stringify([[37, 127, 1], [37.01, 127, 2]]);
    __T.goneMark([id]);
    const m = __T.recMerge(id, { ['track:' + id]: tr, ['walkMode:' + id]: '"run"' }, 'over');
    const rec = localStorage.getItem('track:' + id);
    const keep = 'run_wgate2', m2 = __T.recMerge(keep, { ['track:' + keep]: tr }, 'over');
    await __T.photoPut({ id: 'ph_g1', t: keep, ts: 1, blob: new Blob(['x']), thumb: new Blob(['x']) }); await __T.photoDel('ph_g1');
    await __T.photoPut({ id: 'ph_g1', t: keep, ts: 1, blob: new Blob(['x']), thumb: new Blob(['x']) });
    const ph = (await __T.photoList(keep)).length;
    __T.planSave({ id: 'pl_g1', name: '지운 계획', start: '2026-12-01', nd: 1, it: [] }); __T.planDel('pl_g1');
    __T.planSave({ id: 'pl_g1', name: '지운 계획', start: '2026-12-01', nd: 1, it: [] });
    return { gone: m.gone, rec, keep: localStorage.getItem('track:' + keep) === tr && !m2.gone, ph, plan: __T.planAll().some(p => p.id === 'pl_g1') };
  });
  ok(r.gone && r.rec == null, '지운 기록이 recMerge로 들어왔어요');
  ok(r.keep, '지우지 않은 기록이 안 들어왔어요');
  ok(r.ph === 0, '지운 사진이 photoPut으로 들어왔어요');
  ok(!r.plan, '지운 계획이 planSave로 들어왔어요');
});

// ─── 14. 영상 속 전체 지도(판 -297): 길 전체가 작은 지도 안에 들어감 ───
await test('영상 전체 지도 · 길이 칸 안에 다 들어감', async page => {
  await seed(page); await page.goto(BASE); await sleep(800);
  const r = await page.evaluate(async () => {
    const P = Array.from({ length: 50 }, (_, i) => ({ lat: 29.1 + i * 0.008, lng: 110.4 + Math.sin(i / 6) * 0.05 }));
    const o = await __T.filmInset(P, true, 210);
    return { w: o.cv.width, out: o.pts.filter(([x, y]) => x < 0 || y < 0 || x > 210 || y > 210).length, n: o.pts.length };
  });
  ok(r.w === 420, '전체 지도 그림 크기가 이상해요 ' + r.w);
  ok(r.n === 50 && r.out === 0, '길이 전체 지도 밖으로 나가요 ' + r.out);
});

await test('영상 전체 지도 · 여행지 도착~떠나기 전만 (판 -298)', async page => {
  await seed(page); await page.goto(BASE); await sleep(800);
  const r = await page.evaluate(async () => {
    const home = Array.from({ length: 5 }, (_, i) => ({ lat: 37.55 + i * 0.01, lng: 126.8 }));
    const flyA = Array.from({ length: 8 }, (_, i) => ({ lat: 37.5 - i * 1, lng: 126.8 - i * 2, fly: true }));
    const trip = Array.from({ length: 40 }, (_, i) => ({ lat: 29.1 + i * 0.008, lng: 110.4 + Math.sin(i / 6) * 0.05 }));
    const flyB = Array.from({ length: 8 }, (_, i) => ({ lat: 30 + i, lng: 112 + i * 2, fly: true }));
    const P = [...home, ...flyA, ...trip, ...flyB, { lat: 37.55, lng: 126.8 }];
    const [i0, i1] = __T.filmTripRange(P), o = await __T.filmInset(P, true, 210, i0, i1);
    const inn = o.pts.slice(i0, i1 + 1).filter(([x, y]) => x < 0 || y < 0 || x > 210 || y > 210).length;
    return { i0, i1, inn, homeOut: o.pts[0][0] < 0 || o.pts[0][0] > 210 || o.pts[0][1] < 0 || o.pts[0][1] > 210, plain: __T.filmTripRange(trip) };
  });
  ok(r.i0 === 13 && r.i1 === 52, '여행지 구간을 잘못 잡았어요 ' + r.i0 + '~' + r.i1);
  ok(r.inn === 0, '여행지 길이 작은 지도 밖으로 나가요');
  ok(r.homeOut, '집·비행기 구간까지 넣어 축척이 작아졌어요');
  ok(r.plain[0] === 0 && r.plain[1] === 39, '비행 없는 기록은 처음~끝이어야 해요');
});

await test('세 칸 화면 · 위 전체 지도는 가로로 긴 칸에 길이 다 들어감 (판 -300)', async page => {
  await seed(page); await page.goto(BASE); await sleep(800);
  const r = await page.evaluate(async () => {
    const P = Array.from({ length: 60 }, (_, i) => ({ lat: 29.1 + i * 0.004, lng: 110.4 + i * 0.01 }));
    const o = await __T.filmInset(P, true, 720, 0, 59, 358, 34);
    return { w: o.cv.width, h: o.cv.height, out: o.pts.filter(([x, y]) => x < 0 || y < 0 || x > 720 || y > 358).length };
  });
  ok(r.w === 1440 && r.h === 716, '위 칸 지도 크기가 이상해요 ' + r.w + 'x' + r.h);
  ok(r.out === 0, '길이 위 칸 지도 밖으로 나가요 ' + r.out);
});

await test('계획 영상 사진 · 여행사 사진이 먼저, 없으면 공개 사진 (판 -302)', async page => {
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  let cm = 0;
  await page.route('**/image.hanatour.com/**', r => r.fulfill({ body: PNG, contentType: 'image/png' }));
  await page.route('**/commons.wikimedia.org/**', r => { cm++; r.abort(); });
  await seed(page); await page.goto(BASE); await sleep(800);
  const r = await page.evaluate(async () => {
    const a = { n: '천문산', k: 'spot', d: 0, lat: 29.05, lng: 110.48, img: ['https://image.hanatour.com/a/resize/400_0/x.jpg'] }, b = { n: '보봉호수', k: 'spot', d: 1, lat: 29.33, lng: 110.43 };
    const p = { id: 'tp1', name: '시험', it: [a, b] }, src = { plan: p, spots: [{ x: a, n: a.n, lat: a.lat, lng: a.lng, ts: 1, pk: 'spot' }, { x: b, n: b.n, lat: b.lat, lng: b.lng, ts: 2, pk: 'spot' }] };
    const L = await __T.planPhotos(src); return L.map(q => q.from + ':' + q.m);
  });
  ok(r[0] === 'agency:천문산', '천문산은 여행사 사진이어야 해요 ' + JSON.stringify(r));
  ok(r.length === 1, '사진이 없는 곳은 지나가야 해요 ' + JSON.stringify(r));
  ok(cm >= 1, '여행사·구글 사진이 없으면 공개 사진을 찾아봐야 해요');
});

await test('계획 맨 위 사진 · 저장해 둔 사진은 인터넷 없이도 보임 (판 -304)', async page => {
  await seed(page); await page.goto(BASE); await sleep(800);
  await page.evaluate(async () => {
    localStorage.setItem('tripPlans', JSON.stringify([{ id: 'tp9', name: '시험 여행', start: '2026-12-01', nd: 2, it: [], at: 1, u: 1 }]));
    const cv = document.createElement('canvas'); cv.width = cv.height = 8; const b = await new Promise(r => cv.toBlob(r, 'image/png'));
    await __T.trSet('hero:tp9', { u: 'https://example.com/x.jpg', b, at: Date.now() });
  });
  await page.goto(BASE + '?plan=1&p=tp9'); await sleep(2500);
  const r = await page.evaluate(() => { const h = document.querySelector('.tv-hero'); return h ? { img: h.classList.contains('img'), bg: h.style.backgroundImage.slice(0, 9) } : null; });
  ok(r && r.img && r.bg.startsWith('url("blob'), '저장해 둔 맨 위 사진이 안 보여요 ' + JSON.stringify(r));
});

// ─── 14. 첫 화면 바탕 사진이 저절로 바뀌지 않음 (판 -296 '사진도 바뀌고 그래') ───
await test('첫 화면 바탕 사진은 새 기록이 생겨도 그대로', async page => {
  const t = await seed(page);
  const jpg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
  const put = async (id, tid, ts) => page.evaluate(async ([id, tid, ts, u]) => { const b = await (await fetch(u)).blob(); await __T.photoPut({ id, t: tid, ts, lat: 37.4, lng: 127.29, blob: b, thumb: b }); }, [id, tid, ts, jpg]);
  await put('ph_bg1', t, new Date('2026-11-01T10:10:00+09:00').getTime());
  await page.goto(BASE); await sleep(2500);
  const first = await page.evaluate(() => JSON.parse(localStorage.getItem('homeBgPick') || 'null'));
  ok(first === 'ph_bg1', '첫 바탕 사진을 기억하지 않았어요: ' + first);
  await page.evaluate(() => { const id = 'walk_test0002', t0 = new Date('2026-11-10T10:00:00+09:00').getTime(), tr = []; for (let i = 0; i < 30; i++) tr.push([37.5 + i * 0.0002, 127.0, t0 + i * 30000]); localStorage.setItem('track:' + id, JSON.stringify(tr)); localStorage.setItem('walkMode:' + id, '"trek"'); });
  await put('ph_bg2', 'walk_test0002', new Date('2026-11-10T10:05:00+09:00').getTime());
  await page.goto(BASE); await sleep(2500);
  const again = await page.evaluate(() => JSON.parse(localStorage.getItem('homeBgPick') || 'null'));
  ok(again === 'ph_bg1', '새 기록이 생기자 바탕 사진이 바뀌었어요: ' + again);
});

// ─── 15. 일행 채팅: 같은 사람이 여러 기기로 들어와도 한 사람 (판 -306 '참석자가 왜 이렇게 많지?') ───
await test('일행 채팅 · 같은 이름은 한 사람으로 셈', async page => {
  await page.goto(BASE + '?my=1'); await sleep(800);
  await page.evaluate(async () => {
    localStorage.setItem('tripMe', JSON.stringify('meA')); localStorage.setItem('nick', JSON.stringify('길벗'));
    const R = await __T.trRoom('tpeopletest0001'), t = Date.now();
    await __T.trSet('room:' + R.rid, { v: 1, last: { tc: t, tp: t, tl: t, tm: t }, tl: [], tp: [],
      tm: [{ by: 'meA', nm: '길벗', t }, { by: 'meB', nm: '길벗', t }, { by: 'meC', nm: '길벗 ', t }, { by: 'jA', nm: 'jin', t }, { by: 'jB', nm: 'Jin', t }, { by: 'jung', nm: '정은', t }],
      tc: [{ id: 'c1', by: 'meB', nm: '길벗', x: '멋지다 앱', t }] });
  });
  page.errs = [];
  await page.goto(BASE + '?troom=1#tr=tpeopletest0001&n=길벗'); await sleep(2500);
  noErr(page, '일행 채팅');
  const txt = await page.evaluate(() => document.body.innerText);
  ok(/함께하는 사람 3명/.test(txt), '3명이 아니에요: ' + (txt.match(/함께하는 사람 \d+명/) || [''])[0]);
  ok(!/①|②|③/.test(txt), '같은 사람에 ①② 번호가 붙었어요');
  ok(/길벗\(나\)/.test(txt), '내 이름에 (나)가 없어요');
  // 판 -306: AI 묻기는 계획 화면 아래 메뉴 하나로 — 채팅 칸엔 'AI 도우미에게' 단추가 없어야 해요
  ok(!(await page.$$eval('button', bs => bs.some(b => /AI 도우미에게/.test(b.textContent)))), "일행 채팅에 'AI 도우미에게' 단추가 또 있어요");
  ok(await page.$('.tr-in') && /보내기/.test(txt), '일행 채팅 입력칸·보내기가 없어요');
});

// ─── 16. 자동 기록: 위치마다 무겁게 저장하지 않아도 길이 기록으로 남음 (판 -307 '폰이 갑자기 느려졌어') ───
await test('자동 기록 · 가벼운 저장으로도 기록이 남음', async page => {
  await page.goto(BASE + '?my=1'); await sleep(800);
  const r = await page.evaluate(() => {
    localStorage.removeItem('walkNow'); localStorage.setItem('autoSt', '{}');
    let lat = 37.5, ts = Date.now() - 3 * 3600e3, writes = 0; const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (k === 'autoSt') writes++; return set.call(this, k, v); };
    __T.autoFix(lat, 126.9, 10, 30, ts);
    for (let i = 0; i < 600; i++) { lat += 0.00018; ts += 1440; __T.autoFix(lat, 126.9, 10, 30, ts); }   // 차로 약 12km
    const moving = writes;
    for (let i = 0; i < 30; i++) { ts += 30000; __T.autoFix(lat, 126.9, 10, 30, ts); }   // 15분 머묾
    Storage.prototype.setItem = set;
    const ids = Object.keys(localStorage).filter(k => k.startsWith('track:'));
    return { moving, n: ids.length, pts: ids.length ? JSON.parse(localStorage.getItem(ids[0])).length : 0, seg: __T.autoSt().seg };
  });
  ok(r.moving < 60, '움직이는 동안 저장이 너무 잦아요: ' + r.moving + '번');
  ok(r.n === 1 && r.pts > 500, '머문 뒤 기록이 안 남았어요: ' + JSON.stringify(r));
  ok(!r.seg, '기록을 끝낸 뒤에도 길을 모으고 있어요');
});

await test('여행 경비 · 회비(공금) + 내가 쓴 돈 정산 (판 -309)', async page => {
  await seed(page); await page.goto(BASE); await sleep(800);
  const r = await page.evaluate(() => {
    const hh = [{ id: 'h1', n: '우리 집' }, { id: 'h2', n: '2가정' }, { id: 'h3', n: '3가정' }];
    const p = { id: 'x', nd: 3, fund: { on: 1, per: 300000, cur: 'KRW', hh }, exp: [{ id: 'e1', amt: 750000, cur: 'KRW', by: 'pot', d: 0 }, { id: 'e2', amt: 60000, cur: 'KRW', by: 'h1', d: 1 }] };
    const C = __T.expCalc(p, null);
    return { tot: C.tot, left: C.potLeft, tr: C.tr.map(t => t.fid + '>' + t.tid + ':' + Math.round(t.v)).sort(), g: __T.expGuess('저녁 훠궈') };
  });
  ok(r.tot === 810000, '쓴 돈 합계가 81만 원이어야 해요 ' + r.tot);
  ok(r.left === 150000, '남은 공금이 15만 원이어야 해요 ' + r.left);
  ok(JSON.stringify(r.tr) === JSON.stringify(['pot>h1:90000', 'pot>h2:30000', 'pot>h3:30000']), '공금에서 9만·3만·3만을 돌려줘야 해요 ' + JSON.stringify(r.tr));
  ok(r.g === 'meal', '저녁 훠궈는 식사로 짐작해야 해요 ' + r.g);
});

await test('여행 경비 · 가정 이름은 함께 가는 사람으로 (판 -325)', async page => {
  await seed(page); await page.goto(BASE); await sleep(800);
  const r = await page.evaluate(() => {
    const mem = [{ id: 'a', n: '성식' }, { id: 'b', n: '영희' }, { id: 'c', n: '철수' }, { id: 'd', n: '민지' }];
    const p1 = { id: 'x', mem, fund: { on: 1, per: 300000, hh: [{ id: 'h1', m: ['a', 'b'] }, { id: 'h2', m: ['c', 'd'] }] } };
    const p2 = { id: 'y', fund: { on: 1, per: 300000, hh: [{ id: 'h1' }, { id: 'h2' }, { id: 'h3' }] } };
    return [__T.expWho(p1).map(w => w.n), __T.expWho(p2).map(w => w.n)];
  });
  ok(JSON.stringify(r[0]) === JSON.stringify(['성식·영희', '철수·민지']), '가정 이름이 사람 이름이어야 해요 ' + JSON.stringify(r[0]));
  ok(JSON.stringify(r[1]) === JSON.stringify(['우리 집', '가정 2', '가정 3']), '사람이 없으면 우리 집·가정 2·가정 3 ' + JSON.stringify(r[1]));
});

// ─── 17. 비춰 읽기: 중국·일본은 '중국어/일본어' 칸 안, 베트남은 따로 칸, 베트남엔 '중국어' 없음 (판 -318·319) ───
await test('비춰 읽기 탭 · 베트남 계획엔 중국어 메뉴 없음', async page => {
  await page.goto(BASE + '?my=1'); await sleep(800);
  await page.evaluate(() => { __T.planSave({ id: 'pvn1', name: '하노이', start: '2026-12-01', nd: 2, it: [{ id: 'a', d: 0, t: '09:00', n: '호안끼엠', k: 'spot', lat: 21.0287, lng: 105.8524 }], at: Date.now(), u: Date.now() });
    __T.planSave({ id: 'pkr1', name: '서울', start: '2026-12-01', nd: 1, it: [{ id: 'a', d: 0, t: '09:00', n: '경복궁', k: 'spot', lat: 37.5796, lng: 126.977 }], at: Date.now(), u: Date.now() }); });
  page.errs = [];
  await page.goto(BASE + '?plan=1&p=pvn1'); await sleep(1500); noErr(page, '하노이 계획');
  const vn = await page.$$eval('.tv-bar button, .tv-bar a', a => a.map(x => x.textContent));
  ok(vn.some(x => /비춰 읽기/.test(x)), '베트남 계획에 비춰 읽기가 없어요: ' + vn.join(','));
  ok(!vn.some(x => /중국어/.test(x)), '베트남 계획에 중국어 메뉴가 나와요');
  await page.evaluate(() => __T.planSave({ id: 'pcn1', name: '장가계', start: '2026-12-01', nd: 2, it: [{ id: 'a', d: 0, t: '09:00', n: '천문산', k: 'spot', lat: 29.05, lng: 110.48 }], at: Date.now(), u: Date.now() }));
  await page.goto(BASE + '?plan=1&p=pcn1'); await sleep(1500);
  const cn = await page.$$eval('.tv-bar button, .tv-bar a', a => a.map(x => x.textContent));
  ok(cn.some(x => /중국어/.test(x)) && !cn.some(x => /비춰 읽기/.test(x)), '중국 계획 아래 메뉴가 이상해요: ' + cn.join(','));
  await page.click('.tv-bar button:has-text("중국어")'); await sleep(500);
  ok(await page.$('button:has-text("카메라로 비춰 읽기")'), "중국어 칸에 '카메라로 비춰 읽기'가 없어요");
  await page.goto(BASE + '?plan=1&p=pkr1'); await sleep(1500);
  const kr = await page.$$eval('.tv-bar button, .tv-bar a', a => a.map(x => x.textContent));
  ok(!kr.some(x => /비춰 읽기/.test(x)), '국내 계획에 비춰 읽기가 나와요');
});

// ─── 18. 구경(보기만)과 일행 나누기 (판 -320) ───
await test('구경 · 목록에 없는 이름은 보기만, 화면도 좁게', async page => {
  await page.goto(BASE + '?my=1'); await sleep(800);
  const r = await page.evaluate(() => { localStorage.setItem('nick', JSON.stringify('나그네'));
    const S = { own: { by: 'o' }, perm: { by: 'o', m: { x: { r: 1, v: 1 }, y: { r: 0 } }, def: { r: 1, w: 1, ai: 0 } }, tk: [{ by: 'a', nm: '성 식' }, { by: 'b', nm: '옆집' }], mn: ['성식', '유진'] };
    const a = __T.permOf(S, 'a'), b = __T.permOf(S, 'b'), x = __T.permOf(S, 'x'), y = __T.permOf(S, 'y'), b0 = __T.permOf(Object.assign({}, S, { mn: [] }), 'b'), o = __T.permOf(S, 'o');
    return { a: [a.r, a.w, a.v], b: [b.r, b.w, b.v], x: [x.r, x.w, x.v], y: [y.r], b0: [b0.w, b0.v], o: o.w }; });
  ok(JSON.stringify(r.a) === '[1,1,0]', '목록에 있는 이름(띄어쓰기 달라도)은 일행이어야 해요 ' + r.a);
  ok(JSON.stringify(r.b) === '[1,0,1]', '목록에 없는 이름은 구경(보기만)이어야 해요 ' + r.b);
  ok(JSON.stringify(r.x) === '[1,0,1]', '주인이 구경으로 정한 사람은 고치기가 꺼져야 해요 ' + r.x);
  ok(r.y[0] === 0, "주인이 '못 봄'으로 정하면 못 봐야 해요");
  ok(r.b0[0] === 1 && !r.b0[1], '함께 가는 사람 목록이 비었으면 예전처럼 일행이어야 해요');
  ok(r.o === 1, '주인은 늘 다 돼야 해요');
  // 초대 창에서 목록에 없는 이름을 적으면: 함께 가는 사람에 안 들어가고 구경
  await page.evaluate(() => { localStorage.removeItem('nick'); __T.planSave({ id: 'pview1', name: '오사카', start: '2026-12-01', nd: 2, room: { code: 'tviewertest0001' }, shOn: 1,
    mem: [{ id: 'm1', n: '성식' }, { id: 'm2', n: '유진' }], it: [{ id: 'a', d: 0, t: '09:00', n: '오사카성', k: 'spot', lat: 34.687, lng: 135.526 }], at: Date.now(), u: Date.now() }); });
  page.errs = [];
  await page.goto(BASE + '?plan=1&p=pview1'); await sleep(1500);
  if (!(await page.$('.iv-in'))) await page.evaluate(() => __T.planAskName(__T.planAll().find(x => x.id === 'pview1'), true));
  await sleep(400);
  ok(await page.$('.iv-in'), '초대 이름 창이 안 떠요');
  await page.fill('.iv-in', '옆집 아저씨'); await sleep(200);
  ok(await page.isVisible('.iv-vh'), "목록에 없는 이름을 적는데 '구경으로 들어가요' 안내가 안 보여요");   // 판 -323
  await page.fill('.iv-in', '유진'); await sleep(200);
  ok(!(await page.isVisible('.iv-vh')), '목록에 있는 이름인데 구경 안내가 보여요');
  await page.fill('.iv-in', '옆집 아저씨'); await page.click('.iv-go'); await sleep(800);
  const st = await page.evaluate(() => ({ mem: __T.planAll().find(x => x.id === 'pview1').mem.length, v: __T.permIsV(__T.planAll().find(x => x.id === 'pview1')) }));
  ok(st.mem === 2, '목록에 없는 이름이 함께 가는 사람에 저절로 들어갔어요 ' + st.mem);
  ok(st.v, '목록에 없는 이름이 구경이 아니에요');
  await page.evaluate(async () => { const R = await __T.trRoom('tviewertest0001'), t = Date.now();   // 판 -321: 구경은 '구경에게도'로 켠 일행 위치만
    await __T.trSet('room:' + R.rid, { v: 1, last: { tc: t, tp: t, tl: t, tm: t }, tc: [{ id: 'c1', by: 'u1', nm: '성식', x: '비밀 대화', t }], tp: [], tm: [],
      tl: [{ id: 'u1', by: 'u1', nm: '성식', lat: 34.69, lng: 135.5, at: t, t, vw: 1 }, { id: 'u2', by: 'u2', nm: '유진', lat: 34.7, lng: 135.51, at: t, t }] }); });
  await page.goto(BASE + '?plan=1&p=pview1'); await sleep(1500); noErr(page, '구경 계획 화면');
  await sleep(1500);
  const pins = await page.$$eval('.tr-pin', a => a.length), mapTxt = await page.evaluate(() => (document.querySelector('.mapbox') || document.body).innerText);
  ok(pins === 1, '구경에게는 위치 공유를 구경에게도 켠 사람 1명만 보여야 해요: ' + pins);
  ok(!/비밀 대화/.test(mapTxt), '구경 지도에 일행 대화 말풍선이 보여요');
  ok(!/내 위치 공유/.test(await page.evaluate(() => document.body.innerText)), '구경에게 내 위치 공유 스위치가 보여요');
  const bar = await page.$$eval('.tv-bar button, .tv-bar a', a => a.map(x => x.textContent));
  ok(!bar.some(x => /AI 묻기/.test(x)), '구경에게 AI 묻기가 보여요: ' + bar.join(','));
  ok(bar.some(x => /사진/.test(x)) && !bar.some(x => /일행 채팅/.test(x)), "구경 아래 메뉴는 '일행 채팅' 대신 '사진'이어야 해요: " + bar.join(','));
  ok(!(await page.$('.n-ib[aria-label="일행 초대 · 일정 보내기"]')), '구경에게 초대 단추가 보여요');
  ok(/구경하는 중/.test(await page.evaluate(() => document.body.innerText)), "맨 위에 '구경하는 중' 안내가 없어요");
  await page.click('.pm-ban.v'); await sleep(400);
  const vs = await page.evaluate(() => document.body.innerText);
  ok(/구경도 보는 것/.test(vs) && /일행만 보는 것/.test(vs), "구경 안내를 눌러도 '보는 것 / 일행만 보는 것'이 안 나와요");
  await page.goto(BASE + '?plan=1&p=pview1'); await sleep(1500);
  await page.click('.tv-bar button:has-text("준비·정보")'); await sleep(500);
  const prep = await page.evaluate(() => document.body.innerText);
  ok(!/함께 가는 사람|여행 경비|예약 · 항공권|체크리스트/.test(prep), '구경에게 준비·정보의 일행 것(함께 가는 사람·경비·예약·체크리스트)이 보여요');
  // 일행 쪽: 준비·정보에 '🔒 일행만 보는 정보' 묶음, 채팅 칸에 '일행만 봐요'
  await page.evaluate(() => { localStorage.setItem('planV:pview1', '0'); localStorage.setItem('planMe:pview1', '"m1"'); localStorage.setItem('nick', '"성식"'); });
  await page.goto(BASE + '?plan=1&p=pview1'); await sleep(1500);
  await page.click('.tv-bar button:has-text("준비·정보")'); await sleep(500);
  ok(/🔒 일행만 보는 정보/.test(await page.evaluate(() => document.body.innerText)), "일행 준비·정보에 '일행만 보는 정보' 묶음이 없어요");
  await page.goto(BASE + '?plan=1&p=pview1&room=1'); await sleep(1500);
  ok(/일행만 봐요/.test(await page.$eval('.tr-in', t => t.placeholder)), "일행 채팅 칸에 '일행만 봐요'가 없어요");
  await page.evaluate(() => { localStorage.setItem('planV:pview1', '1'); localStorage.setItem('planMe:pview1', '"v"'); localStorage.setItem('nick', '"옆집 아저씨"'); });
  await page.goto(BASE + '?plan=1&p=pview1&room=1'); await sleep(2000); noErr(page, '구경 일행 채팅');
  const btns = await page.$$eval('button', bs => bs.map(b => b.textContent));
  ok(!btns.some(x => /💬 대화|📍 위치|보내기|사진 올리기|일행 초대/.test(x)), '구경에게 대화·위치·보내기·올리기·초대가 보여요: ' + btns.filter(x => /대화|위치|보내기|올리기|초대/.test(x)).join(','));
});

await test('첫 화면 꾸미기·바탕 사진이 같은 계정 다른 기기로 감 (판 -323)', async page => {
  await page.goto(BASE + '?my=1');
  const r = await page.evaluate(async () => {
    const cloud = {}, get = async k => cloud[k] ?? null, put = async (k, v) => { cloud[k] = v; };
    const deco = { pins: [{ k: 'r', t: 'walk_a', pid: 'p1', x: 30, y: 40, s: 100, a: 1 }], at: 5000 }, hero = 'data:image/jpeg;base64,AAAA';
    // 휴대폰: 꾸민 첫 화면 + 예전에 고른 바탕(시각 없음) → 올림
    localStorage.clear(); localStorage.setItem('homeDeco', JSON.stringify(deco)); localStorage.setItem('homeHero', JSON.stringify(hero));
    const g1 = await __T.decoSync(get, put);
    // PC: 아무것도 없음 → 받음
    localStorage.clear(); localStorage.setItem('homeBgPick', JSON.stringify('old'));
    const g2 = await __T.decoSync(get, put);
    const pc = { deco: JSON.parse(localStorage.getItem('homeDeco')), hero: JSON.parse(localStorage.getItem('homeHero')), pick: JSON.parse(localStorage.getItem('homeBgPick')) };
    // PC에서 더 나중에 꾸밈 → 휴대폰의 예전 것이 덮지 않음
    localStorage.setItem('homeDeco', JSON.stringify({ pins: [], at: 9000 })); localStorage.setItem('homeDecoAt', '9000');
    const g3 = await __T.decoSync(get, put);
    return { g1, g2, g3, pc, cl: JSON.parse(cloud['x/deco']).at };
  });
  ok(r.g1 === 0 && r.g2 === 1, '받음 표시가 틀림 ' + JSON.stringify(r));
  ok(r.pc.deco && r.pc.deco.pins.length === 1 && r.pc.deco.pins[0].pid === 'p1', 'PC가 꾸미기를 못 받음');
  ok(r.pc.hero === 'data:image/jpeg;base64,AAAA', 'PC가 바탕 사진을 못 받음');
  ok(r.pc.pick === null, '받은 바탕보다 예전에 고른 사진이 남음');
  ok(r.g3 === 0 && r.cl === 9000, '더 나중에 꾸민 것이 클라우드에 안 올라감');
  noErr(page, '첫 화면 꾸미기 맞추기');
});

await test('계획 사진 주소가 다른 기기로 감 · 이미 있는 사진은 안 바뀜 (판 -324)', async page => {
  await page.goto(BASE + '?my=1');
  const r = await page.evaluate(() => {
    __T.planSave({ id: 'pA', name: '호도협 1안', nd: 3, it: [] }); __T.planSave({ id: 'pB', name: '호도협 2안', nd: 3, it: [] });
    localStorage.setItem('planHero:pA', JSON.stringify({ u: 'https://upload.wikimedia.org/a.jpg', v: 7, at: 1 }));
    const sent = __T.planHeroAll();
    localStorage.removeItem('planHero:pA'); localStorage.setItem('planHero:pB', JSON.stringify({ u: 'https://upload.wikimedia.org/mine.jpg', v: 7, at: 1 }));
    const n = __T.planHeroTake(Object.assign({}, sent, { pB: { u: 'https://upload.wikimedia.org/other.jpg', v: 7 }, pX: { u: 'https://x/y.jpg', v: 7 } }));
    return { keys: Object.keys(sent), n, a: JSON.parse(localStorage.getItem('planHero:pA')).u, b: JSON.parse(localStorage.getItem('planHero:pB')).u, x: localStorage.getItem('planHero:pX') };
  });
  ok(r.keys.join() === 'pA', '보낼 사진 목록이 틀림 ' + JSON.stringify(r));
  ok(r.n === 1 && r.a === 'https://upload.wikimedia.org/a.jpg', '없는 계획 사진을 못 받음');
  ok(r.b === 'https://upload.wikimedia.org/mine.jpg', '이미 보여 준 계획 사진이 바뀜');
  ok(r.x === null, '이 기기에 없는 계획에 사진을 만듦');
  noErr(page, '계획 사진 맞추기');
});

await test('기록 고르기 · 덜 쓰는 모드는 더보기 안 (판 -306)', async page => {
  await page.goto(BASE); await sleep(800);
  await page.evaluate(() => localStorage.removeItem('lastMode'));
  await page.goto(BASE); await sleep(1200);
  const r = await page.evaluate(async () => {
    const b = [...document.querySelectorAll('a,button')].find(x => /기록하기|기록 시작하기/.test(x.textContent)); if (!b) return { none: 1 }; b.click(); await new Promise(z => setTimeout(z, 300));
    const n0 = [...document.querySelectorAll('.sheet .modes .mode')].map(x => x.textContent.trim());
    document.querySelector('.sheet .modes .mode.more').click();
    const n1 = [...document.querySelectorAll('.sheet .modes .mode')].map(x => x.textContent.trim());
    return { n0, n1 };
  });
  ok(r.n0 && r.n0.length === 8 && !r.n0.some(x => /파크골프|캠핑|백패킹/.test(x)) && /더보기/.test(r.n0[7]), '처음 화면 모드가 이상해요 ' + JSON.stringify(r));
  ok(r.n1.length === 10 && r.n1.some(x => /파크골프/.test(x)), '더보기를 눌러도 다 안 나와요 ' + JSON.stringify(r.n1));
  noErr(page, '기록 고르기');
});

await browser.close();
server.close();
console.log(`\n결과: 통과 ${pass} · 실패 ${fail}` + (fails.length ? '\n실패: ' + fails.join(', ') : ''));
process.exit(fail ? 1 : 0);
