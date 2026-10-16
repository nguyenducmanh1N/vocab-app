/**
 * Tách văn bản "Nhập nhanh nhiều từ" (PLAN.md 10.1) thành danh sách từ.
 * Hàm thuần, không phụ thuộc React Native, để test bằng jest ở P3.5.
 *
 * Mỗi dòng một từ: "word", "word - nghĩa", "word – nghĩa", "word — nghĩa" hoặc "word: nghĩa".
 * - Chỉ tách ở gạch có khoảng trắng hai bên, nên "well-known" giữ nguyên.
 * - Bỏ dòng trống và ký hiệu đầu dòng ("•", "*", "- ", "1.", "2)").
 * - Gộp từ trùng (không phân biệt hoa thường): giữ dòng đầu, lấy nghĩa của dòng sau nếu dòng đầu chưa có.
 */

export type ParsedLine = {
  term: string;
  meaning: string | null;
};

export const MAX_TERM_LENGTH = 100;
export const MAX_MEANING_LENGTH = 500;

const BULLET = /^(?:[•*·]\s*|-\s+|\d{1,3}[.)]\s+)/;
// Gạch nối có khoảng trắng hai bên (-, – en dash, — em dash) hoặc dấu hai chấm.
const SEPARATOR = /\s+[-–—]\s+|\s*:\s*/;
// Gạch ở cuối dòng sau khi đã cắt khoảng trắng ("word - " → "word -"): dấu tách chưa có nghĩa.
const TRAILING_DASH = /\s+[-–—]$/;

function collapseSpaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function parseLine(raw: string): ParsedLine | null {
  const line = collapseSpaces(raw).replace(BULLET, "").replace(TRAILING_DASH, "");
  if (!line) return null;

  const match = SEPARATOR.exec(line);
  const term = collapseSpaces(match ? line.slice(0, match.index) : line);
  const meaning = match ? collapseSpaces(line.slice(match.index + match[0].length)) : "";
  if (!term) return null;
  return {
    term: term.slice(0, MAX_TERM_LENGTH),
    meaning: meaning ? meaning.slice(0, MAX_MEANING_LENGTH) : null,
  };
}

export function parseQuickImport(text: string): ParsedLine[] {
  const byKey = new Map<string, ParsedLine>();
  for (const raw of text.split(/\r?\n/)) {
    const parsed = parseLine(raw);
    if (!parsed) continue;
    const key = parsed.term.toLowerCase();
    const existing = byKey.get(key);
    if (!existing) byKey.set(key, parsed);
    else if (!existing.meaning && parsed.meaning) existing.meaning = parsed.meaning;
  }
  return [...byKey.values()];
}
