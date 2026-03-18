import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Vercel Serverless API Route - Video Content Download
 * 
 * Sora API 需要通过 GET /videos/{id}/content 获取视频下载链接
 * 
 * GET /api/content?id=xxx&model=sora-2
 */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const BASE_URL = process.env.OPENAI_BASE_URL || process.env.API_BASE_URL;
  const API_KEY  = process.env.OPENAI_API_KEY  || process.env.API_KEY;

  if (!BASE_URL || !API_KEY) {
    return res.status(500).json({ error: '服务端配置错误' });
  }

  const videoId = req.query.id as string;
  if (!videoId) {
    return res.status(400).json({ error: '缺少视频 ID' });
  }

  try {
    const apiUrl = `${BASE_URL}/videos/${videoId}/content`;
    
    const apiResponse = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
      },
      redirect: 'follow',
    });

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      return res.status(apiResponse.status).json({
        error: `获取视频内容失败 (${apiResponse.status})`,
        detail: errorText,
      });
    }

    // 可能返回重定向到视频 URL 或直接返回视频流
    const contentType = apiResponse.headers.get('content-type') || '';
    
    if (contentType.includes('video') || contentType.includes('octet-stream')) {
      // 直接转发视频流
      res.setHeader('Content-Type', contentType);
      const buffer = await apiResponse.arrayBuffer();
      return res.status(200).send(Buffer.from(buffer));
    }

    // 可能返回 JSON 包含下载 URL
    const data = await apiResponse.json();
    if (data.url) {
      return res.redirect(302, data.url);
    }

    return res.status(200).json(data);
  } catch (err: any) {
    console.error('[content] Error:', err);
    return res.status(500).json({ error: '获取视频内容失败', detail: err.message });
  }
}
