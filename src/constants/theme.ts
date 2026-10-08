import '@/global.css';

import { Platform } from 'react-native';

/**
 * 全应用的颜色令牌。刻意走「极致极简工具风」：
 * 一个主导的暖灰中性面 + 深浅两套近黑近白，不设彩色强调 ——
 * 界面上唯一的"重色"就是文字本身（主按钮 = 文字色填充）。
 *
 * 2026-10-08 从纯 #000/#fff 改为暖调近黑与近白：
 * 纯黑压纯白是最刺眼的组合（前端设计通则的明确禁止项），
 * 暖调让长时间盯屏幕舒服得多，视觉层级不变。
 * 对比度全部实测 ≥ 4.5:1（正文）——改色时别凭感觉，要算。
 */
export const Colors = {
  light: {
    text: '#1B1A18',
    background: '#FAF9F7',
    backgroundElement: '#F1EFEA',
    backgroundSelected: '#E5E2DB',
    textSecondary: '#6D6A63',
    /** 链接/可点 tint：亮色下 ≥4.5:1（旧的 #3c87f7 只有 3.7:1，不达标） */
    tint: '#2E6BE6',
  },
  dark: {
    text: '#F2F0EB',
    background: '#111110',
    backgroundElement: '#201F1D',
    backgroundSelected: '#2D2B28',
    textSecondary: '#B5B1A8',
    tint: '#8AB4F8',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
