import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Vercel Serverless API Route - Task Status Polling
 * 
 * 根据不同模型查询对应的任务端点
 * 
 * GET /api/task?id=xxx&model=sora-2
 * 
 * 端点映射：
 *   - Sora:   GET {BASE_URL}/videos/{id}
 *   - Veo:    GET {BASE_URL}/videos/generations/{id}  或  {BASE_URL}/videos/{id}
 *   - 通用:   GET {BASE_URL}/videos/{id}
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

  const taskId = req.query.id as string;
  const model  = (req.query.model as string) || '';

  if (!taskId) {
    return res.status(400).json({ error: '缺少任务 ID' });
  }

  // 根据模型决定查询端点
  let pollPath: string;
  if (model.startsWith('veo') || model.startsWith('grok-video')) {
    // 先尝试 /videos/{id}，大多数第三方中转统一用这个
    pollPath = `/videos/${taskId}`;
  } else {
    // Sora / 通用: GET /videos/{id}
    pollPath = `/videos/${taskId}`;
  }

  try {
    const apiUrl = `${BASE_URL}${pollPath}`;
    console.log(`[task] polling → ${apiUrl}`);

    const apiResponse = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    const responseText = await apiResponse.text();

    if (!apiResponse.ok) {
      // 如果 /videos/{id} 404，尝试 /videos/generations/{id}
      if (apiResponse.status === 404 && (model.startsWith('veo') || model.startsWith('grok-video'))) {
        const fallbackUrl = `${BASE_URL}/videos/generations/${taskId}`;
        console.log(`[task] fallback polling → ${fallbackUrl}`);
        
        const fallbackRes = await fetch(fallbackUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json',
          },
        });

        if (fallbackRes.ok) {
          const data = await fallbackRes.json();
          return res.status(200).json(data);
        }
      }

      console.error(`[task] API error [${apiResponse.status}]:`, responseText);
      return res.status(apiResponse.status).json({
        error: `查询失败 (${apiResponse.status})`,
        detail: responseText,
      });
    }

    try {
      const data = JSON.parse(responseText);
      return res.status(200).json(data);
    } catch {
      return res.status(200).json({ raw: responseText });
    }
  } catch (err: any) {
    console.error('[task] Polling error:', err);
    return res.status(500).json({ error: '查询任务状态失败', detail: err.message });
  }
}
