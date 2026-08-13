import React from 'react';

type GoldVerifiedBadgeProps = {
  size?: number;
  className?: string;
};

export function GoldVerifiedBadge({ size = 16, className = '' }: GoldVerifiedBadgeProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="已认证"
      role="img"
    >
      <path
        d="M12 1.8L14.9 4.2L18.6 3.5L19.8 7.1L22.9 9.2L21.8 12.8L22.9 16.4L19.8 18.5L18.6 22.1L14.9 21.4L12 23.8L9.1 21.4L5.4 22.1L4.2 18.5L1.1 16.4L2.2 12.8L1.1 9.2L4.2 7.1L5.4 3.5L9.1 4.2L12 1.8Z"
        fill="#F5C84C"
        stroke="#D9A421"
        strokeWidth="1"
      />
      <path
        d="M8.15 12.3L10.45 14.6L15.9 9.15"
        stroke="#FFFFFF"
        strokeWidth="2.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
