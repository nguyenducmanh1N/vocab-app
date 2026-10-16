// Chạy trước mỗi file test: client đọc EXPO_PUBLIC_API_URL lúc nạp module.
// Test không gọi mạng thật (fetch được giả lập trong từng test).
process.env.EXPO_PUBLIC_API_URL = "http://api.test/api/v1";
