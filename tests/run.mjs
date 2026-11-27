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
const EXPOSE = ['mateAdd', 'mateList', 'mateDel', 'mateBig', 'origFind', 'origGet', 'origCfg', 'sealRaw', 'openRaw', 'albumDayN', 'dayNameFix', 'albumPlan', 'spotMarkers', 'nmDeclutter', 'gapFill', 'gapUndo', 'trackGaps', 'hzKind', 'planRealSegs', 'tripAutoEnsure', 'albumRoll', 'planPast', 'mapHzArgs', 'destFx', 'cardDistStats', 'trackStats', 'recApply', 'permSheet', 'koNameInfo', 'koPlaceCC', 'koHanjaLoad', 'expWho', 'planAskName', 'permOf', 'permIsV', 'trSet', 'planPhotos', 'filmTripRange', 'filmInset', 'filmAutoStyle', 'photoPut', 'photoDel', 'photoList', 'planSave', 'planDel', 'planAll', 'planMerge', 'errSheet', 'trackAdd', 'trackLoad', 'trackStats', 'trackModes', 'flyFlags', 'planCopy', 'planPack', 'planUnpack', 'backupMake', 'backupLoad', 'goneMark', 'recMerge', 'trRoom', 'trSet', 'autoFix', 'autoSt', 'expCalc', 'expGuess', 'decoSync', 'planHeroAll', 'planHeroTake', 'tripMeSync', 'trLocOne', 'trLoginNeed', 'permIsV0', 'ptMake', 'ptOpen', 'ptWallTs', 'ptRoute', 'cRecordSheet', 'filmSplitSel', 'filmSplitAt', 'filmDirector', 'filmPhotoPlace', 'filmAt', 'FILM_STYLES', 'filmAiHero', 'vtGet', 'koHanjaWire', 'filmPath', 'filmCoverG', 'stepDayFeed', 'guestLink', 'guestDrop', 'shrinkImage', 'mapTiles', 'showPhoto', 'galleryOffer', 'stepSample', 'stepShake', 'gapAuto', 'photoPtsFill'];
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

// 판 -385: 앱이 사진첩 사진을 넣을 때 진짜 찍은 위치(photosRange)를 쓰고, 짐작한 자리에 놓였던 사진은 옮김(손으로 옮긴 건 그대로)
await test('사진첩 사진의 진짜 위치', async page => {
  await page.goto(BASE + '?my=1'); await sleep(1000);
  const r = await page.evaluate(async () => {
    const id = 'walk_exif01', t0 = Date.UTC(2026, 10, 24, 2), set = (k, v) => localStorage.setItem(k, JSON.stringify(v));
    set('track:' + id, [[29.12, 110.47, t0], [29.13, 110.48, t0 + 3600e3]]); set('walkMode:' + id, 'travel');
    const cv = document.createElement('canvas'); cv.width = 20; cv.height = 20; const b = await new Promise(r => cv.toBlob(r, 'image/jpeg'));
    await __T.photoPut({ id: 'pold1', t: id, ts: t0 + 600e3, lat: 29.12, lng: 110.47, blob: b, thumb: '' });            // 짐작 자리
    await __T.photoPut({ id: 'pold2', t: id, ts: t0 + 900e3, lat: 29.0, lng: 110.0, blob: b, thumb: '', mv: 1 });     // 손으로 옮김
    window.mdNativePhotos = { between: async () => [], blob: async () => b,
      range: async () => ({ items: [{ uri: 'u1', ts: t0 + 600e3, lat: 29.35, lng: 110.55 }, { uri: 'u2', ts: t0 + 900e3, lat: 29.36, lng: 110.56 }, { uri: 'u3', ts: t0 + 1200e3, lat: 29.37, lng: 110.57, name: 'n.jpg' }] }) };
    await __T.galleryOffer([id]);
    const ps = await __T.photoList(id); delete window.mdNativePhotos;
    return ps.map(p => [Math.round(p.ts / 1000) % 10000, p.lat, p.lng]).sort((a, b) => a[0] - b[0]);
  });
  ok(r.length === 3, '사진 3장: ' + JSON.stringify(r));
  ok(r[0][1] === 29.35 && r[1][1] === 29.0 && r[2][1] === 29.37, '짐작 자리는 진짜 위치로, 손으로 옮긴 건 그대로, 새 사진은 진짜 위치: ' + JSON.stringify(r));
});

// 판 -386: 기록 중이면 배터리 최적화에서 빼 달라고 하루 한 번 물어요
await test('기록 중 배터리 최적화 묻기', async page => {
  await page.addInitScript(() => { window.__bat = []; window.mdNativeBattery = { free: async ask => { window.__bat.push(!!ask); return { ok: false }; } };
    navigator.geolocation.watchPosition = ok => { setTimeout(() => { window.__pos = (window.__pos || 0) + 1; ok({ coords: { latitude: 37.5011, longitude: 127, accuracy: 10, altitude: null }, timestamp: Date.now() }); }, 300); return 1; }; navigator.geolocation.clearWatch = () => {}; });
  await page.goto(BASE); await sleep(500);
  await page.evaluate(() => { const t = Date.now(); localStorage.setItem('track:walk_bat1', JSON.stringify([[37.5, 127, t - 6e4], [37.501, 127, t]])); localStorage.setItem('walkMode:walk_bat1', '"walk"'); localStorage.setItem('walkNow', '"walk_bat1"'); localStorage.removeItem('batAsk'); });
  await page.goto(BASE + '?walk=1&resume=walk_bat1'); await sleep(4500);
  const b = await page.evaluate(() => window.__bat);
  ok(b.includes(false) && b.includes(true), '기록 중이면 상태를 보고 물어야 해요: ' + JSON.stringify(b) + await page.evaluate(() => [window.__pos, location.search, document.body.innerText.slice(0, 200)].join('/')));
  await page.goto(BASE + '?walk=1&resume=walk_bat1'); await sleep(4500);
  ok(!(await page.evaluate(() => window.__bat)).includes(true), '같은 날 두 번은 안 물어요');
  await page.evaluate(() => { localStorage.removeItem('walkNow'); localStorage.removeItem('track:walk_bat1'); });
});

// 판 -390: 화면이 꺼져도 걸음 센서로 걷기(1)/흔들림 없음(0)
await test('걸음 센서로 걷기·탈것 나누기', async page => {
  await page.goto(BASE); await sleep(500);
  const r = await page.evaluate(async () => {
    let n = 1000; window.mdNativeSteps = { now: async () => ({ has: true, n }) };
    const realNow = Date.now; let fake = realNow(); Date.now = () => fake;
    const step = async (dn, dt) => { n += dn; fake += dt; await __T.stepSample(); };
    await step(0, 0); await step(20, 10000); await step(20, 10000);   // 20초에 40걸음
    const walk = __T.stepShake();
    await step(0, 10000); await step(0, 10000); await step(0, 10000); await step(0, 10000);   // 40초 동안 0걸음
    const ride = __T.stepShake();
    Date.now = realNow; delete window.mdNativeSteps; return [walk, ride];
  });
  ok(r[0] === 1 && r[1] === 0, '걸음이 늘면 1, 그대로면 0: ' + JSON.stringify(r));
});

// 판 -391: 기록 중·3일 안 기록의 끊긴 길은 묻지 않고 채우고, 길을 찾는 동안 붙은 점은 남고, 되돌리면 채운 점만 빠지고 다시 안 채움
await test('끊긴 길 저절로 채우기', async page => {
  await page.goto(BASE); await sleep(1500);
  const r = await page.evaluate(async () => {
    const id = 'walk_gapa1', t0 = Date.now() - 3 * 3600e3, set = (k, v) => localStorage.setItem(k, JSON.stringify(v));
    set('track:' + id, [[29.33, 110.43, t0, 0, 1], [29.331, 110.431, t0 + 60e3, 0, 1], [29.34, 110.45, t0 + 20 * 60e3, 0, 1], [29.341, 110.451, t0 + 21 * 60e3, 0, 1]]);
    set('walkMode:' + id, 'travel'); set('walkNow', id); localStorage.removeItem('gapTried');
    await __T.gapAuto();
    const a = JSON.parse(localStorage.getItem('track:' + id));
    await __T.gapAuto();   // 두 번째는 할 게 없어요
    const b = JSON.parse(localStorage.getItem('track:' + id));
    __T.gapUndo(id); const c = JSON.parse(localStorage.getItem('track:' + id));
    await __T.gapAuto(); const d = JSON.parse(localStorage.getItem('track:' + id));
    localStorage.removeItem('walkNow');
    return { a: a.length, filled: a.filter(q => q[6] === 1).length, b: b.length, c: c.length, d: d.length };
  });
  ok(r.filled > 0 && r.a === 4 + r.filled && r.b === r.a, '끊긴 곳이 채워지고 두 번 채우지 않아요: ' + JSON.stringify(r));
  ok(r.c === 4 && r.d === 4, '되돌리면 원래 4점, 다시 저절로 채우지 않아요: ' + JSON.stringify(r));
});

// 판 -392: 길에서 벗어난 사진 찍은 곳을 길에 넣고(튄 위치는 빼고), 되돌리면 빠짐
await test('사진 찍은 곳을 길에 넣기', async page => {
  await page.goto(BASE); await sleep(1000);
  const r = await page.evaluate(async () => {
    const id = 'walk_phpt1', t0 = Date.now() - 3600e3, set = (k, v) => localStorage.setItem(k, JSON.stringify(v));
    set('track:' + id, [[29.30, 110.40, t0], [29.30, 110.41, t0 + 20 * 60e3], [29.30, 110.42, t0 + 40 * 60e3]]); set('walkMode:' + id, 'walk');
    const cv = document.createElement('canvas'); cv.width = 8; cv.height = 8; const b = await new Promise(r => cv.toBlob(r, 'image/jpeg'));
    await __T.photoPut({ id: 'php1', t: id, ts: t0 + 10 * 60e3, lat: 29.302, lng: 110.405, blob: b, thumb: '' });   // 220m 옆, 걸어서 갈 만함
    await __T.photoPut({ id: 'php2', t: id, ts: t0 + 30 * 60e3, lat: 29.40, lng: 110.415, blob: b, thumb: '' });    // 11km 튐
    const n = await __T.photoPtsFill(id), a = JSON.parse(localStorage.getItem('track:' + id));
    const n2 = await __T.photoPtsFill(id);
    __T.gapUndo(id); const c = JSON.parse(localStorage.getItem('track:' + id));
    return { n, n2, len: a.length, mid: a[1].slice(0, 2), c: c.length };
  });
  ok(r.n === 1 && r.len === 4 && r.mid[0] === 29.302 && r.n2 === 0, '가까운 사진 자리만 한 번 들어가요: ' + JSON.stringify(r));
  ok(r.c === 3, '되돌리면 빠져요: ' + JSON.stringify(r));
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
  await page.screenshot({ path: process.env.SHOT || '/tmp/pm_tab.png' }); await page.evaluate(() => document.querySelector('.pm-scw') && document.querySelector('.pm-scw').scrollIntoView()); await page.screenshot({ path: '/tmp/pm_tab2.png' }); await page.evaluate(() => document.querySelector('.pm-tbw').scrollIntoView());
  // 구분 칸: 구경 → 못 봄 → 일행(이때 함께 가는 사람에 들어감)
  const tap = async () => { await page.click('.pm-tb tr:has-text("옆집") .pm-rl'); await sleep(300); };
  await tap(); ok(/못 봄/.test(await page.innerText('.pm-tb tr:has-text("옆집")')), '구경을 누르면 못 봄이 돼야 해요');
  await tap(); const t3 = await page.innerText('.pm-tb tr:has-text("옆집")');
  ok(/일행/.test(t3) && /전체/.test(t3), '못 봄을 누르면 일행·전체가 돼야 해요 ' + t3);
  ok(await page.evaluate(() => __T.planAll().find(x => x.id === 'ptab1').mem.some(m => m.n === '옆집')), '일행으로 바꾸면 함께 가는 사람에 들어가야 해요');
  // 같은 사람 두 기기는 고치기도 같이
  ok(await page.getAttribute('.pm-tb tr:has-text("유진") button.pm-sw', 'aria-checked') === 'true', '유진 고치기 스위치가 켜져 있어야 해요');
  await page.click('.pm-tb tr:has-text("유진") button.pm-sw'); await sleep(300);
  ok(await page.getAttribute('.pm-tb tr:has-text("유진") button.pm-sw', 'aria-checked') === 'false', '유진 고치기 스위치를 누르면 꺼져야 해요');
  // 판 -366: 표·설명에 ✓/✕ 글자가 없어야 해요(✕가 '안 됨'으로 읽혀서)
  ok(!/[✓✕]/.test(await page.innerText('.pm-tb')) && !/[✓✕]/.test(await page.evaluate(() => [...document.querySelectorAll('.pm-scw')].map(x => x.innerText).join(''))), '권한 표나 설명에 ✓/✕가 남아 있어요');
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

// ─── 판 -363: 화면을 꺼도 걸음 세기(앱 걸음 센서) · 오늘 걸음(만보계) ───
await test('걸음 센서 · 화면을 꺼도 기록 걸음이 따라잡음 · 오늘 걸음은 자정·다시 켬도 바르게', async page => {
  await page.addInitScript(() => { window.__stepN = 5000; window.__boot = Date.now() - 3 * 864e5;   // 휴대폰은 사흘 전에 켬
    window.mdNativeSteps = { now: async () => ({ has: true, perm: true, n: window.__stepN, boot: window.__boot }) }; });
  const t = await seed(page);
  await page.evaluate(t => { localStorage.setItem('walkNow', JSON.stringify(t)); localStorage.setItem('walkAt', JSON.stringify(Date.now() - 60000)); localStorage.removeItem('walkSteps:' + t); }, t);
  await page.goto(BASE + '?walk=1'); await sleep(1500);
  await page.evaluate(() => { window.__stepN += 1234; }); await sleep(3500);   // 화면을 끈 동안 휴대폰이 센 걸음
  const n1 = await page.evaluate(t => (JSON.parse(localStorage.getItem('walkSteps:' + t) || '{}')).n, t);
  ok(n1 === 1234, '기록 걸음이 센서 값 차이와 달라요: ' + n1);
  await page.reload(); await sleep(1200); await page.evaluate(() => { window.__stepN = 5000 + 1234 + 100; }); await sleep(3500);   // 화면을 다시 열어도 기준 그대로
  const n2 = await page.evaluate(t => (JSON.parse(localStorage.getItem('walkSteps:' + t) || '{}')).n, t);
  ok(n2 === 1334, '다시 열었더니 걸음이 처음부터 세져요: ' + n2);
  noErr(page, '걸음 센서 기록');
  const d = await page.evaluate(() => { const mid = new Date(); mid.setHours(0, 0, 0, 0); const M = +mid, out = {};
    localStorage.removeItem('stepDay'); localStorage.removeItem('stepLast');
    const boot = M - 3 * 864e5;
    __T.stepDayFeed({ n: 9000, boot }, M - 2 * 3600e3);               // 어제 밤 10시에 읽음
    out.a = __T.stepDayFeed({ n: 9500, boot }, M + 8 * 3600e3).v;     // 오늘 아침 → 어제 밤 값부터 500
    out.b = __T.stepDayFeed({ n: 200, boot: M + 9 * 3600e3 }, M + 10 * 3600e3).v;   // 오늘 9시에 휴대폰을 다시 켬 → 500 + 200
    localStorage.removeItem('stepDay'); localStorage.removeItem('stepLast');
    const D = __T.stepDayFeed({ n: 4000, boot }, M + 12 * 3600e3); out.c = D.v; out.ap = D.ap;   // 어제 읽은 값이 없으면 지금부터(앱 켠 뒤)
    return out; });
  ok(d.a === 500 && d.b === 700, `오늘 걸음 계산이 틀려요: 아침 ${d.a}(500이어야) · 다시 켠 뒤 ${d.b}(700이어야)`);
  ok(d.c === 0 && d.ap === 1, '어제 값이 없을 때는 앱 켠 뒤부터라고 표시해야 해요');
});

await test('지도 첫 화면 · 휴대폰 아래 단추 줄이 있어도 기록하기 단추가 그 위에 (판 -364)', async page => {
  await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = ':root{padding-bottom:48px!important}'; document.head.append(st); }));
  await seed(page); await page.goto(BASE); await sleep(2000);
  const b = await page.evaluate(() => document.querySelector('.mh-go').getBoundingClientRect().bottom);
  ok(b <= 844 - 48, `기록하기 단추가 아래 단추 줄 밑으로 내려가요(아래 끝 ${Math.round(b)}px, ${844 - 48}px 위여야)`);
  await page.evaluate(() => scrollTo(0, 99999)); await sleep(400);   // 판 -365: 판을 끝까지 올려도 머리 줄은 맨 위 그대로 · 흰 바탕
  const hd = await page.evaluate(() => { const t = document.querySelector('.mh-top'); return { top: t.getBoundingClientRect().top, solid: t.classList.contains('solid') }; });
  ok(hd.top === 0 && hd.solid, `판을 올리면 머리 줄이 밀려 올라가요(위 ${hd.top}px, 흰 바탕 ${hd.solid})`);
  noErr(page, '아래 단추 줄');
});

// ─── 판 -366: 한자 이름(漢)은 사용자가 정성 들여 정한 설정 — 새 지도에서 빠지지 않게 (사용자 '지도에 한자가 안보이네? 왜 바꿨어') ───
await test('지도 한자 이름 · 다른 선명한 지도는 설정을 따르고 첫 화면은 한글만', async page => {
  await page.goto(BASE + '?my=1'); await sleep(800);
  const r = await page.evaluate(() => ({ plain: __T.mapHzArgs(undefined), keep: __T.mapHzArgs({ keep: true }), plan: __T.mapHzArgs({ hz: 'kr' }), cn: __T.mapHzArgs({ hz: true }) }));
  ok(r.plain[0] && r.keep[0], '그냥 만든 지도가 한자 설정을 안 따라요: ' + JSON.stringify(r));
  ok(!r.plain[1] && r.plan[1] && r.cn[1], '漢 단추는 hz를 준 지도에만 나와야 해요: ' + JSON.stringify(r));
  const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const late = await page.evaluate(() => __T.mapHzArgs({ keep: true, hzLate: true }));
  ok(late[0] && late[1] === 'late', '기록 지도는 이름 붙이기를 준비하고 단추는 나중에 붙여야 해요(판 -386): ' + JSON.stringify(late));
  ok(/mdTileLayer\(\{ keep: true, hzLate: true \}\)/.test(src) && /function hzMaybe\(\)/.test(src), '기록 지도에 漢 단추(hzMaybe)가 빠졌어요(판 -386)');
  const kd = await page.evaluate(() => [__T.hzKind(29.12, 110.48), __T.hzKind(35.68, 139.76), __T.hzKind(21.03, 105.85), __T.hzKind(37.57, 126.98), __T.hzKind(22.3, 114.17)]);
  ok(JSON.stringify(kd) === '["cn","jp","vn","","cn"]', '기록 지도 단추 종류가 틀려요(장가계는 漢이어야, 판 -387): ' + JSON.stringify(kd));
  ok(/mdTileLayer\(\{ keep: true, ko: true \}\)/.test(src), '첫 화면 지도(mhMap)는 한글만이어야 해요(판 -367 사용자 \'첫화면은 한글로만 보여줘\')');
  const ko = await page.evaluate(() => __T.mapHzArgs({ keep: true, ko: true }));
  ok(ko[0] === 'kr' && ko[1] === 'off', '첫 화면 지도는 중국 이름을 우리 한자 읽기 한 줄로만 바꿔야 해요(판 -394, 네 줄·漢 단추는 없이): ' + JSON.stringify(ko));
  ok(/koHanjaWire\(mm, jp, offOnly\)/.test(src) && /const hz = !offOnly && ls\.get\('mapHanzi'/.test(src), '첫 화면 지도가 설정을 켜면 네 줄 이름이 돼요(판 -394)');
  ok(!/if \(hanja && o && o\.btn === false && !ls\.get\('mapHanzi', false\)\) hanja = false/.test(src), '漢 단추 없는 지도(받은 링크)가 다시 중국 글자 그대로예요(판 -394)');
  ok(!/koMapLayer\(\(opt && opt\.hz\) \|\| false\)/.test(src), 'mdTileLayer가 다시 hz 없으면 한자를 끄게 바뀌었어요');
  noErr(page, '지도 한자');
});

// ─── 판 -369: 나라를 건너간 여행(홍콩 → 인천) 공유 카드 지도 칸이 비어 있던 것 ───
await test('공유 카드 지도: 먼 길도 칸 안에', async page => {
  await page.route(u => u.hostname === 'tile.openstreetmap.org', r => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64') }));
  await page.goto(BASE); await sleep(800);
  const r = await page.evaluate(async () => {
    const cv = document.createElement('canvas'); cv.width = 1080; cv.height = 1350; const g = cv.getContext('2d');
    const out = [];
    for (const [R, ph] of [[[[22.31, 113.92], [22.2, 113.55], [37.46, 126.44]], 250], [[[37.40, 127.29], [37.41, 127.30]], 600]]) {
      const px = 72, py = 500, pw = 936, M = await __T.mapTiles(g, R, px, py, pw, ph);
      out.push(M ? M.P.every(p => p[0] >= px && p[0] <= px + pw && p[1] >= py && p[1] <= py + ph) : 'null');
    }
    return out;
  });
  ok(r[0] === true, '홍콩 → 인천 길이 카드 지도 칸 밖으로 나가요: ' + r[0]);
  ok(r[1] === true, '짧은 길이 카드 지도 칸 밖으로 나가요: ' + r[1]);
  noErr(page, '카드 지도');
});

// ─── 판 -369: 사진 보기에서 '위치' → 찍은 곳 지도 ───
await test('사진 보기: 위치를 누르면 찍은 곳 지도', async page => {
  const t = await seed(page);
  const r = await page.evaluate(async t => {
    const b = new Blob(['x'], { type: 'image/jpeg' }), p1 = { id: 'ph_w1', t, ts: Date.now(), lat: 37.401, lng: 127.291, blob: b, thumb: '' }, p2 = { id: 'ph_w2', t, ts: Date.now(), lat: null, lng: null, blob: b, thumb: '' };
    __T.showPhoto(p2, [p2, p1]); await new Promise(z => setTimeout(z, 200));
    const no = !!document.querySelector('button[aria-label="위치"]');
    document.querySelector('button[aria-label="다음 사진"]').click(); await new Promise(z => setTimeout(z, 200));
    const btn = document.querySelector('button[aria-label="위치"]'); if (!btn) return { no, btn: false };
    btn.click(); await new Promise(z => setTimeout(z, 600));
    const mapOk = [...document.querySelectorAll('.leaflet-container')].some(e => e.getBoundingClientRect().width > 300), cap = document.body.innerText.includes('찍은 곳');
    return { no, btn: true, mapOk, cap };
  }, t);
  ok(!r.no, '위치 없는 사진에도 위치 단추가 보여요');
  ok(r.btn, '위치 있는 사진에 위치 단추가 없어요');
  ok(r.mapOk && r.cap, '위치를 눌러도 찍은 곳 지도가 안 열려요');
  noErr(page, '사진 위치');
});

// ─── 판 -370: 여행 중 지난 일정·길은 회색 (사용자 '지도에 과거에 간길과 미래에 갈길 색깔을 다르게 하자') ───
await test('지난 길 · 여행 중에만 지난 날·다녀온 곳·지난 시각은 지난 것', async page => {
  await page.goto(BASE + '?my=1'); await sleep(800);
  const r = await page.evaluate(() => { const d = new Date(), ymd = x => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    const y = new Date(d); y.setDate(d.getDate() - 1); const now = new Date(d); now.setHours(12, 0, 0, 0);
    const on = { id: 'a', start: ymd(y), nd: 3 }, before = { id: 'b', start: ymd(new Date(d.getTime() + 5 * 864e5)), nd: 3 };
    const P = __T.planPast;
    return [P(on, 0, {}, now), P(on, 1, { t: '09:00' }, now), P(on, 1, { t: '15:00' }, now), P(on, 1, { t: '15:00', ok: 1 }, now), P(on, 2, { t: '08:00' }, now), P(before, 0, { t: '01:00' }, now)]; });
  ok(JSON.stringify(r) === JSON.stringify([true, true, false, true, false, false]), '지난 것 가르기가 틀려요: ' + JSON.stringify(r));
});

await test('여행 계획 오늘 칸에서 기록 시작 · 둘째 날은 같은 여행에 (판 -371)', async page => {
  await seed(page); await page.goto(BASE); await sleep(600);
  await page.evaluate(() => { localStorage.removeItem('walkNow'); const y = new Date(); y.setDate(y.getDate() - 1); const ymd = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;   // 판 -382: 어제 시작한 계획(첫날은 기록 안 함)
    localStorage.setItem('tripPlans', JSON.stringify([{ id: 'tpr1', name: '장가계 4박 5일', start: ymd, nd: 5, it: [], at: 1, u: 1 }])); });
  await page.goto(BASE + '?walk=1&mode=travel&go=1&pt=tpr1'); await sleep(1500);
  const a = await page.evaluate(() => { const id = JSON.parse(localStorage.getItem('walkNow')); const aid = JSON.parse(localStorage.getItem('walkAlbum:' + id)); const al = JSON.parse(localStorage.getItem('albums')).find(x => x.id === aid); return { id, aid, name: al && al.name, day: JSON.parse(localStorage.getItem('trackName:' + id)), map: JSON.parse(localStorage.getItem('planAlbum:tpr1')), url: location.search }; });
  ok(/2일차$/.test(a.day || ''), '계획 2일차에 시작했으면 기록도 2일차여야 해요(판 -382) ' + a.day);
  ok(a.id && a.name === '장가계 4박 5일' && a.map === a.aid, '계획 이름의 여행으로 시작해야 해요 ' + JSON.stringify(a));
  ok(!/pt=|go=/.test(a.url), '주소에서 go·pt를 지워야 해요 ' + a.url);
  await page.evaluate(() => localStorage.removeItem('walkNow'));
  await page.goto(BASE + '?walk=1&mode=travel&go=1&pt=tpr1'); await sleep(1500);
  const b = await page.evaluate(() => { const id = JSON.parse(localStorage.getItem('walkNow')); const aid = JSON.parse(localStorage.getItem('walkAlbum:' + id)); const al = JSON.parse(localStorage.getItem('albums')).find(x => x.id === aid); return { aid, days: al && al.days.length, name: JSON.parse(localStorage.getItem('trackName:' + id)) }; });
  ok(b.aid === a.aid && b.days === 2 && /2일차/.test(b.name), '같은 여행에 이어지고 이름은 계획 날짜(2일차)여야 해요 ' + JSON.stringify(b));
  noErr(page, '계획에서 기록 시작');
});

await test('여러 날 여행 · 날짜가 바뀌면 저절로 다음 날 (판 -372)', async page => {
  await seed(page); await page.goto(BASE); await sleep(600);
  const r = await page.evaluate(() => {
    const mid = new Date(); mid.setHours(0, 0, 0, 0); const m = mid.getTime(), id = 'walk_rolltest1';
    localStorage.setItem('albums', JSON.stringify([{ id: 'album_rt', name: '장가계', mode: 'travel', days: [id], at: m - 9e6 }]));
    localStorage.setItem('walkAlbum:' + id, '"album_rt"'); localStorage.setItem('walkMode:' + id, '"travel"'); localStorage.setItem('walkNow', JSON.stringify(id)); localStorage.setItem('walkAt', String(m - 8e6));
    localStorage.setItem('track:' + id, JSON.stringify([[29.1, 110.4, m - 7e6], [29.11, 110.41, m - 6e6], [29.12, 110.42, m + 6e5], [29.13, 110.43, m + 9e5]]));
    localStorage.setItem('walkSpots:' + id, JSON.stringify([{ n: '어제', lat: 29.1, lng: 110.4, ts: m - 7e6 }, { n: '오늘', lat: 29.12, lng: 110.42, ts: m + 6e5 }]));
    const nid = __T.albumRoll(id, m + 1e6), again = __T.albumRoll(nid, m + 2e6);
    const al = JSON.parse(localStorage.getItem('albums'))[0];
    return { nid, again, now: JSON.parse(localStorage.getItem('walkNow')), days: al.days.length, old: JSON.parse(localStorage.getItem('track:' + id)).length, nw: JSON.parse(localStorage.getItem('track:' + nid) || '[]').length,
      name: JSON.parse(localStorage.getItem('trackName:' + nid)), sp: JSON.parse(localStorage.getItem('walkSpots:' + nid) || '[]').map(s => s.n) };
  });
  ok(r.nid && r.now === r.nid && r.days === 2 && r.name === '장가계 2일차', '다음 날 기록으로 넘어가야 해요 ' + JSON.stringify(r));
  ok(r.old === 2 && r.nw === 2 && JSON.stringify(r.sp) === '["오늘"]', '자정 앞뒤로 점·들른 곳이 나뉘어야 해요 ' + JSON.stringify(r));
  ok(r.again === null, '같은 날엔 다시 넘어가지 않아야 해요');
});

await test('여행 계획 날짜 안이면 저절로 여행 기록 · 끝나면 저절로 끝 (판 -373)', async page => {
  await seed(page); await page.goto(BASE); await sleep(600);
  const r = await page.evaluate(() => {
    const d = new Date(), ymd = x => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    localStorage.removeItem('walkNow');
    localStorage.setItem('tripPlans', JSON.stringify([{ id: 'tpa1', name: '장가계 4박 5일', start: ymd(d), nd: 5, it: [], at: 1, u: 1 }, { id: 'tpa2', name: '오사카', start: ymd(new Date(d.getTime() + 20 * 864e5)), nd: 3, it: [], at: 1, u: 1 }]));
    const id = __T.tripAutoEnsure(true, true), again = __T.tripAutoEnsure(true, true);
    const aid = JSON.parse(localStorage.getItem('walkAlbum:' + id)), al = JSON.parse(localStorage.getItem('albums')).find(x => x.id === aid);
    const out = { id, again, name: al && al.name, map: JSON.parse(localStorage.getItem('planAlbum:tpa1')) === aid };
    localStorage.setItem('tripPlans', JSON.stringify([{ id: 'tpa1', name: '장가계 4박 5일', start: ymd(new Date(d.getTime() - 9 * 864e5)), nd: 5, it: [], at: 1, u: 1 }]));
    out.end = __T.tripAutoEnsure(true, true); out.now = localStorage.getItem('walkNow');
    localStorage.setItem('walkNow', '"walk_manual01"'); out.manual = __T.tripAutoEnsure(true, true);
    return out;
  });
  ok(r.id && r.again === r.id && r.name === '장가계 4박 5일' && r.map, '여행 날짜엔 그 계획 이름의 여행 기록이 하나만 저절로 시작돼야 해요 ' + JSON.stringify(r));
  ok(r.end === null && (r.now === null || r.now === 'null'), '여행이 끝나면 저절로 끝나야 해요 ' + JSON.stringify(r));
  ok(r.manual === 'walk_manual01', '손으로 시작한 기록은 건드리지 않아야 해요 ' + JSON.stringify(r));
});

await test('여행 계획 지도 · 실제 다닌 길은 그날 점만 (판 -374)', async page => {
  await seed(page); await page.goto(BASE); await sleep(600);
  const r = await page.evaluate(() => {
    const d0 = new Date(); d0.setHours(0, 0, 0, 0); const t = d0.getTime(), ymd = `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, '0')}-${String(d0.getDate()).padStart(2, '0')}`;
    localStorage.setItem('albums', JSON.stringify([{ id: 'album_rr', name: 'x', mode: 'travel', days: ['walk_rr1', 'walk_rr2'], at: t }]));
    localStorage.setItem('planAlbum:prr', '"album_rr"');
    localStorage.setItem('track:walk_rr1', JSON.stringify([[37.5, 126.4, t + 1e6], [37.51, 126.41, t + 2e6], [37.52, 126.42, t + 3e6]]));
    localStorage.setItem('track:walk_rr2', JSON.stringify([[29.1, 110.4, t + 864e5 + 1e6], [29.11, 110.41, t + 864e5 + 2e6]]));
    const p = { id: 'prr', start: ymd, nd: 3 };
    return [__T.planRealSegs(p, 0).map(s => s.length), __T.planRealSegs(p, 1).map(s => s.length), __T.planRealSegs(p, 2).length];
  });
  ok(JSON.stringify(r) === '[[3],[2],0]', '날마다 그날 실제 길만 나와야 해요 ' + JSON.stringify(r));
});

await test('잘못 끝낸 기록 이어서 · 기록 지도에 오늘 일정 (판 -375)', async page => {
  await seed(page); await page.goto(BASE); await sleep(600);
  await page.evaluate(() => {
    const d0 = new Date(); d0.setHours(0, 0, 0, 0); const t = Math.max(d0.getTime() + 1000, Date.now() - 3600e3), ymd = `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, '0')}-${String(d0.getDate()).padStart(2, '0')}`;
    localStorage.removeItem('walkNow');
    localStorage.setItem('tripPlans', JSON.stringify([{ id: 'tpz', name: '장가계', start: ymd, nd: 3, it: [{ id: 'a', d: 0, n: '공항', k: 'spot', lat: 37.46, lng: 126.44 }, { id: 'b', d: 0, n: '카페', k: 'food', lat: 37.49, lng: 126.51 }], at: 1, u: 1 }]));
    localStorage.setItem('albums', JSON.stringify([{ id: 'album_z', name: '장가계', mode: 'travel', days: ['walk_zz1'], at: t }]));
    localStorage.setItem('planAlbum:tpz', '"album_z"'); localStorage.setItem('walkAlbum:walk_zz1', '"album_z"'); localStorage.setItem('walkMode:walk_zz1', '"travel"');
    localStorage.setItem('track:walk_zz1', JSON.stringify([[37.46, 126.44, t], [37.47, 126.45, t + 6e5]]));
  });
  await page.goto(BASE + '?plan=1&p=tpz'); await sleep(2000);
  const card = await page.evaluate(() => [...document.querySelectorAll('a')].some(a => /resume=walk_zz1/.test(a.href) && /이어서/.test(a.textContent)));
  ok(card, "계획 '오늘' 칸에 '● 이어서'가 있어야 해요");
  page.errs = [];
  await page.goto(BASE + '?walk=1&resume=walk_zz1'); await sleep(2500);
  const r = await page.evaluate(() => ({ now: JSON.parse(localStorage.getItem('walkNow')), url: location.search, plan: [...document.querySelectorAll('a.leaflet-control, .leaflet-control a')].some(a => /일차 일정/.test(a.textContent)), pins: [...document.querySelectorAll('.leaflet-marker-icon')].filter(m => /^[12]$/.test(m.textContent.trim())).length }));
  ok(r.now === 'walk_zz1' && !/resume/.test(r.url), '끝낸 기록이 다시 기록 중이 돼야 해요 ' + JSON.stringify(r));
  ok(r.plan && r.pins >= 2, '기록 지도에 오늘 일정 핀과 일정 단추가 있어야 해요 ' + JSON.stringify(r));
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  noErr(page, '이어서 기록');
});

await test('기록 지도 일정 단추 · 계획 연결이 다른 여행 묶음을 가리켜도 나옴 (판 -380)', async page => {
  // 사용자 기록 화면 캡처 '여행계획보기 안되네': '장가계 4박 5일 · 하나투어 2일차' 기록인데 지도에 '🗓 일정'이 없음 — 계획 연결(planAlbum:)이 같은 이름의 다른 묶음을 가리킴
  await seed(page); await page.goto(BASE); await sleep(600);
  await page.evaluate(() => {
    const d0 = new Date(); d0.setHours(0, 0, 0, 0); const t = Math.max(d0.getTime() + 1000, Date.now() - 3600e3), ymd = `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, '0')}-${String(d0.getDate()).padStart(2, '0')}`;
    const S = (k, v) => localStorage.setItem(k, JSON.stringify(v)), nm = '장가계 4박 5일 · 하나투어';
    S('tripPlans', [{ id: 'tpw', name: nm, start: ymd, nd: 5, it: [{ id: 'a', d: 0, n: '공항', k: 'spot', lat: 37.46, lng: 126.44 }, { id: 'b', d: 0, n: '카페', k: 'food', lat: 37.49, lng: 126.51 }], at: 1, u: 1 },
      { id: 'tpo', name: '장가계', start: '2025-01-01', nd: 2, it: [], at: 1, u: 1 }]);
    S('albums', [{ id: 'album_A', name: nm, mode: 'travel', days: [], at: t }, { id: 'album_B', name: nm, mode: 'travel', days: ['walk_w2'], at: t }]);
    S('planAlbum:tpw', 'album_A'); S('walkAlbum:walk_w2', 'album_B'); S('walkMode:walk_w2', 'travel'); S('trackName:walk_w2', nm + ' 2일차');
    S('track:walk_w2', [[37.46, 126.44, t], [37.47, 126.45, t + 6e5]]); S('walkNow', 'walk_w2'); S('walkAt', t);
  });
  await page.goto(BASE + '?walk=1'); await sleep(2500);
  const r = await page.evaluate(() => ({ link: ([...document.querySelectorAll('a.leaflet-control, .leaflet-control a')].find(a => /일차 일정/.test(a.textContent)) || {}).href || '', pins: [...document.querySelectorAll('.leaflet-marker-icon')].filter(e => /^[0-9]+$/.test(e.textContent.trim())).length, pa: JSON.parse(localStorage.getItem('planAlbum:tpw')) }));
  ok(/p=tpw/.test(r.link), "기록 지도에 '일정' 단추(그 계획으로)가 있어야 해요 " + JSON.stringify(r));
  ok(r.pins >= 2, '오늘 일정 핀이 있어야 해요 ' + JSON.stringify(r));
  ok(r.pa === 'album_A', '계획 연결을 저절로 바꾸면 안 돼요 ' + JSON.stringify(r));
  noErr(page, '기록 지도 일정');
});

await test('여행 첫날 끝낸 뒤 빈 2일차가 생기지 않게 (판 -376)', async page => {
  await page.goto(BASE); await sleep(800);
  const r = await page.evaluate(() => {
    const d0 = new Date(); d0.setHours(0, 0, 0, 0); const t = Math.max(d0.getTime() + 1000, Date.now() - 3600e3), ymd = `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, '0')}-${String(d0.getDate()).padStart(2, '0')}`;
    const S = (k, v) => localStorage.setItem(k, JSON.stringify(v)), G = k => JSON.parse(localStorage.getItem(k));
    S('tripPlans', [{ id: 'tpq', name: '장가계 4박 5일 · 하나투어', start: ymd, nd: 5, it: [], at: 1, u: 1 }]);
    // 첫날 기록은 다른 여행 묶음(B)에, 계획은 빈 2일차가 든 묶음(A)에 붙어 있는 꼬인 상태
    S('albums', [{ id: 'album_A', name: '장가계 4박 5일 · 하나투어', mode: 'travel', days: ['walk_e2'], at: t }, { id: 'album_B', name: '장가계 4박 5일 · 하나투어', mode: 'travel', days: ['walk_d1'], at: t }]);
    S('planAlbum:tpq', 'album_A');
    S('track:walk_d1', [[37.46, 126.44, t], [37.47, 126.45, t + 6e5], [37.48, 126.46, t + 9e5]]); S('walkMode:walk_d1', 'travel'); S('walkAlbum:walk_d1', 'album_B'); S('trackName:walk_d1', '장가계 4박 5일 · 하나투어 1일차');
    S('track:walk_e2', [[37.48, 126.46, Date.now() - 6e4]]); S('walkMode:walk_e2', 'travel'); S('walkAlbum:walk_e2', 'album_A'); S('trackName:walk_e2', '장가계 4박 5일 · 하나투어 2일차');
    S('walkNow', 'walk_e2'); S('walkAutoTrip', 'walk_e2'); S('walkAt', Date.now() - 6e4);
    const w1 = window.__T.tripAutoEnsure(true, true);
    const a1 = { w1, e2: localStorage.getItem('track:walk_e2'), d1n: G('track:walk_d1').length, plan: G('planAlbum:tpq') };
    // 끝내기를 누른 뒤(기록 중 아님) 다시 켜도 새 기록을 만들지 않고 첫날에 이어요
    S('walkNow', null); S('track:walk_e3', [[37.48, 126.46, Date.now() - 3e4]]); S('walkMode:walk_e3', 'travel'); S('walkAlbum:walk_e3', 'album_B'); S('walkAutoTrip', 'walk_e3');
    { const B = G('albums'); B[1].days.push('walk_e3'); S('albums', B); }   // 끝내기로 멈춘 빈 자동 기록도 합쳐져야 (판 -377)
    const w2 = window.__T.tripAutoEnsure(true, true);
    return { ...a1, w2, alb: G('albums').map(a => a.id + ':' + a.days.join(',')) };
  });
  ok(r.w1 === 'walk_d1' && r.e2 === null && r.d1n === 4 && r.plan === 'album_B', '빈 2일차를 첫날 기록에 합쳐야 해요 ' + JSON.stringify(r));
  ok(r.w2 === 'walk_d1' && !r.alb.join().includes('walk_e2') && !r.alb.join().includes('walk_e3'), '끝낸 뒤에도 첫날에 이어야 해요 ' + JSON.stringify(r));
});

await test('같은 날 둘로 나뉜 여행 기록 합치기 (판 -378)', async page => {
  await page.goto(BASE); await sleep(800);
  const r = await page.evaluate(() => {
    const d0 = new Date(); d0.setHours(0, 0, 0, 0); const t = Math.max(d0.getTime() + 60e3, Date.now() - 3 * 3600e3), ymd = `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, '0')}-${String(d0.getDate()).padStart(2, '0')}`;
    const S = (k, v) => localStorage.setItem(k, JSON.stringify(v)), G = k => JSON.parse(localStorage.getItem(k));
    S('tripPlans', [{ id: 'tpm', name: '장가계', start: ymd, nd: 5, it: [], at: 1, u: 1 }]);
    S('albums', [{ id: 'album_M', name: '장가계', mode: 'travel', days: ['walk_m1', 'walk_m2'], at: t }]); S('planAlbum:tpm', 'album_M');
    S('track:walk_m1', [[37.46, 126.44, t], [37.47, 126.45, t + 6e5]]); S('walkMode:walk_m1', 'travel'); S('walkAlbum:walk_m1', 'album_M'); S('trackName:walk_m1', '장가계 1일차');
    S('track:walk_m2', [[37.48, 126.46, t + 9e5], [37.49, 126.47, t + 12e5]]); S('walkMode:walk_m2', 'travel'); S('walkAlbum:walk_m2', 'album_M'); S('trackName:walk_m2', '장가계 2일차');
    S('walkNow', 'walk_m2'); S('walkAutoTrip', 'walk_m2'); S('walkAt', t + 9e5);
    const w = window.__T.tripAutoEnsure(true, true);
    return { w, n: G('track:walk_m1').length, gone: localStorage.getItem('track:walk_m2'), days: G('albums')[0].days, undo: !!(G('tripMergeUndo') || {}).snap };
  });
  ok(r.w === 'walk_m1' && r.n === 4 && r.gone === null && r.days.join() === 'walk_m1' && r.undo, '2일차를 1일차로 합치고 되돌리기 자료를 남겨야 해요 ' + JSON.stringify(r));
});

await test('여행 첫날 1일차·2일차 두 장 안 생기게 · 손으로 시작한 기록도 합침 (판 -384)', async page => {
  // 사용자 첫 화면 캡처(여행 중 1일차인데 최근 이야기에 '1일차 800m'·'2일차 900m' 같은 날 두 장)
  await page.goto(BASE); await sleep(800);
  const r = await page.evaluate(() => {
    const d0 = new Date(); d0.setHours(0, 0, 0, 0); const t = Math.max(d0.getTime() + 60e3, Date.now() - 3 * 3600e3), ymd = `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, '0')}-${String(d0.getDate()).padStart(2, '0')}`;
    const S = (k, v) => localStorage.setItem(k, JSON.stringify(v)), G = k => JSON.parse(localStorage.getItem(k));
    S('tripPlans', [{ id: 'tph', name: '장가계', start: ymd, nd: 5, it: [], at: 1, u: 1 }]);
    S('albums', [{ id: 'album_H', name: '장가계', mode: 'travel', days: ['walk_h1', 'walk_h2'], at: t }]); S('planAlbum:tph', 'album_H');
    S('track:walk_h1', [[37.46, 126.44, t], [37.47, 126.45, t + 6e5]]); S('walkMode:walk_h1', 'travel'); S('walkAlbum:walk_h1', 'album_H'); S('trackName:walk_h1', '장가계 1일차');
    S('track:walk_h2', [[37.48, 126.46, t + 9e5], [37.49, 126.47, t + 12e5]]); S('walkMode:walk_h2', 'travel'); S('walkAlbum:walk_h2', 'album_H'); S('trackName:walk_h2', '장가계 2일차');
    S('walkNow', 'walk_h2'); localStorage.removeItem('walkAutoTrip'); S('walkAt', t + 9e5);   // 손으로 시작한 기록(자동 기록 표시 없음)
    const w = window.__T.tripAutoEnsure(true, true);
    return { w, n: G('track:walk_h1').length, gone: localStorage.getItem('track:walk_h2'), days: G('albums')[0].days };
  });
  ok(r.w === 'walk_h1' && r.n === 4 && r.gone === null && r.days.join() === 'walk_h1', '손으로 시작한 같은 날 2일차도 1일차로 합쳐야 해요 ' + JSON.stringify(r));
  // 오늘 기록을 끝낸 뒤 계획 '오늘' 칸에서 다시 기록 시작 → 새 'n일차'를 만들지 않고 오늘 기록에 이어서
  await page.evaluate(() => { localStorage.removeItem('walkNow'); localStorage.removeItem('walkAutoTrip'); });
  await page.goto(BASE + '?walk=1&mode=travel&go=1&pt=tph'); await sleep(2500);
  const q = await page.evaluate(() => ({ now: JSON.parse(localStorage.getItem('walkNow')), days: JSON.parse(localStorage.getItem('albums'))[0].days }));
  ok(q.now === 'walk_h1' && q.days.join() === 'walk_h1', '오늘 기록이 있으면 새 기록을 만들지 말고 이어서 해야 해요 ' + JSON.stringify(q));
});

await test('초대받은 구경·로그인 안 한 사람도 위치 공유 자리와 로그인 안내 (판 -379)', async page => {
  await page.goto(BASE); await sleep(600);
  await page.evaluate(() => {
    const d0 = new Date(), ymd = `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, '0')}-${String(d0.getDate()).padStart(2, '0')}`;
    localStorage.setItem('tripPlans', JSON.stringify([{ id: 'tpv', name: '장가계', start: ymd, nd: 3, it: [{ id: 'a', d: 0, n: '공항', k: 'spot', lat: 37.46, lng: 126.44 }], room: { code: 'ABCDEFGH' }, at: 1, u: 1 }]));
    localStorage.setItem('planV:tpv', '1');
  });
  page.errs = [];
  await page.goto(BASE + '?plan=1&p=tpv'); await sleep(2500);
  const r = await page.evaluate(() => ({ pill: [...document.querySelectorAll('.tr-sw')].map(b => b.textContent).join('|'), ban: [...document.querySelectorAll('.pm-ban')].map(b => b.textContent).join('|') }));
  ok(/내 위치 공유/.test(r.pill), '지도에 내 위치 공유 스위치가 있어야 해요 (판 -380) ' + JSON.stringify(r));
  ok(/로그인/.test(r.ban), '맨 위 줄에 로그인 안내가 있어야 해요 ' + JSON.stringify(r));
  noErr(page, '구경 계획');
});

await test('여행 화면 맨 위 기록 알약 · 여행 전엔 초대 (판 -383)', async page => {
  await page.goto(BASE); await sleep(600);
  const ymd = o => { const d = new Date(); d.setDate(d.getDate() + o); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  await page.evaluate(([a, b]) => { localStorage.removeItem('walkNow'); localStorage.setItem('tripPlans', JSON.stringify([{ id: 'tpa', name: '장가계', start: a, nd: 3, it: [], at: 1, u: 1 }, { id: 'tpb', name: '오사카', start: b, nd: 3, it: [], at: 1, u: 1 }])); }, [ymd(0), ymd(10)]);
  const top = async id => { await page.goto(BASE + '?plan=1&p=' + id); await sleep(1500); return page.evaluate(() => [...document.querySelectorAll('.tv-topbar .n-ib')].map(b => b.textContent.trim() || b.getAttribute('aria-label')).join('|')); };
  const a = await top('tpa'); ok(/기록 시작/.test(a) && !/초대/.test(a) && !/영상/.test(a), '여행 날엔 기록 알약만 ' + a);
  await page.evaluate(() => { localStorage.setItem('walkNow', '"walk_q1"'); localStorage.setItem('walkAt', String(Date.now() - 3600e3)); localStorage.setItem('track:walk_q1', '[]'); });
  const a2 = await top('tpa'); if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT }); ok(/기록 중/.test(a2), '기록 중이면 빨간 알약 ' + a2);
  const b = await top('tpb'); ok(/초대/.test(b) && !/기록/.test(b), '여행 전엔 초대 ' + b);
  await page.evaluate(() => localStorage.removeItem('walkNow'));
});

// ─── 판 -388: 기록 중 다른 화면에서도 기록이 이어짐 (사용자 '이 모드에서 기록이 멈추는 것 같네') ───
await test('기록 중에 여행 계획·첫 화면으로 가도 길이 이어짐 · 멈춤 중엔 안 넣음 (판 -388)', async page => {
  const t = await seed(page);
  await page.context().grantPermissions(['geolocation']);
  await page.context().setGeolocation({ latitude: 29.12, longitude: 110.48, accuracy: 10 });
  await page.evaluate(t => { localStorage.setItem('walkNow', JSON.stringify(t)); localStorage.setItem('track:' + t, JSON.stringify([[29.10, 110.46, Date.now() - 60000]])); localStorage.removeItem('walkPause:' + t); }, t);
  const n = () => page.evaluate(t => JSON.parse(localStorage.getItem('track:' + t)).length, t);
  for (const url of ['?plan=1', '']) {
    await page.goto(BASE + url); await sleep(2600);
    const a = await n(); await page.context().setGeolocation({ latitude: 29.12 + Math.random() * 0.01, longitude: 110.49, accuracy: 10 }); await sleep(1500);
    ok(await n() > a || a > 1, `'${url || '첫 화면'}'에서 기록 중인데 길이 안 늘어요(${a})`);
  }
  await page.evaluate(t => localStorage.setItem('walkPause:' + t, JSON.stringify({ at: Date.now() })), t);
  await page.goto(BASE + '?plan=1'); await sleep(2600); const b = await n();
  await page.context().setGeolocation({ latitude: 29.2, longitude: 110.6, accuracy: 10 }); await sleep(1500);
  ok(await n() === b, '멈춤 중인데 길이 늘어요');
  noErr(page, '다른 화면 기록');
});

// ─── 판 -389: 끊긴 길 채우기 (사용자 '그래서 잃어버린 경로 복구해') ───
await test('끊긴 길 채우기 · 그 사이 사진 위치를 지나고 · 되돌리기 · 멈춤 뒤는 안 채움 (판 -389)', async page => {
  await page.goto(BASE + '?my=1'); await sleep(800);
  const r = await page.evaluate(async () => {
    const t = 'walk_gap1', t0 = Date.now() - 5 * 3600e3, tr = [];
    for (let i = 0; i < 10; i++) tr.push([29.05 + i * 0.0002, 110.48, t0 + i * 30000]);
    const a = tr[tr.length - 1]; tr.push([29.07, 110.48, a[2] + 40 * 60000]);   // 40분 · 2km 끊김(곧은 줄)
    for (let i = 1; i < 5; i++) tr.push([29.07 + i * 0.0002, 110.48, a[2] + 40 * 60000 + i * 30000]);
    tr.push([29.09, 110.50, a[2] + 90 * 60000, null, null, 1]);   // 멈춤 뒤 이어진 점(brk) — 채우면 안 돼요
    localStorage.setItem('track:' + t, JSON.stringify(tr)); localStorage.setItem('walkMode:' + t, '"hike"');
    await __T.photoPut({ id: 'ph_gap1', t, ts: a[2] + 20 * 60000, lat: 29.06, lng: 110.47, thumb: 'data:,' });   // 끊긴 사이에 찍은 사진(옆으로 1km 비켜 있음)
    const gaps = __T.trackGaps(tr).length, R = await __T.gapFill(t);
    const nt = JSON.parse(localStorage.getItem('track:' + t)), near = nt.some(q => Math.abs(q[0] - 29.06) < 0.0005 && Math.abs(q[1] - 110.47) < 0.0005);
    const sorted = nt.every((q, k) => !k || q[2] >= nt[k - 1][2]);
    __T.gapUndo(t); const back = JSON.parse(localStorage.getItem('track:' + t)).length;
    return { gaps, n: R.n, ph: R.ph, more: nt.length > tr.length, near, sorted, back, len: tr.length };
  });
  ok(r.gaps === 1 && r.n === 1, '끊긴 곳은 하나(멈춤 뒤는 빼고)여야 해요 ' + JSON.stringify(r));
  ok(r.more && r.near && r.ph === 1, '끊긴 길이 그때 찍은 사진 자리를 지나야 해요 ' + JSON.stringify(r));
  ok(r.sorted, '채운 점의 시각 차례가 섞였어요');
  ok(r.back === r.len, '되돌리기 뒤 예전 길과 달라요 ' + JSON.stringify(r));
  noErr(page, '끊긴 길 채우기');
});

// ─── 판 -394: 저절로 남은 '08:51 들른 곳'에 그 자리 이름 (사용자 장가계 받은 링크 캡처, 열 줄이 다 이름 없음) ───
await test('들른 곳 이름 · 지도 이름을 붙여 보이고 중국 한자는 우리 읽기 · 저장된 이름은 그대로 (판 -394)', async page => {
  await page.goto(BASE + '?my=1'); await sleep(800);
  const r = await page.evaluate(async () => {
    localStorage.setItem('sbNames', JSON.stringify({ '29.3500_110.4600': '天下第一桥', '29.3600_110.4700': '', '37.5000_127.0000': '호수공원' }));
    const box = document.createElement('div'); box.style.cssText = 'width:390px;height:400px'; document.body.append(box);
    const m = L.map(box).setView([29.35, 110.46], 14), ly = L.layerGroup().addTo(m);
    const S = [{ n: '10:35 들른 곳', k: 'stay', lat: 29.35, lng: 110.46, ts: 1 }, { n: '11:22 들른 곳', k: 'stay', lat: 29.36, lng: 110.47, ts: 2 },
      { n: '09:11 들른 곳', k: 'stay', lat: 37.5, lng: 127.0, ts: 3 }, { n: '내가 붙인 이름', k: 'stay', lat: 29.35, lng: 110.46, ts: 4 }];
    const keep = JSON.stringify(S);
    __T.spotMarkers(ly, S); await new Promise(z => setTimeout(z, 2500));
    return { tips: [...box.querySelectorAll('.leaflet-tooltip.nm')].map(e => e.textContent), same: JSON.stringify(S) === keep };
  });
  ok(r.tips.includes('천하제일교'), '중국 들른 곳에 우리 한자 읽기 이름이 안 붙어요: ' + JSON.stringify(r.tips));
  ok(r.tips.includes('호수공원'), '들른 곳에 찾아 둔 지도 이름이 안 붙어요: ' + JSON.stringify(r.tips));
  ok(!r.tips.some(t => /\d{1,2}:\d{2}/.test(t)), '지도 이름표에 시간이 있어요(판 -396 사용자 \'지도에는 시간 빼\'): ' + JSON.stringify(r.tips));
  ok(r.tips.includes('내가 붙인 이름') && r.tips.length === 3, '이름 못 찾은 곳은 핀만, 사용자가 붙인 이름은 그대로여야 해요: ' + JSON.stringify(r.tips));
  ok(r.same, '보여 주기만 해야 하는데 들른 곳 자료가 바뀌었어요');
  noErr(page, '들른 곳 이름');
});

// ─── 판 -400: 일행 사진 모으기 (사용자 '여행멤버들에게 어떻게 보여주는게 가장 좋은가' → '해보자') ───
await test('일행 사진 · 링크 열쇠로 잠가 올리고 다른 사람이 풀어 봄 · 위치 없으면 길 위 자리 · 내 기록엔 안 섞임 · 지우기 (판 -400)', async page => {
  await page.goto(BASE + '?my=1'); await sleep(500);
  const r = await page.evaluate(async () => {
    const DB = new Map(), f0 = window.fetch;
    window.fetch = async (u, o = {}) => { u = String(u);
      if (!u.includes('firestore.googleapis.com')) return new Response('{}', { status: 500 });
      const path = decodeURIComponent(u.split('/documents/')[1].split('?')[0]), mth = (o.method || 'GET').toUpperCase();
      if (mth === 'PATCH') { DB.set(path, JSON.parse(o.body).fields.d.stringValue); return new Response('{}'); }
      if (mth === 'DELETE') { DB.delete(path); return new Response('{}'); }
      if (DB.has(path)) return new Response(JSON.stringify({ fields: { d: { stringValue: DB.get(path) } } }));
      const docs = [...DB].filter(([k]) => k.startsWith(path + '/') && !k.slice(path.length + 1).includes('/')).map(([k, v]) => ({ name: 'x/' + k, fields: { d: { stringValue: v } } }));
      return docs.length ? new Response(JSON.stringify({ documents: docs })) : new Response('{}', { status: 404 }); };
    const t = 'crewT1', t0 = Date.parse('2026-11-26T09:00:00+08:00');
    localStorage.setItem('track:' + t, JSON.stringify([[29.35, 110.43, t0], [29.36, 110.44, t0 + 3600e3]]));
    const before = await __T.photoList ? (await __T.photoList(t)).length : 0;
    const cv = document.createElement('canvas'); cv.width = 400; cv.height = 300; cv.getContext('2d').fillRect(0, 0, 400, 300);
    const b = await new Promise(z => cv.toBlob(z, 'image/jpeg', .9)), f = new File([b], 'a.jpg', { type: 'image/jpeg', lastModified: t0 + 1800e3 });
    const kb = crypto.getRandomValues(new Uint8Array(16)), k = btoa(String.fromCharCode(...kb)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const room = { r: 'gvcrewtest01', k, owner: false };
    const n = await __T.mateAdd(room, [f, f], '유진', t);
    const raw = [...DB.values()].join('');
    const L = await __T.mateList({ r: 'gvcrewtest01', k, owner: true });
    const big = L[0] ? await __T.mateBig(room, L[0]) : null;
    const bad = await __T.mateList({ r: 'gvcrewtest01', k: 'AAAAAAAAAAAAAAAAAAAAAA', owner: false });
    const after = __T.photoList ? (await __T.photoList(t)).length : 0;
    await __T.mateDel(room, L[0]); const L2 = await __T.mateList({ r: 'gvcrewtest01', k, owner: true });
    window.fetch = f0;
    return { n, len: L.length, by: L[0] && L[0].by, lat: L[0] && L[0].lat, ts: L[0] && L[0].ts, th: !!(L[0] && L[0].thumb), big: big && big.size, plain: raw.includes('유진'), bad: bad.length, before, after, left: L2.length, docs: DB.size };
  });
  ok(r.n === 2 && r.len === 2, '일행 사진 두 장이 올라가고 보여야 해요: ' + JSON.stringify(r));
  ok(r.by === '유진' && r.th && r.big > 1000, '이름·작은 그림·큰 사진이 풀려야 해요: ' + JSON.stringify(r));
  ok(Math.abs(r.lat - 29.355) < 0.002, '위치 없는 사진은 그 시각 길 위 자리에 놓여야 해요: ' + r.lat);
  ok(!r.plain, '서버에 이름이 그대로 보여요(잠가야 해요)');
  ok(r.bad === 0, '열쇠가 다르면 하나도 못 봐야 해요');
  ok(r.before === r.after, '일행 사진이 내 기록 사진에 섞이면 안 돼요');
  ok(r.left === 1, '지운 사진은 목록에서 빠져야 해요: ' + r.left);
  noErr(page, '일행 사진');
});

// ─── 판 -399: 원본 사진 (사용자 '공유받은 사람이 가장 빠르게, 원본을 볼 수 있는 방법은?' → R2) ───
await test('원본 사진 · 사진첩에서 찍은 시각으로 찾기 · 잠그고 풀기 · 받은 사람은 원본으로 바꿔 끼움 · 창구 주소 없으면 꺼짐 (판 -399)', async page => {
  await page.goto(BASE + '?my=1'); await sleep(500);
  const r = await page.evaluate(async () => {
    const big = n => new Blob([new Uint8Array(n)], { type: 'image/jpeg' });
    const items = [{ uri: 'a', ts: 1000000, name: 'a.jpg' }, { uri: 'b', ts: 1003000, name: 'b.jpg' }, { uri: 'c', ts: 1002000, name: 'c.heic' }, { uri: 'd', ts: 2000000, name: 'd.jpg' }];
    window.mdNativePhotos = { range: async (f, t) => ({ items: items.filter(x => x.ts >= f && x.ts <= t) }), blob: async u => u === 'd' ? big(1000) : big(300000 + u.charCodeAt(0)) };
    const f1 = await __T.origFind({ ts: 1002500 }), f2 = await __T.origFind({ ts: 1500000 }), f3 = await __T.origFind({ ts: 2000000 });
    const kb = crypto.getRandomValues(new Uint8Array(16)), ks = btoa(String.fromCharCode(...kb)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const key = await crypto.subtle.importKey('raw', kb, 'AES-GCM', false, ['encrypt', 'decrypt']);
    const orig = new Uint8Array(400000).map((_, i) => i % 251), sealed = await __T.sealRaw(orig, key), back = new Uint8Array(await __T.openRaw(sealed, key));
    const off = await __T.origGet({ _o: 1, _h: 'x1' }, 'gvabcdef12', ks);   // 주소 없으면 아무것도 안 해요
    __T.origCfg('https://orig.test/'); const f0 = window.fetch; let asked = '';
    window.fetch = async u => { asked = String(u); return new Response(sealed, { status: 200 }); };
    const p = { id: 'gv_1', _o: 1, _h: 'x1', blob: big(10) }, b = await __T.origGet(p, 'gvabcdef12', ks);
    window.fetch = f0; __T.origCfg('');
    return { f1: f1 && f1.size, f2, f3, same: back.length === orig.length && back.every((v, i) => v === orig[i]), off, asked, got: b && b.size, pb: p.blob.size, big: p._big };
  });
  ok(r.f1 === 300000 + 'b'.charCodeAt(0), '사진첩에서 가장 가까운 시각의 그림 파일(HEIC 빼고)을 골라야 해요: ' + r.f1);
  ok(r.f2 === null, '5초 안에 같은 사진이 없으면 원본을 안 올려야 해요');
  ok(r.f3 === null, '200KB 아래 파일은 원본으로 안 봐야 해요');
  ok(r.same, '잠근 원본을 풀면 똑같아야 해요');
  ok(r.off === null, '창구 주소가 비어 있으면 원본 받기가 꺼져 있어야 해요');
  ok(r.asked === 'https://orig.test/o/gvabcdef12/x1', '원본 받는 주소가 틀려요: ' + r.asked);
  ok(r.got === 400000 && r.pb === 400000 && r.big === 1, '받은 원본으로 사진을 바꿔 끼워야 해요: ' + JSON.stringify(r));
  noErr(page, '원본 사진');
});

// ─── 판 -398: 사진 있는 공유 카드는 사진이 주인공 (사용자 '안볼것 같아') ───
await test('공유 카드 · 큰 사진이 있으면 사진 줄 크게·숫자 한 줄·사진 수 · 제목은 띄어쓰기에서 끊기 (판 -398)', async page => {
  const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  ok(/const slim = !!cov && PH\.length > 0 && !gOn;/.test(src) && /slim \? 300 : 140/.test(src), '사진 카드의 큰 사진 줄이 빠졌어요(판 -398)');
  ok(/tiles\.push\(\{ k: '사진', v: `\$\{nPh\}장` \}\)/.test(src), '카드 숫자 칸에 사진 수가 빠졌어요');
  ok(/`사진 \$\{\(o\.photoRecs \|\| \[\]\)\.length\}장 보기`/.test(src), '카톡 단추가 사진 n장 보기가 아니에요');
  ok(/const sp = cur\.lastIndexOf\(' '\)/.test(src), '카드 제목이 낱말 가운데서 끊겨요');
  await page.goto(BASE + '?my=1'); await sleep(500); noErr(page, '공유 카드');
});

// ─── 판 -397: 여행 기록 이름 며칠째 = 계획 날짜 (사용자 공유 카드 '3일차인데?') ───
await test('여행 날 이름 · 여행 이름이 계획 이름보다 길어도 계획 날짜로 · 잘못 붙은 이름 한 번 바로잡기 (판 -397)', async page => {
  await page.goto(BASE + '?my=1'); await sleep(800);
  const r = await page.evaluate(() => {
    const D = 864e5, t0 = new Date(); t0.setHours(9, 0, 0, 0); const day = k => t0.getTime() - k * D;
    const st = new Date(day(2)); const ymd = `${st.getFullYear()}-${String(st.getMonth() + 1).padStart(2, '0')}-${String(st.getDate()).padStart(2, '0')}`;
    localStorage.setItem('tripPlans', JSON.stringify([{ id: 'pl1', name: '장가계 4박 5일', start: ymd, nd: 5, it: [] }, { id: 'pl2', name: '장가계 4박 5일 2안', start: '2027-01-01', nd: 3, it: [] }]));
    const A = '장가계 4박 5일 · 하나투어', ids = ['r1', 'r1b', 'r2', 'r3'];
    const set = (k, v) => localStorage.setItem(k, JSON.stringify(v));
    set('track:r1', [[29.3, 110.4, day(2)]]); set('track:r1b', [[29.3, 110.4, day(2) + 3600e3]]); set('track:r2', [[29.3, 110.4, day(1)]]); set('track:r3', [[29.3, 110.4, day(0)]]);
    set('trackName:r1', A + ' 1일차'); set('trackName:r1b', '내가 붙인 이름'); set('trackName:r2', A + ' 3일차'); set('trackName:r3', A + ' 4일차');
    ids.forEach(i => set('walkAlbum:' + i, 'al1')); set('albums', [{ id: 'al1', name: A, days: ids, last: Date.now() }]);
    const n = __T.albumDayN({ id: 'al1', name: A, days: ids }); __T.dayNameFix();
    const g = k => JSON.parse(localStorage.getItem(k));
    return { n, p: (__T.albumPlan({ id: 'al1', name: A, days: ids }) || {}).id, names: ids.map(i => g('trackName:' + i)), old: g('dayNameOld:r3') };
  });
  ok(r.p === 'pl1', '여행 이름이 계획 이름으로 시작하면 그 계획을 찾아야 해요(2안 아님): ' + r.p);
  ok(r.n === 3, '오늘은 계획 3일차인데 다른 날 수예요: ' + r.n);
  ok(JSON.stringify(r.names) === JSON.stringify(['장가계 4박 5일 · 하나투어 1일차', '내가 붙인 이름', '장가계 4박 5일 · 하나투어 2일차', '장가계 4박 5일 · 하나투어 3일차']), '날 이름 바로잡기가 틀려요: ' + JSON.stringify(r.names));
  ok(r.old === '장가계 4박 5일 · 하나투어 4일차', '바꾸기 전 이름을 남겨야 해요: ' + r.old);
  noErr(page, '여행 날 이름');
});

// ─── 판 -395: 받은 링크 화면 (사용자 '보기 좋게. 관심가게 좀 해라. 이거 누가 보겠냐!!') ───
await test('받은 링크 · 이름 붙은 곳만 짧게 · 같은 이름은 한 번 · 길찾기는 접기 · 기록 중에도 들어와서 보기 (판 -395)', async page => {
  await page.addInitScript(() => { try { localStorage.setItem('sbNames', JSON.stringify({ '29.3980_110.4320': '天子山街道', '29.4070_110.4380': '天子山街道', '29.4160_110.4440': '袁家界' })); } catch {} });
  const R = []; for (let i = 0; i < 40; i++) R.push([29.395 + i * 0.0006, 110.43 + i * 0.0004]);
  const o = { name: '장가계 3일차', dateText: '11월 26일', modeLabel: '여행', modeK: 'travel', stats: ['걸은 거리 8.2km'], route: R,
    spots: [{ n: '08:51 들른 곳', lat: 29.398, lng: 110.432, k: 'stay' }, { n: '10:35 들른 곳', lat: 29.407, lng: 110.438, k: 'stay' }, { n: '11:00 들른 곳', lat: 29.41, lng: 110.5, k: 'stay' }, { n: '12:19 들른 곳', lat: 29.416, lng: 110.444, k: 'stay' }] };
  const b = Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  await page.goto(BASE + '?brag=' + b); await sleep(2500);
  const r = await page.evaluate(() => ({ rows: [...document.querySelectorAll('.bl-stop')].filter(e => e.style.display !== 'none').map(e => e.textContent),
    go: !!document.querySelector('details.bl-go'), open: document.querySelector('details.bl-go') && document.querySelector('details.bl-go').open, list: (document.querySelector('.bl-stops') || {}).innerText.includes('11:00') }));
  ok(JSON.stringify(r.rows) === JSON.stringify(['08:51천자산가도', '12:19원가계']), '들른 곳 시간표가 틀려요(같은 이름은 한 번, 이름 없는 곳은 빼야): ' + JSON.stringify(r.rows));
  ok(r.go && !r.open, '길찾기·따라가기·GPX는 접힌 칸 안에 있어야 해요');
  ok(!r.list, '이름 없는 들른 곳이 그대로 보여요');
  const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  ok(/cardOpts\.gv = which === 'mine' && !room \?/.test(src), '기록 중에 보낸 링크가 다시 요약 화면이 돼요(판 -395)');
  ok(/function guestLive\(\)/.test(src), '기록 중 들어와서 보기 링크를 새로 올리는 guestLive가 없어요');
  noErr(page, '받은 링크 화면');
});

// ─── 판 -393: 지도 이름표가 겹겹이 쌓이지 않게 ───
await test('지도 이름표 겹침 · 겹치면 뒤엣것 숨김 · 확대하면 다시 · 이름 있는 곳 먼저 (판 -393)', async page => {
  await page.goto(BASE + '?my=1'); await sleep(800);
  const r = await page.evaluate(async () => {
    const d = document.createElement('div'); d.style.cssText = 'position:fixed;left:0;top:0;width:360px;height:360px;z-index:99999'; document.body.append(d);
    const m = L.map(d).setView([29.35, 110.5], 11), ly = L.layerGroup().addTo(m);
    __T.spotMarkers(ly, [{ n: '천자산 전망대', lat: 29.351, lng: 110.5 }, { k: 'stay', n: '오룡채', lat: 29.35, lng: 110.5 }, { k: 'stay', n: '십리화랑', lat: 29.352, lng: 110.5 },
      { k: 'stay', n: '원가계', lat: 29.33, lng: 110.45 }, { k: 'stay', n: '원가계', lat: 29.37, lng: 110.55 }, { k: 'stay', n: '09:11 들른 곳', lat: 29.36, lng: 110.47 }]);
    await new Promise(r => setTimeout(r, 300));
    const vis = () => [...d.querySelectorAll('.leaflet-tooltip.nm')].filter(e => e.style.visibility !== 'hidden').map(e => e.textContent);
    const far = vis(); m.setZoom(18, { animate: false }); await new Promise(r => setTimeout(r, 300)); const near = vis(); d.remove(); return { far, near };
  });
  ok(r.far.filter(t => t !== '원가계').length === 1 && r.far.includes('천자산 전망대'), '멀리서 보면 겹친 이름표는 하나만 보여야 해요 ' + JSON.stringify(r));
  ok(r.far.filter(t => t === '원가계').length === 1, '같은 이름은 지도에 한 번만 보여야 해요(판 -396) ' + JSON.stringify(r));
  ok(!r.far.concat(r.near).some(t => /들른 곳/.test(t)), '이름 없는 들른 곳은 지도에 이름표 없이 핀만이어야 해요(판 -396) ' + JSON.stringify(r));
  ok(r.near.filter(t => t !== '원가계').length === 3, '확대하면 겹쳤던 이름표가 다 보여야 해요 ' + JSON.stringify(r));
  noErr(page, '이름표 겹침');
});

await browser.close();
server.close();
console.log(`\n결과: 통과 ${pass} · 실패 ${fail}` + (fails.length ? '\n실패: ' + fails.join(', ') : ''));
process.exit(fail ? 1 : 0);
