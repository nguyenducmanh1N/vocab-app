/** Chấm câu gõ (PLAN.md 10.3). */

export type Grade = "correct" | "near" | "wrong";

export const NEAR_MIN_LENGTH = 7; // "gần đúng" chỉ áp cho đáp án từ 7 ký tự

/** Cắt khoảng trắng hai đầu, viết thường, gộp khoảng trắng, đổi nháy cong thành nháy thẳng. */
export function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ").replace(/[‘’]/g, "'");
}

/** Khoảng cách Levenshtein (thêm, bớt, thay một ký tự). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return previous[b.length];
}

/**
 * Đúng khi khớp sau normalize. Sai đúng 1 ký tự với đáp án dài từ 7 ký tự là "gần đúng":
 * app hiện đáp án và cho chọn "Tính là đúng" (q = 3) hoặc "Tính là sai" (q = 1).
 */
export function grade(input: string, answer: string): Grade {
  const given = normalize(input);
  const expected = normalize(answer);
  if (!given) return "wrong";
  if (given === expected) return "correct";
  if (expected.length >= NEAR_MIN_LENGTH && levenshtein(given, expected) === 1) return "near";
  return "wrong";
}

/** Vì sao "gần đúng": sai 1 ký tự, khác chính tả Anh–Mỹ, hoặc gõ từ đồng nghĩa. */
export type NearReason = "typo" | "spelling" | "synonym";

export type GradeResult = { grade: Grade; reason?: NearReason };

// Từ đuôi -ise vốn không có dạng -ize: không đổi (tránh coi "promize" là chính tả Mỹ của promise).
const ISE_ONLY = new Set(
  (
    "advertise advise chastise comprise compromise concise demise despise devise disguise " +
    "enterprise excise exercise expertise franchise improvise incise merchandise otherwise " +
    "porpoise precise premise promise revise supervise surmise surprise televise tortoise " +
    "treatise turquoise"
  ).split(" "),
);

// Quy tắc Anh → Mỹ, áp cho từng từ; gốc từ đủ dài để không nhầm four/for, tour/tor…
const AMERICANIZE: readonly [RegExp, string][] = [
  [/\b([a-z]{3,})our(s|ed|ing|ite|ites|able)?\b/g, "$1or$2"], // colour, favourite, honourable
  [/\b([a-z]{2,})tre(s|d)?\b/g, "$1ter$2"], // centre, metre, theatres
  [/\b([a-z]{2,})ys(e|es|ed|ing)\b/g, "$1yz$2"], // analyse, paralysed
  [/\b([a-z]{2,}e)ll(ed|ing|er|ers)\b/g, "$1l$2"], // travelled, cancelling, labelled
  [/\b([a-z]{3,})ogue(s)?\b/g, "$1og$2"], // catalogue, dialogue
];

function americanizeWord(word: string): string {
  // Gốc từ ít nhất 4 chữ: bỏ qua praise, raise, noise, cruise…
  const ise = /^([a-z]{4,})is(e|es|ed|ing|ation|ations)$/.exec(word);
  if (ise && !ISE_ONLY.has(`${ise[1]}ise`)) return `${ise[1]}iz${ise[2]}`; // organise, realisation
  return AMERICANIZE.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), word);
}

/** Đưa chính tả Anh về chính tả Mỹ (chỉ để so sánh, không hiển thị). */
export function americanize(value: string): string {
  return value.split(" ").map(americanizeWord).join(" ");
}

/**
 * Chấm câu gõ có xét đáp án tương đương: chính tả Anh–Mỹ và từ đồng nghĩa của thẻ được tính
 * "gần đúng" (người dùng tự chọn Tính là đúng / Tính là sai), kèm lý do để hiển thị.
 */
export function gradeAnswer(
  input: string,
  answer: string,
  options: { synonyms?: readonly string[] } = {},
): GradeResult {
  const basic = grade(input, answer);
  if (basic === "correct") return { grade: "correct" };
  const given = normalize(input);
  if (!given) return { grade: "wrong" };
  if (americanize(given) === americanize(normalize(answer))) {
    return { grade: "near", reason: "spelling" };
  }
  if (options.synonyms?.some((synonym) => normalize(synonym) === given)) {
    return { grade: "near", reason: "synonym" };
  }
  return basic === "near" ? { grade: "near", reason: "typo" } : { grade: "wrong" };
}

/**
 * Điền chỗ trống dạng gõ: chấm như câu gõ theo đúng dạng chữ bị che trong câu
 * (vd. "deadlines"); gõ dạng gốc của từ ("deadline") cũng tính là đúng.
 */
export function gradeClozeAnswer(input: string, answer: string, term: string): GradeResult {
  const given = normalize(input);
  if (given && given === normalize(term)) return { grade: "correct" };
  return gradeAnswer(input, answer);
}
