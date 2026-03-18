/**
 * GET /api/result?id=xxx&model=veo_3_1-fast-4K
 *
 * 用 completion id 查询最终结果。
 * 兼容不同中转实现，优先尝试 chat/completions/{id}，
 * 再尝试 responses/{id}。
 */

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

async function tryFetchJson(apiUrl, apiKey) {
  const response = await fetch(apiUrl, {
    method: 'GET',
    headers: {
      'Authorization': apiKey,
      'Content-Type': 'application/json',
    },
  });

  const text = await response.text();
  return { response, text };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const id = req.query.id;
  const model = req.query.model || '';

  if (!id) {
    return res.status(400).json({ error: '缺少结果 ID' });
  }

  const { baseUrl: BASE_URL, apiKey: API_KEY } = getApiConfigForModel(model);
  if (!BASE_URL || !API_KEY) {
    return res.status(500).json({ error: `服务端配置错误，请检查 ${model.startsWith('sora') ? 'SORA_' : '默认'} 环境变量` });
  }

  const paths = [
    `/chat/completions/${id}`,
    `/responses/${id}`,
  ];

  try {
    let lastError = null;

    for (const path of paths) {
      const apiUrl = `${BASE_URL}${path}`;
      const { response, text } = await tryFetchJson(apiUrl, API_KEY);

      if (response.ok) {
        try {
          return res.status(200).json(JSON.parse(text));
        } catch {
          return res.status(200).json({ raw: text });
        }
      }

      lastError = {
        status: response.status,
        text,
      };

      if (response.status !== 404) {
        break;
      }
    }

    return res.status(lastError?.status || 404).json({
      error: `查询结果失败 (${lastError?.status || 404})`,
      detail: String(lastError?.text || '').slice(0, 500),
    });
  } catch (err) {
    console.error('[result] Error:', err);
    return res.status(500).json({ error: '查询结果失败', detail: err.message });
  }
}
