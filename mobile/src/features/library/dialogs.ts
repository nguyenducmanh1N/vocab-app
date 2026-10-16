import { ActionSheetIOS, Alert } from "react-native";

import { messageFor } from "@/api/errorMessages";

// App chỉ chạy iOS (CLAUDE.md): dùng hộp thoại hệ thống cho các thao tác nhỏ.

/** Hỏi một dòng chữ; trả null nếu huỷ hoặc để trống. */
export function promptText(title: string, message?: string, defaultValue = ""): Promise<string | null> {
  return new Promise((resolve) => {
    Alert.prompt(
      title,
      message,
      [
        { text: "Huỷ", style: "cancel", onPress: () => resolve(null) },
        { text: "Lưu", onPress: (value?: string) => resolve(value?.trim() ? value.trim() : null) },
      ],
      "plain-text",
      defaultValue,
    );
  });
}

/** Hỏi mật khẩu (ô che chữ); trả null nếu huỷ hoặc để trống. */
export function promptPassword(title: string, message: string, actionLabel: string): Promise<string | null> {
  return new Promise((resolve) => {
    Alert.prompt(
      title,
      message,
      [
        { text: "Huỷ", style: "cancel", onPress: () => resolve(null) },
        { text: actionLabel, style: "destructive", onPress: (value?: string) => resolve(value ? value : null) },
      ],
      "secure-text",
    );
  });
}

/** Chọn một mục trong action sheet; trả chỉ số hoặc null nếu huỷ. */
export function pickOption(
  title: string,
  options: string[],
  destructiveIndex?: number,
): Promise<number | null> {
  return new Promise((resolve) => {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title,
        options: [...options, "Huỷ"],
        cancelButtonIndex: options.length,
        destructiveButtonIndex: destructiveIndex,
      },
      (index) => resolve(index === options.length ? null : index),
    );
  });
}

export function confirmDestructive(title: string, message: string, actionLabel = "Xoá"): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: "Huỷ", style: "cancel", onPress: () => resolve(false) },
      { text: actionLabel, style: "destructive", onPress: () => resolve(true) },
    ]);
  });
}

export function showError(error: unknown, title = "Không thực hiện được"): void {
  Alert.alert(title, messageFor(error));
}
