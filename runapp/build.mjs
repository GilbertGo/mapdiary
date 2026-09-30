// www/ 만들기: Map Diary 웹 화면(../index.html)을 그대로 가져오고, 맨 앞에 native.js(휴대폰 기능 다리)를 끼워요
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';

rmSync('www', { recursive: true, force: true });
mkdirSync('www', { recursive: true });
await build({ entryPoints: ['native.js'], bundle: true, format: 'iife', target: 'chrome100', outfile: 'www/native.js', minify: true });
let html = readFileSync('../index.html', 'utf8');
const at = html.indexOf('<script');
if (at < 0) throw new Error('index.html에 <script>가 없어요');
html = html.slice(0, at) + '<script src="native.js"></script>\n' + html.slice(at);
writeFileSync('www/index.html', html);
for (const f of ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png']) copyFileSync('../' + f, 'www/' + f);
console.log('www 준비됨');
