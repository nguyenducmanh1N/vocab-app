import { useQuery } from "@tanstack/react-query";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, ScrollView, Text, TextInput, View } from "react-native";

import { messageFor } from "@/api/errorMessages";
import type { WordOut } from "@/api/types";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { IconButton } from "@/components/IconButton";
import { fetchAllWords } from "@/features/library/listExtras";
import { playWord, speakSentence, stopAll } from "@/services/audio";
import { useTheme } from "@/theme/useTheme";
import { isClozeCorrect, makeCloze, type Cloze } from "@/utils/cloze";

const ROUND_SIZE = 10;

type Question = { word: WordOut; cloze: Cloze; sentence: string; translation: string };

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Câu hỏi từ câu ví dụ có chứa từ (cloze_ready); mỗi từ một câu. */
function buildQuestions(words: WordOut[]): Question[] {
  const questions: Question[] = [];
  for (const word of words) {
    for (const example of word.examples) {
      const cloze = makeCloze(example.en, word.term);
      if (cloze) {
        questions.push({ word, cloze, sentence: example.en, translation: example.vi });
        break;
      }
    }
  }
  return shuffle(questions).slice(0, ROUND_SIZE);
}

/**
 * Luyện điền từ vào câu ví dụ. Bản đầu: chưa ghi tiến độ ôn (SM-2 làm ở giai đoạn 3).
 */
export default function ClozeScreen() {
  const { listId } = useLocalSearchParams<{ listId: string }>();
  const { colors } = useTheme();
  const words = useQuery({
    queryKey: ["words", listId, "all"],
    queryFn: () => fetchAllWords(listId),
  });
  const [round, setRound] = useState(0);
  const questions = useMemo(
    () => (words.data ? buildQuestions(words.data) : []),
    // round đổi → xáo câu hỏi mới
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [words.data, round],
  );
  const [index, setIndex] = useState(0);
  const [input, setInput] = useState("");
  const [checked, setChecked] = useState<boolean | null>(null);
  const [score, setScore] = useState(0);

  useEffect(() => stopAll, []);

  if (words.isPending) return <ActivityIndicator className="flex-1 bg-background" />;
  if (words.isError) {
    return (
      <View className="flex-1 justify-center bg-background">
        <EmptyState
          icon="cloud-offline-outline"
          title="Không tải được từ"
          description={messageFor(words.error)}
          actionLabel="Thử lại"
          onAction={() => words.refetch()}
        />
      </View>
    );
  }
  if (!questions.length) {
    return (
      <View className="flex-1 justify-center bg-background">
        <EmptyState
          icon="document-text-outline"
          title="Chưa có câu ví dụ chứa từ"
          description="Thêm câu ví dụ có chứa từ (hoặc dùng Tự điền) để luyện điền từ."
          actionLabel="Quay lại"
          onAction={() => router.back()}
        />
      </View>
    );
  }

  const done = index >= questions.length;
  if (done) {
    return (
      <>
        <Stack.Screen options={{ title: "Luyện điền từ" }} />
        <View className="flex-1 justify-center gap-4 bg-background p-6">
          <Text className="text-center text-title font-bold text-text">
            {score}/{questions.length} câu đúng
          </Text>
          <Button
            title="Luyện lượt mới"
            onPress={() => {
              setRound((r) => r + 1);
              setIndex(0);
              setScore(0);
              setInput("");
              setChecked(null);
            }}
          />
          <Button title="Xong" variant="secondary" onPress={() => router.back()} />
        </View>
      </>
    );
  }

  const q = questions[index];
  const check = () => {
    if (checked !== null) return;
    const ok = isClozeCorrect(input, q.cloze, q.word.term);
    setChecked(ok);
    if (ok) setScore((s) => s + 1);
    playWord(q.word.term, q.word.audio_url);
  };
  const next = () => {
    setIndex((i) => i + 1);
    setInput("");
    setChecked(null);
  };

  return (
    <>
      <Stack.Screen options={{ title: `Câu ${index + 1}/${questions.length}` }} />
      <KeyboardAvoidingView behavior="padding" className="flex-1 bg-background" keyboardVerticalOffset={80}>
        <ScrollView contentContainerClassName="gap-4 p-4" keyboardShouldPersistTaps="handled">
          <Text className="text-caption text-textMuted">Điền từ còn thiếu vào câu:</Text>
          <Card className="gap-3">
            <Text className="text-[20px] leading-7 text-text">
              {q.cloze.before}
              <Text className="font-bold text-primary">
                {checked === null ? " _____ " : q.cloze.answer}
              </Text>
              {q.cloze.after}
            </Text>
            {q.translation ? <Text className="text-caption text-textMuted">{q.translation}</Text> : null}
            <Text className="text-caption text-textMuted">Gợi ý: {q.word.meaning_vi}</Text>
          </Card>

          <TextInput
            value={input}
            onChangeText={setInput}
            editable={checked === null}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={checked === null ? check : next}
            placeholder="Gõ từ còn thiếu"
            placeholderTextColor={colors.textMuted}
            accessibilityLabel="Đáp án"
            className={`min-h-[52px] rounded-xl border bg-surface px-3 text-[20px] text-text ${
              checked === null ? "border-textMuted/30" : checked ? "border-success" : "border-danger"
            }`}
          />

          {checked !== null ? (
            <View className="flex-row items-center justify-between">
              <Text className={`text-body font-semibold ${checked ? "text-success" : "text-danger"}`}>
                {checked ? "Chính xác!" : `Đáp án: ${q.cloze.answer}`}
              </Text>
              <IconButton
                icon="volume-high-outline"
                accessibilityLabel="Nghe cả câu"
                onPress={() => speakSentence(q.sentence)}
              />
            </View>
          ) : null}

          {checked === null ? (
            <Button title="Kiểm tra" onPress={check} disabled={!input.trim()} />
          ) : (
            <Button title={index + 1 < questions.length ? "Câu tiếp" : "Xem kết quả"} onPress={next} />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
