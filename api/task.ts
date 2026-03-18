import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Vercel Serverless API Route - Task Status Polling
 * 
 * 用于轮询视频生成任务的状态
 * GET /api/task?id=xxx
 */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

 const API_BASE_URL = process.env.OPENAI_BASE_URL;  // 匹配你设置的环境变量
const API_KEY = process.env.OPENAI_API_KEY;        // 需要设置这个

  if (!API_BASE_URL || !API_KEY) {
    return res.status(500).json({ error: '服务端配置错误' });
  }

  const taskId = req.query.id as string;
  if (!taskId) {
    return res.status(400).json({ error: '缺少任务 ID' });
  }

  try {
    const apiResponse = await fetch(`${API_BASE_URL}/tasks/${taskId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      return res.status(apiResponse.status).json({
        error: `查询失败 (${apiResponse.status})`,
        detail: errorText,
      });
    }

    const data = await apiResponse.json();
    return res.status(200).json(data);
  } catch (err: any) {
    console.error('Task polling error:', err);
    return res.status(500).json({ error: '查询任务状态失败', detail: err.message });
  }
}
