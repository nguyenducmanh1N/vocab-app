import { useColorScheme } from "react-native";

import { colors, type ColorScheme, type ThemeColors } from "./tokens";

/** Màu dạng giá trị cho chỗ không dùng được className (tab bar, placeholder, StatusBar). */
export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const scheme: ColorScheme = useColorScheme() === "dark" ? "dark" : "light";
  return { scheme, colors: colors[scheme] };
}
