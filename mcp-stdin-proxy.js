const readline = require('readline');
const axios = require('axios');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

const systemPrompt = `당신은 시니어 QA 엔지니어입니다. 주어진 인수 조건(AC)을 분석하여, 프론트엔드와 백엔드에 대한 포괄적인 테스트 케이스를 생성해야 합니다.\n\n요구사항:\n- 프론트엔드 테스트 케이스 (UI/UX 검증)\n- 백엔드 테스트 케이스 (Positive 케이스)\n- 백엔드 테스트 케이스 (Negative 케이스)\n- 각 테스트 케이스는 구체적이고 실행 가능해야 함\n- 마크다운 형식으로 정리\n\n출력 형식:\n## 프론트엔드 테스트 케이스\n### 1. [테스트 제목]\n- **목적**: [테스트 목적]\n- **조건**: [사전 조건]\n- **단계**: [테스트 단계]\n- **예상 결과**: [예상 결과]\n\n## 백엔드 테스트 케이스\n### Positive 케이스\n### Negative 케이스`;

let initialized = false;

function sendResponse(obj) {
  console.error('Sending response:', JSON.stringify(obj)); // 디버깅용
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function sendError(id, code, message) {
  sendResponse({
    jsonrpc: '2.0',
    id: id || 1, // null 대신 기본값 사용
    error: { code, message }
  });
}

rl.on('line', async (line) => {
  console.error('Received line:', line);
  
  // 빈 라인 무시
  if (!line.trim()) {
    return;
  }
  
  let req;
  try {
    req = JSON.parse(line);
  } catch (e) {
    return sendError(1, -32700, 'Parse error');
  }

  const { jsonrpc, id, method, params } = req;
  
  // id 검증 - null이나 undefined면 기본값 사용
  const requestId = (id !== null && id !== undefined) ? id : 1;
  
  if (jsonrpc !== '2.0') {
    return sendError(requestId, -32600, 'Invalid Request');
  }

  if (!method) {
    return sendError(requestId, -32600, 'Missing method');
  }

  console.error('Processing method:', method);

  try {
    switch (method) {
      case 'initialize':
        initialized = true; // initialize 시점에서 바로 초기화 완료로 설정
        sendResponse({
          jsonrpc: '2.0',
          id: requestId,
          result: {
            protocolVersion: '2024-11-05',
            serverInfo: {
              name: 'jira_test_case_generator',
              version: '0.1.0'
            },
            capabilities: {
              tools: {}
            }
          }
        });
        console.error('Server initialized after initialize call');
        break;

      case 'initialized':
        // 초기화 완료 통지 - 이미 initialize에서 설정했지만 다시 확인
        initialized = true;
        console.error('Server initialized notification received');
        break;

      case 'tools/list':
        sendResponse({
          jsonrpc: '2.0',
          id: requestId,
          result: {
            tools: [
              {
                name: 'generate_jira_testcases',
                description: 'Jira 이슈 키를 기반으로 테스트 케이스를 생성합니다.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    issueKey: {
                      type: 'string',
                      description: 'Jira 이슈 키 (예: AUT-4)'
                    }
                  },
                  required: ['issueKey']
                }
              },
              {
                name: 'register_jira_comment',
                description: 'Jira 이슈에 마크다운(테스트케이스 등)을 댓글로 등록합니다.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    issueKey: {
                      type: 'string',
                      description: 'Jira 이슈 키 (예: AUT-4)'
                    },
                    markdown: {
                      type: 'string',
                      description: '댓글로 등록할 마크다운 텍스트'
                    }
                  },
                  required: ['issueKey', 'markdown']
                }
              }
            ]
          }
        });
        break;

      case 'tools/call':
        console.error('tools/call requested, initialized:', initialized);
        
        if (!initialized) {
          console.error('Server not initialized, forcing initialization');
          initialized = true; // 강제로 초기화 상태로 설정
        }

        const { name, arguments: args } = params || {};
        
        if (!name) {
          return sendError(requestId, -32602, 'Missing tool name');
        }
        
        if (name === 'generate_jira_testcases') {
          try {
            const { issueKey } = args || {};
            
            console.error('Processing issueKey:', issueKey);
            
            if (!issueKey || !issueKey.match(/^[A-Z]+-\d+$/)) {
              return sendResponse({
                jsonrpc: '2.0',
                id: requestId,
                result: {
                  content: [
                    {
                      type: 'text',
                      text: '올바른 Jira 이슈 키를 입력해주세요. (예: AUT-4)'
                    }
                  ]
                }
              });
            }

            console.error('Calling API for issue:', issueKey);
            const apiRes = await axios.post('http://localhost:3000/api/generate-testcases', { issueKey });
            const markdown = apiRes.data.markdown;

            sendResponse({
              jsonrpc: '2.0',
              id: requestId,
              result: {
                content: [
                  {
                    type: 'text',
                    text: markdown
                  }
                ]
              }
            });
          } catch (error) {
            console.error('API call failed:', error.message);
            sendResponse({
              jsonrpc: '2.0',
              id: requestId,
              result: {
                content: [
                  {
                    type: 'text',
                    text: `테스트케이스 생성 실패: ${error.message}`
                  }
                ]
              }
            });
          }
        } else if (name === 'register_jira_comment') {
          try {
            const { issueKey, markdown } = args || {};
            if (!issueKey || !issueKey.match(/^[A-Z]+-\d+$/)) {
              return sendResponse({
                jsonrpc: '2.0',
                id: requestId,
                result: {
                  content: [
                    {
                      type: 'text',
                      text: '올바른 Jira 이슈 키를 입력해주세요. (예: AUT-4)'
                    }
                  ]
                }
              });
            }
            if (!markdown || typeof markdown !== 'string' || markdown.length < 10) {
              return sendResponse({
                jsonrpc: '2.0',
                id: requestId,
                result: {
                  content: [
                    {
                      type: 'text',
                      text: '마크다운 텍스트가 너무 짧거나 비어 있습니다.'
                    }
                  ]
                }
              });
            }
            console.error('Calling API for comment:', issueKey);
            const apiRes = await axios.post('http://localhost:3000/api/jira-comment', { issueKey, markdown });
            if (apiRes.data && apiRes.data.ok) {
              sendResponse({
                jsonrpc: '2.0',
                id: requestId,
                result: {
                  content: [
                    {
                      type: 'text',
                      text: `Jira 이슈(${issueKey})에 댓글이 성공적으로 등록되었습니다.`
                    }
                  ]
                }
              });
            } else {
              sendResponse({
                jsonrpc: '2.0',
                id: requestId,
                result: {
                  content: [
                    {
                      type: 'text',
                      text: `댓글 등록 실패: ${apiRes.data?.error || '알 수 없는 오류'}`
                    }
                  ]
                }
              });
            }
          } catch (error) {
            console.error('댓글 등록 API call failed:', error?.message);
            sendResponse({
              jsonrpc: '2.0',
              id: requestId,
              result: {
                content: [
                  {
                    type: 'text',
                    text: `댓글 등록 실패: ${error?.message}`
                  }
                ]
              }
            });
          }
        } else {
          sendError(requestId, -32601, `Unknown tool: ${name}`);
        }
        break;

      case 'shutdown':
        sendResponse({
          jsonrpc: '2.0',
          id: requestId,
          result: null
        });
        break;

      case 'exit':
        process.exit(0);
        break;

      default:
        sendError(requestId, -32601, `Method not found: ${method}`);
    }
  } catch (error) {
    console.error('Handler error:', error);
    sendError(requestId, -32603, 'Internal error');
  }
});

// 서버 시작 로그
console.error('MCP Jira Test Case Generator Server starting...');
console.error('Initial initialized state:', initialized);

// 프로세스 종료 처리
process.on('SIGINT', () => {
  console.error('Server shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('Server shutting down...');
  process.exit(0);
});