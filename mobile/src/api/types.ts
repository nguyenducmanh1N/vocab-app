// Kiểu dữ liệu API, giữ snake_case như JSON (PLAN.md 6.2).

export type HealthOut = {
  status: string;
  db: string;
};

export type TokenPair = {
  access_token: string;
  refresh_token: string;
  token_type: "bearer";
  expires_in: number; // giây
};

export type NotifySettings = {
  daily_reminder: boolean;
  reminder_time: string; // HH:MM
  word_push: boolean;
  word_push_per_day: number;
  window_start: string;
  window_end: string;
  streak_guard: boolean;
};

export type UserSettings = {
  daily_new_words: number;
  max_reviews_per_day: number;
  daily_goal_cards: number;
  card_direction: "en_vi" | "vi_en";
  voice: "en-US" | "en-GB";
  speech_rate: number;
  auto_play_audio: boolean;
  theme: "system" | "light" | "dark";
  notify: NotifySettings;
};

export type UserOut = {
  id: string;
  email: string;
  display_name: string;
  level: string;
  timezone: string;
  settings: UserSettings;
  ai_consent_at: string | null; // null = chưa đồng ý hoặc đã rút lại (PLAN.md 9.16)
  ai_consent_version: number | null;
  created_at: string;
};

export type AiConsentOut = Pick<UserOut, "ai_consent_at" | "ai_consent_version">;

export type AuthOut = {
  user: UserOut;
  tokens: TokenPair;
};

export type ValidationDetail = {
  field: string; // ví dụ "body.email"
  message: string;
  type: string;
};

// --- Thư viện (PLAN.md 8.2, 8.3) ---

export type Page<T> = { items: T[]; total: number };

export type CategoryOut = {
  id: string;
  name: string;
  icon: string;
  color: string;
  sort_order: number;
  is_pinned: boolean;
  list_count: number;
};

export type CategoryCreate = { name: string; icon?: string; color?: string };
export type CategoryUpdate = Partial<CategoryCreate & { sort_order: number; is_pinned: boolean }>;

export type ListSource = "manual" | "ai" | "import";

export type ListOut = {
  id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  source: ListSource;
  ai_topic: string | null;
  word_count: number;
  mastered_count: number;
  due_count: number;
  created_at: string;
  updated_at: string;
};

export type ListFilters = { category_id?: string; uncategorized?: boolean; q?: string };

export type ListCreate = {
  name: string;
  category_id?: string | null;
  description?: string | null;
  source?: ListSource;
  ai_topic?: string | null;
};

export type ListUpdate = { name?: string; description?: string | null; category_id?: string | null };

export type Level = "new" | "learning" | "familiar" | "mastered";

export type ProgressOut = {
  level: Level;
  due_at: string | null;
  interval_days: number;
  repetitions: number;
  lapses: number;
  is_leech: boolean; // từ khó dai dẳng (PLAN.md 9.11)
  correct_count: number;
  wrong_count: number;
  last_reviewed_at: string | null;
};

export type ExampleSource = "ai" | "user" | "tatoeba" | "text" | "image";

export type Example = {
  en: string;
  vi: string;
  source?: ExampleSource | null;
  source_id?: string | null; // id câu trên Tatoeba, dạng chuỗi
  source_url?: string | null;
};

export type FamilyItem = {
  term: string;
  part_of_speech: string;
  meaning_vi: string;
  example_en: string;
};

export type Collocation = { phrase: string; meaning_vi: string; example_en: string };

export type Confusable = {
  term: string;
  difference_vi: string;
  example_en: string;
  other_example_en: string;
};

export type WordOut = {
  id: string;
  list_id: string;
  term: string;
  part_of_speech: string | null;
  ipa: string | null;
  meaning_vi: string;
  definition_en: string | null; // định nghĩa tiếng Anh từ từ điển, mỗi dòng một định nghĩa
  synonyms: string[];
  examples: Example[];
  audio_url: string | null;
  note: string | null;
  is_starred: boolean;
  progress: ProgressOut;
  mnemonic: string | null;
  word_family: FamilyItem[]; // tối đa 5
  collocations: Collocation[]; // tối đa 5
  confusables: Confusable[]; // tối đa 2
  created_at: string;
  updated_at: string;
};

export type WordSearchOut = WordOut & { list_name: string };

// --- Học (PLAN.md 8.2, 8.3) ---

export type StudyMode =
  | "review"
  | "flashcard"
  | "learn"
  | "mcq"
  | "typing"
  | "dictation"
  | "cloze"
  | "speaking"
  | "match"
  | "test";

export type StudyCard = WordOut & { is_new: boolean; is_due: boolean };

export type DistractorItem = {
  word_id: string;
  term: string;
  meaning_vi: string;
  part_of_speech: string | null;
};

export type StudyQueueOut = {
  cards: StudyCard[];
  distractor_pool: DistractorItem[];
  stats: { due_total: number; new_available: number };
};

export type StudyAnswerIn = {
  client_answer_id: string;
  word_id: string;
  quality: 0 | 1 | 2 | 3 | 4 | 5;
  is_correct: boolean;
  is_first_attempt: boolean;
  response_ms: number;
  answered_at: string;
};

export type StudySessionIn = {
  client_session_id: string;
  list_id: string | null;
  mode: StudyMode;
  started_at: string;
  finished: boolean;
  ended_at: string | null;
  answers: StudyAnswerIn[];
};

export type StudySessionOut = {
  session_id: string;
  accepted: number;
  duplicates: number;
  progress: { word_id: string; level: Level; due_at: string | null; interval_days: number }[];
  today: { cards_done: number; goal: number; goal_met: boolean; streak_current: number };
};

export type WordCreate = {
  term: string;
  meaning_vi: string;
  definition_en?: string | null;
  part_of_speech?: string | null;
  ipa?: string | null;
  synonyms?: string[];
  examples?: Example[];
  audio_url?: string | null;
  note?: string | null;
  is_starred?: boolean;
  mnemonic?: string | null; // ≤ 300 ký tự
  word_family?: FamilyItem[];
  collocations?: Collocation[];
  confusables?: Confusable[];
};

export type WordUpdate = Partial<WordCreate> & { list_id?: string };

export type WordFilters = { level?: Level; starred?: boolean; q?: string };

/** details của 409 DUPLICATE_WORD; có list_id khi trùng ở list khác. */
export type DuplicateDetails = { existing_word_id?: string; list_id?: string; list_name?: string };

export type DictionaryOut = {
  term: string;
  found: boolean;
  ipa: string | null;
  audio_url: string | null;
  part_of_speech: string | null;
  definitions_en: string[];
  available: boolean; // false khi từ điển đang lỗi: found=false lúc đó không có nghĩa là không có từ
};

// --- AI (PLAN.md 8.2, 8.3) ---

export type SuggestedWord = {
  term: string;
  part_of_speech: string | null;
  ipa: string | null;
  meaning_vi: string;
  definition_en?: string | null;
  synonyms: string[];
  examples: Example[];
  audio_url: string | null;
  already_saved: boolean;
  cloze_ready: boolean;
  corrected_from?: string | null; // từ người dùng gõ, khi AI đã sửa chính tả
};

export type EnrichOut = {
  remaining_today: number;
  words: SuggestedWord[];
  unknown_terms: string[];
};

export type TermSuggestion = { term: string; already_saved: boolean };

export type WordType = "word" | "phrase" | "idiom";

export type SuggestIn = {
  topic: string;
  level: string;
  count: 10 | 20 | 30;
  word_types: WordType[];
  exclude_terms?: string[];
};

export type SuggestOut = {
  generation_id: string;
  cached: boolean;
  remaining_today: number;
  words: SuggestedWord[];
};

export type HistoryItem = {
  generation_id: string;
  topic: string | null;
  level: string | null;
  word_count: number | null;
  created_at: string;
};

export type QuotaOut = {
  suggest_remaining: number;
  enrich_remaining: number;
  speaking_remaining: number;
  resets_at: string;
};

// --- Nhận xét luyện nói (PLAN.md 9.11) ---

export type SpeakingFeedbackIn = {
  audio_base64: string;
  mime_type: "audio/m4a";
  reference_text: string;
  term?: string;
};

export type SpeakingCriterion = { score: number; comment_vi: string };

/** ok: có chấm; no_speech / different_sentence: không chấm, không tính lượt. */
export type SpeakingStatus = "ok" | "no_speech" | "different_sentence";

export type SpeakingFeedback = {
  remaining_today: number;
  status: SpeakingStatus;
  transcript: string;
  overall: number | null;
  pronunciation: SpeakingCriterion | null;
  stress: SpeakingCriterion | null;
  fluency: SpeakingCriterion | null;
  fixes: { word: string; ipa: string; issue_vi: string; tip_vi: string }[];
  summary_vi: string;
};

export type BulkOut = { created: WordOut[]; skipped: { term: string; reason: string }[] };

// --- Thống kê (PLAN.md 8.3) ---

export type TodayStats = {
  cards_done: number;
  goal: number;
  goal_met: boolean;
  new_words: number;
  correct: number;
};

export type StatsOverview = {
  streak_current: number;
  streak_best: number;
  today: TodayStats;
  levels: Record<Level, number>;
  due_today: number;
  accuracy_30d: { mode: StudyMode; total: number; correct: number }[];
};

export type DailyStat = {
  date: string; // YYYY-MM-DD theo giờ của user
  cards_done: number;
  correct: number;
  new_words: number;
  study_seconds: number;
};

export type HardWord = {
  word_id: string;
  term: string;
  meaning_vi: string;
  wrong_count: number;
  lapses: number;
};

// --- Thông báo (PLAN.md 8.3, 9.9) ---

export type FeedItem = {
  word_id: string;
  term: string;
  part_of_speech: string | null;
  meaning_vi: string;
  example_en: string | null;
  example_vi: string | null;
};

export type WordFeedOut = { items: FeedItem[] };
