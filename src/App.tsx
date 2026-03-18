import React, { useState, useRef, useCallback } from 'react';
import { Settings, Image as ImageIcon, Video, Download, Trash2, Plus, X, ChevronDown, Play, Loader2, ThumbsUp, ThumbsDown, Share2, MoreHorizontal, Sparkles, Clock, Settings2, AlertCircle, RefreshCw } from 'lucide-react';

// ============ Types ============

type Model = 'sora-2' | 'veo_3_1-4K' | 'veo_3_1-fast-4K' | 'grok-video-3-10s' | 'grok-video-3';
type GenerationMode = 'first-last' | 'omni';
type Ratio = '16:9' | '4:3' | '1:1' | '3:4' | '9:16' | '智能模式';

interface ModelConfig {
  label: string;
  durations: string[];   // 可选时长，空数组表示只有"默认"
  qualities: string[];   // 可选清晰度，空数组表示只有"默认"
}

const MODEL_CONFIGS: Record<Model, ModelConfig> = {
  'sora-2':            { label: 'Sora 2',              durations: ['4秒', '8秒', '12秒'], qualities: [] },
  'veo_3_1-4K':        { label: 'Veo 3.1 4K',         durations: [],                      qualities: [] },
  'veo_3_1-fast-4K':   { label: 'Veo 3.1 Fast 4K',    durations: [],                      qualities: [] },
  'grok-video-3-10s':  { label: 'Grok Video 3 (10s)',  durations: [],                      qualities: [] },
  'grok-video-3':      { label: 'Grok Video 3',        durations: [],                      qualities: [] },
};

interface ImageFile {
  url: string;      // ObjectURL for preview
  base64: string;   // base64 data for API
  mimeType: string; // image/png, image/jpeg etc.
}

interface VideoRecord {
  id: string;
  prompt: string;
  model: Model;
  status: 'generating' | 'completed' | 'failed';
  thumbnailUrl?: string;
  videoUrl?: string;
  createdAt: number;
  ratio?: Ratio;
  mode: GenerationMode;
  params: Record<string, string[]>;
  errorMsg?: string;
  taskId?: string;
  duration?: string;
  quality?: string;
}

// ============ Constants ============

const PARAM_CONFIG = [
  { key: 'classicCamera', title: '经典镜头', options: ['环绕下摇', '环绕推进', '上升推进'], multi: false },
  { key: 'basicCamera', title: '基础镜头', options: ['围绕主体运镜', '固定镜头', '手持镜头', '拉远', '推进', '跟随', '右摇', '上摇', '下摇', '环绕'], multi: false },
  { key: 'speed', title: '运镜速度', options: ['慢速'], multi: false },
  { key: 'shotType', title: '景别', options: ['近景', '中景', '远景', '仰视', '俯视', '景深', '正面视角', '侧面视角', '特写', '无人机拍摄'], multi: false },
  { key: 'lighting', title: '光影', options: ['阳光', '灯光', '柔和光', '霓虹光', '暖光', '自然光', '烛光', '城市夜景'], multi: true },
  { key: 'picture', title: '画面', options: ['丰富细节', '背景简约'], multi: true },
  { key: 'atmosphere', title: '氛围', options: ['神秘', '宁静', '温馨', '生动', '色彩艳丽'], multi: true },
];

const POLL_INTERVAL_MS = 5000;
const MAX_POLL_COUNT = 120;

// ============ Helpers ============

function fileToBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve({ base64, mimeType: file.type || 'image/png' });
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

function buildFullPrompt(prompt: string, params: Record<string, string[]>): string {
  const tags = Object.entries(params)
    .flatMap(([_, values]) => values)
    .filter(Boolean);
  if (tags.length === 0) return prompt;
  return `${prompt}\n\n风格参数：${tags.map(t => `#${t}`).join(' ')}`;
}

function buildMessages(
  prompt: string,
  model: Model,
  ratio: Ratio | undefined,
  mode: GenerationMode,
  params: Record<string, string[]>,
  firstFrame?: ImageFile | null,
  lastFrame?: ImageFile | null,
  omniImages?: ImageFile[],
) {
  const fullPrompt = buildFullPrompt(prompt, params);
  const content: any[] = [];

  if (mode === 'first-last') {
    if (firstFrame) {
      content.push({
        type: 'image_url',
        image_url: { url: `data:${firstFrame.mimeType};base64,${firstFrame.base64}` },
      });
    }
    if (lastFrame) {
      content.push({
        type: 'image_url',
        image_url: { url: `data:${lastFrame.mimeType};base64,${lastFrame.base64}` },
      });
    }
  } else if (mode === 'omni' && omniImages) {
    for (const img of omniImages) {
      content.push({
        type: 'image_url',
        image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
      });
    }
  }

  let textPrompt = fullPrompt;
  if (mode === 'first-last') {
    const ratioStr = ratio && ratio !== '智能模式' ? `，输出比例 ${ratio}` : '';
    const frameDesc = lastFrame ? '根据提供的首帧和尾帧图片' : '根据提供的首帧图片';
    textPrompt = `${frameDesc}${ratioStr}，生成视频：${fullPrompt}`;
  } else {
    textPrompt = `根据提供的参考图片，生成视频：${fullPrompt}`;
  }

  content.push({ type: 'text', text: textPrompt });
  return [{ role: 'user', content }];
}

function extractVideoUrl(data: any): string | null {
  try {
    const choices = data.choices || [];
    for (const choice of choices) {
      const content = choice.message?.content;
      if (typeof content === 'string' && content.startsWith('http')) return content.trim();
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'video_url' || block.type === 'video') {
            return block.video_url?.url || block.url;
          }
        }
      }
    }
    if (data.data?.url) return data.data.url;
    if (data.output?.video_url) return data.output.video_url;
  } catch {}
  return null;
}

/** 将比例字符串转为 Sora 的 size 格式 (WxH) */
function ratioToSize(ratio: Ratio): string {
  const map: Record<string, string> = {
    '16:9': '1280x720',
    '4:3':  '960x720',
    '1:1':  '720x720',
    '3:4':  '720x960',
    '9:16': '720x1280',
  };
  return map[ratio] || '1280x720';
}

const RatioIcon = ({ ratio }: { ratio: string }) => {
  if (ratio === '智能模式') return <Sparkles className="w-4 h-4 mb-1" />;
  const [w, h] = ratio.split(':').map(Number);
  const isWide = w > h;
  return (
    <div className="w-5 h-5 flex items-center justify-center mb-1">
      <div className="border border-current rounded-[2px]" style={{
        width: isWide ? '16px' : `${16 * (w / h)}px`,
        height: isWide ? `${16 * (h / w)}px` : '16px',
      }} />
    </div>
  );
};

// ============ Toast ============

interface ToastMessage { id: string; type: 'success' | 'error' | 'info'; text: string; }

function Toast({ messages, onDismiss }: { messages: ToastMessage[]; onDismiss: (id: string) => void }) {
  if (messages.length === 0) return null;
  return (
    <div className="fixed top-6 right-6 z-[100] space-y-3">
      {messages.map(msg => (
        <div key={msg.id} className={`flex items-center gap-3 px-5 py-3 rounded-2xl border backdrop-blur-xl shadow-2xl text-sm font-medium ${
          msg.type === 'error' ? 'bg-red-500/20 border-red-500/30 text-red-300'
            : msg.type === 'success' ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-300'
            : 'bg-cyan-500/20 border-cyan-500/30 text-cyan-300'
        }`}>
          {msg.type === 'error' && <AlertCircle className="w-4 h-4 shrink-0" />}
          {msg.type === 'success' && <Sparkles className="w-4 h-4 shrink-0" />}
          <span>{msg.text}</span>
          <button onClick={() => onDismiss(msg.id)} className="ml-2 opacity-60 hover:opacity-100"><X className="w-3.5 h-3.5" /></button>
        </div>
      ))}
    </div>
  );
}

// ============ Main App ============

export default function App() {
  const [selectedModel, setSelectedModel] = useState<Model>('veo_3_1-4K');
  const [mode, setMode] = useState<GenerationMode>('first-last');
  const [ratio, setRatio] = useState<Ratio>('智能模式');
  const [duration, setDuration] = useState<string>('默认');
  const [quality, setQuality] = useState<string>('默认');
  const [prompt, setPrompt] = useState('');
  const [firstFrame, setFirstFrame] = useState<ImageFile | null>(null);
  const [lastFrame, setLastFrame] = useState<ImageFile | null>(null);
  const [omniImages, setOmniImages] = useState<ImageFile[]>([]);
  const [showParams, setShowParams] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [params, setParams] = useState<Record<string, string[]>>({
    classicCamera: [], basicCamera: [], speed: [], shotType: [], lighting: [], picture: [], atmosphere: []
  });
  const [videos, setVideos] = useState<VideoRecord[]>([]);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const firstFrameRef = useRef<HTMLInputElement>(null);
  const lastFrameRef = useRef<HTMLInputElement>(null);
  const omniRef = useRef<HTMLInputElement>(null);
  const pollTimerRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const currentModelConfig = MODEL_CONFIGS[selectedModel];

  const handleModelChange = (model: Model) => {
    setSelectedModel(model);
    // 切换模型时重置时长和清晰度
    const config = MODEL_CONFIGS[model];
    setDuration(config.durations.length > 0 ? config.durations[0] : '默认');
    setQuality(config.qualities.length > 0 ? config.qualities[0] : '默认');
  };

  const addToast = useCallback((type: ToastMessage['type'], text: string) => {
    const id = Date.now().toString() + Math.random();
    setToasts(prev => [...prev, { id, type, text }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'first' | 'last' | 'omni') => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      addToast('error', '图片大小不能超过 20MB');
      return;
    }
    try {
      const { base64, mimeType } = await fileToBase64(file);
      const url = URL.createObjectURL(file);
      const imageFile: ImageFile = { url, base64, mimeType };
      if (type === 'first') setFirstFrame(imageFile);
      else if (type === 'last') setLastFrame(imageFile);
      else setOmniImages(prev => [...prev, imageFile]);
    } catch {
      addToast('error', '图片读取失败，请重试');
    }
    e.target.value = '';
  };

  const handleRemoveOmniImage = (index: number) => {
    setOmniImages(prev => {
      const removed = prev[index];
      if (removed?.url) URL.revokeObjectURL(removed.url);
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleParamChange = (key: string, values: string[]) => {
    setParams(prev => ({ ...prev, [key]: values }));
  };

  const getSelectedParamsCount = () => Object.values(params).flat().length;

  const updateVideo = useCallback((id: string, updates: Partial<VideoRecord>) => {
    setVideos(prev => prev.map(v => v.id === id ? { ...v, ...updates } : v));
  }, []);

  const startPolling = useCallback((videoId: string, taskId: string, model: string) => {
    let count = 0;
    const poll = async () => {
      count++;
      if (count > MAX_POLL_COUNT) {
        updateVideo(videoId, { status: 'failed', errorMsg: '生成超时，请重试' });
        setIsGenerating(false);
        addToast('error', '视频生成超时');
        return;
      }
      try {
        const res = await fetch(`/api/task?id=${encodeURIComponent(taskId)}&model=${encodeURIComponent(model)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || data.detail || '查询失败');

        // 兼容多种返回格式
        const status = (data.status || data.data?.status || '').toLowerCase();
        
        // 提取视频URL —— 兼容各种格式
        let videoUrl: string | null = null;
        // Sora 格式: 需要额外请求 /videos/{id}/content 获取下载链接
        // 但有些中转站会直接在 task_result 中返回
        videoUrl = data.video_url 
          || data.data?.video_url 
          || data.data?.videos?.[0]?.url  // Veo 格式
          || data.task_result?.video_url
          || data.task_result?.url
          || extractVideoUrl(data);

        if (status === 'completed' || status === 'success' || status === 'Completed') {
          // 如果还没有 videoUrl，可能需要从 content 端点获取
          if (!videoUrl && data.id) {
            // 尝试拼接内容下载 URL
            videoUrl = `/api/content?id=${encodeURIComponent(data.id)}&model=${encodeURIComponent(model)}`;
          }
          updateVideo(videoId, { status: 'completed', videoUrl: videoUrl || undefined, thumbnailUrl: data.thumbnail_url || data.data?.thumbnail_url });
          setIsGenerating(false);
          addToast('success', '视频生成完成！');
          return;
        }
        if (status === 'failed' || status === 'error') {
          const errMsg = data.error?.message || data.error || data.message || data.data?.error || '生成失败';
          updateVideo(videoId, { status: 'failed', errorMsg: typeof errMsg === 'string' ? errMsg : '生成失败' });
          setIsGenerating(false);
          addToast('error', '视频生成失败');
          return;
        }
        // queued / in_progress / processing → 继续轮询
        pollTimerRef.current[videoId] = setTimeout(poll, POLL_INTERVAL_MS);
      } catch (err: any) {
        if (count < 5) {
          pollTimerRef.current[videoId] = setTimeout(poll, POLL_INTERVAL_MS * 2);
        } else {
          updateVideo(videoId, { status: 'failed', errorMsg: err.message });
          setIsGenerating(false);
          addToast('error', `查询状态失败: ${err.message}`);
        }
      }
    };
    pollTimerRef.current[videoId] = setTimeout(poll, POLL_INTERVAL_MS);
  }, [updateVideo, addToast]);

  const handleGenerate = async () => {
    if (mode === 'first-last' && !firstFrame) { addToast('error', '请至少上传首帧图'); return; }
    if (mode === 'omni' && omniImages.length === 0) { addToast('error', '请至少上传一张参考图'); return; }
    if (!prompt.trim()) { addToast('error', '请输入提示词'); return; }

    const videoId = Date.now().toString();
    const newVideo: VideoRecord = {
      id: videoId, prompt, model: selectedModel, status: 'generating', createdAt: Date.now(),
      ratio: mode === 'first-last' ? ratio : undefined, mode, params: { ...params },
      duration: duration !== '默认' ? duration : undefined,
      quality: quality !== '默认' ? quality : undefined,
    };
    setVideos(prev => [newVideo, ...prev]);
    setIsGenerating(true);

    try {
      // 构建完整 prompt（含风格参数标签）
      const fullPrompt = buildFullPrompt(prompt, params);

      // 构建请求体 —— 发送给 /api/generate，后端会根据 model 路由到正确端点
      const requestBody: any = {
        model: selectedModel,
        prompt: fullPrompt,
      };

      // Sora 系列参数
      if (selectedModel.startsWith('sora')) {
        // seconds: "4秒" -> "4"
        if (duration !== '默认') {
          requestBody.seconds = String(parseInt(duration));
        }
        // size: ratio -> WxH 格式
        if (mode === 'first-last' && ratio && ratio !== '智能模式') {
          requestBody.size = ratioToSize(ratio);
        }
        // 首帧图片作为 input_reference (需要是 URL 或 base64 data URI)
        if (firstFrame) {
          requestBody.input_reference = `data:${firstFrame.mimeType};base64,${firstFrame.base64}`;
        }
      }

      // Veo / Grok 系列参数
      if (selectedModel.startsWith('veo') || selectedModel.startsWith('grok-video')) {
        if (mode === 'first-last' && ratio && ratio !== '智能模式') {
          requestBody.aspect_ratio = ratio;
        }
        // 图片参考
        if (firstFrame) {
          requestBody.image = `data:${firstFrame.mimeType};base64,${firstFrame.base64}`;
        }
        if (duration !== '默认') {
          requestBody.duration = parseInt(duration);
        }
        if (quality !== '默认') {
          requestBody.quality = quality;
        }
      }

      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.detail || `请求失败 (${res.status})`);

      // 视频 API 通常返回异步任务，需要轮询
      // 返回格式: { id: "xxx", status: "queued", ... }
      const taskId = data.id || data.task_id || data.data?.task_id || data.data?.id;
      
      // 也可能同步返回了视频URL
      const videoUrl = data.video_url 
        || data.data?.video_url 
        || data.data?.videos?.[0]?.url
        || extractVideoUrl(data);

      if (videoUrl) {
        updateVideo(videoId, { status: 'completed', videoUrl });
        setIsGenerating(false);
        addToast('success', '视频生成完成！');
      } else if (taskId) {
        updateVideo(videoId, { taskId });
        startPolling(videoId, taskId, selectedModel);
        addToast('info', '任务已提交，正在生成中...');
      } else {
        throw new Error('API 返回格式异常，未获取到视频或任务ID。返回内容：' + JSON.stringify(data).slice(0, 200));
      }
    } catch (err: any) {
      console.error('Generate error:', err);
      updateVideo(videoId, { status: 'failed', errorMsg: err.message });
      setIsGenerating(false);
      addToast('error', `生成失败: ${err.message}`);
    }
  };

  const handleRetry = (video: VideoRecord) => {
    setPrompt(video.prompt);
    setSelectedModel(video.model);
    if (video.mode) setMode(video.mode);
    if (video.ratio) setRatio(video.ratio);
    if (video.params) setParams(video.params);
    setDuration(video.duration || '默认');
    setQuality(video.quality || '默认');
    addToast('info', '已恢复参数，请点击生成');
  };

  const handleDelete = (id: string) => {
    if (confirm('确定要删除这条记录吗？')) {
      if (pollTimerRef.current[id]) { clearTimeout(pollTimerRef.current[id]); delete pollTimerRef.current[id]; }
      setVideos(prev => prev.filter(v => v.id !== id));
    }
  };

  const handleDownload = async (video: VideoRecord) => {
    if (!video.videoUrl) return;
    try {
      const response = await fetch(video.videoUrl);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `video-${video.id}.mp4`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      const a = document.createElement('a');
      a.href = video.videoUrl; a.download = `video-${video.id}.mp4`; a.target = '_blank';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    }
  };

  return (
    <>
      <Toast messages={toasts} onDismiss={dismissToast} />

      {/* Background */}
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none bg-black">
        <div className="absolute top-[-20%] left-[-10%] w-[70vw] h-[70vw] bg-cyan-900/20 blur-[120px] rounded-full mix-blend-screen animate-float-slow" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[60vw] h-[60vw] bg-blue-900/20 blur-[120px] rounded-full mix-blend-screen animate-float-medium" />
        <div className="absolute top-[40%] left-[40%] w-[30vw] h-[30vw] bg-purple-900/20 blur-[100px] rounded-full mix-blend-screen animate-float-fast" />
      </div>

      <div className="relative z-10 flex h-screen text-white/90 font-sans overflow-hidden selection:bg-cyan-500/30">
        
        {/* Left Panel */}
        <div className="w-[400px] flex flex-col bg-white/[0.02] backdrop-blur-3xl border-r border-white/10 shrink-0 shadow-[4px_0_24px_rgba(0,0,0,0.5)] z-20">
        
        {/* Model Selector */}
        <div className="p-5 border-b border-white/10">
          <div className="relative group">
            <select value={selectedModel} onChange={e => handleModelChange(e.target.value as Model)}
              className="w-full appearance-none bg-black/40 border border-white/10 text-white py-3 pl-4 pr-10 rounded-2xl focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 text-sm font-medium cursor-pointer transition-all shadow-inner group-hover:bg-black/60">
              {(Object.keys(MODEL_CONFIGS) as Model[]).map(m => (
                <option key={m} value={m}>{MODEL_CONFIGS[m].label}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-cyan-400 pointer-events-none group-hover:text-cyan-300 transition-colors" />
          </div>
        </div>

        {/* Controls */}
        <div className="flex-1 overflow-y-auto p-5 space-y-8 scrollbar-hide">
          
          {/* Mode */}
          <div className="flex bg-black/40 p-1 rounded-2xl border border-white/5 shadow-inner">
            <button className={`flex-1 py-2.5 text-sm rounded-xl transition-all duration-300 font-medium ${mode === 'first-last' ? 'bg-white/10 text-cyan-300 shadow-[0_2px_8px_rgba(0,0,0,0.5)]' : 'text-white/50 hover:text-white/80'}`}
              onClick={() => setMode('first-last')}>首尾帧模式</button>
            <button className={`flex-1 py-2.5 text-sm rounded-xl transition-all duration-300 font-medium ${mode === 'omni' ? 'bg-white/10 text-cyan-300 shadow-[0_2px_8px_rgba(0,0,0,0.5)]' : 'text-white/50 hover:text-white/80'}`}
              onClick={() => setMode('omni')}>全能参考模式</button>
          </div>

          {/* Image Upload */}
          <div>
            {mode === 'first-last' ? (
              <div className="flex space-x-4">
                <div onClick={() => firstFrameRef.current?.click()}
                  className="flex-1 aspect-video bg-white/5 rounded-2xl border border-white/10 flex flex-col items-center justify-center cursor-pointer hover:border-cyan-500/50 hover:bg-white/10 hover:shadow-[0_0_20px_rgba(34,211,238,0.15)] transition-all duration-300 relative overflow-hidden group">
                  {firstFrame ? (
                    <>
                      <img src={firstFrame.url} className="w-full h-full object-cover" alt="首帧" />
                      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300">
                        <span className="text-xs font-medium text-white bg-white/20 px-3 py-1.5 rounded-full">更换首帧</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform duration-300">
                        <ImageIcon className="w-5 h-5 text-cyan-400" />
                      </div>
                      <span className="text-xs font-medium text-white/60 group-hover:text-cyan-300 transition-colors">添加首帧图</span>
                    </>
                  )}
                  <input type="file" ref={firstFrameRef} className="hidden" accept="image/*" onChange={e => handleFileUpload(e, 'first')} />
                </div>
                <div onClick={() => lastFrameRef.current?.click()}
                  className="flex-1 aspect-video bg-white/5 rounded-2xl border border-white/10 flex flex-col items-center justify-center cursor-pointer hover:border-cyan-500/50 hover:bg-white/10 hover:shadow-[0_0_20px_rgba(34,211,238,0.15)] transition-all duration-300 relative overflow-hidden group">
                  {lastFrame ? (
                    <>
                      <img src={lastFrame.url} className="w-full h-full object-cover" alt="尾帧" />
                      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300">
                        <span className="text-xs font-medium text-white bg-white/20 px-3 py-1.5 rounded-full">更换尾帧</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform duration-300">
                        <ImageIcon className="w-5 h-5 text-white/40 group-hover:text-cyan-400 transition-colors" />
                      </div>
                      <span className="text-xs font-medium text-white/40 group-hover:text-cyan-300 transition-colors">添加尾帧图(可选)</span>
                    </>
                  )}
                  <input type="file" ref={lastFrameRef} className="hidden" accept="image/*" onChange={e => handleFileUpload(e, 'last')} />
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-4 gap-3">
                  {omniImages.map((img, idx) => (
                    <div key={idx} className="aspect-square bg-white/5 rounded-2xl relative overflow-hidden group border border-white/10 shadow-lg">
                      <img src={img.url} className="w-full h-full object-cover" alt={`图${idx + 1}`} />
                      <div className="absolute top-1.5 left-1.5 bg-black/60 backdrop-blur-md px-2 py-0.5 rounded-full text-[10px] font-medium text-cyan-300 border border-white/10">图{idx + 1}</div>
                      <button className="absolute top-1.5 right-1.5 bg-red-500/80 hover:bg-red-500 p-1 rounded-full opacity-0 group-hover:opacity-100 transition-all duration-300 shadow-lg transform scale-90 group-hover:scale-100" 
                        onClick={() => handleRemoveOmniImage(idx)}>
                        <X className="w-3 h-3 text-white"/>
                      </button>
                    </div>
                  ))}
                  <div onClick={() => omniRef.current?.click()}
                    className="aspect-square bg-white/5 rounded-2xl border border-white/10 border-dashed flex flex-col items-center justify-center cursor-pointer hover:border-cyan-500/50 hover:bg-white/10 hover:shadow-[0_0_15px_rgba(34,211,238,0.15)] transition-all duration-300 group">
                    <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                      <Plus className="w-4 h-4 text-cyan-400" />
                    </div>
                  </div>
                </div>
                <input type="file" ref={omniRef} className="hidden" accept="image/*" onChange={e => handleFileUpload(e, 'omni')} />
                <p className="text-[11px] text-cyan-400/60 flex items-center"><Sparkles className="w-3 h-3 mr-1"/> 提示：在提示词中输入 @图1, @图2 引用图片</p>
              </div>
            )}
          </div>

          {/* Prompt */}
          <div className="relative group">
            <textarea value={prompt} onChange={e => setPrompt(e.target.value)}
              placeholder={mode === 'omni' ? "描述视频内容，例如：@图1 的角色，正在 @图2 的场景中奔跑..." : "描述视频内容，支持中文和英文..."}
              className="w-full h-36 bg-black/40 border border-white/10 text-white p-4 rounded-2xl resize-none focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 text-sm transition-all shadow-inner placeholder:text-white/30" />
            <button onClick={() => setShowParams(true)}
              className="absolute bottom-4 right-4 text-xs bg-white/10 hover:bg-cyan-500/20 hover:text-cyan-300 text-white/70 px-3 py-1.5 rounded-xl transition-all duration-300 flex items-center backdrop-blur-md border border-white/5">
              <Settings className="w-3.5 h-3.5 mr-1.5" /> 
              <span className="font-medium">参数设置</span> {getSelectedParamsCount() > 0 && <span className="ml-1.5 bg-cyan-500 text-black font-bold px-1.5 py-0.5 rounded-full text-[10px]">{getSelectedParamsCount()}</span>}
            </button>
          </div>

          {/* Ratio */}
          {mode === 'first-last' && (
            <div className="space-y-3">
              <label className="text-xs font-medium text-white/50 uppercase tracking-wider">生成尺寸</label>
              <div className="grid grid-cols-3 gap-3">
                {(['16:9', '4:3', '1:1', '3:4', '9:16', '智能模式'] as Ratio[]).map(r => (
                  <button key={r} onClick={() => setRatio(r)}
                    className={`py-2.5 flex flex-col items-center justify-center text-xs rounded-xl border transition-all duration-300 font-medium ${ratio === r ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300 shadow-[0_0_15px_rgba(34,211,238,0.15)]' : 'bg-black/40 border-white/5 text-white/50 hover:border-white/20 hover:text-white/80'}`}>
                    <RatioIcon ratio={r} />
                    <span className="mt-1">{r}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Duration & Quality - 根据模型动态显示 */}
          <div className="flex gap-4">
            {/* 时长选择 */}
            <div className="flex-1 space-y-3">
              <label className="text-xs font-medium text-white/50 uppercase tracking-wider">时长</label>
              <div className="flex flex-wrap gap-2">
                {(currentModelConfig.durations.length > 0
                  ? ['默认', ...currentModelConfig.durations]
                  : ['默认']
                ).map(d => (
                  <button key={d} onClick={() => setDuration(d)}
                    className={`px-3 py-2 text-xs rounded-xl border transition-all duration-300 font-medium ${
                      duration === d
                        ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300 shadow-[0_0_15px_rgba(34,211,238,0.15)]'
                        : 'bg-black/40 border-white/5 text-white/50 hover:border-white/20 hover:text-white/80'
                    }`}>
                    {d}
                  </button>
                ))}
              </div>
            </div>
            {/* 清晰度选择 */}
            <div className="flex-1 space-y-3">
              <label className="text-xs font-medium text-white/50 uppercase tracking-wider">清晰度</label>
              <div className="flex flex-wrap gap-2">
                {(currentModelConfig.qualities.length > 0
                  ? ['默认', ...currentModelConfig.qualities]
                  : ['默认']
                ).map(q => (
                  <button key={q} onClick={() => setQuality(q)}
                    className={`px-3 py-2 text-xs rounded-xl border transition-all duration-300 font-medium ${
                      quality === q
                        ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300 shadow-[0_0_15px_rgba(34,211,238,0.15)]'
                        : 'bg-black/40 border-white/5 text-white/50 hover:border-white/20 hover:text-white/80'
                    }`}>
                    {q}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Generate Button */}
        <div className="p-5 border-t border-white/10 bg-black/20 backdrop-blur-xl">
          <button onClick={handleGenerate}
            disabled={isGenerating || (mode === 'first-last' && !firstFrame) || !prompt}
            className="w-full relative overflow-hidden group bg-gradient-to-r from-cyan-600 to-blue-600 text-white font-medium py-3.5 rounded-2xl flex items-center justify-center space-x-2 hover:from-cyan-500 hover:to-blue-500 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_20px_rgba(8,145,178,0.4)]">
            <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
            <div className="relative flex items-center justify-center space-x-2">
              {isGenerating ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span className="text-[15px]">生成中...</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current" />
                  <span className="text-[15px]">生成视频</span>
                </>
              )}
            </div>
          </button>
        </div>
      </div>

      {/* Right Panel - Video Library */}
      <div className="flex-1 overflow-y-auto p-8 scrollbar-hide relative z-10">
        <div className="max-w-5xl mx-auto space-y-8">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-2xl font-semibold tracking-tight text-white/90">视频库</h2>
            <div className="flex items-center space-x-2 text-sm font-medium text-cyan-400/80 bg-cyan-500/10 px-4 py-2 rounded-full border border-cyan-500/20">
              <Clock className="w-4 h-4" />
              <span>生成记录 ({videos.length})</span>
            </div>
          </div>

          {videos.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[60vh] text-white/30">
              <div className="w-24 h-24 mb-6 rounded-full bg-white/5 flex items-center justify-center border border-white/10 shadow-[0_0_30px_rgba(255,255,255,0.02)]">
                <Video className="w-10 h-10 opacity-50" />
              </div>
              <p className="text-lg font-medium tracking-wide">暂无生成记录，快去创作你的第一个视频吧</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
              {videos.map(video => (
                <div key={video.id} className="bg-white/[0.02] rounded-3xl overflow-hidden border border-white/5 shadow-2xl group hover:border-cyan-500/30 hover:shadow-[0_8px_40px_rgba(34,211,238,0.15)] transition-all duration-500 backdrop-blur-sm flex flex-col">
                  
                  {/* Header */}
                  <div className="p-5 flex items-start justify-between border-b border-white/5 bg-black/20">
                    <div className="flex items-start space-x-3">
                      <div className="w-10 h-10 shrink-0 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white font-bold text-sm shadow-lg">U</div>
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap gap-2 items-center">
                          <span className="text-xs font-medium bg-white/10 px-2 py-1 rounded-md text-white/80 border border-white/5">{MODEL_CONFIGS[video.model]?.label || video.model}</span>
                          {video.ratio && <span className="text-xs font-medium bg-white/10 px-2 py-1 rounded-md text-white/80 border border-white/5">{video.ratio}</span>}
                          <span className="text-xs font-medium bg-white/10 px-2 py-1 rounded-md text-white/80 border border-white/5">{video.mode === 'omni' ? '全能参考' : '首尾帧'}</span>
                          {video.duration && <span className="text-xs font-medium bg-violet-500/15 px-2 py-1 rounded-md text-violet-300 border border-violet-500/20">{video.duration}</span>}
                          {video.quality && <span className="text-xs font-medium bg-amber-500/15 px-2 py-1 rounded-md text-amber-300 border border-amber-500/20">{video.quality}</span>}
                        </div>
                        <p className="text-sm text-white/60 line-clamp-2 leading-relaxed" title={video.prompt}>{video.prompt}</p>
                        {Object.values(video.params).flat().length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {Object.values(video.params).flat().map((p, i) => (
                              <span key={i} className="text-[10px] font-medium text-cyan-300 bg-cyan-500/10 px-2 py-0.5 rounded-full border border-cyan-500/20">#{p}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  {/* Player */}
                  <div className="relative aspect-video bg-black/60 flex items-center justify-center overflow-hidden flex-1">
                    {video.status === 'generating' ? (
                      <div className="flex flex-col items-center text-cyan-400/80">
                        <div className="w-10 h-10 border-2 border-cyan-500/30 border-t-cyan-400 rounded-full animate-spin mb-4 shadow-[0_0_20px_rgba(34,211,238,0.2)]" />
                        <span className="text-sm font-medium tracking-wider animate-pulse">AI 正在努力生成中...</span>
                      </div>
                    ) : video.status === 'completed' ? (
                      <>
                        <video src={video.videoUrl} poster={video.thumbnailUrl} controls className="w-full h-full object-contain" />
                        <div className="absolute top-4 left-4 bg-black/60 px-3 py-1.5 rounded-full text-[10px] font-medium text-white backdrop-blur-md border border-white/10 shadow-lg flex items-center">
                          <Sparkles className="w-3 h-3 mr-1 text-cyan-400" />AI 生成
                        </div>
                      </>
                    ) : (
                      <div className="flex flex-col items-center gap-3">
                        <div className="text-red-400/80 text-sm font-medium flex items-center bg-red-500/10 px-4 py-2 rounded-full border border-red-500/20">
                          <AlertCircle className="w-4 h-4 mr-1.5" />{video.errorMsg || '生成失败'}
                        </div>
                        <button onClick={() => handleRetry(video)} className="text-xs text-white/50 hover:text-cyan-300 flex items-center gap-1 transition-colors">
                          <RefreshCw className="w-3 h-3" />恢复参数重试
                        </button>
                      </div>
                    )}
                  </div>
                  
                  {/* Footer */}
                  {video.status === 'completed' && (
                    <div className="p-4 flex items-center justify-between bg-black/20 border-t border-white/5">
                      <div className="text-xs font-medium text-white/40">{new Date(video.createdAt).toLocaleString()}</div>
                      <div className="flex items-center space-x-1">
                        <button className="p-2 text-white/40 hover:text-cyan-400 hover:bg-cyan-500/10 rounded-xl transition-all duration-300"><ThumbsUp className="w-4 h-4"/></button>
                        <button className="p-2 text-white/40 hover:text-cyan-400 hover:bg-cyan-500/10 rounded-xl transition-all duration-300"><ThumbsDown className="w-4 h-4"/></button>
                        <button className="p-2 text-white/40 hover:text-cyan-400 hover:bg-cyan-500/10 rounded-xl transition-all duration-300"><Share2 className="w-4 h-4"/></button>
                        <div className="w-px h-4 bg-white/10 mx-1"></div>
                        <button className="p-2 text-white/40 hover:text-cyan-400 hover:bg-cyan-500/10 rounded-xl transition-all duration-300" onClick={() => handleDownload(video)} title="下载"><Download className="w-4 h-4"/></button>
                        <button className="p-2 text-white/40 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-all duration-300" onClick={() => handleDelete(video.id)} title="删除"><Trash2 className="w-4 h-4"/></button>
                      </div>
                    </div>
                  )}
                  {video.status === 'failed' && (
                    <div className="p-4 flex items-center justify-between bg-black/20 border-t border-white/5">
                      <div className="text-xs font-medium text-white/40">{new Date(video.createdAt).toLocaleString()}</div>
                      <button className="p-2 text-white/40 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-all duration-300" onClick={() => handleDelete(video.id)} title="删除"><Trash2 className="w-4 h-4"/></button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      </div>

      {/* Params Modal */}
      {showParams && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center backdrop-blur-xl">
          <div className="bg-black/80 w-[600px] max-h-[85vh] rounded-3xl flex flex-col border border-white/10 shadow-[0_0_50px_rgba(0,0,0,0.8)] backdrop-blur-2xl">
            <div className="p-6 border-b border-white/10 flex justify-between items-center bg-white/[0.02]">
              <h3 className="text-lg font-semibold tracking-wide text-white/90 flex items-center">
                <Settings2 className="w-5 h-5 mr-2 text-cyan-400" />灵感词库 / 参数设置
              </h3>
              <button onClick={() => setShowParams(false)} className="text-white/40 hover:text-white bg-white/5 hover:bg-white/10 p-2 rounded-full transition-all duration-300"><X className="w-5 h-5"/></button>
            </div>
            <div className="p-8 overflow-y-auto space-y-10 scrollbar-hide">
              {PARAM_CONFIG.map(group => (
                <div key={group.key}>
                  <h4 className="text-sm font-medium text-white/50 mb-4 flex items-center uppercase tracking-wider">
                    {group.title} {group.multi && <span className="ml-3 text-[10px] bg-cyan-500/20 px-2 py-0.5 rounded-full text-cyan-300 border border-cyan-500/30">多选</span>}
                  </h4>
                  <div className="flex flex-wrap gap-3">
                    {group.options.map(opt => {
                      const isSelected = params[group.key]?.includes(opt);
                      return (
                        <button key={opt} onClick={() => {
                          const current = params[group.key] || [];
                          if (group.multi) handleParamChange(group.key, isSelected ? current.filter(x => x !== opt) : [...current, opt]);
                          else handleParamChange(group.key, isSelected ? [] : [opt]);
                        }}
                          className={`px-4 py-2 rounded-xl text-sm border transition-all duration-300 font-medium ${isSelected ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300 shadow-[0_0_15px_rgba(34,211,238,0.15)]' : 'bg-white/5 border-white/5 text-white/60 hover:border-white/20 hover:text-white/90 hover:bg-white/10'}`}>
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="p-5 border-t border-white/10 bg-black/40 flex justify-between items-center rounded-b-3xl backdrop-blur-md">
              <button onClick={() => setParams({ classicCamera: [], basicCamera: [], speed: [], shotType: [], lighting: [], picture: [], atmosphere: [] })}
                className="text-xs text-white/40 hover:text-white/70 transition-colors">重置全部</button>
              <button onClick={() => setShowParams(false)}
                className="px-8 py-2.5 bg-cyan-500 hover:bg-cyan-400 text-black text-sm font-bold rounded-xl transition-all duration-300 shadow-[0_0_20px_rgba(34,211,238,0.3)] hover:shadow-[0_0_30px_rgba(34,211,238,0.5)] transform hover:scale-105">
                确认
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
