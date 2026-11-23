// 앱 받는 쪽(golf.html / run.html). 안드로이드: 카톡에서 열면 바로 크롬으로 넘기고, 크롬에서는 APK를 바로 내려받아요
// 아이폰: 웹앱으로. 카톡이면 Safari로 넘기고, Safari에서는 '홈 화면에 추가' 안내, 홈 화면 아이콘으로 열면 바로 그 모드 기록 화면
(function () {
  const A = { golf: { name: 'MPD 파크골프', emoji: '⛳', apk: 'MPD_golf.apk', what: '친 길', mode: 'pgolf' }, run: { name: 'MPD Run', emoji: '🏃', apk: 'MPD_run.apk', what: '달린 길', mode: 'run' }, md: { name: 'MPD', emoji: '🗺', apk: 'MPD.apk', what: '다닌 길', mode: '' } }[document.documentElement.dataset.app];
  const APK = 'https://github.com/GilbertGo/mapdiary/releases/latest/download/' + A.apk;
  const ua = navigator.userAgent, android = /Android/i.test(ua), kakao = /KAKAOTALK/i.test(ua);
  const ios = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1), WEB = A.mode ? './?walk=1&mode=' + A.mode : './';
  const page = location.href.split('#')[0];
  const $ = id => document.getElementById(id);
  const MD = !A.mode;   // md.html: 장점을 먼저 보여 주는 소개 쪽(판 -351). 제목·글은 쪽에 있는 그대로, 받기는 단추를 눌렀을 때
  const how = () => { const h = $('how'); if (h) { h.classList.add('on'); setTimeout(() => h.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300); } };
  if (!MD) { document.title = A.name + ' 받기'; $('t').textContent = `${A.emoji} ${A.name}`; }
  $('w').textContent = A.what;
  $('dl').href = APK;
  if (kakao && android) {
    // 카톡 안 브라우저 → 크롬으로 (크롬이 없으면 기본 브라우저로)
    $('msg').textContent = '크롬으로 여는 중이에요…';
    location.href = 'intent://' + page.replace(/^https?:\/\//, '') + '#Intent;scheme=https;package=com.android.chrome;end';
    setTimeout(() => { if (document.visibilityState === 'visible') location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(page); }, 1500);
    return;
  }
  if (ios) {
    if (navigator.standalone) { location.replace(WEB); return; }   // 홈 화면 아이콘으로 열었으면 바로 기록 화면
    if (kakao) { $('msg').textContent = 'Safari로 여는 중이에요…'; location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(page); }
    if (!MD) document.title = A.name;
    $('msg').textContent = '아이폰은 웹앱으로 써요. 홈 화면에 추가하면 앱처럼 열려요';
    $('dl').textContent = MD ? '지금 바로 열기' : '▶ 지금 바로 열기'; $('dl').href = WEB;
    if (MD) { $('t').textContent = '가입 없이 바로 써요 · 무료'; how(); $('how').querySelector('h3').textContent = '홈 화면에 추가하기'; }
    $('steps').innerHTML = `<li>Safari 아래쪽 <b>공유 버튼(□↑)</b> → <b>홈 화면에 추가</b> → <b>추가</b></li><li>홈 화면의 <b>${A.name}</b> 아이콘을 눌러 열어요</li><li>처음에 <b>위치</b>는 '앱을 사용하는 동안 허용', <b>동작</b> 센서도 허용해요</li><li>⚠ 아이폰은 화면이 꺼지면 기록이 멈춰요. 화면을 켜 둔 채 <b>화면 잠그기</b>를 눌러 두세요</li>`;
    return;
  }
  if (!android && MD) { $('dl').textContent = '웹으로 열기'; $('dl').href = WEB; $('t').textContent = '휴대폰에서 이 주소를 열면 앱을 받을 수 있어요'; return; }
  if (!android) { $('msg').textContent = '휴대폰에서 열어 주세요. 컴퓨터에서는 웹으로 써요: gilbertgo.github.io/mapdiary'; $('dl').textContent = '▶ 웹으로 열기'; $('dl').href = WEB; return; }
  if (MD) { $('dl').href = APK; $('dl').addEventListener('click', how); return; }   // 소개 쪽은 읽고 나서 '무료로 받기' 한 번
  // 크롬(또는 다른 브라우저): 한 번 바로 내려받기
  $('msg').textContent = '내려받기를 시작했어요. 다 받으면 아래 순서대로 설치해 주세요';
  try { if (!sessionStorage.getItem('got' + A.apk)) { sessionStorage.setItem('got' + A.apk, '1'); setTimeout(() => { location.href = APK; }, 600); } } catch { setTimeout(() => { location.href = APK; }, 600); }
})();
