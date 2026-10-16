/** Một phiên Ghép cặp: lấy thẻ, giữ MatchGame, gửi kết quả với mode = "match" (useSessionSubmit). */
import { useMemo, useState } from "react";

import { MatchGame, type TapResult } from "./match";
import { useSessionCards, useSessionSubmit } from "./useSessionSubmit";

/** Bản chụp trạng thái game để render (game là object thay đổi bên trong, không dùng trực tiếp). */
type MatchView = {
  selectedTileId: string | null;
  matchedWordIds: readonly string[];
  answered: number;
  done: boolean;
  /** Thời gian cả ván (ms) khi đã xong; null khi đang chơi. */
  finalMs: number | null;
};

function viewOf(game: MatchGame, matched: readonly string[]): MatchView {
  return {
    selectedTileId: game.selectedTileId,
    matchedWordIds: matched,
    answered: game.answers.length,
    done: game.done,
    finalMs: game.done ? game.elapsedMs : null,
  };
}

const EMPTY: MatchView = { selectedTileId: null, matchedWordIds: [], answered: 0, done: false, finalMs: null };

export function useMatchSession(listId: string | null) {
  const queue = useSessionCards("match", listId);
  // Dữ liệu queue không refetch trong phiên nên game chỉ tạo một lần.
  const game = useMemo(() => (queue.data ? new MatchGame({ cards: queue.data.cards }) : null), [queue.data]);
  const submit = useSessionSubmit("match", listId, game, queue.data);
  const [view, setView] = useState<MatchView | null>(null);
  const current = view ?? (game ? viewOf(game, []) : EMPTY);

  const tap = (tileId: string): TapResult => {
    if (!game) return { type: "ignored" };
    const result = game.tap(tileId);
    if (result.type === "match" || result.type === "wrong") submit.afterAnswer();
    const matched =
      result.type === "match" ? [...current.matchedWordIds, result.record.word_id] : current.matchedWordIds;
    setView(viewOf(game, matched));
    return result;
  };

  return {
    queue,
    /** Ô và số cặp không đổi trong ván. */
    tiles: game?.tiles ?? [],
    pairCount: game?.pairCount ?? 0,
    startedAt: game?.startedAt ?? 0,
    ...current,
    tap,
    finish: submit.finish,
  };
}
