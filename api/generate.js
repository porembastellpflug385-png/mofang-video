/**
 * POST /api/generate
 *
 * 恢复到原始的 /chat/completions 路径，
 * 并在 stream=true 时将上游 SSE 原样转发给前端。
 *
 * 重要：Authorization 不带 Bearer 前缀
 */

export const config = {
  maxDuration: 300,
};

function getApiConfigForModel(model = '') {
  const isSora = model.startsWith('sora');

  if (isSora) {
    return {
      baseUrl:
        process.env.SORA_OPENAI_BASE_URL ||
        process.env.SORA_API_BASE_URL ||
        process.env.OPENAI_BASE_URL ||
        process.env.API_BASE_URL,
      apiKey:
        process.env.SORA_OPENAI_API_KEY ||
        process.env.SORA_API_KEY ||
        process.env.OPENAI_API_KEY ||
        process.env.API_KEY,
    };
  }

  return {
    baseUrl: process.env.OPENAI_BASE_URL || process.env.API_BASE_URL,
    apiKey: process.env.OPENAI_API_KEY || process.env.API_KEY,
  };
}

async function pipeStream(upstreamResponse, res) {
  const contentType = upstreamResponse.headers.get('content-type') || 'text/event-stream; charset=utf-8';

  res.statusCode = 200;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  for await (const chunk of upstreamResponse.body) {
    res.write(chunk);
  }

  res.end();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;
    const model = body.model || '';
    const { baseUrl: BASE_URL, apiKey: API_KEY } = getApiConfigForModel(model);

    if (!BASE_URL || !API_KEY) {
      return res.status(500).json({ error: `服务端配置错误，请检查 ${model.startsWith('sora') ? 'SORA_' : '默认'} 环境变量` });
    }

    const apiUrl = `${BASE_URL}/chat/completions`;
    console.log(`[generate] model=${model} stream=${Boolean(body.stream)} → ${apiUrl}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 300000);

    const apiResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': API_KEY,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!apiResponse.ok) {
      clearTimeout(timeout);
      const errorText = await apiResponse.text();
      console.error(`[generate] Error ${apiResponse.status}:`, errorText.slice(0, 500));
      return res.status(apiResponse.status).json({
        error: `API 请求失败 (${apiResponse.status})`,
        detail: errorText.slice(0, 500),
      });
    }

    if (body.stream && apiResponse.body) {
      try {
        await pipeStream(apiResponse, res);
        return;
      } finally {
        clearTimeout(timeout);
      }
    }

    clearTimeout(timeout);
    const responseText = await apiResponse.text();

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
