// MPD 원본 사진 창구 (판 -399, 사용자 '공유받은 사람이 가장 빠르게, 원본을 볼 수 있는 방법은?' → R2)
// 사진은 휴대폰에서 이미 잠가서(AES-GCM, 열쇠는 링크 # 뒤에만) 오므로 여기서는 잠긴 덩어리만 맡아 둬요.
//   PUT    /o/{방}/{사진}  머리 x-w: 쓰기 표 → 저장(방의 첫 쓰기가 표를 정함, 그 뒤엔 같은 표만)
//   GET    /o/{방}/{사진}  → 잠긴 덩어리(누구나 받지만 열쇠 없이는 못 풂)
//   DELETE /o/{방}/{사진}  · DELETE /o/{방}  머리 x-w → 지우기(방 전체 지우기는 표 칸까지)
const ROOM = /^gv[a-z0-9]{6,24}$/, PID = /^[a-z0-9]{2,32}$/, MAX = 40 * 1024 * 1024;
const ORIGINS = ['https://gilbertgo.github.io', 'https://localhost', 'http://localhost', 'capacitor://localhost'];
const cors = req => { const o = req.headers.get('origin') || ''; return { 'access-control-allow-origin': ORIGINS.includes(o) || /^http:\/\/127\.0\.0\.1(:\d+)?$/.test(o) ? o : ORIGINS[0],
  'access-control-allow-methods': 'GET,PUT,DELETE,OPTIONS', 'access-control-allow-headers': 'x-w,content-type', 'access-control-max-age': '86400', vary: 'origin' }; };
const sha = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');
async function owner(env, room, w, claim) {
  if (!w || w.length < 16 || w.length > 100) return false;
  const k = `${room}/.w`, h = await sha(w), o = await env.ORIG.get(k);
  if (o) return (await o.text()) === h;
  if (!claim) return false;
  await env.ORIG.put(k, h); return true;
}
export default {
  async fetch(req, env) {
    const H = cors(req), u = new URL(req.url), m = u.pathname.split('/').filter(Boolean);
    const out = (body, st, more) => new Response(body, { status: st, headers: Object.assign({}, H, more || {}) });
    if (req.method === 'OPTIONS') return out(null, 204);
    if (m[0] !== 'o' || !ROOM.test(m[1] || '') || (m[2] != null && !PID.test(m[2]))) return out('not found', 404);
    const room = m[1], pid = m[2], w = req.headers.get('x-w') || '';
    if (req.method === 'GET' && pid) {
      const o = await env.ORIG.get(`${room}/${pid}`); if (!o) return out('not found', 404);
      return out(o.body, 200, { 'content-type': 'application/octet-stream', 'cache-control': 'private, max-age=86400' });
    }
    if (req.method === 'PUT' && pid) {
      const n = +(req.headers.get('content-length') || 0); if (!n || n > MAX) return out('too big', 413);
      if (!(await owner(env, room, w, true))) return out('forbidden', 403);
      await env.ORIG.put(`${room}/${pid}`, req.body); return out('ok', 200);
    }
    if (req.method === 'DELETE') {
      if (!(await owner(env, room, w, false))) return out('forbidden', 403);
      if (pid) { await env.ORIG.delete(`${room}/${pid}`); return out('ok', 200); }
      let cur; do { const l = await env.ORIG.list({ prefix: room + '/', cursor: cur }); const ks = l.objects.map(x => x.key); if (ks.length) await env.ORIG.delete(ks); cur = l.truncated ? l.cursor : null; } while (cur);
      return out('ok', 200);
    }
    return out('method', 405);
  }
};
