import { ApiError } from "./client";

const MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: "Email hoặc mật khẩu không đúng.",
  EMAIL_EXISTS: "Email này đã được đăng ký. Hãy đăng nhập.",
  INVALID_RESET_CODE: "Mã không đúng hoặc đã hết hạn. Kiểm tra lại hoặc bấm Gửi lại mã.",
  RATE_LIMITED: "Bạn thử quá nhiều lần. Đợi khoảng 1 phút rồi thử lại.",
  NETWORK: "Không kết nối được máy chủ. Kiểm tra Wi‑Fi và thử lại.",
  TIMEOUT: "Không kết nối được máy chủ. Kiểm tra Wi‑Fi và thử lại.",
  VALIDATION_ERROR: "Thông tin chưa hợp lệ.",
  AI_UPSTREAM_ERROR: "AI đang bận hoặc trả kết quả lỗi. Thử lại sau ít phút.",
  AI_CONSENT_REQUIRED: "Cần đồng ý dùng AI trước khi dùng tính năng này.",
  AI_QUOTA_EXCEEDED: "Bạn đã dùng hết lượt AI hôm nay. Thử lại vào ngày mai.",
  TOKEN_EXPIRED: "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.",
  TOKEN_INVALID: "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.",
  REFRESH_REUSED: "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.",
};

/** Câu tiếng Việt dễ hiểu cho lỗi API; mã chưa biết thì dùng message của server. */
export function messageFor(error: unknown): string {
  if (error instanceof ApiError) return MESSAGES[error.code] ?? error.message;
  return "Đã có lỗi xảy ra. Thử lại sau.";
}
