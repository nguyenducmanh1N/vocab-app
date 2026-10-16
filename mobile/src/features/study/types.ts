/** Kiểu của bộ máy học (PLAN.md 10.3). */
import type { StudyAnswerIn, StudyCard } from "@/api/types";

export type { StudyCard, StudyMode } from "@/api/types";

export type QuestionKind =
  | "flip"
  | "mcq_en_vi"
  | "mcq_vi_en"
  | "mcq_audio"
  | "type_word"
  | "dictation"
  | "cloze"
  | "speak";

export type McqKind = "mcq_en_vi" | "mcq_vi_en" | "mcq_audio";

export type CardDirection = "en_vi" | "vi_en";

export type Quality = 0 | 1 | 2 | 3 | 4 | 5;

export interface Question {
  id: string; // id của lượt hỏi phía client
  kind: QuestionKind;
  card: StudyCard;
  prompt: string; // nội dung hiển thị chính (mcq_audio: từ để phát âm, không hiện chữ)
  options?: string[]; // 4 lựa chọn cho câu trắc nghiệm
  answer: string; // đáp án đúng để chấm
  intro?: true; // thẻ flip giới thiệu từ mới trong review: không chấm, không gửi
  introPosition?: { index: number; total: number }; // thẻ giới thiệu thứ mấy (1-based) / tổng số
  hint?: string; // type_word: chữ cái đầu cho nút gợi ý
  translation?: string; // speak: nghĩa tiếng Việt của câu ví dụ
}

/** Một câu trả lời đã chấm; đúng shape answer của POST /study/sessions. */
export type AnswerRecord = StudyAnswerIn & { quality: Quality };

/** Thứ cần để tạo đáp án nhiễu: thẻ trong phiên hoặc distractor_pool. */
export type Candidate = {
  word_id: string;
  term: string;
  meaning_vi: string;
  part_of_speech: string | null;
};
