import React from 'react';
import { ChevronRight } from 'lucide-react';

export const WxToggle: React.FC<{ on: boolean; onTap: () => void }> = ({ on, onTap }) => (
  <button
    type="button"
    role="switch"
    aria-checked={on}
    onClick={(event) => { event.stopPropagation(); onTap(); }}
    className="relative h-[31px] min-w-[51px] shrink-0 rounded-[16px] border-0 p-0 transition-colors"
    style={{ backgroundColor: on ? '#34c759' : '#e5e5ea' }}
  >
    <span className="absolute top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.15)] transition-[left] duration-200" style={{ left: on ? 22 : 2 }} />
  </button>
);

export const SheetSection: React.FC<React.PropsWithChildren<{ title?: string; className?: string }>> = ({ title, className = '', children }) => (
  <section className={`overflow-hidden rounded-xl bg-white/80 dark:bg-slate-900/70 ${className}`}>
    {title && <h3 className="px-4 pb-2 pt-4 text-xs font-medium text-muted-foreground">{title}</h3>}
    {children}
  </section>
);

export const SettingRow: React.FC<{
  label: string;
  value?: string;
  hasArrow?: boolean;
  onClick?: () => void;
  toggle?: { value: boolean; onChange: () => void };
  isLast?: boolean;
  labelColor?: string;
  center?: boolean;
}> = ({ label, value, hasArrow, onClick, toggle, isLast, labelColor, center }) => (
  <div
    onClick={onClick}
    className={`flex min-h-11 w-full items-center px-4 py-[13px] ${center ? 'justify-center' : 'justify-between'} ${onClick ? 'cursor-pointer' : 'cursor-default'} ${isLast ? '' : 'border-b border-black/5 dark:border-white/10'}`}
    style={{ WebkitTapHighlightColor: 'transparent' }}
  >
    <span className="shrink-0 whitespace-nowrap text-[15px]" style={{ color: labelColor || undefined }}>{label}</span>
    {toggle ? (
      <WxToggle on={toggle.value} onTap={toggle.onChange} />
    ) : !center ? (
      <div className="ml-3 flex min-w-0 items-center gap-1">
        {value && <span className="max-w-[180px] truncate text-[15px] text-[#8e8e93]">{value}</span>}
        {hasArrow && <ChevronRight size={18} color="#c7c7cc" className="shrink-0" />}
      </div>
    ) : null}
  </div>
);
