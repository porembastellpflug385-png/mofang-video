# AI Video Generator

AI 视频生成器 — 支持 Sora 2 / Veo 3.1 / Grok Video 等多模型，通过 Vercel Serverless 代理保护 API Key。

## 架构

```
前端 (React + Vite + Tailwind)
  ↓ fetch /api/generate
Vercel Serverless Function (api/generate.ts)
  ↓ Authorization: Bearer $API_KEY
第三方 API (OpenAI 兼容格式)
```

API Key 和 Base URL **仅存在于 Vercel 服务端环境变量中**，前端代码不包含任何密钥。

## Vercel 部署

### 1. 推送代码到 GitHub

### 2. 在 Vercel 中导入项目

### 3. 配置环境变量

在 Vercel Dashboard → Settings → Environment Variables 中添加：

| 变量名 | 说明 | 示例 |
|--------|------|------|
| `API_BASE_URL` | 第三方 API 的 base URL（不带末尾 `/`） | `https://api.example.com/v1` |
| `API_KEY` | 第三方 API 密钥 | `sk-xxx` |

### 4. 部署

Vercel 会自动识别 Vite 项目并构建部署。

## API 兼容说明

本项目使用 **OpenAI 兼容的 chat/completions 格式** 发送请求：

```json
{
  "model": "veo_3_1-4K",
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } },
        { "type": "text", "text": "根据提供的首帧图片，生成视频：..." }
      ]
    }
  ]
}
```

支持两种返回模式：
- **同步返回**：response 中直接包含 `video_url`
- **异步任务**：response 中返回 `task_id`，前端自动轮询 `/api/task?id=xxx`

## 本地开发

```bash
npm install
npm run dev
```

本地开发需要另起一个 Vercel Dev Server 处理 `/api` 路由：

```bash
npx vercel dev --listen 3001
```

## 从原项目的一些改动

1. **安全**：移除了前端硬编码的 API URL 和 GEMINI_API_KEY 暴露
2. **API 代理**：新增 `api/generate.ts` 和 `api/task.ts` 作为 Vercel Serverless 代理
3. **真实 API 调用**：替换 setTimeout mock 为真实的 fetch + 轮询
4. **图片 base64**：上传图片时同时生成 base64 用于 API 传输
5. **错误处理**：Toast 通知系统、失败重试、超时处理
6. **下载优化**：通过 blob 下载避免跨域问题
7. **依赖清理**：移除 `@google/genai`、`express`、`dotenv`、`tsx` 等无用依赖
8. **构建优化**：代码分割 (vendor/icons chunks)
