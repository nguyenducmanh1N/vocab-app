import { useEffect, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";

import { Button } from "@/components/Button";
import { playWord } from "@/services/audio";
import { useTheme } from "@/theme/useTheme";

import { gradeAnswer, gradeClozeAnswer, type NearReason } from "../grading";
import { answerQuality } from "../quality";
import type { Quality, Question } from "../types";
import { AnswerReveal } from "./AnswerReveal";
import { ClozePrompt } from "./ClozePrompt";
import { ListenPrompt } from "./ListenPrompt";
import { useAfterAnswer } from "./useAfterAnswer";

const NEAR_REASON: Record<NearReason, string> = {
  typo: "Sai 1 ký tự.",
  spelling: "Khác cách viết Anh–Mỹ.",
  synonym: "Bạn gõ một từ đồng nghĩa.",
};

type Props = {
  question: Question;
  onAnswer: (quality: Quality, isCorrect: boolean, given?: string) => void;
  onNext: () => void;
  elapsedMs: () => number;
  /** Bài kiểm tra: không báo đúng/sai, không gợi ý, trả lời xong sang câu tiếp ngay. */
  silent?: boolean;
};

/**
 * Câu gõ, chấm theo grading.ts, có "gần đúng" (PLAN.md 10.3):
 * type_word: xem nghĩa, gõ từ tiếng Anh. dictation: nghe phát âm, gõ lại; không hiện chữ trước khi trả lời.
 * cloze (dạng gõ): gõ chữ bị che trong câu ví dụ.
 */
export function TypeWordQuestion({ question, onAnswer, onNext, elapsedMs, silent = false }: Props) {
  const { colors } = useTheme();
  const { card } = question;
  const isDictation = question.kind === "dictation";
  const isCloze = question.kind === "cloze";
  const [input, setInput] = useState("");
  const [usedHint, setUsedHint] = useState(false);
  const [near, setNear] = useState<NearReason | null>(null);
  const { result, reveal } = useAfterAnswer(card, onNext);

  // Nghe chép: đề bài là âm thanh nên luôn đọc khi câu hiện ra.
  useEffect(() => {
    if (isDictation) playWord(card.term, card.audio_url);
  }, [isDictation, card.term, card.audio_url]);

  const settle = (correct: boolean, quality: Quality) => {
    setNear(null);
    onAnswer(quality, correct, input.trim());
    if (silent) onNext();
    else reveal(correct);
  };

  const check = () => {
    if (result !== null || near || !input.trim()) return;
    // Nghe chép, điền chỗ trống chấm theo đúng chữ cần điền: gõ từ đồng nghĩa không tính "gần đúng".
    const outcome = isCloze
      ? gradeClozeAnswer(input, question.answer, card.term)
      : gradeAnswer(input, question.answer, isDictation ? {} : { synonyms: card.synonyms });
    if (outcome.grade === "near" && silent) {
      // Kiểm tra không hỏi "gần đúng" (sẽ lộ đáp án): khác chính tả Anh–Mỹ vẫn là đúng (q = 3),
      // sai 1 ký tự hay gõ từ đồng nghĩa tính sai; xem lại ở cuối bài.
      const correct = outcome.reason === "spelling";
      settle(correct, answerQuality({ correct, responseMs: 0, nearMissAccepted: correct }));
      return;
    }
    if (outcome.grade === "near") {
      setNear(outcome.reason ?? "typo"); // chờ tự chấm "Tính là đúng" / "Tính là sai"
      return;
    }
    const correct = outcome.grade === "correct";
    settle(correct, answerQuality({ correct, responseMs: elapsedMs(), usedHint }));
  };

  /** Kiểm tra: không biết thì bỏ qua, tính một câu sai. */
  const skip = () => {
    if (result !== null || near) return;
    onAnswer(answerQuality({ correct: false, responseMs: elapsedMs() }), false, "");
    onNext();
  };

  const showHint = () => {
    setUsedHint(true);
    if (!input.trim()) setInput(question.hint ?? "");
  };

  const borderClass =
    result === null ? (near ? "border-warning" : "border-textMuted/30") : result ? "border-success" : "border-danger";

  return (
    <ScrollView contentContainerClassName="flex-grow gap-4 px-4 py-6" keyboardShouldPersistTaps="handled">
      {isDictation ? (
        <View className="flex-1 justify-center">
          <ListenPrompt card={card} label="Nghe và gõ lại từ" />
        </View>
      ) : isCloze ? (
        <View className="flex-1 justify-center">
          <ClozePrompt question={question} label="Gõ từ còn thiếu" />
        </View>
      ) : (
        <View className="flex-1 items-center justify-center gap-2">
          <Text className="text-body text-textMuted">Gõ từ tiếng Anh có nghĩa</Text>
          <Text testID="study-prompt" className="text-center text-[28px] font-bold text-text">
            {question.prompt}
          </Text>
          {usedHint && question.hint ? (
            <Text className="text-body text-textMuted">Bắt đầu bằng “{question.hint}”</Text>
          ) : null}
        </View>
      )}

      <TextInput
        testID="type-input"
        value={input}
        onChangeText={setInput}
        editable={result === null && !near}
        autoCorrect={false}
        autoCapitalize="none"
        spellCheck={false}
        autoComplete="off"
        autoFocus
        returnKeyType="done"
        submitBehavior="submit"
        onSubmitEditing={result === null ? check : onNext}
        placeholder={isDictation ? "Gõ từ bạn nghe được" : isCloze ? "Gõ từ còn thiếu" : "Gõ từ tiếng Anh"}
        placeholderTextColor={colors.textMuted}
        accessibilityLabel="Đáp án"
        className={`min-h-[56px] rounded-xl border-2 bg-surface px-4 text-[22px] text-text ${borderClass}`}
      />

      {near ? (
        <View className="gap-3 rounded-2xl border-2 border-warning bg-surface p-4">
          <Text className="text-body font-semibold text-warning">Gần đúng!</Text>
          <Text className="text-caption text-textMuted">{NEAR_REASON[near]}</Text>
          <Text className="text-body text-text">
            Bạn gõ: <Text className="font-semibold">{input.trim()}</Text>
          </Text>
          <Text className="text-body text-text">
            Đáp án: <Text className="font-semibold">{question.answer}</Text>
          </Text>
          <View className="flex-row gap-3">
            <View className="flex-1">
              <Button
                title="Tính là sai"
                variant="secondary"
                onPress={() => settle(false, answerQuality({ correct: false, responseMs: 0 }))}
              />
            </View>
            <View className="flex-1">
              <Button
                title="Tính là đúng"
                onPress={() =>
                  settle(true, answerQuality({ correct: true, responseMs: 0, nearMissAccepted: true }))
                }
              />
            </View>
          </View>
        </View>
      ) : null}

      {result !== null ? (
        <View className="gap-3">
          <AnswerReveal card={card} correct={result} />
          <Button title="Tiếp tục" onPress={onNext} />
        </View>
      ) : !near ? (
        <View className="flex-row gap-3">
          {silent ? (
            <View className="flex-1">
              <Button title="Không biết" variant="secondary" onPress={skip} />
            </View>
          ) : question.hint ? (
            <View className="flex-1">
              <Button title="Gợi ý" variant="secondary" onPress={showHint} disabled={usedHint} />
            </View>
          ) : null}
          <View className="flex-[2]">
            <Button title="Kiểm tra" onPress={check} disabled={!input.trim()} />
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}
