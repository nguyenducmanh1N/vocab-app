import type { ReactElement, ReactNode } from "react";
import { ScrollView, View, type RefreshControlProps } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type ScreenProps = {
  children: ReactNode;
  scroll?: boolean;
  className?: string;
  /** Kéo để làm mới (chỉ khi scroll). */
  refreshControl?: ReactElement<RefreshControlProps>;
};

export function Screen({ children, scroll = false, className = "", refreshControl }: ScreenProps) {
  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background">
      {scroll ? (
        <ScrollView
          contentContainerClassName={`px-4 pb-8 gap-4 ${className}`}
          refreshControl={refreshControl}
        >
          {children}
        </ScrollView>
      ) : (
        <View className={`flex-1 px-4 gap-4 ${className}`}>{children}</View>
      )}
    </SafeAreaView>
  );
}
