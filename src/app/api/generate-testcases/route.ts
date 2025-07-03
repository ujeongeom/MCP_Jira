import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';
import OpenAI from 'openai';
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

function loadConfig(): Config {
  const configPath = path.join(process.cwd(), 'config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error('config.json 파일이 없습니다.');
  }
  const configData = fs.readFileSync(configPath, 'utf8');
  const config = JSON.parse(configData);
  if (!config.jira?.baseUrl || !config.jira?.username || !config.jira?.apiToken || !config.openai?.apiKey) {
    throw new Error('config.json에 필요한 정보가 누락되었습니다.');
  }
  return config;
}

async function fetchJiraIssue(config: Config, issueKey: string): Promise<Record<string, unknown>> {
  const url = `${config.jira.baseUrl}/rest/api/2/issue/${issueKey}`;
  const auth = Buffer.from(`${config.jira.username}:${config.jira.apiToken}`).toString('base64');
  try {
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json',
      },
      timeout: 10000,
      httpsAgent: new https.Agent({ rejectUnauthorized: false })
    });
    return response.data as Record<string, unknown>;
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      if (error.response?.status === 404) {
        throw new Error(`Jira 이슈를 찾을 수 없습니다: ${issueKey} (404 Not Found)`);
      } else if (error.response?.status === 401) {
        throw new Error('Jira 인증에 실패했습니다. 사용자명과 API 토큰을 확인해주세요. (401 Unauthorized)');
      } else if (error.response?.status === 403) {
        throw new Error('Jira 접근 권한이 없습니다. (403 Forbidden)');
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
  if (!fields) throw new Error('이슈 필드 정보를 찾을 수 없습니다.');
  const description = fields.description;
  const summary = fields.summary;
  let descriptionText = '';
  if (description) {
    if (typeof description === 'string') {
      descriptionText = description.trim();
    } else if (typeof description === 'object') {
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

async function generateTestCasesWithLLM(openai: OpenAI, description: string, systemPrompt?: string): Promise<string> {
  const defaultSystemPrompt = `당신은 시니어 QA 엔지니어입니다. 주어진 인수 조건(AC)을 분석하여, 프론트엔드와 백엔드에 대한 포괄적인 테스트 케이스를 생성해야 합니다.\n\n요구사항:\n- 프론트엔드 테스트 케이스 (UI/UX 검증)\n- 백엔드 테스트 케이스 (Positive 케이스)\n- 백엔드 테스트 케이스 (Negative 케이스)\n- 각 테스트 케이스는 구체적이고 실행 가능해야 함\n- 마크다운 형식으로 정리\n\n출력 형식:\n## 프론트엔드 테스트 케이스\n### 1. [테스트 제목]\n- **목적**: [테스트 목적]\n- **조건**: [사전 조건]\n- **단계**: [테스트 단계]\n- **예상 결과**: [예상 결과]\n\n## 백엔드 테스트 케이스\n### Positive 케이스\n### Negative 케이스`;
  const system = systemPrompt || defaultSystemPrompt;
  const userPrompt = `다음은 분석할 인수 조건입니다:\n\n---\n${description}\n---\n\n위 조건을 바탕으로 테스트 케이스를 생성해주세요.`;

  console.log('=== [LLM 호출 프롬프트] ===');
  console.log('[SYSTEM]', system);
  if (userPrompt.length > 30) {
    console.log('[USER]', userPrompt.slice(0, 30) + '...');
  } else {
    console.log('[USER]', userPrompt);
  }

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 2048,
      temperature: 0.3,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userPrompt }
      ],
    });
    const markdown = response.choices[0].message.content || 'LLM 응답을 받지 못했습니다.';

    console.log('=== [LLM 응답(markdown)] ===');
    if (markdown.length > 30) {
      console.log(markdown.slice(0, 30) + '...');
    } else {
      console.log(markdown);
    }

    return markdown;
  } catch (error: unknown) {
    if (error instanceof Error) {
      throw new Error(`OpenAI API 호출 실패: ${error.message}`);
    }
    throw new Error('알 수 없는 OpenAI API 오류');
  }
}

export async function POST(req: NextRequest) {
  try {
    const { issueKey, systemPrompt } = await req.json();
    if (!issueKey) {
      return NextResponse.json({ error: 'issueKey는 필수입니다.' }, { status: 400 });
    }
    const config = loadConfig();
    const openai = new OpenAI({ apiKey: config.openai.apiKey });
    const issueData = await fetchJiraIssue(config, issueKey);
    const description = extractDescription(issueData);
    const markdown = await generateTestCasesWithLLM(openai, description, systemPrompt);
    return NextResponse.json({ markdown });
  } catch (error: unknown) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message || '알 수 없는 오류' }, { status: 500 });
    }
    return NextResponse.json({ error: '알 수 없는 오류' }, { status: 500 });
  }
} 