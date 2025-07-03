#!/usr/bin/env node
import axios from 'axios';
import OpenAI from 'openai';
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

interface Config {
  jira: {
    baseUrl: string;
    username: string;
    apiToken: string;
  };
  openai: {
    apiKey: string;
  };
}

// 설정 파일 읽기
function loadConfig(): Config {
  const configPath = path.join(process.cwd(), 'config.json');
  
  if (!fs.existsSync(configPath)) {
    console.error('❌ config.json 파일이 없습니다!');
    console.log('📝 다음 명령어로 설정 파일을 생성하세요:');
    console.log('   cp config.json.example config.json');
    console.log('   # config.json 파일을 편집해서 실제 정보를 입력하세요');
    process.exit(1);
  }
  
  try {
    const configData = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(configData);
    
    // 설정 검증
    if (!config.jira?.baseUrl || !config.jira?.username || !config.jira?.apiToken || !config.openai?.apiKey) {
      console.error('❌ config.json에 필요한 정보가 누락되었습니다!');
      console.log('필요한 정보:');
      console.log('  - jira.baseUrl: Jira 서버 URL (예: https://your-domain.atlassian.net)');
      console.log('  - jira.username: Jira 사용자명 (이메일)');
      console.log('  - jira.apiToken: Jira API 토큰');
      console.log('  - openai.apiKey: OpenAI API 키');
      process.exit(1);
    }
    
    return config;
  } catch (error) {
    console.error('❌ config.json 파일을 읽는 중 오류가 발생했습니다:', error);
    process.exit(1);
  }
}

async function fetchJiraIssue(config: Config, issueKey: string): Promise<Record<string, unknown>> {
  const url = `${config.jira.baseUrl}/rest/api/2/issue/${issueKey}`;
  const auth = Buffer.from(`${config.jira.username}:${config.jira.apiToken}`).toString('base64');
  
  console.log(`🔗 API URL: ${url}`);
  
  try {
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json',
      },
      timeout: 10000, // 10초 타임아웃
      httpsAgent: new https.Agent({
        rejectUnauthorized: false // SSL 인증서 검증 비활성화
      })
    });
    
    console.log(`✅ API 응답 성공: ${response.status}`);
    return response.data as Record<string, unknown>;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.log(`❌ API 응답 실패: ${error.response?.status} - ${error.response?.statusText}`);
      
      if (error.response?.status === 404) {
        throw new Error(`Jira 이슈를 찾을 수 없습니다: ${issueKey} (404 Not Found)`);
      } else if (error.response?.status === 401) {
        throw new Error('Jira 인증에 실패했습니다. 사용자명과 API 토큰을 확인해주세요. (401 Unauthorized)');
      } else if (error.response?.status === 403) {
        throw new Error('Jira 접근 권한이 없습니다. 해당 이슈나 프로젝트에 대한 권한을 확인해주세요. (403 Forbidden)');
      } else if (error.code === 'ECONNREFUSED') {
        throw new Error('Jira 서버에 연결할 수 없습니다. URL을 확인해주세요.');
      } else {
        throw new Error(`Jira 이슈 조회 실패: ${error.message} (${error.response?.status})`);
      }
    }
    throw new Error(`알 수 없는 오류: ${error}`);
  }
}

function extractDescription(issueData: Record<string, unknown>): string {
  const fields = issueData.fields as Record<string, unknown> | undefined;
  if (!fields) {
    throw new Error('이슈 필드 정보를 찾을 수 없습니다.');
  }
  const description = fields.description;
  const summary = fields.summary;
  let descriptionText = '';
  if (description) {
    if (typeof description === 'string') {
      descriptionText = description.trim();
    } else if (typeof description === 'object') {
      // Atlassian Document Format인 경우
      const descObj = description as { content?: unknown[] };
      if (descObj.content && Array.isArray(descObj.content)) {
        descriptionText = extractTextFromContent(descObj.content);
      }
    }
  }
  if (!descriptionText && summary) {
    descriptionText = `제목: ${summary}`;
  }
  if (!descriptionText) {
    descriptionText = '이슈에 상세한 설명이 없습니다. 제목과 기본 정보만으로 테스트 케이스를 생성합니다.';
  }
  return descriptionText;
}

function extractTextFromContent(content: unknown[]): string {
  let text = '';
  for (const block of content) {
    if (
      typeof block === 'object' &&
      block !== null &&
      'content' in block &&
      Array.isArray((block as { content: unknown[] }).content)
    ) {
      for (const item of (block as { content: unknown[] }).content) {
        if (
          typeof item === 'object' &&
          item !== null &&
          'text' in item &&
          typeof (item as { text: unknown }).text === 'string'
        ) {
          text += ((item as { text: string }).text) + ' ';
        } else if (
          typeof item === 'object' &&
          item !== null &&
          'content' in item &&
          Array.isArray((item as { content: unknown[] }).content)
        ) {
          text += extractTextFromContent((item as { content: unknown[] }).content) + ' ';
        }
      }
    }
  }
  return text.trim();
}

async function generateTestCasesWithLLM(openai: OpenAI, description: string): Promise<string> {
  const systemPrompt = `당신은 시니어 QA 엔지니어입니다. 주어진 인수 조건(AC)을 분석하여, 프론트엔드와 백엔드에 대한 포괄적인 테스트 케이스를 생성해야 합니다.

요구사항:
- 프론트엔드 테스트 케이스 (UI/UX 검증)
- 백엔드 테스트 케이스 (Positive 케이스)
- 백엔드 테스트 케이스 (Negative 케이스)
- 각 테스트 케이스는 구체적이고 실행 가능해야 함
- 마크다운 형식으로 정리

출력 형식:
## 프론트엔드 테스트 케이스
### 1. [테스트 제목]
- **목적**: [테스트 목적]
- **조건**: [사전 조건]
- **단계**: [테스트 단계]
- **예상 결과**: [예상 결과]

## 백엔드 테스트 케이스
### Positive 케이스
### Negative 케이스`;

  const userPrompt = `다음은 분석할 인수 조건입니다:

---
${description}
---

위 조건을 바탕으로 테스트 케이스를 생성해주세요.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 2048,
      temperature: 0.3,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
    });
    
    return response.choices[0].message.content || "LLM 응답을 받지 못했습니다.";
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`OpenAI API 호출 실패: ${error.message}`);
    }
    throw new Error('알 수 없는 OpenAI API 오류');
  }
}

async function fetchProjectIssues(config: Config, projectKey: string): Promise<unknown[]> {
  const url = `${config.jira.baseUrl}/rest/api/2/search?jql=project=${projectKey}&maxResults=50`;
  const auth = Buffer.from(`${config.jira.username}:${config.jira.apiToken}`).toString('base64');
  
  console.log(`🔍 프로젝트 이슈 조회: ${url}`);
  
  try {
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json',
      },
      timeout: 10000,
      httpsAgent: new https.Agent({
        rejectUnauthorized: false
      })
    });
    
    console.log(`✅ 프로젝트 조회 성공: ${response.data.issues?.length || 0}개 이슈 발견`);
    return response.data.issues || [];
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.log(`❌ 프로젝트 조회 실패: ${error.response?.status} - ${error.response?.statusText}`);
    }
    throw error;
  }
}

// Jira 이슈에 댓글 등록 함수 추가
async function addCommentToJiraIssue(config: Config, issueKey: string, markdown: string): Promise<void> {
  const url = `${config.jira.baseUrl}/rest/api/2/issue/${issueKey}/comment`;
  const auth = Buffer.from(`${config.jira.username}:${config.jira.apiToken}`).toString('base64');

  try {
    const response = await axios.post(
      url,
      { body: markdown },
      {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        timeout: 10000,
        httpsAgent: new https.Agent({ rejectUnauthorized: false })
      }
    );
    console.log(`✅ Jira 댓글 등록 성공: ${response.status}`);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.log(`❌ Jira 댓글 등록 실패: ${error.response?.status} - ${error.response?.statusText}`);
      if (error.response?.status === 404) {
        throw new Error(`Jira 이슈를 찾을 수 없습니다: ${issueKey} (404 Not Found)`);
      } else if (error.response?.status === 401) {
        throw new Error('Jira 인증에 실패했습니다. 사용자명과 API 토큰을 확인해주세요. (401 Unauthorized)');
      } else if (error.response?.status === 403) {
        throw new Error('Jira 접근 권한이 없습니다. (403 Forbidden)');
      } else {
        throw new Error(`Jira 댓글 등록 실패: ${error.message} (${error.response?.status})`);
      }
    }
    throw new Error(`알 수 없는 오류: ${error}`);
  }
}

// 메인 CLI 인터페이스
async function main() {
  console.log('🚀 Jira 테스트 케이스 생성기');
  console.log('='.repeat(50));
  
  const config = loadConfig();
  const openai = new OpenAI({ apiKey: config.openai.apiKey });
  
  console.log(`📋 Jira URL: ${config.jira.baseUrl}`);
  console.log(`👤 사용자: ${config.jira.username}`);
  console.log('');
  
  // 프로젝트 키 추출 (URL에서)
  const urlMatch = config.jira.baseUrl.match(/https:\/\/([^.]+)\.atlassian\.net/);
  if (urlMatch) {
    const domain = urlMatch[1];
    console.log(`🔍 도메인: ${domain}`);
  }
  
  // 사용 가능한 이슈들 확인
  try {
    console.log('📋 사용 가능한 이슈들을 확인 중...');
    const issues = await fetchProjectIssues(config, 'AUT');
    
    if (issues.length > 0) {
      console.log('\n📝 사용 가능한 이슈들:');
      issues.forEach((issue) => {
        if (typeof issue === 'object' && issue !== null && 'key' in issue && 'fields' in issue) {
          const key = (issue as { key: string }).key;
          const fields = (issue as { fields: { summary?: string; issuetype?: { name?: string } } }).fields;
          const summary = fields?.summary || '제목 없음';
          const type = fields?.issuetype?.name || '알 수 없음';
          console.log(`  - ${key} (${type}): ${summary}`);
        }
      });
    } else {
      console.log('⚠️  AUT 프로젝트에서 이슈를 찾을 수 없습니다.');
    }
  } catch {
    console.log('⚠️  프로젝트 이슈 조회 실패, 개별 이슈 조회를 시도합니다.');
  }
  
  console.log('');
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  
  const askIssueKey = (): Promise<string> => {
    return new Promise((resolve) => {
      rl.question('🔑 Jira 이슈 키를 입력하세요 (예: AUT-123, 종료하려면 q): ', (answer) => {
        resolve(answer.trim());
      });
    });
  };
  
  while (true) {
    const issueKey = await askIssueKey();
    
    if (issueKey.toLowerCase() === 'q' || issueKey.toLowerCase() === 'quit') {
      console.log('👋 프로그램을 종료합니다.');
      break;
    }
    
    if (!issueKey) {
      console.log('⚠️  이슈 키를 입력해주세요.');
      continue;
    }
    
    try {
      console.log(`\n🔍 Jira 이슈를 조회 중... (${issueKey})`);
      const issueData = await fetchJiraIssue(config, issueKey);
      const description = extractDescription(issueData);
      
      console.log('✅ 이슈 조회 완료');
      console.log('🤖 테스트케이스 생성 중... (LLM 호출)');
      
      const markdown = await generateTestCasesWithLLM(openai, description);
      
      console.log('\n' + '='.repeat(60));
      console.log('📝 생성된 테스트케이스 (마크다운)');
      console.log('='.repeat(60));
      console.log(markdown);
      console.log('='.repeat(60));
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류';
      console.error(`❌ 오류: ${errorMessage}`);
    }
    
    console.log('\n' + '-'.repeat(30) + '\n');
  }
  
  rl.close();

  // 명령행 인자 파싱 (댓글 등록 모드)
  const args = process.argv.slice(2);
  if (args[0] === '--comment' && args.length === 3) {
    const issueKey = args[1];
    const filePath = args[2];
    if (!fs.existsSync(filePath)) {
      console.error(`❌ 파일을 찾을 수 없습니다: ${filePath}`);
      process.exit(1);
    }
    const markdown = fs.readFileSync(filePath, 'utf8');
    try {
      await addCommentToJiraIssue(config, issueKey, markdown);
      console.log(`🎉 Jira 이슈(${issueKey})에 테스트케이스(마크다운) 댓글 등록 완료!`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류';
      console.error(`❌ 오류: ${errorMessage}`);
      process.exit(1);
    }
    process.exit(0);
  }
}

// 프로그램 실행
main().catch((error) => {
  console.error('❌ 치명적인 오류:', error);
  process.exit(1);
});