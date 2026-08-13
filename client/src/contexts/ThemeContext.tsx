import React, { createContext, useContext, useEffect, useState } from "react";

// 三种主题模式
export type ThemeMode = "light" | "dark" | "system";
// 实际应用的主题（不含 system）
export type Theme = "light" | "dark";

interface ThemeContextType {
  /** 用户选择的模式：light / dark / system */
  mode: ThemeMode;
  /** 实际应用的主题（system 时根据系统判断） */
  theme: Theme;
  /** 循环切换：light → dark → system → light */
  toggleTheme: () => void;
  /** 直接设置模式 */
  setMode: (mode: ThemeMode) => void;
  switchable: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

function getSystemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveTheme(mode: ThemeMode): Theme {
  if (mode === 'system') return getSystemTheme();
  return mode;
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

interface ThemeProviderProps {
  children: React.ReactNode;
  switchable?: boolean;
}

export function ThemeProvider({
  children,
  switchable = true,
}: ThemeProviderProps) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    const stored = localStorage.getItem('imim_theme_mode');
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
    // 兼容旧版本：如果有旧的 imim_theme 存储，迁移过来
    const oldStored = localStorage.getItem('imim_theme');
    if (oldStored === 'light' || oldStored === 'dark') return oldStored;
    // 默认跟随系统
    return 'system';
  });

  const [theme, setTheme] = useState<Theme>(() => resolveTheme(
    (() => {
      const stored = localStorage.getItem('imim_theme_mode');
      if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
      const oldStored = localStorage.getItem('imim_theme');
      if (oldStored === 'light' || oldStored === 'dark') return oldStored;
      return 'system';
    })()
  ));

  // 当 mode 变化时，重新计算并应用主题
  useEffect(() => {
    const resolved = resolveTheme(mode);
    setTheme(resolved);
    applyTheme(resolved);
    localStorage.setItem('imim_theme_mode', mode);
  }, [mode]);

  // 监听系统主题变化（仅在 system 模式下生效）
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      if (mode === 'system') {
        const resolved = getSystemTheme();
        setTheme(resolved);
        applyTheme(resolved);
      }
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [mode]);

  const setMode = (newMode: ThemeMode) => {
    setModeState(newMode);
  };

  // 循环切换：light → dark → system → light
  const toggleTheme = () => {
    setModeState(prev => {
      if (prev === 'light') return 'dark';
      if (prev === 'dark') return 'system';
      return 'light';
    });
  };

  return (
    <ThemeContext.Provider value={{ mode, theme, toggleTheme, setMode, switchable }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}
