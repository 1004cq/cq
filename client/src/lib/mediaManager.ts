/**
 * 全局媒体流管理器
 * 
 * iOS Safari 要求 getUserMedia 必须在用户手势的同步调用链中执行。
 * 本模块在用户点击视频通话按钮时立即调用 getUserMedia，
 * CallScreen 挂载后直接取用已获取的流，无需再次请求权限。
 */

let pendingStream: MediaStream | null = null;
let pendingStreamPromise: Promise<MediaStream | null> | null = null;

/**
 * 在用户手势中预获取摄像头流（必须在 onClick 等同步事件处理器中调用）
 */
export async function preFetchVideoStream(): Promise<MediaStream | null> {
  // 如果已有流，直接返回
  if (pendingStream) return pendingStream;

  // 如果正在获取，等待结果
  if (pendingStreamPromise) return pendingStreamPromise;

  console.log('[MediaManager] ★ 在用户手势中预获取摄像头流...');
  pendingStreamPromise = navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
    audio: true,
  }).then(stream => {
    console.log('[MediaManager] ★ 摄像头流预获取成功, tracks:', stream.getTracks().length);
    pendingStream = stream;
    pendingStreamPromise = null;
    return stream;
  }).catch(err => {
    console.warn('[MediaManager] 摄像头流预获取失败:', err);
    pendingStreamPromise = null;
    return null;
  });

  return pendingStreamPromise;
}

/**
 * 取出预获取的流（取出后清空，由调用方管理生命周期）
 */
export function takePendingStream(): MediaStream | null {
  const stream = pendingStream;
  pendingStream = null;
  return stream;
}

/**
 * 等待预获取完成并取出流
 */
export async function waitAndTakeStream(): Promise<MediaStream | null> {
  if (pendingStream) return takePendingStream();
  if (pendingStreamPromise) {
    await pendingStreamPromise;
    return takePendingStream();
  }
  return null;
}

/**
 * 释放预获取的流（通话取消时调用）
 */
export function releasePendingStream(): void {
  if (pendingStream) {
    pendingStream.getTracks().forEach(t => t.stop());
    pendingStream = null;
  }
  pendingStreamPromise = null;
}
