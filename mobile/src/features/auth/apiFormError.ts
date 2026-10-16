import type { FieldValues, Path, UseFormSetError } from "react-hook-form";

import { ApiError } from "@/api/client";
import { messageFor } from "@/api/errorMessages";
import type { ValidationDetail } from "@/api/types";

/**
 * Đưa lỗi API vào đúng ô của form; trả câu lỗi chung (hiện trên nút) nếu không gắn được vào ô nào.
 * `fieldForCode`: mã lỗi → ô, ví dụ { EMAIL_EXISTS: "email" }.
 */
export function applyApiError<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fieldForCode: Partial<Record<string, Path<T>>>,
  fields: readonly Path<T>[],
): string | null {
  const message = messageFor(error);
  if (!(error instanceof ApiError)) return message;

  const field = fieldForCode[error.code];
  if (field) {
    setError(field, { type: "server", message }, { shouldFocus: true });
    return null;
  }

  if (error.code === "VALIDATION_ERROR" && Array.isArray(error.details)) {
    let applied = false;
    for (const detail of error.details as ValidationDetail[]) {
      const name = detail.field?.replace(/^body\./, "") as Path<T>;
      if (fields.includes(name)) {
        setError(name, { type: "server", message: detail.message });
        applied = true;
      }
    }
    if (applied) return null;
  }
  return message;
}
