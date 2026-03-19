/**
 * GET /api/content?id=xxx
 * 
 * 获取视频内容下载链接
 * GET {BASE}/videos/{id}/content
 */

function extractMediaUrl(data) {
  return (
    data?.video_url ||
    data?.url ||
    data?.download_url ||
    data?.content_url ||
    data?.data?.video_url ||
    data?.data?.url ||
    data?.data?.download_url ||
    data?.data?.content_url ||
    data?.data?.video?.url ||
    data?.data?.result?.url ||
    data?.data?.result?.video_url ||
    data?.data?.output?.url ||
    data?.data?.output?.video_url ||
    data?.data?.videos?.[0]?.url ||
    data?.data?.videos?.[0]?.video_url ||
    data?.data?.videos?.[0]?.download_url ||
    data?.data?.videos?.[0]?.content_url ||
    data?.data?.videos?.[0]?.signed_url ||
    data?.data?.assets?.[0]?.url ||
    data?.data?.assets?.[0]?.download_url ||
    data?.data?.assets?.[0]?.signed_url ||
    data?.task_result?.url ||
    data?.task_result?.video_url ||
    data?.task_result?.videos?.[0]?.url ||
    data?.task_result?.videos?.[0]?.video_url ||
    data?.task_result?.videos?.[0]?.download_url ||
    data?.task_result?.videos?.[0]?.signed_url ||
    data?.task_result?.assets?.[0]?.url ||
    data?.task_result?.assets?.[0]?.download_url ||
    data?.task_result?.assets?.[0]?.signed_url ||
    data?.result?.url ||
    data?.result?.video_url ||
    data?.result?.videos?.[0]?.url ||
    data?.result?.videos?.[0]?.video_url ||
    data?.result?.assets?.[0]?.url ||
    data?.output?.url ||
    data?.output?.video_url ||
    data?.output?.videos?.[0]?.url ||
    data?.output?.videos?.[0]?.video_url ||
    data?.output?.assets?.[0]?.url ||
    null
  );
}

function extractMediaId(data) {
  return (
    data?.video_id ||
    data?.file_id ||
    data?.content_id ||
    data?.output_id ||
    data?.data?.video_id ||
    data?.data?.file_id ||
    data?.data?.content_id ||
    data?.data?.output_id ||
    data?.data?.video?.id ||
    data?.data?.videos?.[0]?.id ||
    data?.data?.assets?.[0]?.id ||
    data?.task_result?.video_id ||
    data?.task_result?.file_id ||
    data?.task_result?.content_id ||
    data?.task_result?.output_id ||
    data?.task_result?.video?.id ||
    data?.task_result?.videos?.[0]?.id ||
    data?.task_result?.assets?.[0]?.id ||
    data?.result?.video_id ||
    data?.result?.file_id ||
    data?.result?.videos?.[0]?.id ||
    data?.result?.assets?.[0]?.id ||
    data?.output?.video_id ||
    data?.output?.file_id ||
    data?.output?.videos?.[0]?.id ||
    data?.output?.assets?.[0]?.id ||
    null
  );
}

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
    const fetchBinaryOrRedirect = async (targetId) => {
      const contentPaths = isVeo
        ? [`/videos/generations/${targetId}/content`, `/videos/${targetId}/content`]
        : [`/videos/${targetId}/content`];

      let contentResponse = null;
      let contentText = '';

      for (const path of contentPaths) {
        const apiUrl = `${BASE_URL}${path}`;
        contentResponse = await fetch(apiUrl, {
          method: 'GET',
          headers: { 'Authorization': API_KEY },
          redirect: 'follow',
        });

        if (contentResponse.ok) break;

        contentText = await contentResponse.text();
        if (contentResponse.status !== 404) {
          return {
            ok: false,
            status: contentResponse.status,
            detail: contentText,
          };
        }
      }

      if (!contentResponse || !contentResponse.ok) {
        return {
          ok: false,
          status: contentResponse?.status || 404,
          detail: contentText,
        };
      }

      const contentType = contentResponse.headers.get('content-type') || '';

      if (contentType.includes('video') || contentType.includes('octet-stream')) {
        res.setHeader('Content-Type', contentType);
        const buffer = Buffer.from(await contentResponse.arrayBuffer());
        return res.status(200).send(buffer);
      }

      try {
        const data = await contentResponse.json();
        const mediaUrl = extractMediaUrl(data);
        if (mediaUrl) return res.redirect(302, mediaUrl);
        return res.status(200).json(data);
      } catch {
        const text = await contentResponse.text();
        if (/^https?:\/\//.test(text.trim())) {
          return res.redirect(302, text.trim());
        }
        return res.status(200).send(text);
      }
    };

    const paths = isVeo
      ? [`/videos/generations/${videoId}/content`, `/videos/${videoId}/content`]
      : [`/videos/${videoId}/content`];

    let apiResponse = null;
    let responseText = '';

    for (const path of paths) {
      const apiUrl = `${BASE_URL}${path}`;
      apiResponse = await fetch(apiUrl, {
        method: 'GET',
        headers: { 'Authorization': API_KEY },
        redirect: 'follow',
      });

      if (apiResponse.ok) {
        break;
      }

      responseText = await apiResponse.text();
      if (apiResponse.status !== 404) {
        return res.status(apiResponse.status).json({
          error: `获取视频内容失败 (${apiResponse.status})`,
          detail: responseText.slice(0, 500),
        });
      }
    }

    if (!apiResponse || !apiResponse.ok) {
      const detailPaths = isVeo
        ? [`/videos/generations/${videoId}`, `/videos/${videoId}`]
        : [`/videos/${videoId}`];

      for (const path of detailPaths) {
        const detailUrl = `${BASE_URL}${path}`;
        const detailResponse = await fetch(detailUrl, {
          method: 'GET',
          headers: {
            'Authorization': API_KEY,
            'Content-Type': 'application/json',
          },
        });

        const detailText = await detailResponse.text();
        if (!detailResponse.ok) continue;

        try {
          const detailData = JSON.parse(detailText);
          const mediaUrl = extractMediaUrl(detailData);
          if (mediaUrl) {
            return res.redirect(302, mediaUrl);
          }
          const mediaId = extractMediaId(detailData);
          if (mediaId && mediaId !== videoId) {
            return await fetchBinaryOrRedirect(mediaId);
          }
        } catch {
          if (/^https?:\/\//.test(detailText.trim())) {
            return res.redirect(302, detailText.trim());
          }
        }
      }

      return res.status(apiResponse?.status || 404).json({
        error: `获取视频内容失败 (${apiResponse?.status || 404})`,
        detail: responseText.slice(0, 500),
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
      const mediaUrl = extractMediaUrl(data);
      if (mediaUrl) return res.redirect(302, mediaUrl);
      const mediaId = extractMediaId(data);
      if (mediaId && mediaId !== videoId) {
        return await fetchBinaryOrRedirect(mediaId);
      }
      return res.status(200).json(data);
    } catch {
      return res.status(200).send(await apiResponse.text());
    }
  } catch (err) {
    console.error('[content] Error:', err);
    return res.status(500).json({ error: '获取视频内容失败', detail: err.message });
  }
}
