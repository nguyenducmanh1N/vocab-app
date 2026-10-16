import { describe, expect, it } from "@jest/globals";

import { MatchGame, formatMatchTime, matchMeaningLabels, pickMatchCards, type MatchTile } from "../match";
import { seededRng } from "../random";
import { counterIds, makeCard } from "../__fixtures__/cards";

const WORDS = [
  ["deadline", "hạn chót"],
  ["meeting", "cuộc họp"],
  ["budget", "ngân sách"],
  ["report", "báo cáo"],
  ["invoice", "hoá đơn"],
  ["colleague", "đồng nghiệp"],
  ["agenda", "chương trình họp"],
  ["memo", "bản ghi nhớ"],
].map(([term, meaning]) => makeCard(term, meaning));

function gameFor(cards = WORDS, seed = 3) {
  let clock = 1_000;
  const game = new MatchGame({ cards, rng: seededRng(seed), newId: counterIds(), now: () => clock });
  return { game, tick: (ms: number) => (clock += ms) };
}

const tileOf = (game: MatchGame, wordId: string, side: MatchTile["side"]) =>
  game.tiles.find((t) => t.wordId === wordId && t.side === side)!.id;

describe("MatchGame", () => {
  it("lưới 6 cặp: 12 ô, mỗi từ một ô từ và một ô nghĩa", () => {
    const { game } = gameFor();
    expect(game.pairCount).toBe(6);
    expect(game.tiles).toHaveLength(12);
    for (const card of game.cards) {
      expect(game.tiles.filter((t) => t.wordId === card.id).map((t) => t.side).sort()).toEqual([
        "meaning",
        "term",
      ]);
    }
  });

  it("nối đúng hết: mỗi từ một answer đúng, lần chấm đầu; đồng hồ dừng khi xong", () => {
    const { game, tick } = gameFor();
    for (const card of game.cards) {
      tick(1500);
      expect(game.tap(tileOf(game, card.id, "meaning")).type).toBe("select");
      expect(game.tap(tileOf(game, card.id, "term")).type).toBe("match");
    }
    expect(game.done).toBe(true);
    expect(game.answers).toHaveLength(6);
    expect(game.answers.every((a) => a.is_correct && a.is_first_attempt && a.quality === 4)).toBe(true);
    expect(game.answers.every((a) => a.response_ms === 1500)).toBe(true);
    const final = game.elapsedMs;
    tick(5000);
    expect(game.elapsedMs).toBe(final);
    expect(final).toBe(9000);
  });

  it("nối sai: một câu sai (q=1) cho từ của ô chạm trước; lần nối đúng sau không phải lần đầu", () => {
    const { game } = gameFor();
    const [a, b] = game.cards;
    game.tap(tileOf(game, a.id, "term"));
    const wrong = game.tap(tileOf(game, b.id, "meaning"));
    expect(wrong.type).toBe("wrong");
    expect(game.answers[0]).toMatchObject({ word_id: a.id, is_correct: false, quality: 1, is_first_attempt: true });
    expect(game.selectedTileId).toBeNull();
    expect(game.wrongWordIds).toEqual([a.id]);

    game.tap(tileOf(game, a.id, "term"));
    expect(game.tap(tileOf(game, a.id, "meaning")).type).toBe("match");
    expect(game.answers[1]).toMatchObject({ word_id: a.id, is_correct: true, is_first_attempt: false });
    // b chưa có answer nào: lần nối đầu của b vẫn là lần chấm đầu
    game.tap(tileOf(game, b.id, "term"));
    game.tap(tileOf(game, b.id, "meaning"));
    expect(game.answers[2]).toMatchObject({ word_id: b.id, is_first_attempt: true });
  });

  it("chạm lại ô đang chọn thì bỏ chọn; chạm ô cùng phía thì đổi lựa chọn, không tính sai", () => {
    const { game } = gameFor();
    const [a, b] = game.cards;
    game.tap(tileOf(game, a.id, "term"));
    expect(game.tap(tileOf(game, a.id, "term")).type).toBe("deselect");
    game.tap(tileOf(game, a.id, "term"));
    expect(game.tap(tileOf(game, b.id, "term")).type).toBe("select");
    expect(game.selectedTileId).toBe(tileOf(game, b.id, "term"));
    expect(game.answers).toHaveLength(0);
  });

  it("ô đã nối thì bỏ qua", () => {
    const { game } = gameFor();
    const [a] = game.cards;
    game.tap(tileOf(game, a.id, "term"));
    game.tap(tileOf(game, a.id, "meaning"));
    expect(game.tap(tileOf(game, a.id, "term")).type).toBe("ignored");
    expect(game.answers).toHaveLength(1);
  });

  it("chọn ngẫu nhiên trong các thẻ được trả về (không luôn là 6 thẻ đầu)", () => {
    const sets = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => gameFor(WORDS, seed).game.cards.map((c) => c.id).sort().join()),
    );
    expect(sets.size).toBeGreaterThan(1);
  });
});

describe("pickMatchCards", () => {
  it("bỏ thẻ trùng chữ từ hoặc trùng nghĩa (không phân biệt hoa thường, khoảng trắng)", () => {
    const cards = [
      makeCard("deadline", "hạn chót"),
      makeCard("Deadline ", "thời hạn"),
      makeCard("due date", "Hạn  chót"),
      makeCard("budget", "ngân sách"),
    ];
    expect(pickMatchCards(cards).map((c) => c.term)).toEqual(["deadline", "budget"]);
  });

  it("tối đa 6 cặp", () => {
    expect(pickMatchCards(WORDS)).toHaveLength(6);
  });
});

describe("formatMatchTime", () => {
  it.each([
    [0, "0:00.0"],
    [23_456, "0:23.4"],
    [61_000, "1:01.0"],
  ])("%d ms → %s", (ms, text) => {
    expect(formatMatchTime(ms)).toBe(text);
  });
});

describe("matchMeaningLabels", () => {
  it("ô nghĩa chỉ hiện nghĩa đầu, trừ khi trùng nghĩa đầu với thẻ khác", () => {
    const cards = [
      makeCard("travel", "đi du lịch; đi lại"),
      makeCard("trip", "chuyến đi; cuộc hành trình"),
      makeCard("journey", "chuyến đi; hành trình dài"),
      makeCard("hotel", "khách sạn"),
    ];

    const labels = matchMeaningLabels(cards);

    expect(cards.map((card) => labels.get(card.id))).toEqual([
      "đi du lịch",
      "chuyến đi; cuộc hành trình",
      "chuyến đi; hành trình dài",
      "khách sạn",
    ]);
  });

  it("ô nghĩa trong ván dùng nhãn rút gọn", () => {
    const game = new MatchGame({ cards: [makeCard("travel", "đi du lịch; đi lại")], newId: counterIds() });

    expect(game.tiles.find((tile) => tile.side === "meaning")?.text).toBe("đi du lịch");
  });
});
