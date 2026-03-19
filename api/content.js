/**
 * GET /api/content?id=xxx
 * 
 * 获取视频内容下载链接
 * GET {BASE}/videos/{id}/content
 */

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const videoId = req.query.id;
  const model = req.query.model || '';
  if (!videoId) {
    return res.status(400).json({ error: '缺少视频 ID' });
  }

  const isSora = model.startsWith('sora');
  const isVeo = model.startsWith('veo');
  const BASE_URL =
    (isSora
      ? process.env.SORA_OPENAI_BASE_URL || process.env.SORA_API_BASE_URL
      : isVeo
        ? process.env.VEO_OPENAI_BASE_URL || process.env.VEO_API_BASE_URL || 'https://ai.t8star.cn/v2'
      : undefined) ||
    process.env.OPENAI_BASE_URL ||
    process.env.API_BASE_URL;
  const API_KEY =
    (isSora
      ? process.env.SORA_OPENAI_API_KEY || process.env.SORA_API_KEY
      : isVeo
        ? process.env.VEO_OPENAI_API_KEY || process.env.VEO_API_KEY
      : undefined) ||
    process.env.OPENAI_API_KEY ||
    process.env.API_KEY;

  if (!BASE_URL || !API_KEY) {
    return res.status(500).json({ error: `服务端配置错误，请检查 ${isSora ? 'SORA_' : isVeo ? 'VEO_' : '默认'} 环境变量` });
  }

  try {
    const apiUrl = `${BASE_URL}/videos/${videoId}/content`;
    const apiResponse = await fetch(apiUrl, {
      method: 'GET',
      headers: { 'Authorization': API_KEY },
      redirect: 'follow',
    });

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      return res.status(apiResponse.status).json({
        error: `获取视频内容失败 (${apiResponse.status})`,
        detail: errorText.slice(0, 500),
      });
    }

    const contentType = apiResponse.headers.get('content-type') || '';

    if (contentType.includes('video') || contentType.includes('octet-stream')) {
      res.setHeader('Content-Type', contentType);
      const buffer = Buffer.from(await apiResponse.arrayBuffer());
      return res.status(200).send(buffer);
    }

    try {
      const data = await apiResponse.json();
      if (data.url) return res.redirect(302, data.url);
      return res.status(200).json(data);
    } catch {
      return res.status(200).send(await apiResponse.text());
    }
  } catch (err) {
    console.error('[content] Error:', err);
    return res.status(500).json({ error: '获取视频内容失败', detail: err.message });
  }
}
