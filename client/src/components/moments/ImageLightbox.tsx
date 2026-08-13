import React, { useEffect, useRef, useState } from 'react';

function ImageLightbox({ images, initialIndex, onClose }: { images: string[]; initialIndex: number; onClose: () => void }) {
  const [current, setCurrent] = useState(initialIndex);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") setCurrent(c => (c > 0 ? c - 1 : c));
      if (e.key === "ArrowRight") setCurrent(c => (c < images.length - 1 ? c + 1 : c));
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [images.length, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black flex flex-col"
      onTouchStart={e => {
        touchStartX.current = e.touches[0].clientX;
        touchStartY.current = e.touches[0].clientY;
      }}
      onTouchEnd={e => {
        const dx = e.changedTouches[0].clientX - touchStartX.current;
        const dy = e.changedTouches[0].clientY - touchStartY.current;
        if (dy > 100 && Math.abs(dx) < 80) { onClose(); return; }
        if (Math.abs(dx) > 50 && Math.abs(dy) < 80) {
          if (dx < 0) setCurrent(c => Math.min(images.length - 1, c + 1));
          else setCurrent(c => Math.max(0, c - 1));
        }
      }}
    >
      <div className="flex items-center justify-between px-4 py-3 flex-shrink-0">
        <button onClick={onClose} className="text-white/80 hover:text-white">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <span className="text-white/70 text-sm">{current + 1} / {images.length}</span>
        <div className="w-6" />
      </div>
      <div className="flex-1 flex items-center justify-center overflow-hidden relative">
        <img src={images[current]} alt="" className="max-w-full max-h-full object-contain select-none" />
        {current > 0 && (
          <button onClick={() => setCurrent(c => c - 1)} className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-black/40 rounded-full hidden sm:flex items-center justify-center text-white">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
          </button>
        )}
        {current < images.length - 1 && (
          <button onClick={() => setCurrent(c => c + 1)} className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-black/40 rounded-full hidden sm:flex items-center justify-center text-white">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
          </button>
        )}
      </div>
      {images.length > 1 && (
        <div className="flex-shrink-0 flex items-center justify-center gap-1.5 py-3 px-4">
          {images.map((img, i) => (
            <button key={i} onClick={() => setCurrent(i)}
              className={`w-10 h-10 rounded overflow-hidden flex-shrink-0 transition-all ${i === current ? "ring-2 ring-white opacity-100" : "opacity-50"}`}>
              <img src={img} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export { ImageLightbox };
export default ImageLightbox;
