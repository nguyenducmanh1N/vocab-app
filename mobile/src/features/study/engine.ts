/**
 * Hàng câu hỏi của một phiên học (PLAN.md 10.3, luật is_first_attempt ở 9.2).
 * Thuần TypeScript: rng, đồng hồ và sinh id được tiêm vào để test lặp lại được.
 */
import * as Crypto from "expo-crypto";

import type { DistractorItem } from "@/api/types";

import { toCandidate } from "./distractors";
import {
  initialQuestions,
  isClozeEligible,
  isMcq,
  mcq,
  randomMcqKind,
  retryQuestion,
  typeWord,
  type GeneratorContext,
} from "./generators";
import { randomInt, type Rng } from "./random";
import type { AnswerRecord, CardDirection, Quality, Question, StudyCard, StudyMode } from "./types";

export const REINSERT_MIN = 3; // câu sai hỏi lại sau 3–5 câu
export const REINSERT_MAX = 5;
export const LEARN_MCQ_TO_TYPE = 2; // learn: đúng 2 câu trắc nghiệm rồi mới gõ

export type EngineOptions = {
  mode: StudyMode;
  cards: readonly StudyCard[];
  distractorPool?: readonly DistractorItem[];
  direction?: CardDirection;
  rng?: Rng;
  now?: () => number; // ms
  newId?: () => string;
};

export type SubmitInput = {
  quality: Quality;
  isCorrect: boolean;
  given?: string; // câu người học trả lời (lựa chọn hoặc chữ đã gõ), để xem lại cuối bài kiểm tra
};

/** Một câu đã chấm: câu hỏi, câu trả lời của người học và answer gửi lên server. */
export type GradedEntry = { question: Question; given: string | null; record: AnswerRecord };

/** Trạng thái ngay trước lần chấm gần nhất, để hoàn tác một bước. */
type UndoSnapshot = {
  queue: Question[];
  graded: Set<string>;
  wrong: Set<string>;
  learnMcqCorrect: Map<string, number>;
  learned: Set<string>;
};

export class StudyEngine {
  readonly mode: StudyMode;
  readonly answers: AnswerRecord[] = [];
  /** Song song với answers: câu hỏi và câu trả lời của từng answer. */
  readonly history: GradedEntry[] = [];
  /** cloze: từ bị bỏ vì không có câu ví dụ chứa chính từ đó. */
  readonly skippedWordIds: string[];

  private queue: Question[];
  private readonly ctx: GeneratorContext;
  private readonly now: () => number;
  private readonly newId: () => string; // client_answer_id
  private graded = new Set<string>(); // word_id đã chấm trong phiên
  private wrong = new Set<string>();
  private learnMcqCorrect = new Map<string, number>();
  private learned = new Set<string>(); // learn: từ đã gõ đúng (xong)
  private undoSnapshot: UndoSnapshot | null = null;
  private readonly wordCount: number;
  private shownAt: number;

  constructor(options: EngineOptions) {
    this.mode = options.mode;
    this.now = options.now ?? Date.now;
    this.newId = options.newId ?? Crypto.randomUUID;
    let questionCount = 0;
    this.ctx = {
      candidates: [...options.cards.map(toCandidate), ...(options.distractorPool ?? [])],
      direction: options.direction ?? "en_vi",
      rng: options.rng ?? Math.random,
      questionId: () => `q${++questionCount}`,
    };
    this.queue = initialQuestions(options.mode, options.cards, this.ctx);
    this.skippedWordIds =
      options.mode === "cloze"
        ? options.cards.filter((card) => !isClozeEligible(card)).map((card) => card.id)
        : [];
    this.wordCount = new Set(options.cards.map((card) => card.id)).size;
    this.shownAt = this.now();
  }

  get current(): Question | null {
    return this.queue[0] ?? null;
  }

  get done(): boolean {
    return this.queue.length === 0;
  }

  /** Từ đã trả lời sai ít nhất một lần, theo thứ tự sai đầu tiên ("Ôn lại từ sai"). */
  get wrongWordIds(): string[] {
    return [...this.wrong];
  }

  get progress(): { answered: number; remaining: number } {
    return { answered: this.answers.length, remaining: this.queue.length };
  }

  /** Thời gian từ lúc câu hiện tại hiện ra (ms); dùng để tính q "quá 10 giây". */
  get elapsedMs(): number {
    return Math.max(0, Math.round(this.now() - this.shownAt));
  }

  /** Có thể hoàn tác câu vừa chấm (một bước). Bài kiểm tra không cho hoàn tác. */
  get canUndo(): boolean {
    return this.mode !== "test" && this.undoSnapshot !== null;
  }

  /**
   * Hoàn tác câu vừa chấm: hàng câu hỏi, lần chấm đầu, từ sai và tiến độ learn quay về như trước;
   * câu đó hiện lại để trả lời lại. Trả answer đã bỏ, null nếu không có gì để hoàn tác.
   */
  undo(): AnswerRecord | null {
    const snapshot = this.undoSnapshot;
    if (!snapshot || !this.canUndo) return null;
    this.queue = snapshot.queue;
    this.graded = snapshot.graded;
    this.wrong = snapshot.wrong;
    this.learnMcqCorrect = snapshot.learnMcqCorrect;
    this.learned = snapshot.learned;
    this.undoSnapshot = null;
    this.shownAt = this.now(); // đo lại thời gian nghĩ từ lúc câu hiện lại
    this.history.pop();
    return this.answers.pop() ?? null;
  }

  /** learn: số từ đã xong (gõ đúng) trên tổng số từ của phiên. */
  get learnProgress(): { done: number; total: number } {
    return { done: this.learned.size, total: this.wordCount };
  }

  /** Qua thẻ giới thiệu từ mới: không chấm, không sinh answer, không tính là đã chấm. */
  skipIntro(): void {
    if (!this.current?.intro) throw new Error("Câu hiện tại không phải thẻ giới thiệu");
    this.undoSnapshot = null; // chỉ hoàn tác ngay sau câu vừa chấm
    this.advance();
  }

  /** Chấm câu hiện tại, xếp lịch hỏi lại nếu cần, chuyển sang câu tiếp. */
  submit({ quality, isCorrect, given }: SubmitInput): AnswerRecord {
    const question = this.current;
    if (!question) throw new Error("Phiên đã hết câu hỏi");
    if (question.intro) throw new Error("Thẻ giới thiệu không chấm; dùng skipIntro()");

    this.undoSnapshot = {
      queue: [...this.queue],
      graded: new Set(this.graded),
      wrong: new Set(this.wrong),
      learnMcqCorrect: new Map(this.learnMcqCorrect),
      learned: new Set(this.learned),
    };
    const answeredAt = this.now();
    const wordId = question.card.id;
    const record: AnswerRecord = {
      client_answer_id: this.newId(),
      word_id: wordId,
      quality,
      is_correct: isCorrect,
      is_first_attempt: !this.graded.has(wordId),
      response_ms: Math.max(0, Math.round(answeredAt - this.shownAt)),
      answered_at: new Date(answeredAt).toISOString(),
    };
    this.graded.add(wordId);
    if (!isCorrect) this.wrong.add(wordId);
    this.answers.push(record);
    this.history.push({ question, given: given ?? null, record });

    this.queue.shift();
    if (this.mode === "learn") this.scheduleLearn(question, isCorrect);
    // Kiểm tra: chấm cuối bài, câu sai không hỏi lại.
    else if (!isCorrect && this.mode !== "test") this.insertLater(retryQuestion(question, this.ctx));
    this.shownAt = this.now();
    return record;
  }

  /**
   * learn: trắc nghiệm tới khi đúng 2 lần, rồi gõ đúng 1 lần là xong.
   * Sai thì về lại trắc nghiệm và bị đẩy xuống cuối; gõ sai cần đúng thêm 1 câu trắc nghiệm.
   */
  private scheduleLearn(question: Question, isCorrect: boolean): void {
    const card = question.card;
    const nextMcq = () => mcq(card, randomMcqKind(this.ctx.rng), this.ctx);
    if (isMcq(question.kind)) {
      if (!isCorrect) {
        this.queue.push(nextMcq());
        return;
      }
      const count = (this.learnMcqCorrect.get(card.id) ?? 0) + 1;
      this.learnMcqCorrect.set(card.id, count);
      this.insertLater(count >= LEARN_MCQ_TO_TYPE ? typeWord(card, this.ctx) : nextMcq());
    } else if (!isCorrect) {
      this.learnMcqCorrect.set(card.id, LEARN_MCQ_TO_TYPE - 1);
      this.queue.push(nextMcq());
    } else {
      this.learned.add(card.id); // gõ đúng: từ đã học xong
    }
  }

  /** Chèn sau 3–5 câu khác; hàng ngắn hơn thì xuống cuối. */
  private insertLater(question: Question): void {
    const gap = randomInt(REINSERT_MIN, REINSERT_MAX, this.ctx.rng);
    this.queue.splice(Math.min(gap, this.queue.length), 0, question);
  }

  private advance(): void {
    this.queue.shift();
    this.shownAt = this.now();
  }
}
