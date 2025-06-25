# Jira 테스트 케이스 생성기

Jira 이슈의 인수 조건(AC)을 분석하여 프론트엔드와 백엔드 테스트 케이스를 자동으로 생성하는 CLI 도구입니다.

## 🚀 기능

- **Jira 이슈 조회**: Jira API를 통해 이슈 정보 자동 가져오기
- **AI 기반 테스트 케이스 생성**: OpenAI GPT-4를 활용한 지능형 테스트 케이스 생성
- **포괄적 테스트 커버리지**: 프론트엔드(UI/UX) + 백엔드(Positive/Negative) 테스트 케이스
- **마크다운 출력**: 깔끔한 마크다운 형식으로 결과 출력
- **반복 실행**: 여러 이슈를 연속으로 처리 가능

## 📋 요구사항

- Node.js 18+ 
- Jira 계정 및 API 토큰
- OpenAI API 키

## 🛠️ 설치

1. **저장소 클론**
   ```bash
   git clone <repository-url>
   cd jira-smithery
   ```

2. **의존성 설치**
   ```bash
   npm install
   ```

3. **설정 파일 생성**
   ```bash
   cp config.json.example config.json
   ```

4. **설정 파일 편집**
   ```json
   {
     "jira": {
       "baseUrl": "https://your-domain.atlassian.net",
       "username": "your-email@example.com",
       "apiToken": "your-jira-api-token"
     },
     "openai": {
       "apiKey": "your-openai-api-key"
     }
   }
   ```

## 🚀 사용법

### 간단한 실행
```bash
./run-cli.sh
```

### 수동 실행
```bash
# TypeScript 컴파일
npx tsc --project tsconfig.server.json

# CLI 실행
node dist/cli.js
```

### 사용 예시
```
🚀 Jira 테스트 케이스 생성기
==================================================
📋 Jira URL: https://your-domain.atlassian.net
👤 사용자: your-email@example.com

🔑 Jira 이슈 키를 입력하세요 (예: AUT-123, 종료하려면 q): AUT-456

🔍 Jira 이슈를 조회 중... (AUT-456)
✅ 이슈 조회 완료
🤖 테스트케이스 생성 중... (LLM 호출)

============================================================
📝 생성된 테스트케이스 (마크다운)
============================================================
## 프론트엔드 테스트 케이스
### 1. 로그인 폼 검증
- **목적**: 사용자가 올바른 정보로 로그인할 수 있는지 확인
- **조건**: 로그인 페이지가 열려있음
- **단계**: 
  1. 사용자명 입력
  2. 비밀번호 입력
  3. 로그인 버튼 클릭
- **예상 결과**: 성공적으로 로그인되어 메인 페이지로 이동

## 백엔드 테스트 케이스
### Positive 케이스
- 유효한 사용자명/비밀번호로 로그인 시도
- 올바른 응답 코드(200) 반환
- 사용자 세션 생성

### Negative 케이스
- 잘못된 비밀번호로 로그인 시도
- 존재하지 않는 사용자명으로 로그인 시도
- 빈 필드로 로그인 시도
============================================================
```

## 📁 프로젝트 구조

```
jira-smithery/
├── src/
│   └── cli.ts              # 메인 CLI 애플리케이션
├── dist/                   # 컴파일된 JavaScript 파일
├── config.json.example     # 설정 파일 예시
├── run-cli.sh             # 실행 스크립트
├── tsconfig.server.json   # TypeScript 설정
└── package.json           # 프로젝트 의존성
```

## 🔧 설정

### Jira API 토큰 생성
1. [Atlassian 계정 설정](https://id.atlassian.com/manage-profile/security/api-tokens)에서 API 토큰 생성
2. 생성된 토큰을 `config.json`의 `jira.apiToken`에 입력

### OpenAI API 키
1. [OpenAI API 키 페이지](https://platform.openai.com/api-keys)에서 API 키 생성
2. 생성된 키를 `config.json`의 `openai.apiKey`에 입력

## 🐛 문제 해결

### 일반적인 오류

**Jira 인증 실패**
```
❌ 오류: Jira 인증에 실패했습니다. 사용자명과 API 토큰을 확인해주세요.
```
- 사용자명이 이메일 주소인지 확인
- API 토큰이 올바른지 확인

**이슈를 찾을 수 없음**
```
❌ 오류: Jira 이슈를 찾을 수 없습니다: AUT-999
```
- 이슈 키가 올바른지 확인
- 해당 이슈에 접근 권한이 있는지 확인

**OpenAI API 오류**
```
❌ 오류: OpenAI API 호출 실패: Invalid API key
```
- API 키가 올바른지 확인
- API 키에 충분한 크레딧이 있는지 확인

## 📝 라이선스

MIT License

## 🤝 기여

버그 리포트나 기능 제안은 이슈로 등록해주세요.
