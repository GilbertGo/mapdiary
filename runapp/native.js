// MD Run·MD 파크골프 (안드로이드 앱) ↔ Map Diary 웹 화면을 잇는 다리.
// build.mjs가 esbuild로 묶어서 www/native.js로 만들고, index.html의 다른 스크립트보다 먼저 읽혀요.
// 웹 화면 코드는 그대로 두고, 웹에서 쓰던 기능(위치·목소리·공유·저장)을 휴대폰 기능으로 바꿔 끼워요.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { Media } from '@capacitor-community/media';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { LocalNotifications } from '@capacitor/local-notifications';
import { App } from '@capacitor/app';

if (Capacitor.isNativePlatform()) {
  window.MD_NATIVE = true;
  // 남에게 보내는 링크(짧은 지도 링크·모임방)는 앱 안 주소(https://localhost)가 아니라 웹 주소로
  window.MD_WEB_BASE = 'https://gilbertgo.github.io/mapdiary/';

  // 처음 열면 바로 그 앱의 시작 화면 (MD Run = 러닝, MD 파크골프 = 파크골프, Map Diary = 첫 화면). build.mjs가 window.MD_APP을 넣어요
  const APP = window.MD_APP || { mode: 'run', name: 'MD Run', noti: '달린 길' };
  // 새 화면으로 바꾸며 다시 열렸으면, 보던 곳(주소 ? 뒤)으로 돌아가요
  try { const back = sessionStorage.getItem('mdBack'); if (back != null) { sessionStorage.removeItem('mdBack'); if (back && !location.search) location.replace(location.pathname + back); } } catch {}
  // 앱을 처음 켤 때 한 번만 넘겨요 (그 뒤 '처음으로'를 누르면 첫 화면에서 내 MD 등을 볼 수 있게)
  let first = true; try { first = !sessionStorage.getItem('mdStarted'); sessionStorage.setItem('mdStarted', '1'); } catch {}
  if (first && !location.search && APP.mode) location.replace(location.pathname + '?walk=1&mode=' + APP.mode);   // Map Diary(전체) 앱은 mode가 비어 첫 화면

  // ---------- 위치: 화면을 꺼도(주머니에 넣어도) 계속 받기 ----------
  // 알림 창에 "기록 중"을 띄워 두는 동안 안드로이드가 앱을 멈추지 않아요
  const BG = registerPlugin('BackgroundGeolocation');
  const watchers = new Map(); let seq = 0, askedNoti = false;
  navigator.geolocation.watchPosition = (ok, err) => {
    const key = ++seq;
    (async () => {
      if (!askedNoti) { askedNoti = true; try { await LocalNotifications.requestPermissions(); } catch {} }   // 안드로이드 13+: 알림 허락이 있어야 화면이 꺼져도 기록돼요
      const id = await BG.addWatcher({
        backgroundTitle: `${APP.name} 기록 중`,
        backgroundMessage: `화면을 꺼도 ${APP.noti}을 계속 기록해요`,
        requestPermissions: true, stale: false, distanceFilter: 0,
      }, (loc, e) => {
        if (e) {
          if (e.code === 'NOT_AUTHORIZED' && confirm('위치 권한이 필요해요. 설정을 열까요?\n(위치 → "항상 허용" 또는 "앱 사용 중에만 허용")')) BG.openSettings();
          if (err) err({ code: e.code === 'NOT_AUTHORIZED' ? 1 : 2, message: e.message || String(e) });
          return;
        }
        if (!loc) return;
        ok({ coords: { latitude: loc.latitude, longitude: loc.longitude, accuracy: loc.accuracy, altitude: loc.altitude ?? null, altitudeAccuracy: loc.altitudeAccuracy ?? null, speed: loc.speed ?? null, heading: loc.bearing ?? null }, timestamp: loc.time || Date.now() });
      });
      if (watchers.has(key) && watchers.get(key) === 'gone') { BG.removeWatcher({ id }); watchers.delete(key); } else watchers.set(key, id);
    })().catch(e => err && err({ code: 2, message: String(e) }));
    return key;
  };
  navigator.geolocation.clearWatch = key => {
    const id = watchers.get(key);
    if (id && id !== 'gone') { BG.removeWatcher({ id }); watchers.delete(key); } else watchers.set(key, 'gone');   // 아직 시작 중이면 시작하자마자 끄기
  };

  // ---------- 목소리 안내: 안드로이드 웹뷰에는 speechSynthesis가 없어서 휴대폰 TTS로 ----------
  let speaking = false;
  window.SpeechSynthesisUtterance = function (text) { this.text = text; this.lang = 'ko-KR'; this.rate = 1; this.onend = null; };
  const synth = {
    get speaking() { return speaking; },
    speak(u) {
      speaking = true;
      TextToSpeech.speak({ text: u.text, lang: u.lang || 'ko-KR', rate: u.rate || 1, pitch: 1, volume: 1, category: 'playback', queueStrategy: 0 })
        .catch(() => {}).finally(() => { speaking = false; if (typeof u.onend === 'function') u.onend(); });
    },
    cancel() { speaking = false; TextToSpeech.stop().catch(() => {}); },
    getVoices: () => [],
  };
  try { Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true }); } catch { window.speechSynthesis = synth; }

  // ---------- 저장: 사진은 갤러리 'MapDiary' 앨범, 그 밖(백업 등)은 Documents/MapDiary ----------
  const toB64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(blob); });
  let albumId = null;
  async function album() {
    if (albumId) return albumId;
    const find = async () => { const { albums } = await Media.getAlbums(); const a = (albums || []).find(x => x.name === 'MapDiary'); return a && a.identifier; };
    albumId = await find();
    if (!albumId) { try { await Media.createAlbum({ name: 'MapDiary' }); } catch {} albumId = await find(); }
    return albumId;
  }
  const say = t => { try { window.dispatchEvent(new CustomEvent('md-native-toast', { detail: t })); } catch {} };
  window.mdNativeSave = async (blob, name) => {
    try {
      const url = await toB64(blob);
      if ((blob.type || '').startsWith('image/')) {
        await Media.savePhoto({ path: url, albumIdentifier: await album(), fileName: name.replace(/\.[a-z0-9]+$/i, '') });
        say('갤러리 "MapDiary" 앨범에 저장했어요');
      } else {
        await Filesystem.writeFile({ path: 'MapDiary/' + name, data: url.split(',')[1], directory: Directory.Documents, recursive: true });
        say(`"내 파일 > Documents > MapDiary"에 ${name}(으)로 저장했어요`);
      }
    } catch (e) { say('저장하지 못했어요: ' + (e && e.message || e)); }
  };

  // ---------- 공유: 웹뷰에는 navigator.share가 없어서 휴대폰 공유 창으로 (사진 파일도) ----------
  navigator.canShare = () => true;
  navigator.share = async d => {
    let files;
    if (d && d.files && d.files.length) {
      files = [];
      for (const f of d.files) {
        const r = await Filesystem.writeFile({ path: 'share/' + (f.name || 'MapDiary.png'), data: (await toB64(f)).split(',')[1], directory: Directory.Cache, recursive: true });
        files.push(r.uri);
      }
    }
    await Share.share({ title: d.title, text: d.text, url: d.url, files, dialogTitle: d.title || '공유하기' });
  };

  // ---------- 화면 저절로 새로: 웹(gilbertgo.github.io/mapdiary)의 index.html이 앱 속 화면과 다르면 받아서 바꿔 끼워요 ----------
  // 앱 주소(https://localhost)는 그대로라 기록(localStorage·사진)은 그대로예요. 위치·잠금 같은 휴대폰 기능을 바꿀 때만 새 판(APK)이 필요해요
  const WEB = window.MD_WEB_BASE, MdApp = registerPlugin('MdApp');
  const recording = () => { try { return !!JSON.parse(localStorage.getItem('walkNow') || 'null'); } catch { return false; } };
  const hex = async t => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))].map(b => b.toString(16).padStart(2, '0')).join('');
  async function liveUpdate() {
    if (recording()) return;   // 기록 중엔 다시 열지 않아요 (다음에 켤 때)
    const r = await fetch(WEB + 'index.html?u=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return;
    const txt = await r.text(), at = txt.indexOf('<script');
    if (txt.length < 100000 || at < 0 || !txt.includes('Map Diary')) return;   // 와이파이 로그인 화면 같은 엉뚱한 쪽이면 안 써요
    const h = await hex(txt);
    if (h === APP.h || recording()) return;
    const dir = 'web/' + h.slice(0, 16);
    const html = txt.slice(0, at) + `<script>window.MD_APP=${JSON.stringify({ ...APP, h })}</script>\n<script src="native.js"></script>\n` + txt.slice(at);
    await Filesystem.writeFile({ path: dir + '/index.html', data: html, directory: Directory.Data, encoding: Encoding.UTF8, recursive: true });
    await Filesystem.writeFile({ path: dir + '/native.js', data: await (await fetch('/native.js')).text(), directory: Directory.Data, encoding: Encoding.UTF8, recursive: true });
    for (const f of ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png']) {
      try { const b = await (await fetch('/' + f)).blob(); await Filesystem.writeFile({ path: dir + '/' + f, data: (await toB64(b)).split(',')[1], directory: Directory.Data, recursive: true }); } catch {}
    }
    if (recording()) return;
    const { uri } = await Filesystem.getUri({ path: dir, directory: Directory.Data });
    try { sessionStorage.setItem('mdBack', location.search + location.hash); sessionStorage.setItem('mdToast', '새 화면으로 바꿨어요'); } catch {}
    await MdApp.setWeb({ path: decodeURIComponent(uri.replace(/^file:\/\//, '')) });
  }
  // 지난 화면 폴더는 지워요 (지금 쓰는 것만 남기고)
  async function cleanWeb() {
    try { const { files } = await Filesystem.readdir({ path: 'web', directory: Directory.Data });
      for (const f of files) if (APP.h && !APP.h.startsWith(f.name)) await Filesystem.rmdir({ path: 'web/' + f.name, directory: Directory.Data, recursive: true }).catch(() => {}); } catch {}
  }
  // 새 판(APK) 알림: 휴대폰 기능이 바뀌어 다시 설치해야 할 때만 GitHub에 새 판이 올라와요(mdrun-번호 = 판 번호)
  const PAGE = { run: 'run.html', pgolf: 'golf.html' }[APP.mode] || 'md.html';
  async function checkBinary() {
    if (recording()) return;
    const cur = Number((await App.getInfo()).build) || 0;
    const j = await (await fetch('https://api.github.com/repos/GilbertGo/mapdiary/releases/latest', { cache: 'no-store' })).json();
    const n = Number((String(j.tag_name || '').match(/^mdrun-(\d+)$/) || [])[1]) || 0;
    if (!n || n <= cur || localStorage.getItem('mdUpdAsk') === String(n) || recording()) return;
    localStorage.setItem('mdUpdAsk', String(n));
    if (confirm(`${APP.name} 새 판이 나왔어요.\n(위치·잠금 같은 휴대폰 기능이 바뀌었어요)\n\n지금 받을까요? 지우지 말고 덮어 설치하면 기록은 그대로 남아요.`)) location.href = WEB + PAGE;
  }
  addEventListener('load', () => {
    try { const t = sessionStorage.getItem('mdToast'); if (t) { sessionStorage.removeItem('mdToast'); setTimeout(() => say(t), 800); } } catch {}
    setTimeout(() => { cleanWeb(); liveUpdate().catch(() => {}).finally(() => checkBinary().catch(() => {})); }, 2500);
  });

  // ---------- 갤러리 사진: 기록한 시간에 휴대폰 카메라로 찍은 사진 찾기 ----------
  window.mdNativePhotos = {
    between: async (from, to) => (await MdApp.photosBetween({ from: Math.round(from), to: Math.round(to) })).items || [],
    blob: async uri => (await fetch(Capacitor.convertFileSrc(uri))).blob(),
  };

  // ---------- 저절로 백업: 내 파일 > Documents > MapDiary 에 조금씩 이어 써요(사진이 많아도 되게). 최근 3개만 남겨요 ----------
  const BK = { run: 'MDRun', pgolf: 'MDGolf' }[APP.mode] || 'MapDiary';
  let bkName = '';
  const bkOpt = path => ({ path: 'MapDiary/' + path, directory: Directory.Documents });
  window.mdNativeBackup = {
    start: async head => {
      const d = new Date(), pad = n => String(n).padStart(2, '0');
      bkName = `${BK}_autobackup_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`;
      await Filesystem.writeFile({ ...bkOpt(bkName + '.part'), data: head, encoding: Encoding.UTF8, recursive: true });
    },
    add: chunk => Filesystem.appendFile({ ...bkOpt(bkName + '.part'), data: chunk, encoding: Encoding.UTF8 }),
    end: async tail => {
      try {
        await Filesystem.appendFile({ ...bkOpt(bkName + '.part'), data: tail, encoding: Encoding.UTF8 });
        await Filesystem.deleteFile(bkOpt(bkName)).catch(() => {});
        await Filesystem.rename({ from: 'MapDiary/' + bkName + '.part', to: 'MapDiary/' + bkName, directory: Directory.Documents, toDirectory: Directory.Documents });
        try { const { files } = await Filesystem.readdir({ path: 'MapDiary', directory: Directory.Documents });
          const mine = files.map(f => f.name).filter(n => n.startsWith(BK + '_autobackup_') && n.endsWith('.json')).sort();
          for (const n of mine.slice(0, -3)) await Filesystem.deleteFile(bkOpt(n)).catch(() => {}); } catch {}
        return 'Documents/MapDiary/' + bkName;
      } catch { return ''; }
    },
  };

  // ---------- 앱끼리 기록 넘기기: MD Run·MD 파크골프가 끝낸 기록을 내놓고, Map Diary 앱이 읽어 가요 (같은 열쇠로 서명한 앱끼리만) ----------
  window.mdNativeSync = {
    put: (id, data) => MdApp.syncPut({ id, data }),
    del: id => MdApp.syncDel({ id }),
    list: async () => (await MdApp.syncList({ apps: ['io.github.gilbertgo.mdrun', 'io.github.gilbertgo.mdgolf'] })).items || [],
    read: async (app, id) => (await MdApp.syncRead({ app, id })).data,
  };

  // ---------- 화면 잠금: 안드로이드 '앱 고정'으로 홈·최근 앱 버튼까지 막기 (patch-android.mjs가 넣는 MdPin) ----------
  const Pin = registerPlugin('MdPin');
  window.mdNativePin = on => { (on ? Pin.start() : Pin.stop()).catch(() => {}); };
  // 휴대폰 뒤로 버튼: 화면 잠금 중엔 아무것도 안 해요. 아니면 웹처럼 한 칸 뒤로(맨 처음이면 앱 닫기)
  App.addListener('backButton', ({ canGoBack }) => {
    if (document.querySelector('.lock-ov')) return;
    if (canGoBack) history.back(); else App.exitApp();
  });
}
