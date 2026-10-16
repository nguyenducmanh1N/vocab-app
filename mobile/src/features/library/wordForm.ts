import { z } from "zod";

import type { WordCreate, WordOut } from "@/api/types";

export const MAX_EXAMPLES = 3; // giới hạn của API (8.2)
/** Form chỉ hiện 1 ô ví dụ; các ví dụ khác của từ (nếu có) được giữ nguyên khi lưu. */
export const VISIBLE_EXAMPLES = 1;
export const MAX_SYNONYMS = 5;

function splitSynonyms(text: string): string[] {
  return text
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Giới hạn độ dài theo PLAN.md 8.2.
export const wordFormSchema = z.object({
  term: z.string().trim().min(1, { error: "Nhập từ" }).max(100, { error: "Tối đa 100 ký tự" }),
  meaning_vi: z
    .string()
    .trim()
    .min(1, { error: "Nhập nghĩa tiếng Việt" })
    .max(500, { error: "Tối đa 500 ký tự" }),
  definition_en: z.string().max(1500),
  part_of_speech: z.string().trim().max(20, { error: "Tối đa 20 ký tự" }),
  ipa: z.string().trim().max(100, { error: "Tối đa 100 ký tự" }),
  synonyms: z.string().refine((text) => splitSynonyms(text).length <= MAX_SYNONYMS, {
    error: `Tối đa ${MAX_SYNONYMS} từ đồng nghĩa`,
  }).refine((text) => splitSynonyms(text).every((s) => s.length <= 60), {
    error: "Mỗi từ đồng nghĩa tối đa 60 ký tự",
  }),
  examples: z
    .array(
      z
        .object({
          en: z.string().trim().max(300, { error: "Tối đa 300 ký tự" }),
          vi: z.string().trim().max(300, { error: "Tối đa 300 ký tự" }),
        })
        .refine((ex) => !ex.vi || ex.en, { error: "Nhập câu tiếng Anh", path: ["en"] }),
    )
    .min(VISIBLE_EXAMPLES)
    .max(MAX_EXAMPLES),
  note: z.string().trim().max(1000, { error: "Tối đa 1000 ký tự" }),
  audio_url: z.string(),
  is_starred: z.boolean(),
  list_id: z.string().min(1),
});

export type WordFormInput = z.input<typeof wordFormSchema>;
export type WordFormValues = z.output<typeof wordFormSchema>;

export function emptyForm(listId: string): WordFormInput {
  return {
    term: "",
    meaning_vi: "",
    definition_en: "",
    part_of_speech: "",
    ipa: "",
    synonyms: "",
    examples: [{ en: "", vi: "" }],
    note: "",
    audio_url: "",
    is_starred: false,
    list_id: listId,
  };
}

export function formFromWord(word: WordOut): WordFormInput {
  return {
    term: word.term,
    meaning_vi: word.meaning_vi,
    definition_en: word.definition_en ?? "",
    part_of_speech: word.part_of_speech ?? "",
    ipa: word.ipa ?? "",
    synonyms: word.synonyms.join(", "),
    // Giữ mọi ví dụ đang có; form chỉ hiện ví dụ đầu tiên.
    examples: word.examples.length
      ? word.examples.map((ex) => ({ en: ex.en, vi: ex.vi }))
      : [{ en: "", vi: "" }],
    note: word.note ?? "",
    audio_url: word.audio_url ?? "",
    is_starred: word.is_starred,
    list_id: word.list_id,
  };
}

/** Dữ liệu form → body API: chuỗi rỗng thành null, bỏ ví dụ trống. */
export function toPayload(values: WordFormValues): WordCreate {
  return {
    term: values.term,
    meaning_vi: values.meaning_vi,
    definition_en: values.definition_en.trim() || null,
    part_of_speech: values.part_of_speech || null,
    ipa: values.ipa || null,
    synonyms: splitSynonyms(values.synonyms),
    examples: values.examples.filter((ex) => ex.en).map((ex) => ({ en: ex.en, vi: ex.vi })),
    audio_url: values.audio_url || null,
    note: values.note || null,
    is_starred: values.is_starred,
  };
}
