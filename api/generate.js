/**
 * POST /api/generate
 *
 * 为不同模型路由到对应的视频提交端点，优先使用异步任务接口，
 * 避免在 Vercel Hobby 上长时间占用函数执行时间。
 *
 * 重要：Authorization 不带 Bearer 前缀
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const BASE_URL = process.env.OPENAI_BASE_URL || process.env.API_BASE_URL;
  const API_KEY  = process.env.OPENAI_API_KEY  || process.env.API_KEY;

  if (!BASE_URL || !API_KEY) {
    return res.status(500).json({ error: '服务端配置错误，请检查环境变量' });
  }

  try {
    const body = req.body;
    const model = body.model || '';

    let path = '/chat/completions';
    if (model.startsWith('sora')) {
      path = Array.isArray(body.messages) ? '/chat/completions' : '/videos';
    } else if (model.startsWith('veo_')) {
      path = '/videos';
    } else if (model.startsWith('veo') || model.startsWith('grok-video')) {
      path = '/videos/generations';
    } else if (body.prompt && !Array.isArray(body.messages)) {
      path = '/videos/generations';
    }

    const apiUrl = `${BASE_URL}${path}`;

    console.log(`[generate] model=${model} → ${apiUrl}`);

    const controller = new AbortController();
    // 提交任务本身应尽快返回，避免免费版函数超时。
    const timeout = setTimeout(() => controller.abort(), 25000);

    const apiResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': API_KEY,  // 不带 Bearer
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const responseText = await apiResponse.text();

    if (!apiResponse.ok) {
      console.error(`[generate] Error ${apiResponse.status}:`, responseText.slice(0, 500));
      return res.status(apiResponse.status).json({
        error: `API 请求失败 (${apiResponse.status})`,
        detail: responseText.slice(0, 500),
      });
    }

    try {
      return res.status(200).json(JSON.parse(responseText));
    } catch {
      return res.status(200).json({ raw: responseText });
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: '视频生成超时，请稍后重试' });
    }
    console.error('[generate] Error:', err);
    return res.status(500).json({ error: '服务器内部错误', detail: err.message });
  }
}
