/**
 * POST /api/generate
 *
 * 默认保持原有 chat/completions 行为，避免影响已经可用的 grok。
 * 对 sora / veo 在 chat 端点失败时，自动回退到视频任务端点。
 *
 * 重要：Authorization 不带 Bearer 前缀
 */

export const config = {
  maxDuration: 300,
};

function getTextAndImagesFromMessages(messages = []) {
  const textParts = [];
  const imageUrls = [];

  for (const message of messages) {
    const content = message?.content;
    if (typeof content === 'string') {
      textParts.push(content);
      continue;
    }
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (block?.type === 'text' && typeof block.text === 'string') {
        textParts.push(block.text);
      }
      if (block?.type === 'image_url' && typeof block.image_url?.url === 'string') {
        imageUrls.push(block.image_url.url);
      }
    }
  }

  return {
    prompt: textParts.join('\n').trim(),
    imageUrls,
  };
}

function extractAspectRatio(prompt = '') {
  const match = prompt.match(/(16:9|4:3|1:1|3:4|9:16)/);
  return match ? match[1] : undefined;
}

function buildVideoFallbackBody(body) {
  const { prompt, imageUrls } = getTextAndImagesFromMessages(body.messages);
  const nextBody = {
    model: body.model,
    prompt,
  };

  if (imageUrls[0]) {
    nextBody.image = imageUrls[0];
  }

  const aspectRatio = extractAspectRatio(prompt);
  if (aspectRatio) {
    nextBody.aspect_ratio = aspectRatio;
  }

  return nextBody;
}

async function sendJsonRequest(apiUrl, apiKey, body, signal) {
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': apiKey,
    },
    body: JSON.stringify(body),
    signal,
  });

  const text = await response.text();
  return { response, text };
}

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

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 300000);

    let apiUrl = `${BASE_URL}/chat/completions`;
    console.log(`[generate] primary model=${model} → ${apiUrl}`);

    let { response, text } = await sendJsonRequest(apiUrl, API_KEY, body, controller.signal);

    const canFallbackToVideoApi =
      Array.isArray(body.messages) &&
      (model.startsWith('sora') || model.startsWith('veo_'));

    if (!response.ok && canFallbackToVideoApi) {
      const fallbackBody = buildVideoFallbackBody(body);
      apiUrl = `${BASE_URL}/videos`;
      console.log(`[generate] fallback model=${model} → ${apiUrl}`);
      ({ response, text } = await sendJsonRequest(apiUrl, API_KEY, fallbackBody, controller.signal));
    }

    clearTimeout(timeout);

    if (!response.ok) {
      console.error(`[generate] Error ${response.status}:`, text.slice(0, 500));
      return res.status(response.status).json({
        error: `API 请求失败 (${response.status})`,
        detail: text.slice(0, 500),
      });
    }

    try {
      return res.status(200).json(JSON.parse(text));
    } catch {
      return res.status(200).json({ raw: text });
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: '视频生成超时，请稍后重试' });
    }
    console.error('[generate] Error:', err);
    return res.status(500).json({ error: '服务器内部错误', detail: err.message });
  }
}
