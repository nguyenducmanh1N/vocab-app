// Màu lấy từ CSS variable; giá trị sáng/tối đặt trong src/theme/tokens.ts (themeVars).
const color = (name) => `rgb(var(--color-${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        background: color("background"),
        surface: color("surface"),
        primary: color("primary"),
        success: color("success"),
        danger: color("danger"),
        warning: color("warning"),
        text: color("text"),
        textMuted: color("textMuted"),
        onFill: color("onFill"),
      },
      fontSize: {
        title: ["28px", { lineHeight: "34px" }],
        word: ["34px", { lineHeight: "41px" }],
        body: ["17px", { lineHeight: "22px" }],
        caption: ["13px", { lineHeight: "18px" }],
      },
    },
  },
  plugins: [],
};
