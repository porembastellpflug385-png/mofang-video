/**
 * POST /api/generate
 * 
 * Vercel Edge Function — 无 10 秒超时限制
 * Edge Runtime 支持 streaming，可以保持长连接直到第三方 API 返回
 * 
 * Hobby 计划: Edge Functions 没有 10 秒硬限制（CPU 时间限制 30s，但等待 I/O 不算）
 */

export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const BASE_URL = process.env.OPENAI_BASE_URL || process.env.API_BASE_URL;
  const API_KEY  = process.env.OPENAI_API_KEY  || process.env.API_KEY;

  if (!BASE_URL || !API_KEY) {
    return new Response(JSON.stringify({ error: '服务端配置错误' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    const apiUrl = `${BASE_URL}/chat/completions`;

    const apiResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': API_KEY,
      },
      body: JSON.stringify(body),
    });

    // 如果上游返回流式数据，直接透传 stream 给前端
    if (body.stream && apiResponse.body) {
      return new Response(apiResponse.body, {
        status: apiResponse.status,
        headers: {
          'Content-Type': apiResponse.headers.get('content-type') || 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
      });
    }

    // 非流式：等待完整响应后返回
    const responseText = await apiResponse.text();

    if (!apiResponse.ok) {
      return new Response(JSON.stringify({
        error: `API 请求失败 (${apiResponse.status})`,
        detail: responseText.slice(0, 500),
      }), {
        status: apiResponse.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(responseText, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({
      error: '服务器内部错误',
      detail: err.message,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
