import { z } from "zod";

const email = z
  .string()
  .trim()
  .min(1, { error: "Nhập email" })
  .max(255, { error: "Email quá dài" })
  .pipe(z.email({ error: "Email không hợp lệ" }));

const newPassword = z
  .string()
  .min(8, { error: "Mật khẩu tối thiểu 8 ký tự" })
  .max(128, { error: "Mật khẩu tối đa 128 ký tự" });

export const loginSchema = z.object({
  email,
  password: z.string().min(1, { error: "Nhập mật khẩu" }).max(128, { error: "Mật khẩu quá dài" }),
});

export const registerSchema = z
  .object({
    email,
    display_name: z
      .string()
      .trim()
      .min(1, { error: "Nhập tên hiển thị" })
      .max(50, { error: "Tên hiển thị tối đa 50 ký tự" }),
    password: newPassword,
    confirm_password: z.string().min(1, { error: "Nhập lại mật khẩu" }),
  })
  .refine((data) => data.password === data.confirm_password, {
    error: "Mật khẩu nhập lại không khớp",
    path: ["confirm_password"],
  });

export const forgotSchema = z.object({ email });

export const resetSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[0-9]{6}$/, { error: "Mã gồm 6 chữ số" }),
    new_password: newPassword,
    confirm_password: z.string().min(1, { error: "Nhập lại mật khẩu" }),
  })
  .refine((data) => data.new_password === data.confirm_password, {
    error: "Mật khẩu nhập lại không khớp",
    path: ["confirm_password"],
  });

export type LoginForm = z.infer<typeof loginSchema>;
export type RegisterForm = z.infer<typeof registerSchema>;
export type ForgotForm = z.infer<typeof forgotSchema>;
export type ResetForm = z.infer<typeof resetSchema>;
