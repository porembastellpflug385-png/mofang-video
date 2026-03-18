/**
 * GET /api/task?id=xxx&model=sora-2
 * 
 * 查询视频生成任务状态
 * 
 * 端点：
 *   - sora / veo_ 系列: GET {BASE}/videos/{id}
 *   - 视频统一格式:     GET {BASE}/videos/generations/{id}
 *   - 回退自动尝试两个
 * 
 * 重要：此平台 Authorization 不带 Bearer 前缀！
 */

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const taskId = req.query.id;
  const model  = req.query.model || '';

  if (!taskId) {
    return res.status(400).json({ error: '缺少任务 ID' });
  }

  const isSora = model.startsWith('sora');
  const BASE_URL =
    (isSora
      ? process.env.SORA_OPENAI_BASE_URL || process.env.SORA_API_BASE_URL
      : undefined) ||
    process.env.OPENAI_BASE_URL ||
    process.env.API_BASE_URL;
  const API_KEY =
    (isSora
      ? process.env.SORA_OPENAI_API_KEY || process.env.SORA_API_KEY
      : undefined) ||
    process.env.OPENAI_API_KEY ||
    process.env.API_KEY;

  if (!BASE_URL || !API_KEY) {
    return res.status(500).json({ error: `服务端配置错误，请检查 ${isSora ? 'SORA_' : '默认'} 环境变量` });
  }

  const headers = {
    'Authorization': API_KEY,
    'Content-Type': 'application/json',
  };

  // 根据模型选择轮询端点
  let primaryPath, fallbackPath;
  if (model.startsWith('sora') || model.startsWith('veo_')) {
    // openAI视频格式
    primaryPath = `/videos/${taskId}`;
    fallbackPath = `/videos/generations/${taskId}`;
  } else {
    // 视频统一格式
    primaryPath = `/videos/generations/${taskId}`;
    fallbackPath = `/videos/${taskId}`;
  }

  try {
    let apiUrl = `${BASE_URL}${primaryPath}`;
    console.log(`[task] polling → ${apiUrl}`);

    let apiResponse = await fetch(apiUrl, { method: 'GET', headers });

    // 如果 404，尝试备用路径
    if (apiResponse.status === 404 && fallbackPath) {
      apiUrl = `${BASE_URL}${fallbackPath}`;
      console.log(`[task] fallback → ${apiUrl}`);
      apiResponse = await fetch(apiUrl, { method: 'GET', headers });
    }

    const responseText = await apiResponse.text();

    if (!apiResponse.ok) {
      return res.status(apiResponse.status).json({
        error: `查询失败 (${apiResponse.status})`,
        detail: responseText.slice(0, 500),
      });
    }

    try {
      return res.status(200).json(JSON.parse(responseText));
    } catch {
      return res.status(200).json({ raw: responseText });
    }
  } catch (err) {
    console.error('[task] Error:', err);
    return res.status(500).json({ error: '查询任务状态失败', detail: err.message });
  }
}
