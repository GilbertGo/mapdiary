// npx cap add android 뒤에: 앱 아이콘, 판 번호(깃허브 실행 번호), 알림 채널 이름을 넣어요
import { readFileSync, writeFileSync, copyFileSync, readdirSync, rmSync, existsSync } from 'node:fs';

const res = 'android/app/src/main/res';
for (const d of readdirSync(res).filter(d => d.startsWith('mipmap-'))) {
  if (d.startsWith('mipmap-anydpi')) { rmSync(`${res}/${d}`, { recursive: true, force: true }); continue; }   // 모양 아이콘(xml) 대신 우리 그림(png)을 쓰게
  for (const f of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png']) if (existsSync(`${res}/${d}/${f}`)) copyFileSync('../icon-512.png', `${res}/${d}/${f}`);
}
// 시작 화면(스플래시): Capacitor 그림 대신 종이 색 바탕 + 우리 아이콘
for (const d of readdirSync(res).filter(d => d.startsWith('drawable')))
  if (existsSync(`${res}/${d}/splash.png`)) copyFileSync('splash.png', `${res}/${d}/splash.png`);
const n = Number(process.env.RUN_NUMBER || 1);
const g = 'android/app/build.gradle';
writeFileSync(g, readFileSync(g, 'utf8').replace(/versionCode \d+/, `versionCode ${n}`).replace(/versionName "[^"]*"/, `versionName "0.1.${n}"`));
const s = `${res}/values/strings.xml`;
let x = readFileSync(s, 'utf8');
if (!x.includes('capacitor_background_geolocation_notification_channel_name'))
  x = x.replace('</resources>', `    <string name="capacitor_background_geolocation_notification_channel_name">${process.env.MD_APP === 'pgolf' ? '파크골프 기록' : '러닝 기록'}</string>\n</resources>`);
writeFileSync(s, x);
console.log('android 손질 끝 · 판 번호', n);
