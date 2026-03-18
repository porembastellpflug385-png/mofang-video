// @ts-nocheck
/**
 * GET /api/task?id=xxx&model=sora-2
 * 
 * 查询视频生成任务状态
 *   统一:  GET {BASE}/videos/{id}
 *   回退:  GET {BASE}/videos/generations/{id}
 */

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const BASE_URL = process.env.OPENAI_BASE_URL || process.env.API_BASE_URL;
  const API_KEY  = process.env.OPENAI_API_KEY  || process.env.API_KEY;

  if (!BASE_URL || !API_KEY) {
    return res.status(500).json({ error: '服务端配置错误' });
  }

  const taskId = req.query.id;
  const model  = req.query.model || '';

  if (!taskId) {
    return res.status(400).json({ error: '缺少任务 ID' });
  }

  try {
    // 先尝试通用路径
    let apiUrl = `${BASE_URL}/videos/${taskId}`;
    console.log(`[task] polling → ${apiUrl}`);

    let apiResponse = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    // 如果 404，尝试 /videos/generations/{id}
    if (apiResponse.status === 404) {
      const fallbackUrl = `${BASE_URL}/videos/generations/${taskId}`;
      console.log(`[task] fallback → ${fallbackUrl}`);
      apiResponse = await fetch(fallbackUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        },
      });
    }

    const responseText = await apiResponse.text();

    if (!apiResponse.ok) {
      console.error(`[task] Error ${apiResponse.status}:`, responseText.slice(0, 500));
      return res.status(apiResponse.status).json({
        error: `查询失败 (${apiResponse.status})`,
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
    console.error('[task] Error:', err);
    return res.status(500).json({ error: '查询任务状态失败', detail: err.message });
  }
}
