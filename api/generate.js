/**
 * POST /api/generate
 * 
 * 生产队API视频生成代理
 * 
 * 端点路由（根据模型的 supported_endpoint_types）：
 *   - sora-2 系列 (openai):       POST {BASE}/chat/completions
 *   - veo_3_1 系列 (openAI视频格式): POST {BASE}/videos
 *   - grok-video 系列 (grok视频):    需要专用格式
 *   - 其他视频统一格式:              POST {BASE}/videos/generations
 * 
 * 重要：此平台 Authorization 不带 Bearer 前缀！
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

    // 根据模型选择端点
    let path;
    if (model.startsWith('sora')) {
      // sora-2 支持 openai 格式 (chat/completions) 和 openAI官方视频格式 (/videos)
      // 如果请求体有 messages → chat/completions, 否则 → /videos
      path = Array.isArray(body.messages) ? '/chat/completions' : '/videos';
    } else if (model.startsWith('veo_')) {
      // veo_3_1-4K 等下划线格式的 → openAI视频格式 → /videos
      path = '/videos';
    } else if (model.startsWith('veo')) {
      // veo3.1 等点号格式的 → 视频统一格式 → /videos/generations
      path = '/videos/generations';
    } else if (model.startsWith('grok-video')) {
      // grok视频 → 专用格式，也走 /videos/generations 试试
      path = '/videos/generations';
    } else {
      // 回退到 chat/completions
      path = '/chat/completions';
    }

    const apiUrl = `${BASE_URL}${path}`;
    console.log(`[generate] model=${model} → ${apiUrl}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180000);

    const apiResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // 重要：此平台不用 Bearer 前缀
        'Authorization': API_KEY,
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
      return res.status(504).json({ error: '请求超时，请稍后重试' });
    }
    console.error('[generate] Error:', err);
    return res.status(500).json({ error: '服务器内部错误', detail: err.message });
  }
}