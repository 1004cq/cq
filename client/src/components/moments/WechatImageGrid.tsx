import React, { memo } from 'react';
import LazyImage from './LazyImage';

const WechatImageGrid = memo(({ images, onImageClick }: { images: string[]; onImageClick: (images: string[], index: number) => void }) => {
  const count = images.length;
  if (count === 0) return null;

  const cellStyle: React.CSSProperties = { aspectRatio: "1/1", overflow: "hidden", borderRadius: 4, cursor: "pointer", position: "relative" };
  const imgStyle: React.CSSProperties = { width: "100%", height: "100%", objectFit: "cover" };
  const gap = 4;

  const renderImg = (src: string, i: number) => (
    <div key={i} style={cellStyle} onClick={() => onImageClick(images, i)}>
      <LazyImage src={src} style={imgStyle} />
    </div>
  );

  if (count === 1) {
    return (
      <div style={{ maxWidth: 240, overflow: "hidden", borderRadius: 6, cursor: "pointer" }} onClick={() => onImageClick(images, 0)}>
        <LazyImage src={images[0]} style={{ width: "100%", height: "auto", display: "block", objectFit: "contain" }} />
      </div>
    );
  }
  if (count === 2) {
    return (
      <div style={{ maxWidth: 220, display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap }}>
        {images.map((src, i) => renderImg(src, i))}
      </div>
    );
  }
  if (count === 3) {
    return (
      <div style={{ maxWidth: 300, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap }}>
        {images.map((src, i) => renderImg(src, i))}
      </div>
    );
  }
  if (count === 4) {
    return (
      <div style={{ maxWidth: 220, display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap }}>
        {images.map((src, i) => renderImg(src, i))}
      </div>
    );
  }
  if (count === 5) {
    return (
      <div style={{ maxWidth: 300, display: "flex", flexDirection: "column", gap }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap }}>
          {images.slice(0, 2).map((src, i) => renderImg(src, i))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap }}>
          {images.slice(2, 5).map((src, i) => renderImg(src, i + 2))}
        </div>
      </div>
    );
  }
  if (count === 6) {
    return (
      <div style={{ maxWidth: 300, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap }}>
        {images.map((src, i) => renderImg(src, i))}
      </div>
    );
  }
  if (count === 7) {
    return (
      <div style={{ maxWidth: 300, display: "flex", flexDirection: "column", gap }}>
        <div style={{ aspectRatio: "3/1", overflow: "hidden", borderRadius: 2, cursor: "pointer" }} onClick={() => onImageClick(images, 0)}>
          <LazyImage src={images[0]} style={imgStyle} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap }}>
          {images.slice(1, 4).map((src, i) => renderImg(src, i + 1))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap }}>
          {images.slice(4, 7).map((src, i) => renderImg(src, i + 4))}
        </div>
      </div>
    );
  }
  if (count === 8) {
    return (
      <div style={{ maxWidth: 300, display: "flex", flexDirection: "column", gap }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap }}>
          {images.slice(0, 2).map((src, i) => renderImg(src, i))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap }}>
          {images.slice(2, 5).map((src, i) => renderImg(src, i + 2))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap }}>
          {images.slice(5, 8).map((src, i) => renderImg(src, i + 5))}
        </div>
      </div>
    );
  }
  // 9张
  return (
    <div style={{ maxWidth: 300, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap }}>
      {images.slice(0, 9).map((src, i) => renderImg(src, i))}
    </div>
  );
});

export { WechatImageGrid };
export default WechatImageGrid;
