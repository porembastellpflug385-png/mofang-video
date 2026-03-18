import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Vercel Serverless API Route - Video Generation Proxy
 * 
 * 作用：将前端请求代理到第三方 API，保护 API Key 不暴露在前端
 * 
 * 环境变量（在 Vercel Dashboard 中配置）：
 *   - API_BASE_URL: 第三方 API 的 base URL (例如 https://api.example.com/v1)
 *   - API_KEY: 第三方 API 的密钥
 */

const TIMEOUT_MS = 120_000; // 2分钟超时

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 只允许 POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const API_BASE_URL = process.env.API_BASE_URL;
  const API_KEY = process.env.API_KEY;

  if (!API_BASE_URL || !API_KEY) {
    console.error('Missing environment variables: API_BASE_URL or API_KEY');
    return res.status(500).json({ error: '服务端配置错误，请检查环境变量' });
  }

  try {
    const body = req.body;

    // 构建请求到第三方 API
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const apiResponse = await fetch(`${API_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      console.error(`API error [${apiResponse.status}]:`, errorText);
      return res.status(apiResponse.status).json({
        error: `API 请求失败 (${apiResponse.status})`,
        detail: errorText,
      });
    }

    const data = await apiResponse.json();
    return res.status(200).json(data);
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: '请求超时，请稍后重试' });
    }
    console.error('Proxy error:', err);
    return res.status(500).json({ error: '服务器内部错误', detail: err.message });
  }
}
