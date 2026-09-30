// 바탕화면 설치용 도우미. 화면(index.html)은 늘 인터넷에서 새로 받아요.
// 인터넷이 안 될 때만 마지막으로 받아 둔 화면을 보여줘요. 다른 요청(지도·사진 등)은 건드리지 않아요.
const CACHE = 'mapdiary-v2';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.mode !== 'navigate') return;
  // 늘 새 화면을 받아요 (브라우저에 잠깐 남아 있는 옛 화면을 쓰지 않게 cache: 'no-cache')
  e.respondWith(fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put('./', copy)); }
    return res;
  }).catch(() => caches.match('./').then(r => r || Response.error())));
});
