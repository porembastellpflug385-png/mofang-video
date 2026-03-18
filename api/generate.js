/**
 * POST /api/generate
 * 
 * 生产队API视频生成代理
 * 
 * 路由策略（根据文档 https://m9h9dj1gn2.apifox.cn/ ）：
 *   - 统一视频格式:  POST {BASE}/videos/generations  (sora/veo/grok 都支持)
 *   - chat 格式:     POST {BASE}/chat/completions     (备用)
 * 
 * 前端发来的 body 直接透传，后端只负责加 Authorization 和选择端点
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const BASE_URL = process.env.OPENAI_BASE_URL || process.env.API_BASE_URL;
  const API_KEY  = process.env.OPENAI_API_KEY  || process.env.API_KEY;

  if (!BASE_URL || !API_KEY) {
    console.error('Missing env: OPENAI_BASE_URL / OPENAI_API_KEY');
    return res.status(500).json({ error: '服务端配置错误，请检查环境变量' });
  }

  try {
    const body = req.body;
    const model = body.model || '';
    
    // 判断端点：如果 body 中有 messages 数组 → chat/completions
    // 否则（有 prompt 字段） → videos/generations（统一视频格式）
    const isChat = Array.isArray(body.messages);
    const path = isChat ? '/chat/completions' : '/videos/generations';
    const apiUrl = `${BASE_URL}${path}`;
    
    console.log(`[generate] model=${model} format=${isChat ? 'chat' : 'video'} → ${apiUrl}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180000);

    const apiResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
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