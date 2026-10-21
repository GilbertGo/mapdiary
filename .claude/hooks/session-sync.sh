#!/usr/bin/env bash
# 세션을 시작할 때: 이 폴더가 GitHub 최신본보다 뒤처져 있으면 받아 오거나(고친 게 없을 때), Claude에게 크게 알림
cd "$CLAUDE_PROJECT_DIR" 2>/dev/null || exit 0
git fetch -q origin main 2>/dev/null || exit 0
b=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo 0)
[ "${b:-0}" -gt 0 ] 2>/dev/null || exit 0
if [ -z "$(git status --porcelain 2>/dev/null)" ] && [ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] && git merge -q --ff-only origin/main 2>/dev/null; then
  echo "이 폴더가 GitHub보다 커밋 ${b}개 뒤처져 있어서 세션을 열 때 최신으로 받았어요(git pull). 사용자에게 한 줄로 알려 주세요."
else
  echo "⚠ 중요: 이 폴더는 GitHub 최신본(origin/main)보다 커밋 ${b}개 뒤처진 예전 사본이에요. 고친 것이 있거나 main이 아니어서 저절로 받지 못했어요. 답하거나 고치기 전에 이 사실을 사용자에게 먼저 알리고, 고친 것을 잃지 않게(git stash) 한 뒤 git pull부터 하세요. 예전 사본만 보고 '없다'고 답하지 마세요."
fi
