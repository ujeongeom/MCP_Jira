const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const recentTestcases = {};

// MCP 프록시: OpenAI 호환 엔드포인트
app.post('/v1/chat/completions', async (req, res) => {
  try {
    const messages = req.body.messages || [];
    const userMsg = messages.map(m => m.content).join(' ');

    // 이슈 키 추출 (예: AUT-4)
    const match = userMsg.match(/([A-Z]+-\d+)/);
    const issueKey = match ? match[1] : null;

    // 1. 테스트케이스 생성 요청
    if (userMsg.includes('테스트 케이스') && userMsg.includes('Jira') && !userMsg.includes('댓글') && !userMsg.includes('등록')) {
      if (!issueKey) {
        return res.json({
          id: 'chatcmpl-mcp-proxy',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: 'gpt-4o',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: 'Jira 이슈 키를 찾을 수 없습니다. 예: AUT-4' },
            finish_reason: 'stop'
          }],
        });
      }
      // 내부 REST API 호출
      const apiRes = await axios.post('http://localhost:3000/api/generate-testcases', { issueKey });
      const markdown = apiRes.data.markdown;
      // 메모리에 저장
      recentTestcases[issueKey] = markdown;
      return res.json({
        id: 'chatcmpl-mcp-proxy',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'gpt-4o',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: markdown },
          finish_reason: 'stop'
        }],
      });
    }

    // 2. 댓글 등록 요청
    if (issueKey && (userMsg.includes('댓글') || userMsg.includes('등록'))) {
      const markdown = recentTestcases[issueKey];
      if (!markdown) {
        return res.json({
          id: 'chatcmpl-mcp-proxy',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: 'gpt-4o',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: '먼저 테스트 케이스를 생성해 주세요.' },
            finish_reason: 'stop'
          }],
        });
      }
      // 댓글 등록 API 호출
      console.log('[MCP] 댓글 등록 API 호출 준비', { issueKey, markdownLength: markdown.length });
      try {
        const apiRes = await axios.post('http://localhost:3000/api/jira-comment', { issueKey, markdown });
        console.log('[MCP] 댓글 등록 API 성공', { status: apiRes.status, data: apiRes.data });
        return res.json({
          id: 'chatcmpl-mcp-proxy',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: 'gpt-4o',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: `Jira 이슈(${issueKey})에 테스트케이스가 댓글로 등록되었습니다.` },
            finish_reason: 'stop'
          }],
        });
      } catch (e) {
        console.error('[MCP] 댓글 등록 API 실패', e?.message, e?.response?.data);
        return res.json({
          id: 'chatcmpl-mcp-proxy',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: 'gpt-4o',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: `댓글 등록에 실패했습니다: ${e.message}` },
            finish_reason: 'stop'
          }],
        });
      }
    }

    // 그 외 프롬프트는 에코
    return res.json({
      id: 'chatcmpl-mcp-proxy',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'gpt-4o',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: `Echo: ${userMsg}` },
        finish_reason: 'stop'
      }],
    });
  } catch (error) {
    return res.status(500).json({
      error: {
        message: error.message || 'MCP 프록시 서버 오류',
        type: 'mcp_proxy_error',
      }
    });
  }
});

const PORT = 8001;
app.listen(PORT, () => {
  console.log(`MCP 프록시 서버가 포트 ${PORT}에서 실행 중입니다.`);
}); 