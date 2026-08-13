import React, { memo } from 'react';
import LazyImage from './LazyImage';

export interface VideoThumbnailProps {
  src: string;
  coverUrl?: string;
  style?: React.CSSProperties;
}

export const VideoThumbnail = memo(function VideoThumbnail({ src, coverUrl, style }: VideoThumbnailProps) {
  if (coverUrl) {
    return (
      <div style={{ ...style, position: 'relative', display: 'block' }}>
        <LazyImage src={coverUrl} alt="视频封面" style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', inset: 0 }} />
      </div>
    );
  }
  return <video src={src} style={{ ...style, display: 'block' }} muted playsInline preload="metadata" />;
});

export default VideoThumbnail;
