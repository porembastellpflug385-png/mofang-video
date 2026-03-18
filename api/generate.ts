import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Vercel Serverless API Route - Video Generation Proxy
 * 
 * 统一代理层，根据不同模型路由到正确的 API 端点
 * 
 * 环境变量（在 Vercel Dashboard 中配置）：
 *   - OPENAI_BASE_URL: 第三方 API 的 base URL (例如 https://ai.scd666.com/v1)
 *   - OPENAI_API_KEY: 第三方 API 密钥
 * 
 * 支持的 API 端点格式：
 *   - Sora 系列:   POST {BASE_URL}/videos             (OpenAI Videos API 兼容)
 *   - Veo 系列:    POST {BASE_URL}/videos/generations  (Google Veo 兼容)
 *   - Grok 系列:   POST {BASE_URL}/videos/generations  (同 Veo 格式)
 *   - 通用回退:    POST {BASE_URL}/chat/completions    (OpenAI Chat 格式)
 */

const TIMEOUT_MS = 180_000; // 3分钟超时（视频生成较慢）

// 根据模型决定使用哪个 API 端点和请求格式
function getEndpointConfig(model: string) {
  if (model.startsWith('sora')) {
    return { path: '/videos', format: 'sora' as const };
  }
  if (model.startsWith('veo') || model.startsWith('grok-video')) {
    return { path: '/videos/generations', format: 'veo' as const };
  }
  // 通用回退到 chat/completions
  return { path: '/chat/completions', format: 'chat' as const };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 兼容多种环境变量命名
  const BASE_URL = process.env.OPENAI_BASE_URL || process.env.API_BASE_URL;
  const API_KEY  = process.env.OPENAI_API_KEY  || process.env.API_KEY;

  if (!BASE_URL || !API_KEY) {
    console.error('Missing env vars. Need OPENAI_BASE_URL + OPENAI_API_KEY (or API_BASE_URL + API_KEY)');
    return res.status(500).json({ 
      error: '服务端配置错误，请检查环境变量 OPENAI_BASE_URL 和 OPENAI_API_KEY' 
    });
  }

  try {
    const body = req.body;
    const model = body.model || '';
    const { path, format } = getEndpointConfig(model);

    // 构建适配不同端点的请求体
    let apiBody: any;

    if (format === 'sora') {
      // OpenAI Sora Videos API 格式
      // POST /v1/videos
      // { model, prompt, seconds, size, input_reference? }
      apiBody = {
        model: body.model,
        prompt: body.prompt || '',
      };
      if (body.seconds) apiBody.seconds = String(body.seconds);
      if (body.size) apiBody.size = body.size;
      if (body.input_reference) apiBody.input_reference = body.input_reference;
      // 图片参考（首帧）
      if (body.image_url) apiBody.input_reference = body.image_url;
    } else if (format === 'veo') {
      // Veo / Grok Videos Generations 格式
      // POST /v1/videos/generations
      // { model, prompt, aspectRatio?, ... }
      apiBody = {
        model: body.model,
        prompt: body.prompt || '',
      };
      if (body.aspectRatio) apiBody.aspectRatio = body.aspectRatio;
      if (body.aspect_ratio) apiBody.aspectRatio = body.aspect_ratio;
      if (body.image) apiBody.image = body.image;
      // 传递 extra 参数
      if (body.duration) apiBody.duration = body.duration;
      if (body.quality) apiBody.quality = body.quality;
      if (body.personGeneration) apiBody.personGeneration = body.personGeneration;
    } else {
      // Chat completions 通用格式 — 原样透传
      apiBody = body;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const apiUrl = `${BASE_URL}${path}`;
    console.log(`[generate] ${model} → ${format} → ${apiUrl}`);

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

    // 读取响应
    const responseText = await apiResponse.text();
    
    if (!apiResponse.ok) {
      console.error(`[generate] API error [${apiResponse.status}]:`, responseText);
      return res.status(apiResponse.status).json({
        error: `API 请求失败 (${apiResponse.status})`,
        detail: responseText,
      });
    }

    // 尝试解析 JSON
    try {
      const data = JSON.parse(responseText);
      return res.status(200).json(data);
    } catch {
      // 非 JSON 响应，原样返回
      return res.status(200).json({ raw: responseText });
    }
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: '请求超时，请稍后重试' });
    }
    console.error('[generate] Proxy error:', err);
    return res.status(500).json({ error: '服务器内部错误', detail: err.message });
  }
}
