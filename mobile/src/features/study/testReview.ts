/** Chấm bài kiểm tra cuối bài (PLAN.md 10.3, P5.5). Hàm thuần để test bằng jest. */
import type { GradedEntry } from "./engine";
import type { Question, StudyCard } from "./types";

export type TestReviewItem = {
  key: string;
  card: StudyCard;
  ask: string; // câu hỏi viết lại để đọc khi xem lại
  sentence?: string; // cloze: câu có chỗ trống
  given: string | null; // câu người học trả lời; null/rỗng = bỏ qua
  answer: string;
};

export type TestResult = { correct: number; total: number; percent: number; wrong: TestReviewItem[] };

function askOf(question: Question): string {
  const { card } = question;
  switch (question.kind) {
    case "mcq_en_vi":
      return `Nghĩa của “${card.term}”`;
    case "mcq_vi_en":
      return `Từ có nghĩa “${card.meaning_vi}”`;
    case "mcq_audio":
      return "Nghe và chọn từ đúng";
    case "type_word":
      return `Gõ từ có nghĩa “${question.prompt}”`;
    case "cloze":
      return "Điền vào chỗ trống";
    default:
      return question.prompt;
  }
}

/**
 * Điểm = số answer đúng trên số answer (mỗi câu đúng một answer, bài kiểm tra không hỏi lại câu sai),
 * nên luôn khớp số câu đúng trong log gửi lên server.
 */
export function testResult(history: readonly GradedEntry[]): TestResult {
  const total = history.length;
  const correct = history.filter((entry) => entry.record.is_correct).length;
  const wrong = history
    .filter((entry) => !entry.record.is_correct)
    .map(({ question, given, record }) => ({
      key: record.client_answer_id,
      card: question.card,
      ask: askOf(question),
      ...(question.kind === "cloze" ? { sentence: question.prompt } : {}),
      given,
      answer: question.answer,
    }));
  return { correct, total, percent: total ? Math.round((correct / total) * 100) : 0, wrong };
}
