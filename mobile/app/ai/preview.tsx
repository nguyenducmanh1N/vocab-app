import Ionicons from "@expo/vector-icons/Ionicons";
import { FlashList, useRecyclingState } from "@shopify/flash-list";
import { Stack, router } from "expo-router";
import { useEffect } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { messageFor } from "@/api/errorMessages";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { IconButton } from "@/components/IconButton";
import { Skeleton } from "@/components/Skeleton";
import { aiButtonTitle, useAiConsent } from "@/features/ai/consent";
import { aiErrorMessage, isRetryable } from "@/features/ai/format";
import { IMAGE_TOPIC_PREFIX } from "@/features/ai/imageImport";
import { pickOption } from "@/features/library/dialogs";
import { useAiQuota, useSaveSuggestions, useSuggest } from "@/hooks/useAi";
import { useLists } from "@/hooks/useLibrary";
import { playWord, stopAll } from "@/services/audio";
import { useSuggestStore, type PreviewItem } from "@/stores/suggestStore";
import { useTheme } from "@/theme/useTheme";

const MAX_EXCLUDE = 200; // giới hạn exclude_terms của /ai/suggest


function PreviewRow({ item }: { item: PreviewItem }) {
  const { colors } = useTheme();
  const toggle = useSuggestStore((s) => s.toggle);
  const editMeaning = useSuggestStore((s) => s.editMeaning);
  // FlashList tái sử dụng ô: trạng thái sửa gắn với từng term, sang từ khác thì về mặc định.
  // Nếu dùng useState, ô đang sửa có thể mang bản nháp sang từ khác rồi lưu nhầm khi mất focus.
  const [editing, setEditing] = useRecyclingState(false, [item.term]);
  const [draft, setDraft] = useRecyclingState(item.meaning_vi, [item.term]);

  const commit = () => {
    if (!editing) return;
    const value = draft.trim();
    if (value && value !== item.meaning_vi) editMeaning(item.term, value);
    else setDraft(item.meaning_vi);
    setEditing(false);
  };

  return (
    <View className="flex-row items-start gap-2 border-b border-textMuted/10 bg-surface py-3 pl-2 pr-1">
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: item.selected }}
        accessibilityLabel={`Chọn ${item.term}`}
        onPress={() => toggle(item.term)}
        className="h-11 w-11 items-center justify-center"
      >
        <Ionicons
          name={item.selected ? "checkbox" : "square-outline"}
          size={24}
          color={item.selected ? colors.primary : colors.textMuted}
        />
      </Pressable>
      <View className="flex-1 gap-1 pt-2">
        <View className="flex-row flex-wrap items-center gap-2">
          <Text className="text-body font-semibold text-text">{item.term}</Text>
          {item.ipa ? <Text className="text-caption text-textMuted">{item.ipa}</Text> : null}
          {item.part_of_speech ? (
            <Text className="text-caption text-textMuted">· {item.part_of_speech}</Text>
          ) : null}
          {item.already_saved ? (
            <Text className="text-caption font-semibold text-warning">Đã có</Text>
          ) : null}
        </View>
        {editing ? (
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onBlur={commit}
            onSubmitEditing={commit}
            autoFocus
            accessibilityLabel={`Nghĩa của ${item.term}`}
            className="min-h-[44px] rounded-xl border border-primary px-2 py-1 text-[15px] text-text"
          />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Nghĩa: ${item.meaning_vi}`}
            accessibilityHint="Chạm để sửa nghĩa"
            className="min-h-[44px] justify-center"
            onPress={() => {
              setDraft(item.meaning_vi);
              setEditing(true);
            }}
          >
            <Text className="text-caption text-text">
              {item.meaning_vi} <Ionicons name="create-outline" size={13} color={colors.textMuted} />
            </Text>
          </Pressable>
        )}
      </View>
      <IconButton
        icon="volume-high-outline"
        size={22}
        accessibilityLabel={`Nghe cách đọc ${item.term}`}
        onPress={() => playWord(item.term, item.audio_url)}
      />
    </View>
  );
}

export default function PreviewScreen() {
  const params = useSuggestStore((s) => s.params);
  const items = useSuggestStore((s) => s.items);
  const append = useSuggestStore((s) => s.append);
  const setAll = useSuggestStore((s) => s.setAll);
  const lists = useLists();
  const { granted, ensure } = useAiConsent();
  const quota = useAiQuota();
  const more = useSuggest();
  const save = useSaveSuggestions();
  // List đích lưu trong store (giữ qua nháp); null = list mới tên chủ đề.
  const target = useSuggestStore((s) => s.target);
  const setTarget = useSuggestStore((s) => s.setTarget);

  useEffect(() => stopAll, []);

  if (!params) {
    return (
      <View className="flex-1 justify-center bg-background">
        <EmptyState
          icon="sparkles-outline"
          title="Chưa có gợi ý nào"
          actionLabel="Quay lại tab AI"
          onAction={() => router.back()}
        />
      </View>
    );
  }

  const selected = items.filter((i) => i.selected);
  const allSelected = items.length > 0 && selected.length === items.length;

  const chooseTarget = async () => {
    const options = lists.data ?? [];
    const choice = await pickOption("Lưu vào list", [
      `List mới: ${params.topic}`,
      ...options.map((l) => l.name),
    ]);
    if (choice === null) return;
    setTarget(choice === 0 ? null : { id: options[choice - 1].id, name: options[choice - 1].name });
  };

  const suggestMore = async () => {
    if (!(await ensure())) return;
    try {
      const result = await more.mutateAsync({
        ...params,
        exclude_terms: items.map((i) => i.term).slice(0, MAX_EXCLUDE),
      });
      append(result.words);
    } catch {
      // lỗi hiện ở cuối danh sách qua more.error
    }
  };

  const onSave = async () => {
    try {
      const result = await save.mutateAsync(
        target === null
          ? { target: "new", topic: params.topic, words: selected }
          : { target: "existing", listId: target.id, words: selected },
      );
      const skippedNote = result.skipped ? `, bỏ qua ${result.skipped} từ đã có trong list` : "";
      Alert.alert("Đã lưu", `Đã lưu ${result.created} từ${skippedNote}.`);
      useSuggestStore.getState().clear();
      router.replace({ pathname: "/list/[id]", params: { id: result.listId } });
    } catch (err) {
      Alert.alert("Không lưu được", messageFor(err));
    }
  };

  const footer = (
    <View className="gap-3 px-4 py-4">
      {more.isPending ? <Skeleton message="Đang gợi ý thêm…" rows={2} /> : null}
      {more.isError ? (
        <View className="gap-2">
          <Text className="text-body text-danger">{aiErrorMessage(more.error)}</Text>
          {isRetryable(more.error) ? (
            <Button title="Thử lại" variant="secondary" onPress={suggestMore} />
          ) : null}
        </View>
      ) : null}
      {/* Danh sách lọc từ ảnh không có chủ đề thật nên không "Gợi ý thêm". */}
      {!more.isPending && !params.topic.startsWith(IMAGE_TOPIC_PREFIX) ? (
        <Button
          title={aiButtonTitle("Gợi ý thêm", granted)}
          variant="secondary"
          onPress={suggestMore}
          disabled={items.length >= MAX_EXCLUDE || quota.data?.suggest_remaining === 0}
        />
      ) : null}
    </View>
  );

  return (
    <>
      <Stack.Screen options={{ title: params.topic }} />
      <SafeAreaView edges={["bottom"]} className="flex-1 bg-background">
        <View className="gap-2 px-4 pb-2 pt-3">
          <Pressable
            accessibilityRole="button"
            onPress={chooseTarget}
            className="min-h-[44px] flex-row items-center justify-between rounded-xl bg-surface px-3"
          >
            <Text className="text-body text-textMuted">Lưu vào</Text>
            <Text className="flex-shrink text-body font-semibold text-primary" numberOfLines={1}>
              {target === null ? `List mới: ${params.topic}` : target.name}
            </Text>
          </Pressable>
          <View className="flex-row items-center justify-between">
            <Text className="text-caption text-textMuted">
              Đã chọn {selected.length}/{items.length} từ
            </Text>
            <Pressable accessibilityRole="button" onPress={() => setAll(!allSelected)} className="min-h-[44px] justify-center">
              <Text className="text-caption font-semibold text-primary">
                {allSelected ? "Bỏ chọn hết" : "Chọn hết"}
              </Text>
            </Pressable>
          </View>
        </View>
        <FlashList
          data={items}
          keyExtractor={(item) => item.term}
          renderItem={({ item }) => <PreviewRow item={item} />}
          ListFooterComponent={footer}
          keyboardShouldPersistTaps="handled"
        />
        <View className="border-t border-textMuted/10 px-4 pt-3">
          <Button
            title={`Lưu ${selected.length} từ`}
            onPress={onSave}
            loading={save.isPending}
            disabled={selected.length === 0}
          />
        </View>
      </SafeAreaView>
    </>
  );
}
