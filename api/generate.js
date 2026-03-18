/**
 * POST /api/generate
 * 
 * 生产队API - 所有视频模型统一走 /chat/completions
 * 返回格式: choices[0].message.content 包含视频URL(markdown格式)
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
    const apiUrl = `${BASE_URL}/chat/completions`;

    console.log(`[generate] model=${body.model} → ${apiUrl}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 300000); // 5分钟超时（视频生成耗时较长）

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