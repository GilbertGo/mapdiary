// 앱 받는 쪽(golf.html / run.html). 카톡에서 열면 바로 크롬으로 넘기고, 크롬에서는 APK를 바로 내려받아요
(function () {
  const A = { golf: { name: 'MD 파크골프', emoji: '⛳', apk: 'MDGolf.apk', what: '친 길' }, run: { name: 'MD Run', emoji: '🏃', apk: 'MDRun.apk', what: '달린 길' } }[document.documentElement.dataset.app];
  const APK = 'https://github.com/GilbertGo/mapdiary/releases/latest/download/' + A.apk;
  const ua = navigator.userAgent, android = /Android/i.test(ua), kakao = /KAKAOTALK/i.test(ua);
  const page = location.href.split('#')[0];
  const $ = id => document.getElementById(id);
  document.title = A.name + ' 받기';
  $('t').textContent = `${A.emoji} ${A.name}`;
  $('w').textContent = A.what;
  $('dl').href = APK;
  if (kakao && android) {
    // 카톡 안 브라우저 → 크롬으로 (크롬이 없으면 기본 브라우저로)
    $('msg').textContent = '크롬으로 여는 중이에요…';
    location.href = 'intent://' + page.replace(/^https?:\/\//, '') + '#Intent;scheme=https;package=com.android.chrome;end';
    setTimeout(() => { if (document.visibilityState === 'visible') location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(page); }, 1500);
    return;
  }
  if (!android) { $('msg').textContent = '안드로이드 휴대폰에서만 설치돼요. 아이폰은 웹으로 써 주세요: gilbertgo.github.io/mapdiary'; $('dl').style.display = 'none'; return; }
  // 크롬(또는 다른 브라우저): 한 번 바로 내려받기
  $('msg').textContent = '내려받기를 시작했어요. 다 받으면 아래 순서대로 설치해 주세요';
  try { if (!sessionStorage.getItem('got' + A.apk)) { sessionStorage.setItem('got' + A.apk, '1'); setTimeout(() => { location.href = APK; }, 600); } } catch { setTimeout(() => { location.href = APK; }, 600); }
})();
