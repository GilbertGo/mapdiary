// 구글 테이크아웃 사진 → MPD 여러 날 여행 기록(백업 파일)
// 2026-11-22 사용자 '2018년 산티아고 순례길 사진만 가지고 MPD로 여행기록을 거꾸로 만들 수 있으면 최고!!' → '1번은 하고(도구), 프랑스길 레온부터'
//
// 하는 일
//  1. 테이크아웃 폴더(압축 푼 것)에서 사진과 짝 .json(찍은 시각 photoTakenTime · 위치 geoData)을 읽어요. .json이 없으면 사진 속 EXIF를 봐요
//  2. 여행 날짜 안 사진만 골라(--from/--to, 없으면 길에서 25km 안에서 찍은 첫 사진~마지막 사진 날짜) 현지 날짜(--tz)마다 하루 기록으로 나눠요
//  3. 하루 길 = 사진 위치를 시간 순으로 잇고, 두 사진이 모두 순례길(--route) 가까이면 그 사이는 순례길을 따라가요(시각은 거리 비율로 나눠요)
//  4. 위치 없는 사진은 그 시각에 있었을 길 위 자리에 놓아요
//  5. MPD 백업 파일(MapDiary_….json)로 내보내요 → 앱 '내 MPD → 기록 지키기 · 가져오기 → 백업 불러오기'
//     백업 불러오기는 지운 기록·사진(묘비)을 먼저 보고 photoPut으로 넣어서, 지운 것은 되살아나지 않아요(CLAUDE.md 문지기 규칙)
//     파일이 크면(--max-mb, 기본 45MB) 날짜 순으로 여러 파일로 나눠요. 같은 여행(album) 아이디라 불러오면 한 여행으로 합쳐져요
//  같은 사진을 두 번 넣어도 아이디가 같아 겹치지 않아요(기록·사진·여행 아이디를 날짜·사진에서 만들어서)
//
// 쓰는 법
//   cd tools/takeout2mpd && npm i
//   node takeout2mpd.mjs --takeout <압축 푼 Takeout 폴더> --route route.json --name "산티아고 순례길" --out <내보낼 폴더>
//     [--from 2018-09-10 --to 2018-10-05] [--tz Europe/Madrid] [--mode travel] [--max-mb 45] [--dry]
// route.json: { name, pts: [[lat,lng],…](길 차례대로), towns: [{ n, lat, lng }] } — OSM 순례길 관계에서 만든 것(만든 법은 README.md)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => { if (x.startsWith('--')) a.push([x.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]); return a; }, []));
if (!args.takeout || !args.out) { console.error('쓰는 법: node takeout2mpd.mjs --takeout <폴더> --out <폴더> [--route route.json] [--name 이름] [--from YYYY-MM-DD --to YYYY-MM-DD] [--tz Europe/Madrid] [--dry]'); process.exit(2); }
const TZ = args.tz || 'Europe/Madrid', NAME = String(args.name || '여행').slice(0, 30), MODE = args.mode || 'travel', MAX_MB = +args['max-mb'] || 45;
const IMG = /\.(jpe?g|png|heic|heif|webp)$/i, VID = /\.(mp4|mov|m4v|3gp|webm)$/i;

// ── 거리·길 ──
const R = 6371000, rad = d => d * Math.PI / 180;
function dist(a, b, c, d) { const x = rad(c - a), y = rad(d - b), h = Math.sin(x / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(y / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); }
let route = null;
if (args.route) {
  route = JSON.parse(fs.readFileSync(args.route, 'utf8'));
  route.cum = [0]; for (let i = 1; i < route.pts.length; i++) route.cum.push(route.cum[i - 1] + dist(...route.pts[i - 1], ...route.pts[i]));
}
function snap(lat, lng) {   // 길에서 가장 가까운 점
  let bi = -1, bd = Infinity;
  for (let i = 0; i < route.pts.length; i++) { const p = route.pts[i], d = dist(lat, lng, p[0], p[1]); if (d < bd) { bd = d; bi = i; } }
  return { i: bi, d: bd };
}
function townNear(lat, lng, max = 3000) {
  if (!route || !route.towns) return null;
  let b = null, bd = max; for (const t of route.towns) { const d = dist(lat, lng, t.lat, t.lng); if (d < bd) { bd = d; b = t.n; } } return b;
}

// ── 테이크아웃 읽기 ──
function walk(dir, out = []) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p, out); else out.push(p); } return out; }
const files = walk(args.takeout);
const jsons = files.filter(f => /\.json$/i.test(f));
const byDirTitle = new Map();   // '폴더|사진 원래 이름' → [{ file, j }]
for (const f of jsons) {
  let j; try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
  if (!j || !j.title || !j.photoTakenTime) continue;
  const k = path.dirname(f) + '|' + j.title; if (!byDirTitle.has(k)) byDirTitle.set(k, []); byDirTitle.get(k).push({ file: path.basename(f), j });
}
function sideOf(f) {   // 사진 파일의 짝 .json: 'IMG(1).jpg'는 제목 'IMG.jpg'에 이름에 '(1)'이 든 .json
  const dir = path.dirname(f), base = path.basename(f), m = base.match(/^(.*)\((\d+)\)(\.[^.]+)$/);
  const title = m ? m[1] + m[3] : base, list = byDirTitle.get(dir + '|' + title) || byDirTitle.get(dir + '|' + base) || [];
  if (!list.length) {   // 편집본('-edited'·'-수정됨')은 원본 .json을 같이 써요
    const e = base.replace(/-(edited|수정됨|bearbeitet|modifié)(\.[^.]+)$/i, '$2'); if (e !== base) return sideOf(path.join(dir, e));
    return null;
  }
  if (m) return (list.find(x => x.file.includes('(' + m[2] + ')')) || list[0]).j;
  return (list.find(x => !/\(\d+\)/.test(x.file)) || list[0]).j;
}
const geo = g => g && Number.isFinite(+g.latitude) && Number.isFinite(+g.longitude) && !(+g.latitude === 0 && +g.longitude === 0) ? [+(+g.latitude).toFixed(6), +(+g.longitude).toFixed(6)] : null;

const exifr = (await import('exifr')).default;
const EXIF_TZ = args['exif-tz'] || TZ;
// 'YYYY:MM:DD HH:MM:SS'(그 시간대 벽시계) → UTC ms
function wallToTs(s, off, tz) {
  const m = /^(\d{4}):(\d\d):(\d\d)[ T](\d\d):(\d\d):(\d\d)/.exec(s || ''); if (!m) return 0;
  const asUtc = Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  const o = /^([+-])(\d\d):?(\d\d)$/.exec(off || ''); if (o) return asUtc - (o[1] === '-' ? -1 : 1) * (o[2] * 60 + +o[3]) * 60000;
  const offOf = t => { const p = {}; for (const x of new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(t))) p[x.type] = +x.value;
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - t; };
  let t = asUtc - offOf(asUtc); t = asUtc - offOf(t); return t;
}
function gpsOf(ex) {
  const dms = v => Array.isArray(v) ? v[0] + v[1] / 60 + v[2] / 3600 : +v;
  let la = ex.latitude, lo = ex.longitude;
  if (!Number.isFinite(la) && ex.GPSLatitude != null) { la = dms(ex.GPSLatitude) * (ex.GPSLatitudeRef === 'S' ? -1 : 1); lo = dms(ex.GPSLongitude) * (ex.GPSLongitudeRef === 'W' ? -1 : 1); }
  return Number.isFinite(la) && Number.isFinite(lo) && !(la === 0 && lo === 0) ? [+la.toFixed(6), +lo.toFixed(6)] : null;
}
const media = [], seen = new Set(), skipped = { noTime: [], video: 0, dup: 0 };
for (const f of files) {
  if (!IMG.test(f) && !VID.test(f)) continue;
  const j = sideOf(f); let ts = j ? +j.photoTakenTime.timestamp * 1000 : 0, ll = j ? geo(j.geoData) || geo(j.geoDataExif) : null, src = j ? 'json' : '';
  if (!ts || !ll) { try { const ex = await exifr.parse(f, { gps: true, reviveValues: false }); if (ex) {
    // EXIF 찍은 시각은 시간대 없는 '그곳 시계' 글자예요 → OffsetTimeOriginal이 있으면 그것으로, 없으면 --exif-tz(기본 --tz) 시간대로 읽어요
    //   GPS 시각(GPSTimeStamp)은 안 써요: 2018 산티아고 갤럭시 노트8 사진은 GPS 시각이 구글 .json 시각보다 1시간씩 어긋났어요(서머타임). 파일 이름도 저장한 때라 안 써요
    if (!ts && typeof ex.DateTimeOriginal === 'string') { ts = wallToTs(ex.DateTimeOriginal, ex.OffsetTimeOriginal, EXIF_TZ); if (ts) src = 'exif'; }
    if (!ll) { const g = gpsOf(ex); if (g) ll = g; } } } catch {} }
  if (!ts) { skipped.noTime.push(path.relative(args.takeout, f)); continue; }
  const key = path.basename(f).replace(/\(\d+\)(?=\.)/, '').replace(/-(edited|수정됨)(?=\.)/i, '') + '|' + Math.round(ts / 1000);   // '-edited'·'(0)' 사본도 한 장으로   // 앨범 폴더와 'Photos from 2018' 폴더에 같은 사진이 두 번 들어 있어요
  if (seen.has(key)) { skipped.dup++; continue; } seen.add(key);
  if (VID.test(f)) { skipped.video++; continue; }   // 동영상은 아직 안 넣어요(백업 파일이 너무 커져서)
  media.push({ f, ts, ll, src, title: j ? j.title : path.basename(f) });
}
media.sort((a, b) => a.ts - b.ts);

// ── 여행 날짜 고르기 ──
const dayOf = ts => new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts));
let from = args.from, to = args.to;
if (!from || !to) {
  if (!route) { console.error('--from/--to 또는 --route가 있어야 여행 날짜를 알 수 있어요'); process.exit(2); }
  const near = media.filter(m => m.ll && snap(...m.ll).d < 25000);
  if (!near.length) { console.error('길 25km 안에서 찍은 사진이 없어요. --from/--to로 날짜를 주세요'); process.exit(1); }
  from = from || dayOf(near[0].ts); to = to || dayOf(near[near.length - 1].ts);
}
let trip = media.filter(m => { const d = dayOf(m.ts); return d >= from && d <= to; });
// 첫날 앞쪽·마지막 날 뒤쪽에서 길 25km 밖 사진(출발지 공항·다음 여행지로 가는 길)은 빼요 — 길이 있을 때만
if (route && trip.length) {
  const far = m => m.ll && snap(...m.ll).d > 25000, d0 = dayOf(trip[0].ts), d1 = dayOf(trip[trip.length - 1].ts); let cut = 0;
  while (trip.length && dayOf(trip[0].ts) === d0 && (far(trip[0]) || !trip[0].ll && trip.slice(1).find(x => x.ll && dayOf(x.ts) === d0) && far(trip.slice(1).find(x => x.ll)))) { trip.shift(); cut++; }
  while (trip.length && dayOf(trip[trip.length - 1].ts) === d1 && far(trip[trip.length - 1])) { trip.pop(); cut++; }
  if (cut) console.log(`첫날·마지막 날 길 25km 밖 사진 ${cut}장을 뺐어요`);
}
const days = new Map(); for (const m of trip) { const d = dayOf(m.ts); if (!days.has(d)) days.set(d, []); days.get(d).push(m); }

// ── 하루 길 만들기 ──
function dayTrack(list) {
  const pts = list.filter(m => m.ll);
  const tr = [], push = (lat, lng, ts) => { const e = tr[tr.length - 1]; if (e && (ts <= e[2] || dist(e[0], e[1], lat, lng) < 15)) return; tr.push([+lat.toFixed(6), +lng.toFixed(6), Math.round(ts)]); };
  let onRoute = 0, straight = 0;
  for (let k = 0; k < pts.length; k++) {
    const a = pts[k]; push(a.ll[0], a.ll[1], a.ts);
    const b = pts[k + 1]; if (!b || !route) continue;
    const sa = snap(...a.ll), sb = snap(...b.ll), direct = dist(...a.ll, ...b.ll);
    const along = sb.i > sa.i ? route.cum[sb.i] - route.cum[sa.i] : 0;
    if (sa.d < 2000 && sb.d < 2000 && sb.i > sa.i + 1 && along < direct * 2.5 + 3000) {   // 둘 다 길 가까이 · 앞으로 · 너무 돌아가지 않으면 길을 따라
      const span = sa.d + along + sb.d, at = done => a.ts + (b.ts - a.ts) * done / span;
      // 앱은 5분 넘게 점이 없이 150m 넘게 건너뛴 곳을 '끊긴 구간'(점선, 걸은 거리에서 뺌)으로 봐요 → 길 점 사이를 100m·4분 안 간격으로 채워요
      let prev = [a.ll[0], a.ll[1]], pd = 0;
      for (let i = sa.i + 1; i <= sb.i; i++) {
        const p = i < sb.i ? route.pts[i] : b.ll, d = i < sb.i ? sa.d + route.cum[i] - route.cum[sa.i] : span;
        const k = Math.max(1, Math.ceil((d - pd) / 100), Math.ceil((at(d) - at(pd)) / 240000));
        for (let s = 1; s <= k; s++) { if (i === sb.i && s === k) break; const r = s / k; push(prev[0] + (p[0] - prev[0]) * r, prev[1] + (p[1] - prev[1]) * r, at(pd + (d - pd) * r)); }
        prev = p; pd = d;
      }
      onRoute++;
    } else if (direct > 30) straight++;
  }
  return { tr, onRoute, straight };
}
function placeAt(tr, ts) {   // 위치 없는 사진: 그 시각의 길 위 자리
  if (!tr.length) return null;
  if (ts <= tr[0][2]) return tr[0].slice(0, 2); if (ts >= tr[tr.length - 1][2]) return tr[tr.length - 1].slice(0, 2);
  for (let i = 1; i < tr.length; i++) if (tr[i][2] >= ts) { const p = tr[i - 1], q = tr[i], r = (ts - p[2]) / ((q[2] - p[2]) || 1); return [+(p[0] + (q[0] - p[0]) * r).toFixed(6), +(p[1] + (q[1] - p[1]) * r).toFixed(6)]; }
  return null;
}
const lenOf = tr => { let d = 0; for (let i = 1; i < tr.length; i++) d += dist(tr[i - 1][0], tr[i - 1][1], tr[i][0], tr[i][1]); return d; };

// ── 아이디(다시 돌려도 같은 아이디) ──
const h = (s, n) => BigInt('0x' + crypto.createHash('sha1').update(s).digest('hex').slice(0, 15)).toString(36).padStart(n, '0').slice(-n);
const ALBUM = 'album_' + h(NAME + from + to, 8);

// ── 사진 줄이기(앱과 같게: 큰 것 1280px jpeg .82 · 작은 것 160px .7) ──
const sharp = (await import('sharp')).default;
async function photoRec(m, t, ll) {
  const img = sharp(m.f, { failOn: 'none' }).rotate();
  const big = await img.clone().resize(1280, 1280, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
  const th = await sharp(big).resize(160, 160, { fit: 'inside' }).jpeg({ quality: 70 }).toBuffer();
  return { id: h(m.title + '|' + m.ts, 10), t, ts: m.ts, lat: ll ? ll[0] : null, lng: ll ? ll[1] : null, thumb: 'data:image/jpeg;base64,' + th.toString('base64'), blob: 'data:image/jpeg;base64,' + big.toString('base64') };
}

// ── 내보내기 ──
fs.mkdirSync(args.out, { recursive: true });
const report = { name: NAME, album: ALBUM, from, to, tz: TZ, route: route ? route.name || 'route.json' : null, days: [], skipped: { noTime: skipped.noTime.length, video: skipped.video, dup: skipped.dup, outside: media.length - trip.length }, files: [] };
let part = null, partNo = 0;
const albumObj = { id: ALBUM, name: NAME, mode: MODE, days: [], at: Date.now(), last: Date.now(), src: 'photos' };
function newPart() { part = { ls: {}, photos: [], size: 0, days: [] }; }
function flush() {
  if (!part || !part.days.length) return;
  partNo++;
  const ls = { ...part.ls, ['walkMode:' + ALBUM]: JSON.stringify(MODE), albums: JSON.stringify([{ ...albumObj, days: albumObj.days.slice() }]) };   // 여행 묶음은 파일마다 지금까지 날을 다 담아요(불러오면 합쳐져요)
  const name = `MapDiary_${from.replace(/-/g, '')}_${String(partNo).padStart(2, '0')}.json`;
  if (!args.dry) fs.writeFileSync(path.join(args.out, name), JSON.stringify({ app: 'mapdiary', v: 1, at: Date.now(), src: 'takeout2mpd', ls, photos: part.photos }));
  report.files.push({ name, days: part.days, photos: part.photos.length, mb: +(part.size / 1048576).toFixed(1) });
  newPart();
}
newPart();
let n = 0;
for (const [d, list] of days) {
  n++;
  const id = 'walk_' + h(ALBUM + d, 8), { tr, onRoute, straight } = dayTrack(list);
  if (tr.length < 2) { report.days.push({ d, n, photos: list.length, located: list.filter(m => m.ll).length, skip: '위치 있는 사진이 2장 안 돼 길을 못 만들었어요' }); continue; }
  const start = townNear(tr[0][0], tr[0][1]), end = townNear(tr[tr.length - 1][0], tr[tr.length - 1][1]);
  const located = list.filter(m => m.ll).length, km = lenOf(tr) / 1000;
  const ls = {
    ['track:' + id]: JSON.stringify(tr), ['walkMode:' + id]: JSON.stringify(MODE), ['trackName:' + id]: JSON.stringify(`${NAME} ${n}일차`),
    ['walkAlbum:' + id]: JSON.stringify(ALBUM),
    ['walkTz:' + id]: JSON.stringify(TZ),   // 앱 판 -334부터 기록 보기가 이 시간대(현지 시간)로 보여요
    ['walkNote:' + id]: JSON.stringify(`📷 사진 ${list.length}장으로 거꾸로 만든 기록이에요(위치 있는 사진 ${located}장). 사진 사이 길은 ${route ? (route.name || '순례길') + ' 지도를 따라' : '곧게 이어'} 짐작했어요. 거리·시간은 실제와 다를 수 있어요.`),
  };
  if (start || end) ls['walkPlaces:' + id] = JSON.stringify({ ...(start ? { start } : {}), ...(end ? { end } : {}) });
  const phs = [];
  for (const m of list) { try { phs.push(await photoRec(m, id, m.ll || placeAt(tr, m.ts))); } catch (e) { report.skipped.bad = (report.skipped.bad || 0) + 1; } }
  const sz = JSON.stringify(ls).length + phs.reduce((s, p) => s + p.blob.length + p.thumb.length + 120, 0);
  if (part.size && part.size + sz > MAX_MB * 1048576) flush();
  Object.assign(part.ls, ls); part.photos.push(...phs); part.size += sz; part.days.push(d); albumObj.days.push(id);
  report.days.push({ d, n, id, photos: list.length, located, km: +km.toFixed(1), start, end, from: tr[0][2], to: tr[tr.length - 1][2], onRoute, straight });
  console.log(`${n}일차 ${d} · 사진 ${list.length}장(위치 ${located}) · ${km.toFixed(1)}km · ${start || '?'} → ${end || '?'}${straight ? ` · 곧은 줄 ${straight}곳` : ''}`);
}
flush();
fs.writeFileSync(path.join(args.out, 'report.json'), JSON.stringify(report, null, 1));
console.log(`\n여행 ${from} ~ ${to} · ${report.days.length}일 · 파일 ${report.files.length}개(${report.files.map(f => f.mb + 'MB').join(', ')})`);
console.log(`뺀 것: 시각 없음 ${report.skipped.noTime} · 동영상 ${report.skipped.video} · 겹친 사진 ${report.skipped.dup} · 여행 날짜 밖 ${report.skipped.outside}${report.skipped.bad ? ` · 못 읽은 사진 ${report.skipped.bad}` : ''}`);
