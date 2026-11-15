#!/usr/bin/env python3
# 사용자 말에 '경고'가 있으면 Claude 앞에 '규칙으로 적어라' 알림을 붙여요 (2026-11-15 사용자 '경고한다')
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
p = str(d.get('prompt', ''))
if '경고' in p:
    print('🚨 사용자 경고가 들어왔어요. 지금 바로: ① 무엇을 잘못했는지 한 줄로 인정 ② 정한것.md "일하는 방식 (꼭)" 맨 위에 규칙으로 적기(날짜·사용자 말 그대로·앞으로 할 일) ③ CLAUDE.md "작업 방식"에도 같이 ④ 커밋·main에 올리고 ⑤ 적은 글을 사용자에게 그대로 보여 주기. 변명하지 말 것. 무엇이 문제인지 사용자가 말하지 않았으면 이 대화에서 가장 최근 잘못을 규칙으로 적고, 틀렸으면 고쳐 달라고 한 줄만.')
