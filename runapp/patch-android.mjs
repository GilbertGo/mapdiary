// npx cap add android 뒤에: 앱 아이콘, 판 번호(깃허브 실행 번호), 알림 채널 이름을 넣어요
import { readFileSync, writeFileSync, copyFileSync, readdirSync, rmSync, existsSync } from 'node:fs';

const res = 'android/app/src/main/res', app = process.env.MD_APP || 'run';
// md(전체 Map Diary)는 icons/에 그림이 없어서 저장소 맨 위 icon-512.png·splash.png를 써요
// 앱 아이콘(시안 A안, 2026-10-01): Map Diary 아이콘 + 모서리 배지. icons/{run,pgolf}.png (원본 svg도 같은 곳)
const ICON = existsSync(`icons/${app}.png`) ? `icons/${app}.png` : '../icon-512.png', SPLASH = existsSync(`icons/${app}-splash.png`) ? `icons/${app}-splash.png` : 'splash.png';
for (const d of readdirSync(res).filter(d => d.startsWith('mipmap-'))) {
  if (d.startsWith('mipmap-anydpi')) { rmSync(`${res}/${d}`, { recursive: true, force: true }); continue; }   // 모양 아이콘(xml) 대신 우리 그림(png)을 쓰게
  for (const f of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png']) if (existsSync(`${res}/${d}/${f}`)) copyFileSync(ICON, `${res}/${d}/${f}`);
}
// 시작 화면(스플래시): Capacitor 그림 대신 종이 색 바탕 + 우리 아이콘
for (const d of readdirSync(res).filter(d => d.startsWith('drawable')))
  if (existsSync(`${res}/${d}/splash.png`)) copyFileSync(SPLASH, `${res}/${d}/splash.png`);
const n = Number(process.env.RUN_NUMBER || 1);
// 서명: 저장소의 runapp/debug.keystore로 꼭 서명해요. (예전엔 ~/.android에 두었는데 GitHub에선 쓰이지 않아 판마다 열쇠가 달라져
// '앱이 설치되지 않음'이 났어요, 2026-10-01) 늘 같은 열쇠라야 새 판을 덮어 설치할 수 있어요
const SIGN = `\n    signingConfigs {\n        debug {\n            storeFile file('../../debug.keystore')\n            storePassword 'android'\n            keyAlias 'androiddebugkey'\n            keyPassword 'android'\n        }\n    }\n    buildTypes {\n        debug {\n            signingConfig signingConfigs.debug\n        }\n    }\n`;
const g = 'android/app/build.gradle';
writeFileSync(g, readFileSync(g, 'utf8').replace(/versionCode \d+/, `versionCode ${n}`).replace(/versionName "[^"]*"/, `versionName "0.1.${n}"`).replace(/\nandroid \{\n/, m => m + SIGN));
if (!readFileSync(g, 'utf8').includes("storeFile file('../../debug.keystore')")) throw new Error('서명 설정을 못 넣었어요');
const s = `${res}/values/strings.xml`;
let x = readFileSync(s, 'utf8');
if (!x.includes('capacitor_background_geolocation_notification_channel_name'))
  x = x.replace('</resources>', `    <string name="capacitor_background_geolocation_notification_channel_name">${JSON.parse(readFileSync('apps.json', 'utf8'))[app].channel || '길 기록'}</string>\n</resources>`);
writeFileSync(s, x);
console.log('android 손질 끝 · 판 번호', n);
