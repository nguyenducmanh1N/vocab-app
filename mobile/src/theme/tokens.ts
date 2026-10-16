import { vars } from "nativewind";

// Bảng màu theo PLAN.md mục 10.6. Đây là nguồn duy nhất: tailwind.config.js đọc qua CSS variable.
export const colors = {
  light: {
    background: "#F7F7FB",
    surface: "#FFFFFF",
    primary: "#5B5BD6",
    // success/warning đậm hơn bản gốc (#16A34A/#F59E0B) để làm chữ trên nền sáng và nền cho chữ
    // trắng đều đạt WCAG AA (≥ 4,5:1); bản cũ chỉ 3,3:1 và 2,1:1 (P6.6).
    success: "#15803D",
    danger: "#DC2626",
    warning: "#B45309",
    text: "#111827",
    textMuted: "#6B7280",
    onFill: "#FFFFFF", // chữ/icon trên nền đặc primary, success, danger, warning
  },
  dark: {
    background: "#0F1115",
    surface: "#1A1D24",
    primary: "#7C7CF0",
    success: "#22C55E",
    danger: "#F87171",
    warning: "#FBBF24",
    text: "#F3F4F6",
    textMuted: "#9CA3AF",
    onFill: "#0F1115", // nền màu ở chế độ tối là màu sáng: chữ tối mới đọc được (≥ 5:1)
  },
} as const;

export type ColorScheme = keyof typeof colors;
export type ColorToken = keyof (typeof colors)["light"];
export type ThemeColors = Record<ColorToken, string>;

// Chữ: font hệ thống iOS (SF Pro).
export const typography = {
  title: { fontSize: 28, fontWeight: "700" },
  word: { fontSize: 34, fontWeight: "700" },
  body: { fontSize: 17, fontWeight: "400" },
  caption: { fontSize: 13, fontWeight: "400" },
} as const;

export const radius = { card: 16, button: 12 } as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/** "#5B5BD6", 0.2 -> "rgba(91, 91, 214, 0.2)", cho prop màu không nhận className. */
export function withAlpha(hex: string, alpha: number): string {
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

/** "#5B5BD6" -> "91 91 214" (dạng kênh RGB cho rgb(var(--x) / alpha)). */
function toRgbChannels(hex: string): string {
  const value = parseInt(hex.slice(1), 16);
  return `${(value >> 16) & 255} ${(value >> 8) & 255} ${value & 255}`;
}

function toCssVars(palette: ThemeColors) {
  const entries = Object.entries(palette).map(([token, hex]) => [
    `--color-${token}`,
    toRgbChannels(hex),
  ]);
  return vars(Object.fromEntries(entries));
}

// Đặt lên View gốc để các class bg-background, text-text… đổi theo chế độ sáng/tối.
export const themeVars = {
  light: toCssVars(colors.light),
  dark: toCssVars(colors.dark),
} as const;

// Màu cho danh mục mới (xoay vòng), để lưới danh mục ở tab Thư viện có nhiều màu (PLAN.md 10.1).
// Dùng giá trị chế độ sáng của các token chính, cộng vài màu phụ cùng độ đậm.
export const categoryPalette = [
  colors.light.primary,
  colors.light.success,
  colors.light.warning,
  colors.light.danger,
  "#0EA5E9",
  "#DB2777",
  "#0D9488",
  "#7C3AED",
] as const;
