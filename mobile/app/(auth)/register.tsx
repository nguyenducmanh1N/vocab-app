import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Text } from "react-native";

import { register } from "@/api/auth";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { PasswordInput } from "@/components/PasswordInput";
import { applyApiError } from "@/features/auth/apiFormError";
import { AuthFormLayout } from "@/features/auth/AuthFormLayout";
import { registerSchema, type RegisterForm } from "@/features/auth/schemas";
import { useAuthStore } from "@/stores/authStore";

const FIELDS = ["email", "display_name", "password", "confirm_password"] as const;

export default function RegisterScreen() {
  const signIn = useAuthStore((s) => s.signIn);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    mode: "onTouched",
    defaultValues: { email: "", display_name: "", password: "", confirm_password: "" },
  });

  const onSubmit = handleSubmit(async ({ email, display_name, password }) => {
    setFormError(null);
    try {
      await signIn(await register({ email, display_name, password }));
    } catch (err) {
      setFormError(applyApiError(err, setError, { EMAIL_EXISTS: "email" }, FIELDS));
    }
  });

  return (
    <AuthFormLayout
      title="Tạo tài khoản"
      subtitle="Lưu từ vựng theo chủ đề và ôn tập mỗi ngày."
      footerText="Đã có tài khoản?"
      footerLink={{ label: "Đăng nhập", href: "/login" }}
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
          />
        )}
      />
      <Controller
        control={control}
        name="display_name"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="Tên hiển thị"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            error={errors.display_name?.message}
            autoComplete="name"
            textContentType="name"
          />
        )}
      />
      <Controller
        control={control}
        name="password"
        render={({ field: { onChange, onBlur, value } }) => (
          <PasswordInput
            label="Mật khẩu (tối thiểu 8 ký tự)"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            error={errors.password?.message}
            autoComplete="new-password"
            textContentType="newPassword"
          />
        )}
      />
      <Controller
        control={control}
        name="confirm_password"
        render={({ field: { onChange, onBlur, value } }) => (
          <PasswordInput
            label="Nhập lại mật khẩu"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            error={errors.confirm_password?.message}
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="go"
            onSubmitEditing={onSubmit}
          />
        )}
      />
      {formError ? <Text className="text-body text-danger">{formError}</Text> : null}
      <Button title="Đăng ký" loading={isSubmitting} onPress={onSubmit} />
    </AuthFormLayout>
  );
}
