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
const EXPOSE = ['destFx', 'cardDistStats', 'trackStats', 'recApply', 'permSheet', 'koNameInfo', 'koPlaceCC', 'koHanjaLoad', 'expWho', 'planAskName', 'permOf', 'permIsV', 'trSet', 'planPhotos', 'filmTripRange', 'filmInset', 'filmAutoStyle', 'photoPut', 'photoDel', 'photoList', 'planSave', 'planDel', 'planAll', 'planMerge', 'errSheet', 'trackAdd', 'trackLoad', 'trackStats', 'trackModes', 'flyFlags', 'planCopy', 'planPack', 'planUnpack', 'backupMake', 'backupLoad', 'goneMark', 'recMerge', 'trRoom', 'trSet', 'autoFix', 'autoSt', 'expCalc', 'expGuess', 'decoSync', 'planHeroAll', 'planHeroTake', 'tripMeSync', 'trLocOne', 'trLoginNeed', 'permIsV0', 'ptMake', 'ptOpen', 'ptWallTs', 'ptRoute', 'cRecordSheet', 'filmSplitSel', 'filmSplitAt', 'filmDirector', 'filmPhotoPlace', 'filmAt', 'FILM_STYLES', 'filmAiHero', 'vtGet', 'koHanjaWire', 'filmPath', 'filmCoverG', 'guestLink', 'guestDrop', 'shrinkImage'];
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
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return;   // 하나만 돌리기: ONLY='이름 일부' npm test
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

// ─── 10b. 구글 테이크아웃 사진으로 만든 여행(tools/takeout2mpd, 산티아고 순례길) ───
// fixtures/takeout_sample.json = 그 도구가 가짜 테이크아웃(3일 · 사진 18장, 위치 없는 사진 3장 · 같은 사진 두 폴더)으로 만든 백업
await test('테이크아웃 사진 여행: 백업으로 들어가고 · 여행 화면 열림 · 지운 날은 안 살아남', async page => {
  await seed(page);
  // backupLoad는 끝에 화면을 다시 불러와서(location.reload), 불러오기마다 다시 열린 뒤 확인해요
  const load = async () => { await Promise.all([page.waitForNavigation({ timeout: 30000 }), page.evaluate(async () => {
    const d = await (await fetch('tests/fixtures/takeout_sample.json')).json();
    __T.backupLoad(new File([JSON.stringify(d)], 'b.json', { type: 'application/json' })); })]); await sleep(800); };
  const al = await page.evaluate(async () => JSON.parse((await (await fetch('tests/fixtures/takeout_sample.json')).json()).ls.albums)[0]);
  await load();
  const r = await page.evaluate(async al => {
    const days = al.days.map(id => ({ id, tr: __T.trackLoad(id).length, a: JSON.parse(localStorage.getItem('walkAlbum:' + id) || 'null') }));
    const ph = []; for (const id of al.days) ph.push((await __T.photoList(id)).length);
    const noLoc = (await __T.photoList(al.days[0])).filter(p => p.lat == null).length;
    return { days, ph, noLoc, inAlbums: (JSON.parse(localStorage.getItem('albums') || '[]').find(a => a.id === al.id) || {}).days };
  }, al);
  ok(r.days.length === 3 && r.days.every(x => x.tr > 10 && x.a === al.id), '하루 기록 3개가 여행에 묶여 길이 있어야 해요: ' + JSON.stringify(r.days));
  ok((r.inAlbums || []).length === 3, '여행 묶음에 3일이 있어야 해요: ' + r.inAlbums);
  ok(r.ph.join() === '6,6,6', '날마다 사진 6장(같은 사진 두 폴더는 한 번만)이어야 해요: ' + r.ph);
  ok(r.noLoc === 0, '위치 없는 사진도 길 위 자리에 놓여야 해요');
  page.errs = [];
  await page.goto(BASE + '?my=1&t=' + al.id); await sleep(2500);
  noErr(page, '여행 화면');
  ok(/산티아고 순례길/.test(await page.innerText('body')), '여행 화면에 이름이 보여야 해요');
  // 판 -337: 여행 화면 아래 '날마다'(1일·2일·3일), 내 MPD 목록에서는 하루치가 여행 한 장으로 접힘
  { const b = await page.innerText('body'); ok(/날마다/.test(b) && /(^|\n)3일(\n|$)/.test(b), '여행 화면에 날마다 목록(1일~3일)이 있어야 해요'); }
  await page.goto(BASE + '?my=1'); await sleep(2500);
  { const b = await page.innerText('body'); ok(/산티아고 순례길/.test(b) && !/산티아고 순례길 \d+일차/.test(b), '목록에는 여행 한 장만, 하루치(n일차)는 안 보여야 해요'); }
  // 판 -334 현지 시간: 1일차 첫 사진은 UTC 06:00 = 마드리드 오전 8:00(시험 브라우저는 서울 시간이라 예전엔 오후 3:00으로 보였음)
  await page.goto(BASE + '?my=1&t=' + al.days[0]); await sleep(2000);
  { const b = await page.innerText('body'); ok(/오전 8:00 ~ .* 현지 시간/.test(b), '1일차가 스페인 현지 시간(오전 8:00 ~ … 현지 시간)으로 보여야 해요: ' + (b.match(/.{0,20}현지 시간|오[전후] \d+:\d\d ~ [^\n]*/) || [''])[0]); }
  noErr(page, '하루 기록 화면');
  // 판 -338: 사진 동그라미는 absolute여야 찍은 자리에 놓여요(relative면 앞 동그라미만큼 아래로 밀림)
  { const pos = await page.evaluate(() => { const p = document.querySelector('.leaflet-marker-icon.ph-pin'); return p ? getComputedStyle(p).position : 'none'; });
    ok(pos === 'absolute', '지도 사진 동그라미 position이 absolute여야 해요: ' + pos); }
  // 2일차를 지우고 같은 파일을 또 불러옴 → 2일차가 되살아나면 안 됨, 1일차 사진이 두 번 들어가도 안 됨
  await page.evaluate(async al => { localStorage.removeItem('track:' + al.days[1]); __T.goneMark([al.days[1]]); for (const p of await __T.photoList(al.days[1])) await __T.photoDel(p.id); }, al);
  await load();
  const q = await page.evaluate(async al => ({ back: localStorage.getItem('track:' + al.days[1]), ph2: (await __T.photoList(al.days[1])).length, ph1: (await __T.photoList(al.days[0])).length }), al);
  ok(q.back == null, '지운 2일차가 백업에서 되살아났어요');
  ok(q.ph1 === 6, '같은 파일을 두 번 불러와 사진이 겹쳤어요: ' + q.ph1);
  ok(q.ph2 === 0, '지운 2일차 사진이 되살아났어요: ' + q.ph2);
});

// 판 -340: 사진으로 지난 여행 만들기 — 사진 시각·위치 → 날마다 기록 + 여행 한 장, 다시 해도 안 겹치고, 지운 날은 안 살아남
await test('사진으로 지난 여행 만들기', async page => {
  await page.goto(BASE + '?my=1'); await sleep(1500);
  page.errs = [];
  // 내 MPD 맨 아래 줄 → 창
  // 판 -347: '+ 기록하기' 창 안 '지난 날 기록하기'
  await page.evaluate(() => __T.cRecordSheet()); await sleep(300);
  await page.click('button:has-text("지난 날 기록하기")'); await sleep(400);
  ok(await page.isVisible('[aria-label="지난 날 기록하기"] >> text=사진 고르기'), '기록하기 → 지난 날 사진으로 기록하기 창이 떠야 해요');
  await page.evaluate(() => document.querySelector('.sheet-bg')?.remove());
  // 판 -348: 예전 앱(MD_NATIVE인데 사진첩 찾기 없음)은 고르기 대신 새 앱 안내
  ok(await page.evaluate(async () => { window.MD_NATIVE = 1; __T.ptOpen(); await new Promise(r => setTimeout(r, 200)); const t = document.querySelector('.sheet-bg').innerText; document.querySelector('.sheet-bg').remove(); delete window.MD_NATIVE; return /새 앱이 필요해요/.test(t) && !/사진 고르기/.test(t); }), '예전 앱에선 새 앱 안내가 나와야 해요');
  const mk = () => page.evaluate(async () => {
    const jpg = async c => { const cv = document.createElement('canvas'); cv.width = 64; cv.height = 48; const g = cv.getContext('2d'); g.fillStyle = c; g.fillRect(0, 0, 64, 48); return new File([await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.8))], 'x.jpg', { type: 'image/jpeg' }); };
    const P = (n, d, h, m, lat, lng, c) => ({ name: n, wall: [2018, 10, d, h, m, 0], off: '+02:00', lat, lng, c });
    const raw = [P('a1.jpg', 5, 8, 0, 42.60, -5.57, '#a00'), P('a2.jpg', 5, 10, 0, 42.58, -5.62, '#0a0'), P('a3.jpg', 5, 11, 0, null, null, '#00a'), P('a4.jpg', 5, 13, 0, 42.55, -5.70, '#aa0'),
      P('b1.jpg', 6, 8, 30, 42.50, -5.80, '#0aa'), P('b2.jpg', 6, 12, 0, 42.47, -5.88, '#a0a'), P('a1.jpg', 5, 8, 0, 42.60, -5.57, '#a00')];   // 마지막은 같은 사진 한 번 더
    const items = []; for (const x of raw) items.push({ ...x, f: await jpg(x.c) });
    return await __T.ptMake(items, '시험 여행', null);
  });
  const r = await mk();
  ok(!r.err && r.n === 2 && r.days === 2 && r.ph === 6, '이틀·사진 6장(같은 사진은 한 번)이 만들어져야 해요: ' + JSON.stringify(r));
  const q = await page.evaluate(async al => { const a = JSON.parse(localStorage.getItem('albums')).find(x => x.id === al);
    const d = []; for (const id of a.days) { const ph = await __T.photoList(id); d.push({ id, tr: __T.trackLoad(id).length, ph: ph.length, noLoc: ph.filter(p => p.lat == null).length, tz: JSON.parse(localStorage.getItem('walkTz:' + id)), al: JSON.parse(localStorage.getItem('walkAlbum:' + id)), nm: JSON.parse(localStorage.getItem('trackName:' + id)) }); }
    const t0 = __T.trackLoad(a.days[0])[0][2]; return { name: a.name, d, t0 }; }, r.al);
  ok(q.name === '시험 여행' && q.d.length === 2, '여행 한 장에 이틀이 묶여야 해요: ' + JSON.stringify(q));
  ok(q.d.every(x => x.tr >= 2 && x.al === r.al && x.tz && x.noLoc === 0), '날마다 길·여행·시간대가 있고 위치 없는 사진도 길 위에 놓여야 해요: ' + JSON.stringify(q.d));
  ok(q.d[0].ph === 4 && q.d[1].ph === 2 && /시험 여행 1일차/.test(q.d[0].nm), '1일차 사진 4장·2일차 2장: ' + JSON.stringify(q.d));
  ok(q.t0 === Date.UTC(2018, 9, 5, 6, 0, 0), '사진 속 시차(+02:00)로 진짜 시각을 셈해야 해요: ' + new Date(q.t0).toISOString());
  ok(await page.evaluate(() => __T.ptWallTs([2018, 10, 5, 8, 0, 0], 'Europe/Madrid') === Date.UTC(2018, 9, 5, 6, 0, 0)), '마드리드 벽시계 8:00 = UTC 6:00');
  // 다시 해도 겹치지 않아요
  const r2 = await mk();
  ok(r2.al === r.al && r2.days === 0 && r2.old === 2, '두 번째는 새 기록 없이 있던 날로: ' + JSON.stringify(r2));
  ok(await page.evaluate(async al => { const a = JSON.parse(localStorage.getItem('albums')).find(x => x.id === al); return (await __T.photoList(a.days[0])).length; }, r.al) === 4, '다시 해도 사진이 겹치면 안 돼요');
  // 2일차를 지우고 또 하면 되살아나면 안 돼요
  const d2 = q.d[1].id;
  await page.evaluate(async id => { localStorage.removeItem('track:' + id); __T.goneMark([id]); for (const p of await __T.photoList(id)) await __T.photoDel(p.id); }, d2);
  await mk();
  ok(await page.evaluate(async id => localStorage.getItem('track:' + id) == null && (await __T.photoList(id)).length === 0, d2), '지운 2일차가 되살아났어요');
  // 판 -342: 비행기(인천→마드리드)는 길 찾기를 묻지 않고 곧은 줄
  ok(await page.evaluate(async () => { const st = {}; const r = await __T.ptRoute({ lat: 37.46, lng: 126.44, ts: 0 }, { lat: 40.47, lng: -3.57, ts: 13 * 3600000 }, st); return r === null && !st.off; }), '비행기 구간은 길 찾기 없이 곧은 줄이어야 해요');
  // 판 -346: 같은 이름으로 나눠 넣으면 한 여행에 이어 붙고, 같은 날이면 길을 다시 그려요
  const r4 = await page.evaluate(async () => {
    const jpg = async () => { const cv = document.createElement('canvas'); cv.width = 32; cv.height = 24; return new File([await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.8))], 'y.jpg', { type: 'image/jpeg' }); };
    const P = (n, d, h, lat, lng) => ({ name: n, wall: [2025, 1, d, h, 0, 0], off: '+08:00', lat, lng });
    const b1 = [P('h1.jpg', 9, 10, 22.30, 114.17), P('h2.jpg', 9, 12, 22.28, 114.16)], b2 = [P('h3.jpg', 9, 15, 22.27, 114.15), P('h4.jpg', 10, 10, 22.29, 114.17), P('h5.jpg', 10, 12, 22.31, 114.18)];
    for (const x of [...b1, ...b2]) x.f = await jpg();
    const a = await __T.ptMake(b1, '진호와 홍콩', null), b = await __T.ptMake(b2, '진호와 홍콩', null);
    const al = JSON.parse(localStorage.getItem('albums')).filter(x => x.name === '진호와 홍콩');
    const d1 = al[0].days.find(id => JSON.parse(localStorage.getItem('track:' + id))[0][2] < Date.UTC(2025, 0, 9, 12));
    return { same: a.al === b.al, n: al.length, days: al[0].days.length, more: b.more, ph1: (await __T.photoList(d1)).length, last: __T.trackLoad(d1).at(-1).slice(0, 2), names: al[0].days.map(id => JSON.parse(localStorage.getItem('trackName:' + id))).sort() };
  });
  ok(r4.same && r4.n === 1 && r4.days === 2 && r4.more, '나눠 넣어도 한 여행이어야 해요: ' + JSON.stringify(r4));
  ok(r4.ph1 === 3 && r4.last[0] === 22.27, '첫날은 사진 3장이고 길이 세 번째 사진까지 이어져야 해요: ' + JSON.stringify(r4));
  ok(r4.names.join() === '진호와 홍콩 1일차,진호와 홍콩 2일차', '날 이름이 날짜 차례: ' + r4.names);
  // 위치 없는 사진뿐이면 만들지 않고 까닭을 알려요
  const r3 = await page.evaluate(() => __T.ptMake([{ name: 'z.jpg', wall: [2018, 1, 1, 9, 0, 0], lat: null, lng: null }], '', null));
  ok(r3.err === 'noloc', '위치 없는 사진만이면 noloc: ' + JSON.stringify(r3));
  page.errs = page.errs.filter(e => !/net::|Failed to fetch|ERR_/.test(e));
  noErr(page, '사진으로 여행 만들기');
});

// 판 -344: 인천 출발(서울 시간)·스페인 날이 섞인 여행은 첫날·끝날을 그날 시간대로
await test('나라를 오간 여행 n박 m일', async page => {
  await page.goto(BASE + '?my=1');
  await page.evaluate(() => {
    const A = 'album_tzmix1', d1 = 'walk_tzmix001', d2 = 'walk_tzmix002', set = (k, v) => localStorage.setItem(k, JSON.stringify(v)), t = s => new Date(s).getTime();
    set('track:' + d1, [[37.53, 126.63, t('2018-10-03T05:00:00+09:00')], [37.45, 126.44, t('2018-10-03T19:00:00+09:00')]]); set('walkTz:' + d1, 'Asia/Seoul');
    set('track:' + d2, [[42.6, -5.57, t('2018-10-04T08:00:00+02:00')], [42.55, -5.7, t('2018-10-04T15:00:00+02:00')]]); set('walkTz:' + d2, 'Europe/Madrid');
    for (const d of [d1, d2]) { set('walkMode:' + d, 'travel'); set('walkAlbum:' + d, A); }
    set('walkMode:' + A, 'travel'); set('albums', [{ id: A, name: '섞인 시간대', mode: 'travel', days: [d2, d1], at: 1 }]);
  });
  page.errs = [];
  await page.goto(BASE + '?my=1&t=album_tzmix1'); await sleep(2500);
  const b = await page.innerText('body');
  ok(/1박 2일/.test(b), '인천 10/3 새벽 출발~레온 10/4는 1박 2일: ' + (b.match(/\d+박 \d+일/) || [''])[0]);
  ok(/10월 3일/.test(b), '날마다 첫날은 서울 날짜 10월 3일');
  ok(/2018년 10월 3일 \(수\) ~ 10월 4일/.test(b), '여행 머리 날짜도 10월 3일 ~ 10월 4일: ' + (b.match(/2018년[^\n]*/) || [''])[0]);
  noErr(page, '섞인 시간대 여행');
});

// 판 -343: 차·비행기를 탄 기록은 지도에 👣·🚗·✈ / 걷기만 한 기록엔 안 그림
await test('지도 길 표시: 발자국·차·비행기', async page => {
  await page.goto(BASE + '?my=1'); await sleep(1200);
  const r = await page.evaluate(() => {
    const t0 = Date.UTC(2018, 9, 20, 8), tr = [];
    for (let i = 0; i <= 20; i++) tr.push([42.83 + i * 0.003, -8.54, t0 + i * 180000, null, 1]);                 // 걷기 6.7km 60분
    for (let i = 1; i <= 40; i++) tr.push([42.89 + i * 0.01, -8.54 + i * 0.01, t0 + 60 * 60000 + i * 60000, null, 0]);   // 차 50km 40분
    const set = (k, v) => localStorage.setItem(k, JSON.stringify(v));
    set('track:walk_modeic1', tr); set('walkMode:walk_modeic1', 'travel');
    set('track:walk_modeic2', tr.slice(0, 21)); set('walkMode:walk_modeic2', 'travel');
    return 1; });
  page.errs = [];
  await page.goto(BASE + '?my=1&t=walk_modeic1'); await sleep(2500);
  const a = await page.evaluate(() => [...document.querySelectorAll('.mode-ic path')].map(p => p.getAttribute('fill')));
  ok(a.includes('#4B5563') && a.includes('#E4572E'), '차·걷기 조각에 🚗·👣이 있어야 해요: ' + a);
  await page.goto(BASE + '?my=1&t=walk_modeic2'); await sleep(2000);
  ok(await page.evaluate(() => document.querySelectorAll('.mode-ic').length) === 0, '걷기만 한 기록엔 그리지 않아야 해요');
  noErr(page, '지도 길 표시');
});

// 판 -335: 여러 날 여행 날짜·n박 m일도 그 여행 시간대로(마드리드 밤 11시는 서울로 다음 날 아침이라 예전엔 하루가 더 셈)
await test('여러 날 여행 n박 m일은 현지 날짜로', async page => {
  await page.goto(BASE + '?my=1');
  await page.evaluate(() => {
    const A = 'album_tztest1', d1 = 'walk_tzday001', d2 = 'walk_tzday002', set = (k, v) => localStorage.setItem(k, JSON.stringify(v));
    const t = (s) => new Date(s).getTime();
    set('track:' + d1, [[42.6, -5.57, t('2018-10-05T08:00:00+02:00')], [42.55, -5.7, t('2018-10-05T15:00:00+02:00')]]);
    set('track:' + d2, [[42.5, -5.8, t('2018-10-06T08:00:00+02:00')], [42.47, -5.88, t('2018-10-06T23:00:00+02:00')]]);
    for (const d of [d1, d2]) { set('walkMode:' + d, 'travel'); set('walkAlbum:' + d, A); set('walkTz:' + d, 'Europe/Madrid'); }
    set('walkMode:' + A, 'travel'); set('albums', [{ id: A, name: '시간대 시험', mode: 'travel', days: [d1, d2], at: 1 }]);
  });
  page.errs = [];
  await page.goto(BASE + '?my=1&t=album_tztest1'); await sleep(2500);
  noErr(page, '여행 화면');
  const b = await page.innerText('body');
  ok(/1박 2일/.test(b) && !/2박 3일/.test(b), '마드리드 10/5~10/6 여행은 1박 2일이어야 해요: ' + (b.match(/\d+박 \d+일/) || [''])[0]);
  ok(/10월 5일 \(금\) ~ 10월 6일 \(토\)/.test(b), '날짜 범위가 현지 날짜(10월 5일 ~ 10월 6일)여야 해요');
});

// 판 -339: 예전 판이 올린 기록(kv 없음·walkTz: 없음)을 받아도 walkTz:는 남고, 새 판이 올린 기록(kv에 walkTz:)에 없으면 지움
await test('맞추기 받기: 예전 판 기록이 walkTz:를 안 지움', async page => {
  await page.goto(BASE + '?my=1');
  const r = await page.evaluate(() => {
    const id = 'walk_kvtest01'; localStorage.setItem('walkTz:' + id, JSON.stringify('Europe/Madrid')); localStorage.setItem('walkNote:' + id, JSON.stringify('메모'));
    __T.recApply(id, { ls: { 'track:': '[[1,2,3],[1,2,4]]', 'trackName:': '"a"' } });   // 예전 판(333): kv 없음, walkNote도 없음
    const a = { tz: localStorage.getItem('walkTz:' + id), note: localStorage.getItem('walkNote:' + id) };
    __T.recApply(id, { ls: { 'track:': '[[1,2,3],[1,2,4]]' }, kv: ['track:', 'trackName:', 'walkTz:'] });   // 새 판: walkTz를 일부러 뺀 것
    return { a, b: localStorage.getItem('walkTz:' + id) };
  });
  ok(r.a.tz === '"Europe/Madrid"', '예전 판 기록을 받아도 walkTz:가 남아야 해요: ' + r.a.tz);
  ok(r.a.note == null, '예전 판이 아는 키(walkNote:)는 클라우드에 없으면 지워져야 해요');
  ok(r.b == null, '새 판이 kv에 walkTz:를 넣고 뺀 것은 지워져야 해요');
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

await test('세 칸 화면은 끝 장면 전까지 화면 가득으로 바뀌지 않음 (판 -349)', async () => {
  // 사용자 '세 화면분리 고정해. 자꾸 전체화면 생기니까 어지럽기만해': 날 바뀜·대표 사진·처음 제목에서 세 칸이 풀리면 안 돼요
  const h = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const i = h.indexOf('if (SPLIT) {   // 판 -300 세 칸'), blk = h.slice(i, i + 1600);
  ok(i > 0, '세 칸 그리기 자리를 못 찾았어요');
  ok(!/plan\.holds[^\n]*sa = Math\.min/.test(blk), '날이 바뀔 때 세 칸이 풀려요');
  ok(/const sa = Math\.max\(0, Math\.min\(1, \(end - tt\) \/ 0\.5\)\)/.test(blk), '처음부터 세 칸이 아니에요');
  ok(/dayCard\(h, a, [^\n]*\{ y: SA, h: SB \}\)/.test(h), "'n일차'가 가운데 칸 안에 안 나와요");
  ok(/if \(!SPLIT\) for \(const h of \(plan\.holds/.test(h), "세 칸에서도 화면 가득 'n일차'가 나와요");
  ok(/if \(SPLIT\) \{ spHero = [^\n]*heroG = null; \}/.test(h) && /if \(!SPLIT && !plan\.tHero && tt < plan\.tTitle/.test(h), '세 칸에서 처음 대표 사진·제목이 화면 가득 나와요');
});

await test('세 칸 영상 · 아래 칸 사진은 늘 지도 머리가 있는 곳에서 찍은 것 (판 -349)', async page => {
  // 2026-11-23 사용자 '위치와 사진이 전혀 안 맞아 · MPD는 이게 기본인데': 인천 출발(1일차) 지도에 스페인 사진이 나왔음
  //   인천 20km → 비행 → 스페인 21일 걷기(날마다 15km) · 사진 266장(위치 있는 것 250, 그중 10장은 시각이 틀림 · 위치 없는 것 16)
  await seed(page); await page.goto(BASE); await sleep(800);
  const r = await page.evaluate(() => {
    const P = []; let d = 0, ts = Date.UTC(2026, 9, 3, 0, 0), prev = null;
    const add = (lat, lng, t) => { if (prev) d += Math.hypot((lat - prev.lat) * 111000, (lng - prev.lng) * 85000); P.push({ lat, lng, ts: t, d, g: d }); prev = { lat, lng }; };
    for (let i = 0; i <= 40; i++) add(37.45 + i * 0.001, 126.6 + i * 0.004, ts + i * 60000);   // 인천 (1일차)
    ts = Date.UTC(2026, 9, 4, 8, 0); const days = [{ n: 1, d: 0, ts: P[0].ts }];
    for (let k = 0; k < 21; k++) { const t0 = ts + k * 864e5; for (let i = 0; i <= 150; i++) { add(42.6 + Math.sin(i / 20) * 0.01, -5.6 + k * 0.2 + i * 0.2 / 150, t0 + i * 120000); if (i === 0) days.push({ n: k + 2, d: P[P.length - 1].d, ts: t0 }); } }
    const D = P[P.length - 1].d;
    const runs = [{ k: 'fly', a: P[40].d, b: P[41].d }];
    const L = []; let id = 0;
    for (let k = 0; k < 21; k++) for (let j = 0; j < 12; j++) { const i = 41 + k * 151 + 20 + Math.floor(j / 4) * 50 + (j % 4); const q = P[i];   // 날마다 마을 세 곳에서 4장씩
      const bad = (k * 12 + j) % 25 === 3;   // 시각이 틀린 사진: 시각은 인천 출발 때, 위치는 스페인
      L.push({ id: 'p' + (id++), lat: q.lat, lng: q.lng, ts: bad ? P[5].ts : q.ts, blob: 1 }); }
    for (let k = 0; k < 4; k++) L.push({ id: 'p' + (id++), lat: 37.46, lng: 126.62 + k * 0.01, ts: P[10 + k * 5].ts, blob: 1 });
    for (let k = 0; k < 16; k++) L.push({ id: 'p' + (id++), ts: P[41 + k * 190].ts, blob: 1 });   // 위치 없는 사진
    const F = __T.filmPhotoPlace(L, P, D), st = __T.FILM_STYLES.trip, T = 120;
    const sel = __T.filmSplitSel(F, P, D, { T, st, hero: 1.4, days, runs });
    const plan = __T.filmDirector({ D, T, st, adv: { rh: 1, z: 0, phK: 1, info: 1 }, hl: sel.sel.map(c => ({ d: c.hd, w: 1 })), runs, days, hero: 1.4, phHolds: sel.holds });
    const dbg = []; let frames = 0, bad = 0, worst = 0, shownDays = new Set(), ids = new Set(), noPin = 0;
    for (let f = 0; f < T * 30; f++) { const tt = f / 30, at = __T.filmSplitAt(plan, tt); if (!at) continue; frames++;
      const hd = __T.filmAt(P, plan.dOfT(tt));
      for (const g of at.ps) { ids.add(g.p.id); if (!g.pin) { noPin++; continue; } const m = Math.hypot((hd.lat - g.pin[1]) * 111000, (hd.lng - g.pin[0]) * 85000); worst = Math.max(worst, m); if (m > 1000) { bad++; if (dbg.length < 6) dbg.push([+tt.toFixed(2), at.out ? 'out' : 'in', Math.round(m), Math.round(at.h.d), Math.round(plan.dOfT(tt)), g.p.id]); } }
      shownDays.add(at.h.ph.day); }
    const tEnd = plan.tIn + plan.tRun, lastT1 = Math.max(...plan.phHolds.map(h => h.t1));
    return { dbg, frames, bad, worst: Math.round(worst), days: shownDays.size, shown: ids.size, holds: plan.phHolds.length, lastT1, tEnd, tIn: plan.tIn };
  });
  ok(r.bad === 0, `지도 머리와 사진이 ${r.worst}m 떨어져 나와요 (${r.bad}번)`);
  ok(r.days >= 22, '사진이 안 나오는 날이 있어요 ' + r.days + '/22');
  ok(r.shown >= 80, '사진이 너무 적게 나와요 ' + r.shown);
  ok(r.lastT1 <= r.tEnd + 0.01, '사진 멈춤이 끝 장면을 넘어가요');
  console.log('   ' + JSON.stringify(r));
});

await test('영상 첫 사진 · AI가 고른 것은 기억해서 다시 안 부르고, 그 사진을 지우면 다시 안 나옴 (판 -349)', async page => {
  // 2026-11-23 사용자 '첫 사진 선정부터 실망!!' → AI로 고르기
  await seed(page); await page.goto(BASE); await sleep(800);
  const r = await page.evaluate(async () => {
    localStorage.setItem('filmAiHero:T1', JSON.stringify({ id: 'p7', why: '메세타 들판' }));
    const g = id => ({ p: { id, blob: new Blob(['x']) }, ts: 1 });
    const kept = await __T.filmAiHero('T1', [g('p1'), g('p7'), g('p9')]);
    const gone = await __T.filmAiHero('T1', [g('p1'), g('p9')]);   // p7을 지운 뒤 (열쇠가 없으면 AI도 안 불러요)
    return { kept, gone };
  });
  ok(r.kept && r.kept.id === 'p7' && r.kept.why === '메세타 들판', '기억해 둔 첫 사진을 안 써요 ' + JSON.stringify(r.kept));
  ok(r.gone === null, '지운 사진이 첫 사진으로 다시 나와요 ' + JSON.stringify(r.gone));
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
  await page.evaluate(() => { localStorage.setItem('homeMapNew', 'true'); localStorage.setItem('homeStyle', '"photo"'); });   // 판 -362부터 기본은 지도 첫 화면 → 사진 모양을 고른 사람
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
  await page.evaluate(() => { localStorage.setItem('planV:pview1', '0'); localStorage.setItem('planMe:pview1', '"m1"'); localStorage.setItem('nick', '"성식"'); localStorage.setItem('cloudOn', 'true'); localStorage.setItem('cloudUid', '"uidTEST"'); });   // 판 -333: 일행은 로그인한 사람
  await page.goto(BASE + '?plan=1&p=pview1'); await sleep(1500);
  await page.click('.tv-bar button:has-text("준비·정보")'); await sleep(500);
  ok(/🔒 일행만 보는 정보/.test(await page.evaluate(() => document.body.innerText)), "일행 준비·정보에 '일행만 보는 정보' 묶음이 없어요");
  await page.goto(BASE + '?plan=1&p=pview1&room=1'); await sleep(1500);
  ok(/일행만 봐요/.test(await page.$eval('.tr-in', t => t.placeholder)), "일행 채팅 칸에 '일행만 봐요'가 없어요");
  await page.evaluate(() => { localStorage.setItem('planV:pview1', '1'); localStorage.setItem('planMe:pview1', '"v"'); localStorage.setItem('nick', '"옆집 아저씨"'); localStorage.setItem('cloudOn', 'false'); });
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

await test('같은 계정이면 여행 일행에서도 같은 사람 · 방 주인 쪽이 이김 (판 -329)', async page => {
  await page.goto(BASE + '?my=1');
  const r = await page.evaluate(async () => {
    const S = by => JSON.stringify({ own: { by, nm: '길벗' }, perm: { by, m: {}, def: { r: 1, w: 1, ai: 0 } } });
    // PC(주인 아님)가 먼저 맞춤 → 자기 '나'를 올림
    localStorage.clear(); localStorage.setItem('tripMe', '"pcpcpcpc11"'); localStorage.setItem('tripPermC:tx1', S('phph2222ph'));
    const a = await __T.tripMeSync(null);
    // 휴대폰(방 주인)이 맞춤 → PC 것을 받지 않고 자기 것을 올림
    localStorage.clear(); localStorage.setItem('tripMe', '"phph2222ph"'); localStorage.setItem('tripPermC:tx1', S('phph2222ph'));
    const b = await __T.tripMeSync(a.up); const phPk = JSON.parse(localStorage.getItem('tripPk'));
    // PC가 다시 맞춤 → 휴대폰의 '나'와 열쇠를 받아 주인이 됨, 예전 '나'는 남김
    localStorage.clear(); localStorage.setItem('tripMe', '"pcpcpcpc11"'); localStorage.setItem('tripPermC:tx1', S('phph2222ph')); localStorage.setItem('tripTk:r1', '{"nm":"길벗"}');
    const c = await __T.tripMeSync(b.up);
    const p = { id: 'px', room: { code: 'tx1' }, mem: [{ n: '고성식' }] };
    return { a: a.took, aId: a.up.id, b: b.took, bId: b.up.id, bOwn: b.up.own, c: c.took, me: JSON.parse(localStorage.getItem('tripMe')), samePk: JSON.stringify(JSON.parse(localStorage.getItem('tripPk'))) === JSON.stringify(phPk),
      old: JSON.parse(localStorage.getItem('tripMeOld'))[0].id, tk: localStorage.getItem('tripTk:r1'), v: __T.permIsV(p) };
  });
  ok(r.a === 0 && r.aId === 'pcpcpcpc11', 'PC가 처음 올릴 때 틀림 ' + JSON.stringify(r));
  ok(r.b === 0 && r.bId === 'phph2222ph' && r.bOwn === 1, '방 주인 휴대폰이 주인 아닌 PC의 나로 바뀜 ' + JSON.stringify(r));
  ok(r.c === 1 && r.me === 'phph2222ph' && r.samePk, 'PC가 휴대폰의 나·열쇠를 못 받음 ' + JSON.stringify(r));
  ok(r.old === 'pcpcpcpc11' && r.tk === null, '예전 나를 안 남겼거나 이름 표시를 다시 안 올림 ' + JSON.stringify(r));
  ok(r.v === false, 'PC가 아직 구경(보기만)으로 보임');
  noErr(page, '여행 일행 같은 사람');
});

await test('일행 지도 · 같은 사람은 한 번만 (웹·앱·PC를 오가도) (판 -332)', async page => {
  await page.goto(BASE + '?my=1');
  const r = await page.evaluate(() => {
    localStorage.setItem('tripMe', '"nowme1234x"'); localStorage.setItem('tripMeOld', JSON.stringify([{ id: 'oldpc1234x' }]));
    const t = Date.now();
    const L = [{ by: 'web111', nm: '유진', at: t - 600000, lat: 1, lng: 1 }, { by: 'app222', nm: ' 유 진', at: t - 1000, lat: 2, lng: 2 },
      { by: 'oldpc1234x', nm: '길벗', at: t - 900000, lat: 3, lng: 3 }, { by: 'nowme1234x', nm: '길벗', at: t - 2000, lat: 4, lng: 4 },
      { by: 'mom333', nm: '엄마', at: t - 5000, lat: 5, lng: 5 }];
    return __T.trLocOne(L).map(x => x.by).sort();
  });
  ok(JSON.stringify(r) === JSON.stringify(['app222', 'mom333', 'nowme1234x']), '같은 사람이 여러 번 보임 ' + JSON.stringify(r));
  noErr(page, '일행 지도 한 사람');
});

await test('여행 일행은 로그인해야 · 안 하면 구경 (판 -333)', async page => {
  await page.goto(BASE + '?my=1');
  const r = await page.evaluate(() => {
    localStorage.setItem('tripMe', '"memb1234xx"');
    localStorage.setItem('tripPermC:tcode1', JSON.stringify({ own: { by: 'owner1234x', nm: '성식' }, perm: { by: 'owner1234x', m: {}, def: { r: 1, w: 1, ai: 0 } } }));
    const p = { id: 'pl1', name: '장가계', it: [], room: { code: 'tcode1' }, mem: [{ n: '유진' }] };
    localStorage.setItem('nick', '"유진"');
    const a = [__T.trLoginNeed(p), __T.permIsV(p), __T.permIsV0(p)];
    localStorage.setItem('cloudOn', 'true'); localStorage.setItem('cloudUid', '"uidABCD"');
    const b = [__T.trLoginNeed(p), __T.permIsV(p)];
    localStorage.setItem('cloudOn', 'false'); localStorage.setItem('tripMe', '"owner1234x"');
    const c = [__T.trLoginNeed(p), __T.permIsV(p)];
    const solo = __T.trLoginNeed({ id: 'x', it: [] });
    return { a, b, c, solo };
  });
  ok(r.a[0] === true && r.a[1] === true && r.a[2] === false, '로그인 안 한 일행이 구경이 아님 ' + JSON.stringify(r));
  ok(r.b[0] === false && r.b[1] === false, '로그인한 일행이 아직 구경 ' + JSON.stringify(r));
  ok(r.c[0] === false && r.c[1] === false, '방 주인 기기가 로그인을 요구받음 ' + JSON.stringify(r));
  ok(r.solo === false, '일행 방 없는 계획에 로그인을 요구함');
  noErr(page, '일행 로그인');
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

await test('지도 이름 · 나라마다 같은 차례 (판 -327)', async page => {
  await page.goto(BASE); await sleep(800);
  const r = await page.evaluate(async () => {
    const T = await __T.koHanjaLoad(), G = (la, ln) => ({ geometry: { coordinates: [ln, la] } });
    const f = (q, la, ln) => __T.koNameInfo(T, q, __T.koPlaceCC(G(la, ln)));
    return {
      osaka: f({ name: '大阪市', 'name:ko': '오사카시', 'name:en': 'Osaka' }, 34.69, 135.5),
      fuku: f({ name: '福岡市', 'name:ko': '후쿠오카시', 'name:en': 'Fukuoka' }, 33.59, 130.4),
      zjj: f({ name: '张家界市', 'name:ko': '장자제시', 'name:en': 'Zhangjiajie' }, 29.12, 110.48),
      suwon: f({ name: '수원시', 'name:zh-Hant': '水原市', 'name:en': 'Suwon' }, 37.26, 127.03),
      seoul: f({ name: '서울특별시', 'name:zh-Hant': '首爾特別市', 'name:en': 'Seoul' }, 37.56, 126.97),
      hanoi: f({ name: 'Hà Nội', 'name:zh-Hant': '河內市', 'name:ko': '하노이', 'name:en': 'Hanoi' }, 21.03, 105.85) };
  });
  ok(r.osaka && r.osaka.on === '大阪市\n대판시\n오사카시\nOsaka' && r.osaka.off === '', '일본 도시가 이상해요 ' + JSON.stringify(r.osaka));
  ok(r.fuku && r.fuku.off === '' && /^福岡市\n복강시\n후쿠오카시/.test(r.fuku.on), '대마도 쪽 일본 도시가 중국처럼 읽혀요 ' + JSON.stringify(r.fuku));
  ok(r.zjj && r.zjj.on.split('\n')[0] === '张家界市' && r.zjj.on.split('\n')[1] === '장가계시' && /장자제시\nZhangjiajie$/.test(r.zjj.on) && r.zjj.off === '장가계시', '중국 도시가 이상해요 ' + JSON.stringify(r.zjj));
  ok(r.suwon && r.suwon.on === '수원시\n水原市\nSuwon', '우리나라는 한국어·한자·영어 ' + JSON.stringify(r.suwon));
  ok(r.seoul === null, '서울은 한자 읽기가 달라 그대로');
  ok(r.hanoi && r.hanoi.on === '河內市\n하내시\n하노이\nHanoi', '베트남 ' + JSON.stringify(r.hanoi));
  noErr(page, '지도 이름');
});

// ─── 판 -331: 일행 권한 표 ───
await test('일행 권한 · 들어온 사람 표(일행 여부·권한·보는 범위)', async page => {
  await page.goto(BASE + '?my=1'); await sleep(800);
  await page.evaluate(() => { const t = Date.now();
    localStorage.setItem('tripMe', '"ownr"'); localStorage.setItem('nick', '"성식"');
    __T.planSave({ id: 'ptab1', name: '제주', start: '2026-12-10', nd: 2, room: { code: 'tpermtable00001', mk: 'x' }, shOn: 1,
      mem: [{ id: 'm1', n: '성식' }, { id: 'm2', n: '유진' }, { id: 'm3', n: '민수' }], it: [], at: t, u: t });
    localStorage.setItem('tripPermC:tpermtable00001', JSON.stringify({ own: { by: 'ownr', nm: '성식' }, perm: { by: 'ownr', m: { u1: { r: 1, w: 1, ai: 0 } }, def: { r: 1, w: 1, ai: 0 } },
      tk: [{ by: 'u1', nm: '유진', t: t - 3600e3 }, { by: 'u1pc', nm: '유 진', t: t - 60e3 }, { by: 'u2', nm: '옆집', t }] })); });
  page.errs = [];
  await page.evaluate(() => __T.permSheet(__T.planAll().find(x => x.id === 'ptab1'), () => {})); await sleep(700);
  noErr(page, '일행 권한 표');
  const rows = await page.$$eval('.pm-tb tbody tr', trs => trs.map(tr => [...tr.querySelectorAll('td')].map(td => td.innerText.replace(/\s+/g, ' ').trim())));
  ok(rows.length === 4, '줄이 4개(주인·유진·옆집·민수)여야 해요: ' + JSON.stringify(rows));
  const r = n => rows.find(x => x[0].startsWith(n)) || [];
  ok(/주인/.test(r('성식')[1]) && r('성식')[4] === '전체', '주인 줄이 이상해요 ' + r('성식'));
  ok(r('유진')[1] === '일행' && /기기 2대/.test(r('유진')[0]) && r('유진')[4] === '전체', '유진(기기 2대)이 한 줄 일행 전체여야 해요 ' + r('유진'));
  ok(r('옆집')[1] === '구경' && /목록에 없음/.test(r('옆집')[0]) && r('옆집')[4] === '일정·사진·위치', '옆집은 구경, 일정·사진·위치여야 해요 ' + r('옆집'));
  ok(/아직 안 들어옴/.test(r('민수')[0]), '민수는 아직 안 들어옴이어야 해요 ' + r('민수'));
  await page.screenshot({ path: process.env.SHOT || '/tmp/pm_tab.png' });
  // 구분 칸: 구경 → 못 봄 → 일행(이때 함께 가는 사람에 들어감)
  const tap = async () => { await page.click('.pm-tb tr:has-text("옆집") .pm-rl'); await sleep(300); };
  await tap(); ok(/못 봄/.test(await page.innerText('.pm-tb tr:has-text("옆집")')), '구경을 누르면 못 봄이 돼야 해요');
  await tap(); const t3 = await page.innerText('.pm-tb tr:has-text("옆집")');
  ok(/일행/.test(t3) && /전체/.test(t3), '못 봄을 누르면 일행·전체가 돼야 해요 ' + t3);
  ok(await page.evaluate(() => __T.planAll().find(x => x.id === 'ptab1').mem.some(m => m.n === '옆집')), '일행으로 바꾸면 함께 가는 사람에 들어가야 해요');
  // 같은 사람 두 기기는 고치기도 같이
  await page.click('.pm-tb tr:has-text("유진") .pm-ck'); await sleep(300);
  ok(/✕/.test(await page.innerText('.pm-tb tr:has-text("유진") .pm-ck')), '유진 고치기를 누르면 ✕가 돼야 해요');
  ok(await page.$$eval('.pm-tb tbody tr', trs => trs.filter(tr => /유진/.test(tr.innerText)).length) === 1, '같은 사람 두 기기는 한 줄이어야 해요');
});

// ─── 판 -350: 안드로이드 휴대폰 브라우저 첫 화면은 '바탕화면에 추가' 대신 'MPD 앱 받기' ───
await test('안드로이드 웹 첫 화면은 앱 받기 카드', async page => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' }));
  await page.goto(BASE); await sleep(1500);
  const txt = await page.evaluate(() => document.body.innerText);
  ok(txt.includes('MPD 앱 받기'), '앱 받기 카드가 없어요');
  ok(!txt.includes('바탕화면에 추가'), '안드로이드인데 바탕화면에 추가 카드가 나와요');
  await page.route('**/MPD.apk', r => r.fulfill({ body: 'x', headers: { 'content-type': 'application/vnd.android.package-archive', 'content-disposition': 'attachment; filename=MPD.apk' } }));   // 휴대폰처럼 내려받기로(화면은 그대로)
  await page.getByRole('button', { name: '받기', exact: true }).click(); await sleep(500);
  ok(await page.evaluate(() => !!document.querySelector('[aria-label="MPD 앱 설치"]')), '받기를 눌러도 설치 순서가 안 나와요');
  noErr(page, '안드로이드 첫 화면');
});
await test('컴퓨터 첫 화면은 바탕화면에 추가 그대로', async page => {
  await page.goto(BASE); await sleep(1500);
  const txt = await page.evaluate(() => document.body.innerText);
  ok(!txt.includes('MPD 앱 받기'), '컴퓨터에 앱 받기 카드가 나와요');
});

// ─── 판 -351: 지인에게 보내는 앱 받기 쪽(md.html)은 장점을 먼저, 받기는 누를 때만 ───
await test('앱 받기 쪽은 장점을 먼저 보여 주고 누를 때 받음', async page => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' }));
  let got = 0;
  await page.route('**/MPD.apk', r => { got++; r.fulfill({ body: 'x', headers: { 'content-disposition': 'attachment; filename=MPD.apk' } }); });
  await page.goto(BASE + 'md.html'); await sleep(1500);
  const txt = await page.evaluate(() => document.body.innerText);
  for (const w of ['지난 여행도 사진만으로', '지도 위 이동 영상', '링크 하나로 공유']) ok(txt.includes(w), '장점 글이 없어요: ' + w);
  ok(got === 0, '열자마자 저절로 내려받아요');
  ok(await page.evaluate(() => !!document.querySelector('meta[property="og:image"]')), '카톡 미리보기 그림이 없어요');
  await page.click('#dl'); await sleep(800);
  ok(got === 1, '무료로 받기를 눌러도 안 받아요');
  ok(await page.evaluate(() => document.getElementById('how').classList.contains('on')), '설치 순서가 안 나와요');
  noErr(page, 'md.html');
});

// ─── 판 -354: 미리 받은 예전 지도 조각 목록 때문에 지도가 거칠게(길이 바다 위로) 보이던 것 ───
await test('지도 조각 목록은 인터넷이 되면 새로 · 끊기면 예전 판 조각이라도', async page => {
  await page.goto(BASE); await sleep(1000);
  const TJ = 'https://tiles.openfreemap.org/planet';
  await page.route(TJ, r => r.fulfill({ body: JSON.stringify({ tiles: ['https://tiles.openfreemap.org/planet/NEW/{z}/{x}/{y}.pbf'] }), contentType: 'application/json' }));
  await page.route('**/planet/NEW/**', r => r.fulfill({ status: 404, body: '' }));
  const res = await page.evaluate(async TJ => {
    const c = await caches.open('md-vt-v1');
    await c.put(TJ, new Response(JSON.stringify({ tiles: ['https://tiles.openfreemap.org/planet/OLD/{z}/{x}/{y}.pbf'] })));
    await c.put('https://tiles.openfreemap.org/planet/OLD/14/13394/7148.pbf', new Response(new Uint8Array([7, 7, 7])));
    const j = await __T.vtGet(TJ, 'json');
    const saved = await (await c.match(TJ)).json();
    const b = new Uint8Array(await __T.vtGet('https://tiles.openfreemap.org/planet/NEW/14/13394/7148.pbf', 'buf'));
    return { now: j.tiles[0], saved: saved.tiles[0], alt: [...b].join(',') };
  }, TJ);
  ok(/NEW/.test(res.now), '저장해 둔 예전 조각 목록을 그대로 써요: ' + res.now);
  ok(/NEW/.test(res.saved), '저장한 조각 목록이 새것으로 안 바뀌었어요');
  ok(res.alt === '7,7,7', '새 판 조각을 못 받을 때 예전 판으로 받아 둔 조각을 안 써요');
  noErr(page, '지도 조각 목록');
});

// ─── 판 -355: 사진으로 만든 여행의 비행(곧은 줄) 가운데 🚗이 섞여 보이던 것 ───
await test('사진으로 만든 곧은 비행 줄은 차가 아니라 비행', async page => {
  await page.goto(BASE); await sleep(800);
  const r = await page.evaluate(() => {
    const D = (a, b) => { const R = 6371000, x = (b[1] - a[1]) * Math.PI / 180 * Math.cos((a[0] + b[0]) / 2 * Math.PI / 180), y = (b[0] - a[0]) * Math.PI / 180; return Math.hypot(x, y) * R; };
    const tr = [], line = (a, b) => { const d = D(a, b), k = Math.min(400, Math.max(1, Math.ceil(d / 100), Math.ceil((b[2] - a[2]) / 240000))); for (let s = 1; s < k; s++) { const q = s / k; tr.push([a[0] + (b[0] - a[0]) * q, a[1] + (b[1] - a[1]) * q, a[2] + (b[2] - a[2]) * q]); } tr.push(b); };
    const h = 3600000, t0 = Date.UTC(2026, 10, 20, 2), HK = [22.31, 113.92, t0], AIR = [34.5, 123.5, t0 + 2.5 * h], ICN = [37.46, 126.44, t0 + 4 * h];   // 비행기 창 사진 → 인천은 시속 약 280km(평균)
    const FERRY = [37.3, 126.2, t0 + 7 * h], F2 = [36.5, 126.2, t0 + 8.6 * h];   // 배: 곧게 89km 시속 약 55km
    tr.push(HK); line(HK, AIR); line(AIR, ICN); tr.push([37.4601, 126.4401, t0 + 4 * h + 600000]); tr.push(FERRY); line(FERRY, F2);
    const m = __T.trackModes(tr), i1 = tr.indexOf(AIR), i2 = tr.indexOf(ICN), i3 = tr.indexOf(FERRY);
    return { leg2: m.slice(i1 + 1, i2 + 1), ferry: m.slice(i3 + 2, m.length) };
  });
  ok(!/c/.test(r.leg2) && /f/.test(r.leg2), '비행기 안 사진 → 인천 곧은 줄에 차가 섞여요: ' + r.leg2.slice(0, 40));
  ok(!/f/.test(r.ferry), '느린 배(곧은 줄)까지 비행으로 그려요');
  noErr(page, '비행 줄');
});

// ─── 판 -356: 홍콩 시내처럼 이름이 많으면 한자 읽기 이름을 모든 글자 층에 통째로 넣어 휴대폰 지도가 비었음 ───
await test('한자 읽기 이름은 층마다 그 층 이름만 · 1200개까지', async page => {
  await page.goto(BASE); await sleep(800);
  const r = await page.evaluate(async () => {
    await __T.koHanjaLoad();
    const calls = {}, on = {}, feats = { place: [{ properties: { name: '香港' }, geometry: { type: 'Point', coordinates: [114.16, 22.28] } }],
      transportation_name: Array.from({ length: 1500 }, (_, i) => ({ properties: { name: '德輔道' + String.fromCharCode(0x4e00 + i) }, geometry: { type: 'Point', coordinates: [114.16, 22.28] } })) };
    const mm = { getStyle: () => ({ layers: [{ id: 'label_city', 'source-layer': 'place', metadata: { koName: 1 }, layout: { 'text-field': 'A' } }, { id: 'highway_name', 'source-layer': 'transportation_name', metadata: { koName: 1 }, layout: { 'text-field': 'B' } }] }),
      querySourceFeatures: (s, o) => feats[o.sourceLayer] || [], setLayoutProperty: (id, k, v) => { calls[id] = v; }, on: (e, f) => { on[e] = f; } };
    __T.koHanjaWire(mm, false); on.idle(); await new Promise(z => setTimeout(z, 800));
    const n = id => Array.isArray(calls[id]) ? (calls[id].length - 3) / 2 : 0;
    return { city: n('label_city'), road: n('highway_name'), cityHasRoad: JSON.stringify(calls.label_city || '').includes('德輔道') };
  });
  ok(r.city >= 1, '도시 이름 층에 한자 읽기가 없어요');
  ok(!r.cityHasRoad, '도시 이름 층에 길 이름까지 통째로 넣어요');
  ok(r.road > 0 && r.road <= 1200, '길 이름 층 이름 수가 너무 많아요: ' + r.road);
  noErr(page, '한자 읽기 이름');
});

// ─── 판 -357: 사진으로 만든 여행에서 배로 바다를 건넌 곧은 줄이 걸어간 것으로 보이던 것 ───
await test('길 없는 곧은 줄(배)은 걷기가 아니라 탈것 · 영상은 배', async page => {
  await page.goto(BASE); await sleep(800);
  const r = await page.evaluate(() => {
    const D = (a, b) => { const R = 6371000, x = (b[1] - a[1]) * Math.PI / 180 * Math.cos((a[0] + b[0]) / 2 * Math.PI / 180), y = (b[0] - a[0]) * Math.PI / 180; return Math.hypot(x, y) * R; };
    const mk = sh => { const tr = [], line = (a, b) => { const d = D(a, b), k = Math.min(400, Math.max(1, Math.ceil(d / 100), Math.ceil((b[2] - a[2]) / 240000))); for (let s = 1; s < k; s++) { const q = s / k; tr.push([a[0] + (b[0] - a[0]) * q, a[1] + (b[1] - a[1]) * q, a[2] + (b[2] - a[2]) * q, null, sh]); } tr.push(b); };
      const t0 = Date.UTC(2025, 0, 11, 1), HK = [22.287, 114.152, t0], MO = [22.197, 113.56, t0 + 3 * 3600000];   // 홍콩 → 마카오 배 약 61km, 사진 사이 3시간(시속 약 20km)
      // 배 타기 전 걸은 길(흔들림 1, 굽은 길)
      for (let i = 0; i < 30; i++) tr.push([22.29 + Math.sin(i / 3) * 0.0008, 114.16 - i * 0.00026, t0 - (30 - i) * 30000, null, 1]);
      tr.push(HK); line(HK, MO); return tr; };
    const tr = mk(null), m = __T.trackModes(tr, 15), sea = m.slice(31);
    const P = __T.filmPath(tr, false, 6, 3.5).P, boat = P.filter(p => p.boat).length;
    const plan = __T.filmPath(mk(0), false, 6, 3.5).P.filter(p => p.boat).length;
    return { walkOnSea: (sea.match(/w/g) || []).length, seaLen: sea.length, boat, plan };
  });
  ok(r.walkOnSea === 0, `바다 위 곧은 줄 ${r.seaLen}점 가운데 ${r.walkOnSea}점이 걷기예요`);
  ok(r.boat > 100, '이동 영상에서 바다 건너기가 배로 안 나와요');
  ok(r.plan === 0, '흔들림 값이 있는 곧은 줄(계획 미리 보기)까지 배로 그려요');
  noErr(page, '배');
});

// ─── 판 -358: 기록에서 고른 대표 사진을 영상 첫 사진으로 ───
await test('영상 첫 사진은 고른 대표 사진 먼저', async page => {
  await page.goto(BASE); await sleep(800);
  const r = await page.evaluate(() => {
    const cand = [{ p: { id: 'a' } }, { p: { id: 'b' }, star: true }, { p: { id: 'c' } }, { p: { id: 'v', v: 1 } }];
    localStorage.removeItem('walkCover:album_x'); const none = __T.filmCoverG('album_x', cand);
    localStorage.setItem('walkCover:album_x', JSON.stringify('c')); const got = __T.filmCoverG('album_x', cand);
    localStorage.setItem('walkCover:album_x', JSON.stringify('none')); const pic = __T.filmCoverG('album_x', cand);
    localStorage.setItem('walkCover:album_x', JSON.stringify('v')); const vid = __T.filmCoverG('album_x', cand);
    localStorage.removeItem('walkCover:album_x');
    return { none, got: got && got.p.id, pic, vid };
  });
  ok(r.got === 'c', '고른 대표 사진을 영상 첫 사진으로 안 써요');
  ok(r.none === null && r.pic === null && r.vid === null, '고르지 않았는데(또는 풍경 그림·동영상) 대표 사진으로 잡아요');
  noErr(page, '영상 첫 사진');
});

// ─── 판 -359: 차로 다닌 기록 카드에 '걸은 거리'가 두 번(서로 다른 값) 나오지 않게 (지인 장남덕 님 '차량으로 이동한 것인데 통계는 맞는 건지?') ───
await test('차로 다닌 기록 카드 거리 글은 한 번씩', async page => {
  await page.goto(BASE); await sleep(1200);
  const r = await page.evaluate(() => {
    const t0 = Date.parse('2026-11-23T08:00:00+09:00'), tr = [];
    for (let i = 0; i < 40; i++) tr.push([37.50 + i * 0.0001, 127.00, t0 + i * 20000, 50, 5]);          // 걷기 약 450m
    for (let i = 1; i <= 120; i++) tr.push([37.504 + i * 0.004, 127.00 + i * 0.002, t0 + 800000 + i * 30000, 50, 0]);   // 차 약 60km (시속 60km 넘게)
    const st = __T.trackStats(tr, false);
    return { st, car: __T.cardDistStats(st, '걸은'), walk: __T.cardDistStats({ d: 2000, walk: 2000, fly: 0 }, '걸은') };
  });
  const walkLines = r.car.filter(x => x.startsWith('걸은 거리'));
  ok(r.st.d - r.st.walk > 300, '시험 길이 차로 간 길로 안 나뉘었어요: ' + JSON.stringify(r.st));
  ok(walkLines.length === 1, "'걸은 거리'가 " + walkLines.length + '번 나와요: ' + r.car.join(' / '));
  ok(r.car.some(x => x.startsWith('전체 이동')), '전체 이동이 없어요');
  ok(r.walk.length === 1 && r.walk[0].startsWith('걸은 거리'), '걷기만 한 기록 거리 글이 이상해요: ' + r.walk.join(' / '));
  noErr(page, '첫 화면');
});

// ─── 판 -359: 영상도 기록 지도와 같은 걷기/탈것 나누기 (찻길 흔들림 0 · 배 위 사진으로 꺾인 곧은 줄) ───
await test('영상: 사진으로 만든 찻길·배 위 사진 바닷길은 걷기가 아니라 탈것', async page => {
  await page.goto(BASE); await sleep(800);
  const r = await page.evaluate(() => {
    const D = (a, b) => { const R = 6371000, x = (b[1] - a[1]) * Math.PI / 180 * Math.cos((a[0] + b[0]) / 2 * Math.PI / 180), y = (b[0] - a[0]) * Math.PI / 180; return Math.hypot(x, y) * R; };
    const line = (tr, a, b, sh) => { const d = D(a, b), k = Math.min(400, Math.max(1, Math.ceil(d / 100), Math.ceil((b[2] - a[2]) / 240000))); for (let s = 1; s < k; s++) { const q = s / k; tr.push([a[0] + (b[0] - a[0]) * q, a[1] + (b[1] - a[1]) * q, a[2] + (b[2] - a[2]) * q, null, sh]); } tr.push(b.concat([null, sh])); };
    const t0 = Date.UTC(2025, 0, 11, 1), h = 3600000;
    // ① 배: 배 위에서 찍은 사진 4장으로 꺾인 바닷길 (사진 사이 2~2.5km, 평균 시속 약 12km)
    const A = []; A.push([22.197, 113.56, t0, null, 1]);
    const S = [[22.205, 113.58], [22.215, 113.60], [22.222, 113.62], [22.235, 113.64], [22.245, 113.66]];
    S.forEach((p, i) => line(A, A[A.length - 1].slice(0, 3), [p[0], p[1], t0 + (i + 1) * 0.2 * h], null));
    const fa = __T.filmPath(A, false, 6, 3.5).P, boat = fa.filter(p => p.boat).length, walkA = fa.slice(1).filter(p => !p.car && !p.fly).length;
    // ② 찻길(흔들림 0): 굽은 길 15km를 2시간(시속 7.5km, 기다린 시간 포함)
    const B = []; for (let i = 0; i <= 150; i++) B.push([22.3 + Math.sin(i / 9) * 0.01, 114.0 + i * 0.00095, t0 + i * 48000, null, 0]);
    const fb = __T.filmPath(B, false, 6, 3.5).P, carB = fb.slice(1).filter(p => p.car).length;
    // ③ 계획 미리 보기(plain)는 예전대로 빠르기로만
    const fc = __T.filmPath(B, false, 6, 3.5, true).P, carC = fc.slice(1).filter(p => p.car).length;
    return { boat, walkA, nA: fa.length, carB, nB: fb.length, carC };
  });
  ok(r.walkA === 0 && r.boat > 0, `배 위 사진으로 꺾인 바닷길 ${r.nA}점 가운데 ${r.walkA}점을 걷기로 그려요(배 ${r.boat}점)`);
  ok(r.carB > r.nB * 0.9, `사진으로 만든 찻길(흔들림 0)을 걷기로 그려요: 차 ${r.carB}/${r.nB}`);
  ok(r.carC === 0, '계획 미리 보기까지 흔들림 값으로 차를 갈라요');
  noErr(page, '영상 걷기/탈것');
});

// ─── 판 -360: 들어와서 보기 — 받은 사람도 내 기록 화면 그대로 (사진 전부·대표 사진), 받은 사람 자료는 안 건드림, 지운 사진·기록은 링크에서도 ───
await test('들어와서 보기: 받은 사람도 내 화면 그대로 · 지우면 링크에서도', async page => {
  const store = new Map(), FS = 'https://firestore.googleapis.com/v1/projects/map-photo-diary/databases/(default)/documents/';
  const fsRoute = async route => { const req = route.request(), u = req.url(), path = decodeURIComponent(u.slice(FS.length).split('?')[0]);
    if (req.method() === 'PATCH') { const f = JSON.parse(req.postData() || '{}').fields || {}; store.set(path, f.d ? f.d.stringValue : ''); return route.fulfill({ status: 200, body: '{}', contentType: 'application/json' }); }
    if (req.method() === 'DELETE') { store.delete(path); return route.fulfill({ status: 200, body: '{}', contentType: 'application/json' }); }
    if (!store.has(path)) return route.fulfill({ status: 404, body: '{}', contentType: 'application/json' });
    return route.fulfill({ status: 200, body: JSON.stringify({ fields: { d: { stringValue: store.get(path) } } }), contentType: 'application/json' }); };
  await page.route(u => u.href.startsWith(FS), fsRoute);
  const t = await seed(page);
  const url = await page.evaluate(async t => {
    const jpg = async (c) => { const cv = document.createElement('canvas'); cv.width = 400; cv.height = 300; const g = cv.getContext('2d'); g.fillStyle = c; g.fillRect(0, 0, 400, 300); return await new Promise(r => cv.toBlob(r, 'image/jpeg', .8)); };
    const tr = JSON.parse(localStorage.getItem('track:' + t));
    for (let i = 0; i < 5; i++) { const b = await jpg(['red', 'green', 'blue', 'orange', 'purple'][i]); await __T.photoPut({ id: 'ph_g' + i, t, ts: tr[i * 10][2], lat: tr[i * 10][0], lng: tr[i * 10][1], blob: b, thumb: await __T.shrinkImage(b, 120, 'url', .7) }); }
    localStorage.setItem('walkCover:' + t, JSON.stringify('ph_g3'));
    localStorage.setItem('walkNote:' + t, JSON.stringify('친구들과 즐거운 하루'));
    return await __T.guestLink({ t, hide: 0, ph: 1 });
  }, t);
  ok(/\?v=gv[a-z0-9]+#k=/.test(url), '링크 모양이 이상해요: ' + url);
  ok([...store.keys()].some(k => /\/m\/h$/.test(k)) && [...store.keys()].filter(k => /\/p\//.test(k)).length >= 5, '서버에 본문·사진이 안 올라갔어요');
  ok(![...store.values()].some(v => v.includes('시험 걷기') || v.includes('친구들과')), '서버에 잠그지 않은 글이 있어요');
  // 받은 사람(다른 휴대폰): 자기 기록이 하나 있음
  const rp = await newPage(); await rp.route(u => u.href.startsWith(FS), fsRoute);
  try {
    await rp.goto(BASE + '?my=1'); await rp.evaluate(() => { localStorage.setItem('track:mine_1', JSON.stringify([[37.5, 127, 1, 0], [37.51, 127.01, 60000, 0]])); localStorage.setItem('trackName:mine_1', JSON.stringify('내 산책')); });
    const before = await rp.evaluate(() => JSON.stringify(Object.keys(localStorage).sort()));
    await rp.goto(url.replace(/^.*?\?/, BASE + '?')); await sleep(3500);
    const v = await rp.evaluate(() => ({ h1: document.querySelector('.vw-ttl h1')?.textContent, hero: !!document.querySelector('.vw-hero:not([hidden]) img'), gal: document.querySelectorAll('.gallery img').length,
      note: document.body.innerText.includes('친구들과 즐거운 하루'), more: !!document.querySelector('[aria-label="더보기"]'), share: !!document.querySelector('.vb-r [aria-label="공유"]'), mine: document.body.innerText.includes('내 산책'),
      keys: JSON.stringify(Object.keys(localStorage).sort()) }));
    ok(v.h1 === '시험 걷기', '제목이 안 보여요: ' + v.h1);
    ok(v.hero, '대표 사진이 안 보여요');
    ok(v.gal === 5, '사진이 다 안 보여요: ' + v.gal);
    ok(v.note, '메모가 안 보여요');
    ok(!v.more && !v.share, '받은 사람에게 보낸 사람 전용 단추(더보기·공유)가 보여요');
    ok(!v.mine, '받은 사람 자기 기록이 섞였어요');
    ok(v.keys === before, '받은 사람 휴대폰 저장 칸이 바뀌었어요');
    noErr(rp, '받은 화면');
    if (process.env.SHOT) await rp.screenshot({ path: process.env.SHOT, fullPage: true });
    // 보낸 사람이 사진 하나를 지우면 링크에서도 빠져요
    await page.evaluate(async () => { await __T.photoDel('ph_g1'); }); await sleep(3000);
    await rp.reload(); await sleep(3000);
    const g2 = await rp.evaluate(() => document.querySelectorAll('.gallery img').length);
    ok(g2 === 4, '지운 사진이 받은 링크에 남아 있어요: ' + g2);
    // 기록을 지우면 서버에서도 지워요
    await page.evaluate(async t => { await __T.guestDrop(t); }, t);
    ok(![...store.keys()].some(k => k.includes('/rooms/gv') || k.startsWith('rooms/gv')), '기록을 지웠는데 서버에 남았어요: ' + [...store.keys()].slice(0, 3).join(','));
  } finally { await rp.ctx.close(); }
  noErr(page, '보낸 쪽');
});

await test('들어와서 보기: 여러 날 여행도 날마다까지 그대로', async page => {
  const store = new Map(), FS = 'https://firestore.googleapis.com/v1/projects/map-photo-diary/databases/(default)/documents/';
  const fsRoute = async route => { const req = route.request(), u = req.url(), path = decodeURIComponent(u.slice(FS.length).split('?')[0]);
    if (req.method() === 'PATCH') { const f = JSON.parse(req.postData() || '{}').fields || {}; store.set(path, f.d ? f.d.stringValue : ''); return route.fulfill({ status: 200, body: '{}', contentType: 'application/json' }); }
    if (req.method() === 'DELETE') { store.delete(path); return route.fulfill({ status: 200, body: '{}', contentType: 'application/json' }); }
    if (!store.has(path)) return route.fulfill({ status: 404, body: '{}', contentType: 'application/json' });
    return route.fulfill({ status: 200, body: JSON.stringify({ fields: { d: { stringValue: store.get(path) } } }), contentType: 'application/json' }); };
  await page.route(u => u.href.startsWith(FS), fsRoute);
  await page.goto(BASE + '?my=1');
  const url = await page.evaluate(async () => {
    const days = [];
    for (let d = 0; d < 2; d++) { const id = 'walk_trip' + d, t0 = new Date(`2025-01-${String(9 + d).padStart(2, "0")}T10:00:00+08:00`).getTime(), tr = [];
      for (let i = 0; i < 40; i++) tr.push([22.28 + i * 0.0003 + d * 0.01, 114.15 + i * 0.0002, t0 + i * 60000, 10, 1]);
      localStorage.setItem('track:' + id, JSON.stringify(tr)); localStorage.setItem('trackName:' + id, JSON.stringify('홍콩 ' + (d + 1) + '일')); localStorage.setItem('walkMode:' + id, JSON.stringify('travel')); localStorage.setItem('walkAlbum:' + id, JSON.stringify('album_hk')); days.push(id); }
    localStorage.setItem('albums', JSON.stringify([{ id: 'album_hk', name: '홍콩 · 마카오 여행', days }]));
    localStorage.setItem('walkMode:album_hk', JSON.stringify('travel'));
    return await __T.guestLink({ t: 'album_hk', hide: 0, ph: 1 });
  });
  const rp = await newPage(); await rp.route(u => u.href.startsWith(FS), fsRoute);
  try {
    await rp.goto(url.replace(/^.*?\?/, BASE + '?')); await sleep(3000);
    const v = await rp.evaluate(() => ({ h1: document.querySelector('.vw-ttl h1')?.textContent, days: [...document.querySelectorAll('a.n-row')].map(a => a.getAttribute('href')), txt: document.body.innerText }));
    ok(v.h1 === '홍콩 · 마카오 여행', '여행 제목이 안 보여요: ' + v.h1);
    ok(v.days.length === 2 && v.days.every(h => /\?v=gv[a-z0-9]+&d=walk_trip\d#k=/.test(h)), '날마다 줄이 받은 링크 안으로 안 이어져요: ' + v.days.join(' '));
    ok(/1박 2일/.test(v.txt), '기간이 안 보여요: ' + v.txt.slice(0, 200).replace(/\n/g, ' / '));
    await rp.goto(new URL(v.days[1], rp.url()).href); await sleep(2500);
    const d2 = await rp.evaluate(() => document.querySelector('.vw-ttl h1')?.textContent);
    ok(d2 === '홍콩 2일', '날 하나를 열면 그날이 안 보여요: ' + d2);
    noErr(rp, '받은 여행');
  } finally { await rp.ctx.close(); }
});

await test('여행 경비 · 인터넷이 안 돼도 예전 환율로 셈 (판 -361)', async page => {
  await seed(page); await page.goto(BASE); await sleep(800);
  const r = await page.evaluate(async () => {
    localStorage.setItem('fxRate:CNY', JSON.stringify({ at: Date.now() - 3 * 86400e3, krw: 190, day: '' }));
    try { const o = await __T.destFx('CNY'); return o.krw + ':' + (o.old ? 'old' : 'new'); } catch (e) { return 'err'; }
  });
  ok(r === '190:old', '바깥 요청이 막혔을 때 예전 환율을 써야 해요 ' + r);
});

// ─── 판 -362: 첫 화면은 지도 중심(사용자 'MPD 첫화면 설계 다시하자' → '지도 중심') ───
await test('지도 첫 화면 · 지도·기록하기·여행 카드 · 겹친 여행 줄 없음 · 사진 모양은 그대로 고름', async page => {
  await seed(page);
  await page.evaluate(() => { const d = new Date(), ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    __T.planSave({ id: 'pl_home', name: '장가계 여행', start: ymd, nd: 3, it: [{ id: 'a', d: 0, t: '23:59', n: '천문산', k: 'spot', lat: 29.05, lng: 110.48 }], at: Date.now(), u: Date.now() }); });
  await page.goto(BASE); await sleep(2500);
  const r = await page.evaluate(() => ({ map: !!document.querySelector('.mh-map.leaflet-container'), go: !!document.querySelector('.mh-go'), trip: (document.querySelector('.mh-trip') || {}).textContent || '',
    num: document.querySelectorAll('.mh-num').length, rows: [...document.querySelectorAll('.hp-row b')].map(b => b.textContent), bell: !!document.querySelector('[aria-label="알림"]'), style: localStorage.getItem('homeStyle'),
    sp: document.querySelector('.mh-sp').offsetHeight, peek: document.querySelector('.mh-peek').getBoundingClientRect().bottom }));
  ok(r.map && r.go, '지도나 기록하기 단추가 없어요');
  ok(r.trip.includes('장가계 여행') && r.trip.includes('1일차'), '여행 중 카드가 없어요: ' + r.trip);
  ok(r.num === 1, '오늘 일정 장소가 지도에 번호로 안 나와요: ' + r.num);
  ok(!r.rows.includes('장가계 여행'), '위 여행 카드와 같은 여행이 아래 목록에 또 나와요');
  ok(!r.bell, '눌러도 만들 예정 창만 뜨는 🔔 단추가 남아 있어요');
  ok(r.style === '"map"', '처음 한 번 지도 모양으로 안 바뀌었어요: ' + r.style);
  ok(r.peek <= 844 + 2, `처음 화면에 기록하기 단추가 다 안 보여요(아래 끝 ${Math.round(r.peek)}px)`);
  noErr(page, '지도 첫 화면');
  // 사진 모양을 고른 사람은 다음에 켜도 사진 모양 그대로(다시 지도로 바꾸지 않음)
  await page.evaluate(() => localStorage.setItem('homeStyle', '"photo"'));
  await page.goto(BASE); await sleep(2000);
  ok(await page.evaluate(() => !document.querySelector('.mh-map') && !!document.querySelector('.c-ph')), '사진 모양을 골랐는데 지도 첫 화면이 나와요');
  noErr(page, '사진 첫 화면');
});

await browser.close();
server.close();
console.log(`\n결과: 통과 ${pass} · 실패 ${fail}` + (fails.length ? '\n실패: ' + fails.join(', ') : ''));
process.exit(fail ? 1 : 0);
