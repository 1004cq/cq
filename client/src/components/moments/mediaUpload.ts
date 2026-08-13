import { authApi } from '@/lib/authFetch';

export type UploadProgressCallback = (progress: number) => void;

async function uploadFileToLocal(file: File, onProgress?: UploadProgressCallback): Promise<string> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('mediaType', file.type.startsWith('video/') ? 'video' : 'image');
    formData.append('source', 'moments');

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/media/upload-form');

    // 添加认证头
    const token = localStorage.getItem('user_token');
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    // 上传进度监听
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && data.ok) {
          resolve(data.url);
        } else {
          reject(new Error(data.error || '上传失败'));
        }
      } catch {
        reject(new Error('上传响应解析失败'));
      }
    };

    xhr.onerror = () => reject(new Error('网络错误，上传失败'));
    xhr.ontimeout = () => reject(new Error('上传超时，请检查网络后重试'));
    xhr.timeout = 300000; // 5 分钟超时

    xhr.send(formData);
  });
}

async function uploadFileToCos(file: File, prefix: string, onProgress?: UploadProgressCallback): Promise<string> {
  try {
    const stsData = await authApi('/api/cos/sts', undefined, 'GET');
    const { credentials, bucket, region, baseUrl, momentsFolder, expiredTime } = stsData || {};
    if (credentials?.tmpSecretId && credentials?.tmpSecretKey && credentials?.sessionToken && bucket && region && baseUrl && momentsFolder) {
      const COS = (await import('cos-js-sdk-v5')).default;
      const cos = new COS({
        getAuthorization: (_options: any, callback: any) => {
          callback({
            TmpSecretId: credentials.tmpSecretId,
            TmpSecretKey: credentials.tmpSecretKey,
            SecurityToken: credentials.sessionToken,
            ExpiredTime: expiredTime,
          });
        },
      });
      const rawExt = file.name.split('.').pop() || file.type.split('/').pop() || 'jpg';
      const safeExt = rawExt.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      const isVideo = file.type.startsWith('video/');
      // 统一使用 ASCII 路径（videos/photos），避免中文路径在 CDN 回源或不同平台下出现编码问题导致加载失败
      const subDir = isVideo ? 'videos' : 'photos';
      const key = `${momentsFolder}/${subDir}/${prefix}_${Date.now()}.${safeExt}`;
      return await new Promise<string>((resolve, reject) => {
        cos.uploadFile(
          {
            Bucket: bucket,
            Region: region,
            Key: key,
            Body: file,
            SliceSize: 1024 * 1024 * 5, // 大于 5MB 使用分片上传
            onProgress: (progressData: any) => {
              if (onProgress) {
                onProgress(Math.round((progressData.percent || 0) * 100));
              }
            },
          },
          (err: any) => {
            if (err) reject(new Error(err.message || 'COS上传失败'));
            else resolve(`${String(baseUrl).replace(/\/$/, '')}/${key}`);
          }
        );
      });
    }
  } catch (cosErr) {
    console.warn('[moments] COS 上传不可用，回退本地上传:', cosErr);
  }
  return uploadFileToLocal(file, onProgress);
}

export { uploadFileToCos, uploadFileToLocal };
