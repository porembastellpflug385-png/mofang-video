/**
 * POST /api/generate
 * 
 * Edge Function + 强制 stream: true
 * 
 * 关键：Vercel Hobby 有超时限制，但 streaming 响应不受限
 * 所以强制开启 stream，将第三方 API 的流式数据实时透传给前端
 * 前端从 SSE 流中提取最终的视频 URL
 */

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }

  const BASE_URL = process.env.OPENAI_BASE_URL || process.env.API_BASE_URL;
  const API_KEY  = process.env.OPENAI_API_KEY  || process.env.API_KEY;

  if (!BASE_URL || !API_KEY) {
    return new Response(JSON.stringify({ error: '服务端配置错误' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    const apiUrl = `${BASE_URL}/chat/completions`;

    // 强制开启 stream 以避免超时
    body.stream = true;

    const apiResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': API_KEY,
      },
      body: JSON.stringify(body),
    });

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      return new Response(JSON.stringify({
        error: `API 请求失败 (${apiResponse.status})`,
        detail: errorText.slice(0, 500),
      }), {
        status: apiResponse.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 直接透传 stream 给前端
    return new Response(apiResponse.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({
      error: '服务器内部错误',
      detail: err.message,
    }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}
