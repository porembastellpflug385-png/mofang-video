// @ts-nocheck
/**
 * POST /api/generate
 * 
 * 根据不同模型路由到正确的视频生成 API 端点
 *   Sora:       POST {BASE}/videos
 *   Veo/Grok:   POST {BASE}/videos/generations
 *   回退:       POST {BASE}/chat/completions
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const BASE_URL = process.env.OPENAI_BASE_URL || process.env.API_BASE_URL;
  const API_KEY  = process.env.OPENAI_API_KEY  || process.env.API_KEY;

  if (!BASE_URL || !API_KEY) {
    console.error('Missing env: OPENAI_BASE_URL / OPENAI_API_KEY');
    return res.status(500).json({ error: '服务端配置错误，请检查环境变量 OPENAI_BASE_URL 和 OPENAI_API_KEY' });
  }

  try {
    const body = req.body;
    const model = body.model || '';

    // 根据模型选择端点和构建请求体
    let path, apiBody;

    if (model.startsWith('sora')) {
      path = '/videos';
      apiBody = {
        model: body.model,
        prompt: body.prompt || '',
      };
      if (body.seconds) apiBody.seconds = String(body.seconds);
      if (body.size) apiBody.size = body.size;
      if (body.input_reference) apiBody.input_reference = body.input_reference;
    } else if (model.startsWith('veo') || model.startsWith('grok-video')) {
      path = '/videos/generations';
      apiBody = {
        model: body.model,
        prompt: body.prompt || '',
      };
      if (body.aspectRatio || body.aspect_ratio) apiBody.aspectRatio = body.aspectRatio || body.aspect_ratio;
      if (body.image) apiBody.image = body.image;
      if (body.duration) apiBody.duration = body.duration;
      if (body.quality) apiBody.quality = body.quality;
    } else {
      path = '/chat/completions';
      apiBody = body;
    }

    const apiUrl = `${BASE_URL}${path}`;
    console.log(`[generate] ${model} → ${apiUrl}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180000);

    const apiResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(apiBody),
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
      const data = JSON.parse(responseText);
      return res.status(200).json(data);
    } catch {
      return res.status(200).json({ raw: responseText });
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: '请求超时，请稍后重试' });
    }
    console.error('[generate] Error:', err);
    return res.status(500).json({ error: '服务器内部错误', detail: err.message });
  }
}
