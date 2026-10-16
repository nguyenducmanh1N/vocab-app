import { zodResolver } from "@hookform/resolvers/zod";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Text } from "react-native";

import { forgotPassword, resetPassword } from "@/api/auth";
import { messageFor } from "@/api/errorMessages";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { PasswordInput } from "@/components/PasswordInput";
import { applyApiError } from "@/features/auth/apiFormError";
import { AuthFormLayout } from "@/features/auth/AuthFormLayout";
import { forgotSchema, resetSchema, type ForgotForm, type ResetForm } from "@/features/auth/schemas";
import { useAuthStore } from "@/stores/authStore";

// Server không tạo mã mới nếu mã trước chưa quá 60 giây (PLAN.md 8.3).
const RESEND_SECONDS = 60;
const RESET_FIELDS = ["code", "new_password", "confirm_password"] as const;

const FOOTER = {
  footerText: "Nhớ ra mật khẩu?",
  footerLink: { label: "Đăng nhập", href: "/login" as const },
};

/**
 * Đếm ngược tới lúc được gửi lại mã. Tính theo giờ thật (không trừ dần) vì iOS dừng timer khi
 * app ở nền, lúc người dùng sang app Mail lấy mã.
 */
function useResendCountdown(): { secondsLeft: number; restart: () => void } {
  const [now, setNow] = useState(() => Date.now());
  const [until, setUntil] = useState(() => Date.now() + RESEND_SECONDS * 1000);
  const secondsLeft = Math.max(0, Math.ceil((until - now) / 1000));
  const counting = secondsLeft > 0;

  useEffect(() => {
    if (!counting) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [counting]);

  const restart = () => {
    const start = Date.now();
    setNow(start);
    setUntil(start + RESEND_SECONDS * 1000);
  };
  return { secondsLeft, restart };
}

function EmailStep({ initialEmail, onSent }: { initialEmail: string; onSent: (email: string) => void }) {
  const [formError, setFormError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ForgotForm>({
    resolver: zodResolver(forgotSchema),
    mode: "onTouched",
    defaultValues: { email: initialEmail },
  });

  const onSubmit = handleSubmit(async ({ email }) => {
    setFormError(null);
    try {
      await forgotPassword(email);
      onSent(email);
    } catch (err) {
      setFormError(applyApiError(err, setError, {}, ["email"]));
    }
  });

  return (
    <AuthFormLayout
      title="Quên mật khẩu"
      subtitle="Nhập email đã đăng ký, chúng tôi sẽ gửi mã 6 số để đặt lại mật khẩu."
      {...FOOTER}
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
            returnKeyType="send"
            onSubmitEditing={onSubmit}
          />
        )}
      />
      {formError ? <Text className="text-body text-danger">{formError}</Text> : null}
      <Button title="Gửi mã" loading={isSubmitting} onPress={onSubmit} />
    </AuthFormLayout>
  );
}

function CodeStep({ email, onChangeEmail }: { email: string; onChangeEmail: () => void }) {
  const signIn = useAuthStore((s) => s.signIn);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const { secondsLeft, restart } = useResendCountdown();
  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ResetForm>({
    resolver: zodResolver(resetSchema),
    mode: "onTouched",
    defaultValues: { code: "", new_password: "", confirm_password: "" },
  });

  const onSubmit = handleSubmit(async ({ code, new_password }) => {
    setFormError(null);
    setNotice(null);
    try {
      await signIn(await resetPassword({ email, code, new_password })); // app/_layout.tsx tự chuyển sang (tabs)
    } catch (err) {
      setFormError(applyApiError(err, setError, { INVALID_RESET_CODE: "code" }, RESET_FIELDS));
    }
  });

  const onResend = async () => {
    setFormError(null);
    setNotice(null);
    setResending(true);
    try {
      await forgotPassword(email);
      restart();
      setNotice("Đã gửi lại mã. Mã cũ không dùng được nữa.");
    } catch (err) {
      setFormError(messageFor(err));
    } finally {
      setResending(false);
    }
  };

  return (
    <AuthFormLayout
      title="Nhập mã"
      subtitle={`Nếu ${email} đã đăng ký, mã 6 số sẽ được gửi tới trong ít phút. Mã có hiệu lực 10 phút.`}
      {...FOOTER}
    >
      <Controller
        control={control}
        name="code"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="Mã 6 số"
            value={value}
            onChangeText={(text) => onChange(text.replace(/[^0-9]/g, ""))}
            onBlur={onBlur}
            error={errors.code?.message}
            keyboardType="number-pad"
            maxLength={6}
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            autoFocus
          />
        )}
      />
      <Controller
        control={control}
        name="new_password"
        render={({ field: { onChange, onBlur, value } }) => (
          <PasswordInput
            label="Mật khẩu mới"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            error={errors.new_password?.message}
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="next"
          />
        )}
      />
      <Controller
        control={control}
        name="confirm_password"
        render={({ field: { onChange, onBlur, value } }) => (
          <PasswordInput
            label="Nhập lại mật khẩu mới"
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
      {notice ? <Text className="text-body text-success">{notice}</Text> : null}
      <Button title="Đặt lại mật khẩu" loading={isSubmitting} onPress={onSubmit} />
      <Button
        title={secondsLeft > 0 ? `Gửi lại mã sau ${secondsLeft} giây` : "Gửi lại mã"}
        variant="secondary"
        loading={resending}
        disabled={secondsLeft > 0 || isSubmitting}
        onPress={onResend}
      />
      <Button title="Đổi email" variant="ghost" disabled={isSubmitting} onPress={onChangeEmail} />
    </AuthFormLayout>
  );
}

export default function ForgotPasswordScreen() {
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(params.email ?? "");
  const [sent, setSent] = useState(false);

  if (sent) return <CodeStep email={email} onChangeEmail={() => setSent(false)} />;
  return (
    <EmailStep
      initialEmail={email}
      onSent={(value) => {
        setEmail(value);
        setSent(true);
      }}
    />
  );
}
