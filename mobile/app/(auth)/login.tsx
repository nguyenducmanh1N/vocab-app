import { zodResolver } from "@hookform/resolvers/zod";
import { router } from "expo-router";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Pressable, Text } from "react-native";

import { login } from "@/api/auth";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { PasswordInput } from "@/components/PasswordInput";
import { applyApiError } from "@/features/auth/apiFormError";
import { AuthFormLayout } from "@/features/auth/AuthFormLayout";
import { loginSchema, type LoginForm } from "@/features/auth/schemas";
import { useAuthStore } from "@/stores/authStore";

const FIELDS = ["email", "password"] as const;

export default function LoginScreen() {
  const signIn = useAuthStore((s) => s.signIn);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    setError,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    mode: "onTouched",
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await signIn(await login(values)); // app/_layout.tsx tự chuyển sang (tabs)
    } catch (err) {
      setFormError(applyApiError(err, setError, { INVALID_CREDENTIALS: "password" }, FIELDS));
    }
  });

  return (
    <AuthFormLayout
      title="Đăng nhập"
      subtitle="Tiếp tục học từ vựng của bạn."
      footerText="Chưa có tài khoản?"
      footerLink={{ label: "Đăng ký", href: "/register" }}
    >
      <Controller
        control={control}
        name="email"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="Email"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            error={errors.email?.message}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="next"
          />
        )}
      />
      <Controller
        control={control}
        name="password"
        render={({ field: { onChange, onBlur, value } }) => (
          <PasswordInput
            label="Mật khẩu"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            error={errors.password?.message}
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={onSubmit}
          />
        )}
      />
      <Pressable
        accessibilityRole="link"
        hitSlop={8}
        className="min-h-[44px] justify-center self-end"
        onPress={() =>
          router.replace({ pathname: "/forgot-password", params: { email: getValues("email").trim() } })
        }
      >
        <Text className="text-body font-semibold text-primary">Quên mật khẩu?</Text>
      </Pressable>
      {formError ? <Text className="text-body text-danger">{formError}</Text> : null}
      <Button title="Đăng nhập" loading={isSubmitting} onPress={onSubmit} />
    </AuthFormLayout>
  );
}
