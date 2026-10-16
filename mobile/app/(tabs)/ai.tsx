import { router } from "expo-router";
import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { SuggestIn, WordType } from "@/api/types";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { Input } from "@/components/Input";
import { Skeleton } from "@/components/Skeleton";
import { aiButtonTitle, requestAiConsent, useAiConsent } from "@/features/ai/consent";
import { aiErrorMessage, isRetryable } from "@/features/ai/format";
import { useAiHistory, useAiQuota, useExtract, useOpenHistory, useSuggest } from "@/hooks/useAi";
import { imageTopic, pickImageBase64 } from "@/features/ai/imageImport";
import { pickOption } from "@/features/library/dialogs";
import { useAuthStore } from "@/stores/authStore";
import { useSuggestStore } from "@/stores/suggestStore";

const SAMPLE_TOPICS = ["Công sở", "Họp hành", "Email", "Du lịch", "Nhà hàng", "Sức khoẻ", "Công nghệ"];
const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
const COUNTS = [10, 20, 30] as const;
const WORD_TYPES: { value: WordType; label: string }[] = [
  { value: "word", label: "Từ đơn" },
  { value: "phrase", label: "Cụm từ" },
  { value: "idiom", label: "Thành ngữ" },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="gap-2">
      <Text className="text-caption font-semibold text-textMuted">{title}</Text>
      <View className="flex-row flex-wrap gap-2">{children}</View>
    </View>
  );
}

export default function AiScreen() {
  const userLevel = useAuthStore((s) => s.user?.level);
  const [topic, setTopic] = useState("");
  const [level, setLevel] = useState<string>(userLevel ?? "B1");
  const [count, setCount] = useState<SuggestIn["count"]>(20);
  const [wordTypes, setWordTypes] = useState<WordType[]>(["word", "phrase"]);
  const [topicError, setTopicError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const { granted, ensure } = useAiConsent();
  const quota = useAiQuota();
  const history = useAiHistory();
  const suggest = useSuggest();
  const openHistory = useOpenHistory();
  const extract = useExtract();
  const [imageError, setImageError] = useState<string | null>(null);
  const start = useSuggestStore((s) => s.start);
  const draft = useSuggestStore((s) => s.params);
  const draftCount = useSuggestStore((s) => s.items.length);
  const clearDraft = useSuggestStore((s) => s.clear);

  const toggleType = (value: WordType) =>
    setWordTypes((types) =>
      types.includes(value)
        ? types.length > 1
          ? types.filter((t) => t !== value) // luôn giữ ít nhất 1 loại
          : types
        : [...types, value],
    );

  const run = async () => {
    const trimmed = topic.trim();
    if (trimmed.length < 2 || trimmed.length > 100) {
      setTopicError("Chủ đề cần từ 2 đến 100 ký tự");
      return;
    }
    setTopicError(null);
    if (!(await ensure())) return;
    const params: SuggestIn = { topic: trimmed, level, count, word_types: wordTypes };
    try {
      const result = await suggest.mutateAsync(params);
      start(params, result.words);
      router.push("/ai/preview");
    } catch {
      // lỗi hiện bên dưới qua suggest.error
    }
  };

  const reopen = async (id: string, itemTopic: string, itemLevel: string | null, itemCount: number | null) => {
    if (!(await ensure())) return;
    try {
      const result = await openHistory.mutateAsync(id);
      start(
        {
          topic: itemTopic,
          level: itemLevel ?? level,
          count: (COUNTS as readonly number[]).includes(itemCount ?? 0)
            ? (itemCount as SuggestIn["count"])
            : 20,
          word_types: wordTypes,
        },
        result.words,
      );
      router.push("/ai/preview");
    } catch {
      // lỗi hiện qua openHistory.error
    }
  };

  /** Chụp/chọn ảnh trang sách, AI lọc ra từ đáng học rồi mở màn Xem trước. */
  const fromImage = async () => {
    if (!(await ensure())) return;
    const choice = await pickOption("Lọc từ trong ảnh", ["Chụp ảnh", "Chọn từ thư viện ảnh"]);
    if (choice === null) return;
    setImageError(null);
    try {
      const base64 = await pickImageBase64(choice === 0 ? "camera" : "library");
      if (!base64) return;
      const result = await extract.mutateAsync({ base64, level });
      start({ topic: imageTopic(), level, count, word_types: wordTypes }, result.words);
      router.push("/ai/preview");
    } catch (err) {
      setImageError(
        err instanceof Error && err.message === "PERMISSION_DENIED"
          ? "Cần cho phép truy cập camera/ảnh trong Cài đặt của iPhone."
          : aiErrorMessage(err),
      );
    }
  };

  const onRefresh = async () => {
    if (!granted) return; // chưa đồng ý: server trả 403, không gọi
    setRefreshing(true);
    await Promise.all([quota.refetch(), history.refetch()]);
    setRefreshing(false);
  };

  const remaining = quota.data?.suggest_remaining;

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background">
      <ScrollView
        contentContainerClassName="gap-5 px-4 pb-12 pt-4"
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View className="gap-1">
          <Text className="text-title font-bold text-text">AI gợi ý</Text>
          <Text className="text-caption text-textMuted">
            {remaining === undefined
              ? "Gõ một chủ đề, AI soạn list từ để bạn duyệt."
              : `Còn ${remaining} lượt gợi ý hôm nay.`}
          </Text>
        </View>

        {!granted ? (
          <View className="gap-2 rounded-2xl bg-surface p-4">
            <Text className="text-body text-text">
              Cần đồng ý dùng AI: tính năng này gửi chủ đề, từ hoặc ảnh bạn chọn cho Google Gemini.
            </Text>
            <Button title="Xem và đồng ý" variant="secondary" onPress={() => void requestAiConsent()} />
          </View>
        ) : null}

        {draft && draftCount ? (
          <View className="gap-2 rounded-2xl bg-surface p-4">
            <Text className="text-body text-text">
              Bạn còn {draftCount} từ gợi ý về “{draft.topic}” chưa lưu.
            </Text>
            <View className="flex-row gap-3">
              <View className="flex-1">
                <Button title="Tiếp tục duyệt" onPress={() => router.push("/ai/preview")} />
              </View>
              <View className="flex-1">
                <Button title="Bỏ" variant="ghost" onPress={clearDraft} />
              </View>
            </View>
          </View>
        ) : null}

        <Input
          label="Chủ đề"
          value={topic}
          onChangeText={(text) => {
            setTopic(text);
            if (topicError) setTopicError(null);
          }}
          placeholder="Ví dụ: Phỏng vấn xin việc IT"
          error={topicError ?? undefined}
          maxLength={100}
          returnKeyType="go"
          onSubmitEditing={run}
        />

        <Section title="Chủ đề mẫu">
          {SAMPLE_TOPICS.map((sample) => (
            <Chip key={sample} label={sample} selected={topic === sample} onPress={() => setTopic(sample)} />
          ))}
        </Section>

        <Section title="Trình độ">
          {LEVELS.map((l) => (
            <Chip key={l} label={l} selected={level === l} onPress={() => setLevel(l)} />
          ))}
        </Section>

        <Section title="Số từ">
          {COUNTS.map((c) => (
            <Chip key={c} label={String(c)} selected={count === c} onPress={() => setCount(c)} />
          ))}
        </Section>

        <Section title="Loại từ">
          {WORD_TYPES.map((t) => (
            <Chip
              key={t.value}
              label={t.label}
              selected={wordTypes.includes(t.value)}
              onPress={() => toggleType(t.value)}
            />
          ))}
        </Section>

        {suggest.isPending ? (
          <Skeleton message={`Đang soạn ${count} từ về chủ đề "${topic.trim()}"…`} rows={3} />
        ) : (
          <Button title={aiButtonTitle("Gợi ý", granted)} onPress={run} disabled={remaining === 0} />
        )}

        {extract.isPending ? (
          <Skeleton message="Đang đọc ảnh và lọc từ đáng học…" rows={2} />
        ) : (
          <Button
            title={aiButtonTitle("Lọc từ trong ảnh (chụp trang sách)", granted)}
            variant="secondary"
            onPress={fromImage}
            disabled={remaining === 0 || suggest.isPending}
          />
        )}
        {imageError ? <Text className="text-body text-danger">{imageError}</Text> : null}

        {suggest.isError ? (
          <View className="gap-2 rounded-2xl bg-surface p-4">
            <Text className="text-body text-danger">{aiErrorMessage(suggest.error)}</Text>
            {isRetryable(suggest.error) ? (
              <Button title="Thử lại" variant="secondary" onPress={run} />
            ) : null}
          </View>
        ) : null}
        {openHistory.isError ? (
          <Text className="text-body text-danger">{aiErrorMessage(openHistory.error)}</Text>
        ) : null}

        {history.data?.length ? (
          <View className="gap-2">
            <Text className="text-body font-semibold text-text">Lịch sử gợi ý</Text>
            {history.data.map((item) => (
              <Pressable
                key={item.generation_id}
                accessibilityRole="button"
                disabled={openHistory.isPending}
                onPress={() => reopen(item.generation_id, item.topic ?? "", item.level, item.word_count)}
                className="min-h-[44px] flex-row items-center justify-between rounded-2xl bg-surface px-4 py-3 active:opacity-70"
              >
                <View className="flex-1 gap-1">
                  <Text className="text-body text-text" numberOfLines={1}>
                    {item.topic}
                  </Text>
                  <Text className="text-caption text-textMuted">
                    {item.level} · {item.word_count} từ ·{" "}
                    {new Date(item.created_at).toLocaleDateString("vi-VN")}
                  </Text>
                </View>
                <Text className="text-caption font-semibold text-primary">Mở</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
