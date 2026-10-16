import Ionicons from "@expo/vector-icons/Ionicons";
import { FlashList } from "@shopify/flash-list";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { messageFor } from "@/api/errorMessages";
import type { DictionaryOut, SuggestedWord, WordCreate } from "@/api/types";
import { Button } from "@/components/Button";
import { Skeleton } from "@/components/Skeleton";
import { useAiConsent } from "@/features/ai/consent";
import { aiErrorMessage } from "@/features/ai/format";
import { toWordCreate } from "@/hooks/useAi";
import { useList } from "@/hooks/useLibrary";
import {
  enrichInBatches,
  type EnrichProgress,
  lookupMany,
  useImportWords,
} from "@/hooks/useQuickImport";
import { clearDraft, loadDraft, saveDraft } from "@/stores/draftStorage";
import { useTheme } from "@/theme/useTheme";
import { parseQuickImport, MAX_MEANING_LENGTH } from "@/utils/parseQuickImport";

const MAX_LINES = 100; // một lần nhập tối đa 100 từ (bằng giới hạn một lô bulk)

type Row = {
  key: string; // từ người dùng gõ (viết thường), không đổi khi AI sửa chính tả
  term: string;
  correctedFrom: string | null; // AI đã sửa chính tả từ từ này
  dictionary: DictionaryOut | null; // tra từ điển ngầm cho từ tự ghi nghĩa (IPA, phát âm…)
  meaning: string;
  selected: boolean;
  enriched: SuggestedWord | null; // dữ liệu AI (IPA, từ loại, ví dụ…) nếu dòng được tự điền
  unknown: boolean; // AI không nhận ra từ này
};

const PLACEHOLDER = `deadline
meet the deadline - kịp hạn chót
agenda: chương trình họp
well-known`;

function toPayload(row: Row): WordCreate {
  const base: WordCreate = row.enriched
    ? toWordCreate(row.enriched)
    : { term: row.term, meaning_vi: "" };
  const dict = row.dictionary;
  return {
    ...base,
    term: row.term,
    meaning_vi: row.meaning.trim(),
    ipa: base.ipa ?? dict?.ipa ?? null,
    part_of_speech: base.part_of_speech ?? dict?.part_of_speech ?? null,
    audio_url: base.audio_url ?? dict?.audio_url ?? null,
    definition_en: base.definition_en ?? (dict?.definitions_en.length ? dict.definitions_en.join("\n") : null),
  };
}

function PreviewRow({ row, onChange }: { row: Row; onChange: (patch: Partial<Row>) => void }) {
  const { colors } = useTheme();
  const missing = !row.meaning.trim();
  return (
    <View className="flex-row items-start gap-2 border-b border-textMuted/10 bg-surface py-2 pl-2 pr-3">
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: row.selected }}
        accessibilityLabel={`Chọn ${row.term}`}
        onPress={() => onChange({ selected: !row.selected })}
        className="h-11 w-11 items-center justify-center"
      >
        <Ionicons
          name={row.selected ? "checkbox" : "square-outline"}
          size={24}
          color={row.selected ? colors.primary : colors.textMuted}
        />
      </Pressable>
      <View className="flex-1 gap-1 pt-2">
        <View className="flex-row flex-wrap items-center gap-2">
          <Text className="text-body font-semibold text-text">{row.term}</Text>
          {(row.enriched?.ipa ?? row.dictionary?.ipa) ? (
            <Text className="text-caption text-textMuted">{row.enriched?.ipa ?? row.dictionary?.ipa}</Text>
          ) : null}
          {row.enriched ? <Text className="text-caption font-semibold text-primary">AI</Text> : null}
          {row.correctedFrom ? (
            <Text className="text-caption font-semibold text-warning">sửa từ “{row.correctedFrom}”</Text>
          ) : null}
          {row.unknown ? (
            <Text className="text-caption font-semibold text-danger">AI không nhận ra</Text>
          ) : null}
        </View>
        <TextInput
          value={row.meaning}
          onChangeText={(meaning) => onChange({ meaning, selected: row.selected || !!meaning.trim() })}
          placeholder="Nhập nghĩa tiếng Việt"
          placeholderTextColor={colors.textMuted}
          accessibilityLabel={`Nghĩa của ${row.term}`}
          maxLength={MAX_MEANING_LENGTH}
          className={`min-h-[40px] rounded-lg border px-2 text-[15px] text-text ${
            missing ? "border-danger" : "border-textMuted/30"
          }`}
        />
      </View>
    </View>
  );
}

export default function QuickImportScreen() {
  const { colors } = useTheme();
  const { listId } = useLocalSearchParams<{ listId: string }>();
  const list = useList(listId);
  const aiConsent = useAiConsent();
  const save = useImportWords(listId);
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [progress, setProgress] = useState<EnrichProgress | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const draftKey = `import.${listId}`;

  // Nháp: mở lại thì khôi phục văn bản đang dán; gõ tới đâu lưu tới đó (sau 500 ms).
  useEffect(() => {
    loadDraft(draftKey).then((saved) => {
      if (saved) setText((current) => current || saved);
    });
  }, [draftKey]);
  useEffect(() => {
    const timer = setTimeout(() => saveDraft(draftKey, text), 500);
    return () => clearTimeout(timer);
  }, [draftKey, text]);

  const preview = async () => {
    const parsed = parseQuickImport(text);
    if (!parsed.length) {
      setNotice("Chưa có từ nào. Mỗi dòng một từ.");
      return;
    }
    const lines = parsed.slice(0, MAX_LINES);
    const initial: Row[] = lines.map((p) => ({
      key: p.term.toLowerCase(),
      term: p.term,
      correctedFrom: null,
      dictionary: null,
      meaning: p.meaning ?? "",
      selected: !!p.meaning,
      enriched: null,
      unknown: false,
    }));
    setRows(initial);
    const notes = parsed.length > MAX_LINES ? [`Chỉ lấy ${MAX_LINES} từ đầu tiên.`] : [];

    // Dòng chưa có nghĩa → /ai/enrich theo lô 30 từ (cần đồng ý dùng AI; chọn Không thì bỏ bước này).
    const missing = initial.filter((r) => !r.meaning).map((r) => r.term);
    const useAi = missing.length > 0 && (await aiConsent.ensure());
    if (missing.length && !useAi) {
      notes.push("Chưa đồng ý dùng AI nên chưa tự điền nghĩa. Nhập nghĩa cho các dòng còn trống hoặc bỏ qua chúng.");
    }
    if (useAi) {
      setProgress({ done: 0, total: missing.length });
      const result = await enrichInBatches(missing, setProgress);
      setProgress(null);
      const unknown = new Set(result.unknown.map((t) => t.toLowerCase()));
      setRows((current) =>
        (current ?? initial).map((row) => {
          const word = result.words.get(row.key);
          if (word && !row.meaning) {
            return {
              ...row,
              term: word.term,
              correctedFrom: word.corrected_from ?? null,
              meaning: word.meaning_vi,
              enriched: word,
              selected: true,
            };
          }
          return unknown.has(row.term.toLowerCase()) ? { ...row, unknown: true } : row;
        }),
      );
      if (result.unknown.length) {
        notes.push(`AI không nhận ra ${result.unknown.length} từ: ${result.unknown.join(", ")}. Kiểm tra chính tả hoặc tự nhập nghĩa.`);
      }
      if (result.error) notes.push(`Tự điền dừng giữa chừng: ${aiErrorMessage(result.error)}`);
      const corrected = [...result.words.values()].filter((w) => w.corrected_from);
      if (corrected.length) {
        notes.push(`AI đã sửa chính tả ${corrected.length} từ (có nhãn "sửa từ"). Kiểm tra lại trước khi lưu.`);
      }
    }

    // Từ tự ghi nghĩa: tra từ điển ngầm để có IPA và phát âm (không tốn lượt AI).
    const own = initial.filter((r) => r.meaning).map((r) => r.term);
    if (own.length) {
      await lookupMany(own, (term, dictionary) =>
        setRows((current) =>
          current?.map((r) => (r.key === term.toLowerCase() ? { ...r, dictionary } : r)) ?? null,
        ),
      );
    }
    setNotice(notes.length ? notes.join("\n") : null);
  };

  const updateRow = (key: string, patch: Partial<Row>) =>
    setRows((current) => current?.map((r) => (r.key === key ? { ...r, ...patch } : r)) ?? null);

  const ready = rows?.filter((r) => r.selected && r.meaning.trim()) ?? [];
  const missingSelected = rows?.filter((r) => r.selected && !r.meaning.trim()).length ?? 0;

  const onSave = async () => {
    try {
      const result = await save.mutateAsync(ready.map(toPayload));
      const parts = [`Đã thêm ${result.created} từ.`];
      if (result.skipped.length) parts.push(`Bỏ qua ${result.skipped.length} từ đã có trong list: ${result.skipped.join(", ")}.`);
      if (missingSelected) parts.push(`${missingSelected} từ chưa có nghĩa không được lưu.`);
      Alert.alert("Nhập nhanh xong", parts.join("\n"));
      await clearDraft(draftKey);
      router.back();
    } catch (err) {
      Alert.alert("Không lưu được", messageFor(err));
    }
  };

  // Bước 1: dán văn bản
  if (!rows) {
    return (
      <>
        <Stack.Screen options={{ title: "Nhập nhanh" }} />
        <KeyboardAvoidingView behavior="padding" className="flex-1 bg-background" keyboardVerticalOffset={60}>
          <ScrollView contentContainerClassName="gap-3 p-4" keyboardShouldPersistTaps="handled">
            <Text className="text-body text-textMuted">
              Mỗi dòng một từ, dạng <Text className="font-semibold text-text">word</Text>,{" "}
              <Text className="font-semibold text-text">word - nghĩa</Text> hoặc{" "}
              <Text className="font-semibold text-text">word: nghĩa</Text>. Dòng chưa có nghĩa sẽ được AI tự điền
              (mỗi 30 từ tốn 1 lượt{aiConsent.granted ? "" : ", cần đồng ý dùng AI"}). Thêm vào: {list.data?.name ?? "…"}
            </Text>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder={PLACEHOLDER}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              textAlignVertical="top"
              accessibilityLabel="Danh sách từ, mỗi dòng một từ"
              className="min-h-[240px] rounded-xl border border-textMuted/30 bg-surface p-3 text-[17px] text-text"
            />
            {notice ? <Text className="text-body text-danger">{notice}</Text> : null}
            <Button title="Xem trước" onPress={preview} disabled={!text.trim()} />
          </ScrollView>
        </KeyboardAvoidingView>
      </>
    );
  }

  // Bước 2: xem trước, sửa, lưu
  return (
    <>
      <Stack.Screen options={{ title: `Xem trước (${rows.length} từ)` }} />
      <SafeAreaView edges={["bottom"]} className="flex-1 bg-background">
        {progress ? (
          <View className="p-4">
            <Skeleton message={`Đang tự điền ${progress.done}/${progress.total} từ chưa có nghĩa…`} rows={2} />
          </View>
        ) : null}
        {notice ? (
          // Màu cảnh báo ở viền và icon; chữ dùng màu text để đọc rõ cả đoạn dài (P6.6).
          <View className="mx-4 mt-3 flex-row gap-2 rounded-xl border-l-4 border-warning bg-warning/10 p-3">
            <Ionicons name="warning-outline" size={18} color={colors.warning} />
            <Text className="flex-1 text-caption text-text">{notice}</Text>
          </View>
        ) : null}
        <FlashList
          data={rows}
          keyExtractor={(row) => row.key}
          renderItem={({ item }) => <PreviewRow row={item} onChange={(patch) => updateRow(item.key, patch)} />}
          keyboardShouldPersistTaps="handled"
        />
        <View className="gap-2 border-t border-textMuted/10 px-4 pt-3">
          {missingSelected ? (
            <Text className="text-caption text-danger">{missingSelected} từ được chọn còn thiếu nghĩa.</Text>
          ) : null}
          <View className="flex-row gap-3">
            <View className="flex-1">
              <Button title="Sửa văn bản" variant="secondary" onPress={() => setRows(null)} disabled={!!progress} />
            </View>
            <View className="flex-1">
              <Button
                title={`Lưu ${ready.length} từ`}
                onPress={onSave}
                loading={save.isPending}
                disabled={!ready.length || !!progress}
              />
            </View>
          </View>
        </View>
      </SafeAreaView>
    </>
  );
}
