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
const EXPOSE = ['photoPut', 'photoDel', 'photoList', 'planSave', 'planDel', 'planAll', 'planMerge', 'errSheet', 'trackAdd', 'trackLoad', 'trackStats', 'trackModes', 'flyFlags', 'planCopy', 'planPack', 'planUnpack', 'backupMake', 'backupLoad', 'goneMark', 'recMerge'];
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

await browser.close();
server.close();
console.log(`\n결과: 통과 ${pass} · 실패 ${fail}` + (fails.length ? '\n실패: ' + fails.join(', ') : ''));
process.exit(fail ? 1 : 0);
