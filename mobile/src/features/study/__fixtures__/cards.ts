import type { Level } from "@/api/types";

import type { StudyCard } from "../types";

/** Thẻ học mẫu cho test; chỉ các trường engine dùng là có ý nghĩa. */
export function makeCard(
  term: string,
  meaning_vi: string,
  { pos = "noun", level = "learning" }: { pos?: string | null; level?: Level } = {},
): StudyCard {
  return {
    id: `id-${term}`,
    list_id: "list-1",
    term,
    part_of_speech: pos,
    ipa: null,
    meaning_vi,
    definition_en: null,
    synonyms: [],
    examples: [],
    audio_url: null,
    note: null,
    is_starred: false,
    progress: {
      level,
      due_at: level === "new" ? null : "2026-10-15T00:00:00Z",
      interval_days: level === "new" ? 0 : 1,
      repetitions: 0,
      lapses: 0,
      is_leech: false,
      correct_count: 0,
      wrong_count: 0,
      last_reviewed_at: null,
    },
    mnemonic: null,
    word_family: [],
    collocations: [],
    confusables: [],
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    is_new: level === "new",
    is_due: level !== "new",
  };
}

/** Sinh id tăng dần: "id-1", "id-2"… */
export function counterIds(prefix = "a"): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}
