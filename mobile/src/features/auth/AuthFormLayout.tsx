import { Link, type Href } from "expo-router";
import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type AuthFormLayoutProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
  footerText: string;
  footerLink: { label: string; href: Href };
};

/** Khung chung cho màn đăng nhập và đăng ký: tránh bàn phím, cuộn được, link sang màn kia. */
export function AuthFormLayout({ title, subtitle, children, footerText, footerLink }: AuthFormLayoutProps) {
  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerClassName="flex-grow justify-center gap-6 px-4 py-8"
          keyboardShouldPersistTaps="handled"
        >
          <View className="gap-2">
            <Text className="text-title font-bold text-text">{title}</Text>
            <Text className="text-body text-textMuted">{subtitle}</Text>
          </View>
          <View className="gap-4">{children}</View>
          <View className="flex-row items-center justify-center gap-1">
            <Text className="text-body text-textMuted">{footerText}</Text>
            {/* asChild: className của NativeWind không áp được trực tiếp lên Link. */}
            <Link href={footerLink.href} replace asChild>
              <Pressable accessibilityRole="link" hitSlop={8} className="min-h-[44px] justify-center">
                <Text className="text-body font-semibold text-primary">{footerLink.label}</Text>
              </Pressable>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
