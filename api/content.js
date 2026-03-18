export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'GET') {
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

  const url = new URL(req.url);
  const videoId = url.searchParams.get('id');
  if (!videoId) {
    return new Response(JSON.stringify({ error: '缺少视频 ID' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const apiResponse = await fetch(`${BASE_URL}/videos/${videoId}/content`, {
      method: 'GET',
      headers: { 'Authorization': API_KEY },
      redirect: 'follow',
    });

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      return new Response(JSON.stringify({
        error: `获取失败 (${apiResponse.status})`,
        detail: errorText.slice(0, 500),
      }), {
        status: apiResponse.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 透传响应
    return new Response(apiResponse.body, {
      status: 200,
      headers: {
        'Content-Type': apiResponse.headers.get('content-type') || 'application/octet-stream',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: '获取失败', detail: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}
