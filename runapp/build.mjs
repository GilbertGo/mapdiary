// www/ 만들기: Map Diary 웹 화면(../index.html)을 그대로 가져오고, 맨 앞에 native.js(휴대폰 기능 다리)를 끼워요
// MD_APP=run(기본) → MD Run, MD_APP=pgolf → MD 파크골프. 앱마다 이름·아이디·시작 모드가 달라요 (apps.json)
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';

const APPS = JSON.parse(readFileSync('apps.json', 'utf8')), key = process.env.MD_APP || 'run', A = APPS[key];
if (!A) throw new Error('모르는 앱: ' + key);
writeFileSync('capacitor.config.json', JSON.stringify({ appId: A.appId, appName: A.appName, webDir: 'www', android: { useLegacyBridge: true } }, null, 2) + '\n');
rmSync('www', { recursive: true, force: true });
mkdirSync('www', { recursive: true });
await build({ entryPoints: ['native.js'], bundle: true, format: 'iife', target: 'chrome100', outfile: 'www/native.js', minify: true });
let html = readFileSync('../index.html', 'utf8');
const at = html.indexOf('<script');
if (at < 0) throw new Error('index.html에 <script>가 없어요');
html = html.slice(0, at) + `<script>window.MD_APP=${JSON.stringify({ mode: A.mode, name: A.appName, noti: A.noti })}</script>\n<script src="native.js"></script>\n` + html.slice(at);
writeFileSync('www/index.html', html);
for (const f of ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png']) copyFileSync('../' + f, 'www/' + f);
console.log('www 준비됨 ·', A.appName);
