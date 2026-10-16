/**
 * Câu đục lỗ (cloze) từ câu ví dụ: thay từ cần học bằng chỗ trống. Hàm thuần để test ở P3.5.
 */

export type Cloze = { before: string; after: string; answer: string };

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Tìm `term` trong câu (không phân biệt hoa thường, theo ranh giới từ; mỗi từ được phép có đuôi
 * -s/-es/-ed/-d/-ing). Trả null nếu câu không chứa từ.
 */
export function makeCloze(sentence: string, term: string): Cloze | null {
  const words = term.trim();
  if (!words) return null;
  // Mỗi từ (kể cả trong cụm) được phép có đuôi chia: "take off" khớp "takes off".
  const body = words
    .split(/\s+/)
    .map((w) => `${escapeRegExp(w)}(?:s|es|ed|d|ing)?`)
    .join("\\s+");
  const pattern = new RegExp(`(^|[^\\p{L}])(${body})(?=$|[^\\p{L}])`, "iu");
  const match = pattern.exec(sentence);
  if (!match) return null;
  const start = match.index + match[1].length;
  const answer = match[2];
  return { before: sentence.slice(0, start), after: sentence.slice(start + answer.length), answer };
}

/** So đáp án: không phân biệt hoa thường, bỏ khoảng trắng thừa. Chấp nhận cả dạng gốc của từ. */
export function isClozeCorrect(input: string, cloze: Cloze, term: string): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const value = norm(input);
  return value.length > 0 && (value === norm(cloze.answer) || value === norm(term));
}
