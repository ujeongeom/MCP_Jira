import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

interface Config {
  jira: {
    baseUrl: string;
    username: string;
    apiToken: string;
  };
}

function loadConfig(): Config {
  const configPath = path.join(process.cwd(), 'config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error('config.json 파일이 없습니다.');
  }
  const configData = fs.readFileSync(configPath, 'utf8');
  const config = JSON.parse(configData);
  if (!config.jira?.baseUrl || !config.jira?.username || !config.jira?.apiToken) {
    throw new Error('config.json에 필요한 정보가 누락되었습니다.');
  }
  return config;
}

export async function POST(req: NextRequest) {
  try {
    const { issueKey, markdown } = await req.json();
    console.log('[JIRA-COMMENT] 요청 수신:', { issueKey, markdownLength: markdown?.length });
    if (!issueKey || !markdown) {
      console.log('[JIRA-COMMENT] 필수 파라미터 누락');
      return NextResponse.json({ error: 'issueKey와 markdown은 필수입니다.' }, { status: 400 });
    }
    const config = loadConfig();
    const url = `${config.jira.baseUrl}/rest/api/2/issue/${issueKey}/comment`;
    const auth = Buffer.from(`${config.jira.username}:${config.jira.apiToken}`).toString('base64');
    console.log('[JIRA-COMMENT] JIRA API 호출 준비', { url });
    // 마크다운을 plain text로 변환 (간단하게 마크다운 기호 제거)
    const plainText = typeof markdown === 'string' ? markdown.replace(/[\*_#`>\-]/g, '') : markdown;
    try {
      const jiraRes = await axios.post(
        url,
        { body: plainText },
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
      // body가 너무 길면 30자까지만 로그에 출력
      const data = { ...jiraRes.data };
      if (data.body && typeof data.body === 'string' && data.body.length > 30) {
        data.body = data.body.slice(0, 30) + '...';
      }
      console.log('[JIRA-COMMENT] JIRA API 응답', { status: jiraRes.status, data });
    } catch (jiraError) {
      const err = jiraError as any;
      console.error('[JIRA-COMMENT] JIRA API 호출 실패', err?.response?.status, err?.response?.data, err?.message);
      throw jiraError;
    }
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    console.error('[JIRA-COMMENT] 최종 에러', error);
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message || '댓글 등록 실패' }, { status: 500 });
    }
    return NextResponse.json({ error: '알 수 없는 오류' }, { status: 500 });
  }
} 