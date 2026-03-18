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
  const taskId = url.searchParams.get('id');
  if (!taskId) {
    return new Response(JSON.stringify({ error: '缺少任务 ID' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const headers = { 'Authorization': API_KEY, 'Content-Type': 'application/json' };

  try {
    // 先试 /videos/{id}
    let apiResponse = await fetch(`${BASE_URL}/videos/${taskId}`, { method: 'GET', headers });

    // 404 则试 /videos/generations/{id}
    if (apiResponse.status === 404) {
      apiResponse = await fetch(`${BASE_URL}/videos/generations/${taskId}`, { method: 'GET', headers });
    }

    const responseText = await apiResponse.text();
    return new Response(responseText, {
      status: apiResponse.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: '查询失败', detail: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}
