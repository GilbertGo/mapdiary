#!/usr/bin/env python3
# 빠뜨림 경보 (2026-10-21 사용자 '실수 재발 방지'): git commit 전에 규칙대로 같이 고쳐야 할 것을 빠뜨렸으면 막아요.
# 커밋 메시지에 [규칙예외] 를 넣으면 그냥 지나가요(정말 필요할 때만).
import json, re, subprocess, sys, os

d = json.load(sys.stdin)
cmd = (d.get('tool_input') or {}).get('command', '')
if not re.search(r'\bgit\s+commit\b', cmd) or '[규칙예외]' in cmd:
    sys.exit(0)
root = os.environ.get('CLAUDE_PROJECT_DIR') or os.getcwd()
def git(*a):
    return subprocess.run(['git', '-C', root, *a], capture_output=True, text=True).stdout
# 아직 add 전일 수도 있어서(git add -A && git commit) 마지막 커밋과 지금 폴더를 견줘요
changed = set(git('diff', 'HEAD', '--name-only').split()) | set(git('ls-files', '--others', '--exclude-standard').split())
if not changed:
    sys.exit(0)
miss = []
if 'index.html' in changed:
    diff = git('diff', 'HEAD', '-U0', '--', 'index.html')
    if not re.search(r'^\+.*const UI_VER =', diff, re.M):
        miss.append("index.html을 고쳤는데 UI_VER(화면 판)를 안 바꿨어요")
    elif not re.search(r'^\+.*const UI_NOTES =', diff, re.M):
        miss.append("UI_VER를 바꿨는데 UI_NOTES(새로워진 점, '화면이 새로 바뀌었어요' 창)를 안 고쳤어요")
code = [f for f in changed if f == 'index.html' or f.startswith(('runapp/', 'watchapp/', '.github/'))]
if code and 'CLAUDE.md' not in changed:
    miss.append('앱을 고쳤는데 CLAUDE.md(인수인계)를 안 고쳤어요')
for app in ('runapp', 'watchapp'):
    if any(f.startswith(app + '/') and not f.endswith('CHANGES.txt') for f in changed) and f'{app}/CHANGES.txt' not in changed:
        miss.append(f'{app}/를 고쳤는데 {app}/CHANGES.txt 첫 줄(새 판 창의 새로워진 점)을 안 고쳤어요')
if miss:
    print('🚨 빠뜨림 경보 — 커밋 전에 고쳐 주세요:\n- ' + '\n- '.join(miss) + '\n(정말 필요 없으면 커밋 메시지에 [규칙예외])', file=sys.stderr)
    sys.exit(2)
