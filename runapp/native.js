// MD Run·MD 파크골프 (안드로이드 앱) ↔ Map Diary 웹 화면을 잇는 다리.
// build.mjs가 esbuild로 묶어서 www/native.js로 만들고, index.html의 다른 스크립트보다 먼저 읽혀요.
// 웹 화면 코드는 그대로 두고, 웹에서 쓰던 기능(위치·목소리·공유·저장)을 휴대폰 기능으로 바꿔 끼워요.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { Media } from '@capacitor-community/media';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { LocalNotifications } from '@capacitor/local-notifications';

if (Capacitor.isNativePlatform()) {
  window.MD_NATIVE = true;
  // 남에게 보내는 링크(짧은 지도 링크·모임방)는 앱 안 주소(https://localhost)가 아니라 웹 주소로
  window.MD_WEB_BASE = 'https://gilbertgo.github.io/mapdiary/';

  // 처음 열면 바로 그 앱의 시작 화면 (MD Run = 러닝, MD 파크골프 = 파크골프). build.mjs가 window.MD_APP을 넣어요
  const APP = window.MD_APP || { mode: 'run', name: 'MD Run', noti: '달린 길' };
  if (!location.search) location.replace(location.pathname + '?walk=1&mode=' + APP.mode);

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
}
