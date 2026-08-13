import React, { memo } from 'react';

// ============ 骨架屏组件 ============
const MomentSkeleton = memo(() => (
  <div style={{ padding: "12px 16px", borderBottom: "0.5px solid #f0f0f0" }}>
    <div style={{ display: "flex", alignItems: "flex-start" }}>
      <div style={{ width: 48, flexShrink: 0 }}>
        <div style={{ width: 40, height: 40, borderRadius: 4, background: "#f0f0f0", animation: "shimmer 1.5s ease-in-out infinite" }} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ width: 80, height: 14, borderRadius: 2, background: "#f0f0f0", marginBottom: 8, animation: "shimmer 1.5s ease-in-out infinite" }} />
        <div style={{ width: "90%", height: 14, borderRadius: 2, background: "#f0f0f0", marginBottom: 6, animation: "shimmer 1.5s ease-in-out infinite" }} />
        <div style={{ width: "60%", height: 14, borderRadius: 2, background: "#f0f0f0", marginBottom: 8, animation: "shimmer 1.5s ease-in-out infinite" }} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 2, maxWidth: 243 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{ aspectRatio: "1/1", borderRadius: 2, background: "#f0f0f0", animation: "shimmer 1.5s ease-in-out infinite" }} />
          ))}
        </div>
        <div style={{ width: 60, height: 12, borderRadius: 2, background: "#f0f0f0", marginTop: 8, animation: "shimmer 1.5s ease-in-out infinite" }} />
      </div>
    </div>
  </div>
));

export { MomentSkeleton };
export default MomentSkeleton;
