#!/bin/bash

# Jira 테스트 케이스 생성기 실행 스크립트

# 스크립트의 실제 위치로 이동
cd "$(dirname "$0")"

echo "🔨 TypeScript 컴파일 중..."
npx tsc --project tsconfig.server.json

if [ $? -eq 0 ]; then
    echo "✅ 컴파일 완료"
    echo "🚀 CLI 실행 중..."
    echo ""
    node dist/cli.js
else
    echo "❌ 컴파일 실패"
    exit 1
fi 