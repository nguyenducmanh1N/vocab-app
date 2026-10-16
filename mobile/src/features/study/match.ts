/**
 * Ghép cặp (PLAN.md 10.3): lưới 6 cặp từ–nghĩa xáo trộn, chạm hai ô để nối, tính giờ.
 * Mỗi lần nối là một answer gửi với mode = "match" (server không cập nhật lịch ôn, luật 3 ở 9.2).
 * Thuần TypeScript: rng, đồng hồ và sinh id được tiêm vào để test lặp lại được.
 */
import * as Crypto from "expo-crypto";

import { normalize } from "./grading";
import { answerQuality } from "./quality";
import { shuffle, type Rng } from "./random";
import type { AnswerRecord, StudyCard } from "./types";

export const MATCH_PAIRS = 6;

export type MatchSide = "term" | "meaning";

export type MatchTile = { id: string; wordId: string; side: MatchSide; text: string };

/**
 * select: chọn ô (hoặc đổi sang ô khác cùng phía). deselect: chạm lại ô đang chọn.
 * match: nối đúng. wrong: nối sai (tính một câu sai). ignored: ô đã nối hoặc đã xong.
 */
export type TapResult =
  | { type: "select" | "deselect" | "ignored" }
  | { type: "match" | "wrong"; tileIds: [string, string]; record: AnswerRecord };

/**
 * Tối đa 6 thẻ theo thứ tự truyền vào; bỏ thẻ trùng chữ từ hoặc trùng nghĩa với thẻ đã chọn,
 * vì hai ô giống hệt nhau thì không biết ô nào là "đúng".
 */
export function pickMatchCards(cards: readonly StudyCard[], count = MATCH_PAIRS): StudyCard[] {
  const terms = new Set<string>();
  const meanings = new Set<string>();
  const picked: StudyCard[] = [];
  for (const card of cards) {
    if (picked.length >= count) break;
    const term = normalize(card.term);
    const meaning = normalize(card.meaning_vi);
    if (!term || !meaning || terms.has(term) || meanings.has(meaning)) continue;
    terms.add(term);
    meanings.add(meaning);
    picked.push(card);
  }
  return picked;
}

/**
 * Chữ trên ô nghĩa: nghĩa đầu tiên (trước dấu ";") cho vừa ô với cỡ chữ cố định; thẻ nào trùng
 * nghĩa đầu với thẻ khác trong ván thì giữ nguyên nghĩa đầy đủ để vẫn phân biệt được.
 */
export function matchMeaningLabels(cards: readonly StudyCard[]): Map<string, string> {
  const first = new Map(cards.map((card) => [card.id, card.meaning_vi.split(";")[0].trim()]));
  const counts = new Map<string, number>();
  for (const label of first.values()) {
    const key = normalize(label);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Map(
    cards.map((card) => {
      const label = first.get(card.id) ?? "";
      const unique = label !== "" && counts.get(normalize(label)) === 1;
      return [card.id, unique ? label : card.meaning_vi];
    }),
  );
}

export type MatchOptions = {
  cards: readonly StudyCard[];
  rng?: Rng;
  now?: () => number; // ms
  newId?: () => string;
};

export class MatchGame {
  readonly answers: AnswerRecord[] = [];
  readonly tiles: readonly MatchTile[];
  readonly cards: readonly StudyCard[];
  readonly startedAt: number;

  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly tileById: Map<string, MatchTile>;
  private selected: MatchTile | null = null;
  private readonly matched = new Set<string>(); // word_id đã nối đúng
  private readonly graded = new Set<string>(); // word_id đã có answer (lần chấm đầu)
  private readonly wrong = new Set<string>();
  private lastAnswerAt: number;
  private finishedAt: number | null = null;

  constructor(options: MatchOptions) {
    const rng = options.rng ?? Math.random;
    this.now = options.now ?? Date.now;
    this.newId = options.newId ?? Crypto.randomUUID;
    // Chọn ngẫu nhiên trong các thẻ server trả về: match không đổi lịch ôn nên thứ tự server
    // lần nào cũng như nhau, lấy 6 thẻ đầu thì ván nào cũng gặp lại đúng 6 từ đó.
    this.cards = pickMatchCards(shuffle(options.cards, rng));
    const meaningLabels = matchMeaningLabels(this.cards);
    const tiles = this.cards.flatMap((card): MatchTile[] => [
      { id: `t-${card.id}`, wordId: card.id, side: "term", text: card.term },
      {
        id: `m-${card.id}`,
        wordId: card.id,
        side: "meaning",
        text: meaningLabels.get(card.id) ?? card.meaning_vi,
      },
    ]);
    this.tiles = shuffle(tiles, rng);
    this.tileById = new Map(this.tiles.map((tile) => [tile.id, tile]));
    this.startedAt = this.now();
    this.lastAnswerAt = this.startedAt;
    if (!this.cards.length) this.finishedAt = this.startedAt;
  }

  get pairCount(): number {
    return this.cards.length;
  }

  get matchedCount(): number {
    return this.matched.size;
  }

  get done(): boolean {
    return this.finishedAt !== null;
  }

  get selectedTileId(): string | null {
    return this.selected?.id ?? null;
  }

  /** Từ đã nối sai ít nhất một lần, theo thứ tự sai đầu tiên ("Ôn lại từ sai"). */
  get wrongWordIds(): string[] {
    return [...this.wrong];
  }

  /** Thời gian chơi (ms); dừng lại khi đã nối hết. */
  get elapsedMs(): number {
    return Math.max(0, (this.finishedAt ?? this.now()) - this.startedAt);
  }

  isMatched(tileId: string): boolean {
    const tile = this.tileById.get(tileId);
    return tile !== undefined && this.matched.has(tile.wordId);
  }

  tap(tileId: string): TapResult {
    const tile = this.tileById.get(tileId);
    if (!tile || this.done || this.matched.has(tile.wordId)) return { type: "ignored" };
    const first = this.selected;
    if (!first || first.side === tile.side) {
      if (first?.id === tile.id) {
        this.selected = null;
        return { type: "deselect" };
      }
      this.selected = tile;
      return { type: "select" };
    }

    this.selected = null;
    const tileIds: [string, string] = [first.id, tile.id];
    if (first.wordId === tile.wordId) {
      const record = this.record(tile.wordId, true);
      this.matched.add(tile.wordId);
      if (this.matched.size === this.cards.length) this.finishedAt = this.now();
      return { type: "match", tileIds, record };
    }
    // Nối sai: tính một câu sai cho từ của ô chạm trước (ô đang "hỏi").
    return { type: "wrong", tileIds, record: this.record(first.wordId, false) };
  }

  private record(wordId: string, correct: boolean): AnswerRecord {
    const answeredAt = this.now();
    const record: AnswerRecord = {
      client_answer_id: this.newId(),
      word_id: wordId,
      quality: answerQuality({ correct, responseMs: 0 }),
      is_correct: correct,
      is_first_attempt: !this.graded.has(wordId),
      response_ms: Math.max(0, Math.round(answeredAt - this.lastAnswerAt)),
      answered_at: new Date(answeredAt).toISOString(),
    };
    this.graded.add(wordId);
    if (!correct) this.wrong.add(wordId);
    this.lastAnswerAt = answeredAt;
    this.answers.push(record);
    return record;
  }
}

/** Đồng hồ ván ghép cặp: "0:23.4". */
export function formatMatchTime(ms: number): string {
  const tenths = Math.floor(Math.max(0, ms) / 100);
  const minutes = Math.floor(tenths / 600);
  const seconds = Math.floor((tenths % 600) / 10);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${tenths % 10}`;
}
