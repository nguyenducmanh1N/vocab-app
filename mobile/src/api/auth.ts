import * as Device from "expo-device";

import { request } from "./client";
import type { AuthOut } from "./types";

export type RegisterBody = { email: string; password: string; display_name: string };
export type LoginBody = { email: string; password: string };
export type ResetPasswordBody = { email: string; code: string; new_password: string };

function deviceName(): string | undefined {
  return Device.deviceName?.slice(0, 100) ?? undefined;
}

export function register(body: RegisterBody): Promise<AuthOut> {
  return request<AuthOut>("/auth/register", { method: "POST", body, auth: false });
}

export function login(body: LoginBody): Promise<AuthOut> {
  return request<AuthOut>("/auth/login", {
    method: "POST",
    body: { ...body, device_name: deviceName() },
    auth: false,
  });
}

/** Luôn 204 dù email có đăng ký hay không (server không để lộ). */
export function forgotPassword(email: string): Promise<void> {
  return request<void>("/auth/password/forgot", { method: "POST", body: { email }, auth: false });
}

/** Đúng mã thì server thu hồi mọi phiên cũ và trả phiên mới như đăng nhập. */
export function resetPassword(body: ResetPasswordBody): Promise<AuthOut> {
  return request<AuthOut>("/auth/password/reset", {
    method: "POST",
    body: { ...body, device_name: deviceName() },
    auth: false,
  });
}

export function logout(refreshToken: string): Promise<void> {
  return request<void>("/auth/logout", { method: "POST", body: { refresh_token: refreshToken } });
}
