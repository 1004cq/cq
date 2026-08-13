import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { uploadFileToCos } from './mediaUpload';
import type { VisibilityType } from './types';

const PostComposer: React.FC<{
  onClose: () => void;
  onPost: (content: string, images: string[], location: string, visibility: VisibilityType) => Promise<void> | void;
  initialMode?: 'photo' | 'camera' | 'video' | 'text';
}> = ({ onClose, onPost, initialMode = 'photo' }) => {
  const [text, setText] = useState('');
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [location, setLocation] = useState('');
  const [visibility, setVisibility] = useState<VisibilityType>('friends');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0); // 0-100 上传进度
  const [uploadStatusText, setUploadStatusText] = useState(''); // 上传状态文字
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [selectedVideo, setSelectedVideo] = useState<File | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string>('');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const remaining = 9 - selectedImages.length;
    const toProcess = files.slice(0, remaining);
    toProcess.forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        if (dataUrl) {
          setSelectedImages(prev => prev.length < 9 ? [...prev, dataUrl] : prev);
          setSelectedFiles(prev => prev.length < 9 ? [...prev, file] : prev);
        }
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const handleVideoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // 释放上一个预览 URL（避免频繁选视频造成内存泄露）
    if (videoPreviewUrl) { try { URL.revokeObjectURL(videoPreviewUrl); } catch {} }
    setSelectedVideo(file);
    setVideoPreviewUrl(URL.createObjectURL(file));
    setSelectedImages([]);
    setSelectedFiles([]);
    e.target.value = '';
  };

  // 发布页卸载时释放预览 URL
  useEffect(() => () => { if (videoPreviewUrl) { try { URL.revokeObjectURL(videoPreviewUrl); } catch {} } }, [videoPreviewUrl]);

  const handleCameraChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      if (dataUrl) {
        setSelectedImages(prev => prev.length < 9 ? [...prev, dataUrl] : prev);
        setSelectedFiles(prev => prev.length < 9 ? [...prev, file] : prev);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const hasTriggered = useRef(false);
  useEffect(() => {
    if (hasTriggered.current) return;
    hasTriggered.current = true;
    setTimeout(() => {
      if (initialMode === 'photo') fileInputRef.current?.click();
      else if (initialMode === 'camera') cameraInputRef.current?.click();
      else if (initialMode === 'video') videoInputRef.current?.click();
    }, 100);
  }, [initialMode]);

  const isTextOnly = initialMode === 'text';
  const canPost = !uploading && (text.trim().length > 0 || selectedImages.length > 0 || selectedVideo !== null);

  const handlePublish = async () => {
    if (!canPost) return;
    setUploading(true);
    setUploadProgress(0);
    setUploadStatusText('准备上传...');
    // 用一个统一的 loading toast 跟踪整个流程，避免界面被多个 toast 挤满
    const loadingToastId = toast.loading('准备上传...');
    // 节流：仅在进度崑超 5% 或 距上次 ≥1s 才更新一次 toast / state，
    // 避免 cos-js-sdk 分片上传 onProgress 高频回调导致渲染风暴，以及看上去“一直在加载”
    let lastShownPercent = -1;
    let lastShownAt = 0;
    const shouldShow = (p: number) => {
      const now = Date.now();
      if (p >= 100) return true;
      if (p - lastShownPercent >= 5 || now - lastShownAt >= 800) {
        lastShownPercent = p;
        lastShownAt = now;
        return true;
      }
      return false;
    };
    try {
      let uploadedMedia: string[] = [];
      if (selectedVideo) {
        const fileSizeMB = (selectedVideo.size / 1024 / 1024).toFixed(1);
        setUploadStatusText(`正在上传视频 (${fileSizeMB}MB)...`);
        toast.loading(`正在上传视频 (${fileSizeMB}MB)...`, { id: loadingToastId });
        const videoUrl = await uploadFileToCos(selectedVideo, 'moment_video', (p) => {
          if (!shouldShow(p)) return;
          setUploadProgress(p);
          setUploadStatusText(`正在上传视频 ${p}%`);
          toast.loading(`正在上传视频 ${p}%`, { id: loadingToastId });
        });
        uploadedMedia = [videoUrl];
        toast.success('视频上传成功，正在发布…', { id: loadingToastId });
      } else if (selectedFiles.length > 0) {
        const totalFiles = selectedFiles.length;
        let completedFiles = 0;
        setUploadStatusText(`正在上传图片 0/${totalFiles}`);
        toast.loading(`正在上传图片 0/${totalFiles}`, { id: loadingToastId });
        uploadedMedia = [];
        for (let i = 0; i < selectedFiles.length; i++) {
          const file = selectedFiles[i];
          // 每张图片重置节流
          lastShownPercent = -1;
          lastShownAt = 0;
          const url = await uploadFileToCos(file, `moment_${i + 1}`, (p) => {
            if (!shouldShow(p)) return;
            const overallProgress = Math.round(((completedFiles + p / 100) / totalFiles) * 100);
            setUploadProgress(overallProgress);
            setUploadStatusText(`正在上传图片 ${completedFiles + 1}/${totalFiles} (${p}%)`);
            toast.loading(`正在上传图片 ${completedFiles + 1}/${totalFiles} (${p}%)`, { id: loadingToastId });
          });
          uploadedMedia.push(url);
          completedFiles++;
          setUploadProgress(Math.round((completedFiles / totalFiles) * 100));
          toast.success(`第 ${completedFiles}/${totalFiles} 张图片上传成功`, { duration: 1200 });
        }
        toast.loading(`图片上传完成（${totalFiles} 张），正在发布…`, { id: loadingToastId });
      } else {
        toast.loading('正在发布…', { id: loadingToastId });
      }
      setUploadStatusText('正在发布…');
      setUploadProgress(100);
      await onPost(text.trim(), uploadedMedia, location, visibility);
      toast.success('动态发布成功', { id: loadingToastId, duration: 2000 });
      // 先关弹窗，避免被 loading toast 看起来“一直在加载”的观感
      onClose();
    } catch (error: any) {
      console.error('[moments] 动态上传失败:', error);
      setUploadStatusText('');
      setUploadProgress(0);
      toast.error(error?.message || '上传失败，请重试', { id: loadingToastId, duration: 3000 });
    } finally {
      setUploading(false);
      setUploadProgress(0);
      setUploadStatusText('');
      // 兌底：如果上面某条 toast 没有 settle，这里强制 dismiss，避免页面右上角残留 loading
      setTimeout(() => { try { toast.dismiss(loadingToastId); } catch {} }, 2200);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,0.3)", display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div style={{ width: "100%", maxWidth: 480, background: "#fff", borderRadius: "16px 16px 0 0", maxHeight: "90vh", display: "flex", flexDirection: "column" }} onClick={e => e.stopPropagation()}>
        <div style={{ borderBottom: "0.5px solid #f0f0f0" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px" }}>
            <button onClick={uploading ? undefined : onClose} style={{ background: "none", border: "none", fontSize: 14, color: uploading ? "#ccc" : "#888", cursor: uploading ? "default" : "pointer" }}>取消</button>
            <span style={{ fontSize: 15, fontWeight: 500, color: "#282828" }}>发布动态</span>
            <button
              onClick={() => { void handlePublish(); }}
              disabled={!canPost}
              style={{
                background: canPost ? "#07C160" : "#f0f0f0",
                color: canPost ? "#fff" : "#999",
                border: "none", borderRadius: 4, padding: "6px 16px", fontSize: 14, cursor: canPost ? "pointer" : "default"
              }}
            >
              {uploading ? `${uploadProgress}%` : '发表'}
            </button>
          </div>
          {/* 上传进度条 */}
          {uploading && (
            <div style={{ padding: "0 16px 8px 16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <div style={{ flex: 1, height: 4, borderRadius: 2, background: "#f0f0f0", overflow: "hidden" }}>
                  <div
                    style={{
                      height: "100%",
                      width: `${uploadProgress}%`,
                      borderRadius: 2,
                      background: "linear-gradient(90deg, #07C160, #06AD56)",
                      transition: "width 0.3s ease",
                    }}
                  />
                </div>
                <span style={{ fontSize: 11, color: "#999", whiteSpace: "nowrap", minWidth: 32 }}>{uploadProgress}%</span>
              </div>
              {uploadStatusText && (
                <div style={{ fontSize: 11, color: "#999", textAlign: "center" }}>{uploadStatusText}</div>
              )}
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="这一刻的想法..."
            style={{ width: "100%", height: isTextOnly ? 180 : 112, background: "transparent", border: "none", outline: "none", fontSize: 15, resize: "none", color: "#282828", lineHeight: 1.6 }}
            autoFocus={isTextOnly}
          />

          {selectedVideo && videoPreviewUrl && (
            <div style={{ marginTop: 8, position: "relative", borderRadius: 8, overflow: "hidden", maxHeight: 240 }}>
              <video src={videoPreviewUrl} style={{ width: "100%", maxHeight: 240, objectFit: "cover", borderRadius: 8 }} controls playsInline />
              <button
                onClick={() => { setSelectedVideo(null); setVideoPreviewUrl(''); }}
                style={{ position: "absolute", top: 8, right: 8, width: 24, height: 24, borderRadius: "50%", background: "rgba(0,0,0,0.6)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          )}

          {!isTextOnly && !selectedVideo && selectedImages.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4, marginTop: 8 }}>
              {selectedImages.map((img, i) => (
                <div key={i} style={{ aspectRatio: "1/1", borderRadius: 4, overflow: "hidden", position: "relative" }}>
                  <img src={img} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  <button
                    onClick={() => {
                      setSelectedImages(prev => prev.filter((_, idx) => idx !== i));
                      setSelectedFiles(prev => prev.filter((_, idx) => idx !== i));
                    }}
                    style={{ position: "absolute", top: 4, right: 4, width: 20, height: 20, borderRadius: "50%", background: "rgba(0,0,0,0.6)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              ))}
              {selectedImages.length < 9 && (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  style={{ aspectRatio: "1/1", borderRadius: 4, border: "1px dashed #ddd", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#ccc" }}
                >
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                </div>
              )}
            </div>
          )}
          {!isTextOnly && !selectedVideo && selectedImages.length === 0 && initialMode !== 'video' && (
            <div
              onClick={() => initialMode === 'camera' ? cameraInputRef.current?.click() : fileInputRef.current?.click()}
              style={{ marginTop: 8, width: "100%", height: 80, borderRadius: 8, border: "1px dashed #ddd", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, cursor: "pointer", color: "#ccc" }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span style={{ fontSize: 12 }}>{initialMode === 'camera' ? '拍照' : '添加图片'}</span>
            </div>
          )}
          {!isTextOnly && !selectedVideo && selectedImages.length === 0 && initialMode === 'video' && (
            <div
              onClick={() => videoInputRef.current?.click()}
              style={{ marginTop: 8, width: "100%", height: 80, borderRadius: 8, border: "1px dashed #ddd", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, cursor: "pointer", color: "#ccc" }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <rect x="2" y="4" width="15" height="16" rx="2" ry="2" />
                <polygon points="22 6 17 12 22 18 22 6" />
              </svg>
              <span style={{ fontSize: 12 }}>添加视频</span>
            </div>
          )}
          <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleFileChange} />
          <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handleCameraChange} />
          <input ref={videoInputRef} type="file" accept="video/*" style={{ display: 'none' }} onChange={handleVideoChange} />
        </div>

        <div style={{ padding: "8px 16px", borderTop: "0.5px solid #f0f0f0", display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, color: "#888" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
            </svg>
            <input
              type="text" value={location} onChange={e => setLocation(e.target.value)}
              placeholder="所在位置"
              style={{ background: "transparent", border: "none", outline: "none", fontSize: 13, color: "#576b95", width: 80, cursor: "pointer" }}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, color: "#888" }}>
            <select
              value={visibility}
              onChange={e => setVisibility(e.target.value as VisibilityType)}
              style={{ background: "transparent", border: "none", outline: "none", fontSize: 13, color: "#576b95", cursor: "pointer" }}
            >
              <option value="public">公开</option>
              <option value="friends">好友可见</option>
              <option value="private">仅自己</option>
            </select>
          </div>
        </div>
        <div style={{ height: "env(safe-area-inset-bottom, 16px)" }} />
      </div>
    </div>
  );
};

export { PostComposer };
export default PostComposer;
