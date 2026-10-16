import { zodResolver } from "@hookform/resolvers/zod";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";

import { ApiError } from "@/api/client";
import { messageFor } from "@/api/errorMessages";
import type { DuplicateDetails, SuggestedWord, WordCreate } from "@/api/types";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { Input } from "@/components/Input";
import { applyApiError } from "@/features/auth/apiFormError";
import { pickOption } from "@/features/library/dialogs";
import {
  emptyForm,
  formFromWord,
  VISIBLE_EXAMPLES,
  toPayload,
  wordFormSchema,
  type WordFormInput,
  type WordFormValues,
} from "@/features/library/wordForm";
import { useAiConsent } from "@/features/ai/consent";
import { useAutofill, useTermCheck, useTermSuggestions } from "@/hooks/useDictionary";
import { useLists, useWord } from "@/hooks/useLibrary";
import { useWordMutations } from "@/hooks/useLibraryMutations";
import { useTheme } from "@/theme/useTheme";

const FIELDS = ["term", "meaning_vi", "part_of_speech", "ipa", "synonyms", "note"] as const;

type DuplicateChoice = "open" | "add" | "cancel";

/** Chỉ báo số lượt AI còn lại khi gần hết. */
const LOW_QUOTA = 10;

type FillableField =
  | "meaning_vi"
  | "part_of_speech"
  | "ipa"
  | "synonyms"
  | "audio_url"
  | "examples.0.en"
  | "examples.0.vi"
  | "definition_en";

function askDuplicate(details: DuplicateDetails): Promise<DuplicateChoice> {
  return new Promise((resolve) => {
    Alert.alert(
      "Từ này đã có",
      `Từ đã có trong list "${details.list_name}". Bạn muốn làm gì?`,
      [
        { text: "Mở từ cũ", onPress: () => resolve("open") },
        { text: "Vẫn thêm", onPress: () => resolve("add") },
        { text: "Huỷ", style: "cancel", onPress: () => resolve("cancel") },
      ],
    );
  });
}

export default function WordEditScreen() {
  const { listId, wordId } = useLocalSearchParams<{ listId: string; wordId?: string }>();
  const isEdit = Boolean(wordId);
  const { colors } = useTheme();
  const existing = useWord(wordId ?? "");
  const lists = useLists();
  const { create, update } = useWordMutations();
  const autofillRunner = useAutofill();
  const aiConsent = useAiConsent();
  const [formError, setFormError] = useState<string | null>(null);
  const [lookupNote, setLookupNote] = useState<string | null>(null);
  // Gợi ý sửa chính tả từ AI (corrected_from): bấm để dùng từ đúng.
  const [correction, setCorrection] = useState<SuggestedWord | null>(null);

  const {
    control,
    handleSubmit,
    setError,
    getValues,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<WordFormInput, unknown, WordFormValues>({
    resolver: zodResolver(wordFormSchema),
    mode: "onTouched",
    defaultValues: emptyForm(listId),
  });

  // Chế độ sửa: đổ dữ liệu từ khi tải xong.
  const loaded = existing.data;
  useEffect(() => {
    if (loaded) reset(formFromWord(loaded));
  }, [loaded, reset]);

  const targetListId = useWatch({ control, name: "list_id" });
  const definitionEn = useWatch({ control, name: "definition_en" });

  // Gợi ý khi gõ ở ô Từ: ẩn sau khi chọn một gợi ý hoặc khi rời ô.
  const termValue = useWatch({ control, name: "term" });
  const [termFocused, setTermFocused] = useState(false);
  const [pickedTerm, setPickedTerm] = useState<string | null>(null);
  const showSuggest = termFocused && termValue !== pickedTerm;
  const suggestions = useTermSuggestions(termValue, showSuggest);
  const suggestionItems = (showSuggest && termValue.trim().length >= 2 ? suggestions.data ?? [] : [])
    .filter((s) => s.term !== termValue.trim().toLowerCase());

  // Tra từ điển ngay khi gõ xong (rời ô, bấm Return, chọn gợi ý); không tốn lượt AI.
  const termCheck = useTermCheck();
  const [checkedTerm, setCheckedTerm] = useState<string | null>(null);
  const [alternatives, setAlternatives] = useState<string[]>([]);

  const checkTerm = async (raw: string) => {
    const term = raw.trim();
    if (term.length < 2 || term.toLowerCase() === checkedTerm) return;
    if (isEdit && loaded && term.toLowerCase() === loaded.term.toLowerCase()) return; // chưa đổi từ
    setCheckedTerm(term.toLowerCase());
    setAlternatives([]);
    setLookupNote("Đang tra từ điển…");
    const { dictionary, alternatives: alts } = await termCheck.check(term);
    if (getValues("term").trim().toLowerCase() !== term.toLowerCase()) return; // đã gõ từ khác
    if (dictionary?.found) {
      fillIfEmpty("ipa", dictionary.ipa, { override: true });
      fillIfEmpty("part_of_speech", dictionary.part_of_speech);
      fillIfEmpty("audio_url", dictionary.audio_url, { override: true });
      fillDefinitions(dictionary.definitions_en);
      setLookupNote("Có trong từ điển. Bấm Tự điền để AI viết nghĩa tiếng Việt và ví dụ.");
      return;
    }
    setAlternatives(alts);
    if (dictionary && !dictionary.available) {
      setLookupNote("Từ điển đang lỗi nên chưa kiểm tra được chính tả. Bạn vẫn có thể bấm Tự điền.");
      return;
    }
    setLookupNote(
      alts.length
        ? `Không thấy "${term}" trong từ điển, có thể sai chính tả. Có phải ý bạn là:`
        : `Không thấy "${term}" trong từ điển. Kiểm tra lại chính tả.`,
    );
  };

  const pickSuggestion = (term: string) => {
    setValue("term", term, { shouldDirty: true, shouldValidate: true });
    setPickedTerm(term);
    setAlternatives([]);
    void checkTerm(term);
  };
  const targetList = lists.data?.find((l) => l.id === targetListId);

  /** Chỉ điền ô còn trống, không ghi đè thứ người dùng đã nhập. */
  // Các ô do Tự điền điền vào (người dùng chưa sửa): từ điển được phép ghi đè IPA và audio
  // lên giá trị của AI. Ô người dùng tự gõ thì không bao giờ bị ghi đè.
  const autoFilled = useRef(new Set<FillableField>());

  const fillIfEmpty = (
    name: FillableField,
    value: string | null | undefined,
    { override = false }: { override?: boolean } = {},
  ) => {
    if (!value) return;
    const current = getValues(name);
    if (current && !(override && autoFilled.current.has(name))) return;
    setValue(name, value, { shouldDirty: true, shouldValidate: true });
    autoFilled.current.add(name);
  };

  /** Người dùng tự sửa ô → thôi coi là do Tự điền điền. */
  const userEdited = (name: FillableField, onChange: (text: string) => void) => (text: string) => {
    autoFilled.current.delete(name);
    onChange(text);
  };

  /** Định nghĩa tiếng Anh từ từ điển: có thì lưu cùng từ, không có thì thôi. */
  const fillDefinitions = (definitions: string[]) => {
    if (definitions.length) fillIfEmpty("definition_en", definitions.join("\n"), { override: true });
  };

  const applyAiWord = (word: SuggestedWord) => {
    fillIfEmpty("meaning_vi", word.meaning_vi);
    fillIfEmpty("part_of_speech", word.part_of_speech);
    fillIfEmpty("ipa", word.ipa);
    fillIfEmpty("synonyms", word.synonyms.join(", "));
    const example = word.examples[0];
    if (example && !getValues("examples.0.en")) {
      fillIfEmpty("examples.0.en", example.en);
      fillIfEmpty("examples.0.vi", example.vi);
    }
    fillIfEmpty("audio_url", word.audio_url);
    fillIfEmpty("definition_en", word.definition_en, { override: true });
  };

  const acceptCorrection = () => {
    if (!correction) return;
    setValue("term", correction.term, { shouldDirty: true, shouldValidate: true });
    setPickedTerm(correction.term);
    setCheckedTerm(correction.term.toLowerCase());
    applyAiWord(correction);
    setCorrection(null);
    setLookupNote(`Đã đổi thành "${correction.term}" và tự điền. Kiểm tra lại trước khi lưu.`);
  };

  const autofill = async () => {
    const term = getValues("term").trim();
    if (!term) {
      setError("term", { message: "Nhập từ trước khi Tự điền" });
      return;
    }
    if (!(await aiConsent.ensure())) return; // chọn Không: giữ nguyên form, không báo lỗi
    setLookupNote("Đang tự điền…");
    setCorrection(null);
    let dictFilled = false;

    await autofillRunner.run(term, {
      // AI cho nghĩa tiếng Việt, đồng nghĩa, ví dụ; IPA và audio đã được backend ưu tiên từ điển.
      onAi: (result) => {
        const word = result.words[0];
        if (!word) {
          setLookupNote("AI không nhận ra từ này, hãy kiểm tra chính tả.");
          return;
        }
        if (word.corrected_from) {
          // AI đã sửa chính tả: hỏi trước, không tự đổi từ người dùng gõ.
          setCorrection(word);
          setLookupNote(`Có thể bạn gõ sai chính tả. Có phải ý bạn là "${word.term}"?`);
          return;
        }
        applyAiWord(word);
        const left = result.remaining_today;
        setLookupNote(
          left <= 0
            ? "Đã tự điền. Bạn đã dùng hết lượt AI hôm nay."
            : left <= LOW_QUOTA
              ? `Đã tự điền. Kiểm tra lại trước khi lưu (còn ${left} lượt AI hôm nay).`
              : "Đã tự điền. Kiểm tra lại trước khi lưu.",
        );
      },
      onAiError: (err) => {
        setLookupNote(
          dictFilled
            ? `${messageFor(err)} Đã điền IPA và từ loại từ từ điển.`
            : messageFor(err),
        );
      },
      // Từ điển về lúc nào thì điền lúc đó; định nghĩa tiếng Anh luôn hiện để tham khảo.
      onDictionary: (result) => {
        if (!result.found) return;
        dictFilled = true;
        // Ưu tiên IPA và audio của từ điển, kể cả khi AI đã điền trước.
        fillIfEmpty("ipa", result.ipa, { override: true });
        fillIfEmpty("part_of_speech", result.part_of_speech);
        fillIfEmpty("audio_url", result.audio_url, { override: true });
        fillDefinitions(result.definitions_en);
      },
    });
  };

  const chooseList = async () => {
    const options = lists.data ?? [];
    const choice = await pickOption("Chuyển sang list", options.map((l) => l.name));
    if (choice !== null) setValue("list_id", options[choice].id, { shouldDirty: true });
  };

  const handleError = (err: unknown) => {
    if (err instanceof ApiError && err.code === "DUPLICATE_WORD") {
      setError("term", { message: "Từ này đã có trong list", type: "server" }, { shouldFocus: true });
      return;
    }
    setFormError(applyApiError(err, setError, {}, FIELDS));
  };

  const createWithDuplicateCheck = async (targetId: string, body: WordCreate) => {
    try {
      await create.mutateAsync({ listId: targetId, body });
      router.back();
    } catch (err) {
      const details = err instanceof ApiError ? (err.details as DuplicateDetails | null) : null;
      if (err instanceof ApiError && err.code === "DUPLICATE_WORD" && details?.list_id) {
        const choice = await askDuplicate(details);
        if (choice === "open" && details.existing_word_id) {
          router.replace({ pathname: "/word/[id]", params: { id: details.existing_word_id } });
        } else if (choice === "add") {
          try {
            await create.mutateAsync({ listId: targetId, body, allowDuplicate: true });
            router.back();
          } catch (retryErr) {
            handleError(retryErr);
          }
        }
        return;
      }
      handleError(err);
    }
  };

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const body = toPayload(values);
    if (!isEdit) {
      await createWithDuplicateCheck(values.list_id, body);
      return;
    }
    try {
      const moved = loaded && values.list_id !== loaded.list_id;
      await update.mutateAsync({
        id: wordId!,
        body: { ...body, ...(moved ? { list_id: values.list_id } : {}) },
      });
      router.back();
    } catch (err) {
      handleError(err);
    }
  });

  // Sửa từ mà chưa có dữ liệu: không hiện form trống (lưu sẽ ghi đè từ bằng giá trị mặc định).
  if (isEdit && !loaded) {
    if (existing.isError) {
      return (
        <>
          <Stack.Screen options={{ title: "Sửa từ" }} />
          <View className="flex-1 bg-background">
            <EmptyState
              icon="cloud-offline-outline"
              title="Không tải được từ"
              description={messageFor(existing.error)}
              actionLabel="Thử lại"
              onAction={() => existing.refetch()}
            />
          </View>
        </>
      );
    }
    return <ActivityIndicator className="flex-1 bg-background" />;
  }

  return (
    <>
      <Stack.Screen options={{ title: isEdit ? "Sửa từ" : "Thêm từ" }} />
      <KeyboardAvoidingView behavior="padding" className="flex-1 bg-background" keyboardVerticalOffset={60}>
        <ScrollView contentContainerClassName="gap-4 p-4 pb-12" keyboardShouldPersistTaps="handled">
          <Controller
            control={control}
            name="term"
            render={({ field: { onChange, onBlur, value } }) => (
              <Input
                label="Từ hoặc cụm từ"
                value={value}
                onChangeText={onChange}
                onFocus={() => setTermFocused(true)}
                onBlur={() => {
                  setTermFocused(false);
                  onBlur();
                  void checkTerm(value);
                }}
                returnKeyType="done"
                error={errors.term?.message}
                autoCapitalize="none"
                autoCorrect={false}
                right={
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={aiConsent.granted ? "Tự điền từ từ điển" : "Tự điền, cần đồng ý dùng AI"}
                    onPress={autofill}
                    disabled={autofillRunner.pending}
                    className="min-h-[44px] justify-center px-3"
                  >
                    {autofillRunner.pending ? (
                      <ActivityIndicator color={colors.primary} />
                    ) : (
                      <View className="items-center">
                        <Text className="text-caption font-semibold text-primary">Tự điền</Text>
                        {aiConsent.granted ? null : (
                          <Text className="text-[11px] text-textMuted">Cần đồng ý</Text>
                        )}
                      </View>
                    )}
                  </Pressable>
                }
              />
            )}
          />
          {suggestionItems.length ? (
            <View className="-mt-2 overflow-hidden rounded-xl border border-textMuted/20 bg-surface">
              {suggestionItems.map((item) => (
                <Pressable
                  key={item.term}
                  accessibilityRole="button"
                  accessibilityLabel={`Chọn ${item.term}${item.already_saved ? ", đã có trong thư viện" : ""}`}
                  onPress={() => pickSuggestion(item.term)}
                  className="min-h-[44px] flex-row items-center justify-between border-b border-textMuted/10 px-3 active:opacity-60"
                >
                  <Text className="text-[17px] text-text">{item.term}</Text>
                  {item.already_saved ? (
                    <Text className="text-caption font-semibold text-warning">Đã có</Text>
                  ) : null}
                </Pressable>
              ))}
            </View>
          ) : null}
          {lookupNote ? <Text className="-mt-2 text-caption text-textMuted">{lookupNote}</Text> : null}
          {alternatives.length ? (
            <View className="-mt-1 flex-row flex-wrap gap-2">
              {alternatives.map((alt) => (
                <Pressable
                  key={alt}
                  accessibilityRole="button"
                  accessibilityLabel={`Đổi thành ${alt}`}
                  onPress={() => pickSuggestion(alt)}
                  className="min-h-[44px] justify-center rounded-full border border-primary px-4 active:opacity-60"
                >
                  <Text className="text-caption font-semibold text-primary">{alt}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {correction ? (
            <Button title={`Dùng "${correction.term}"`} variant="secondary" onPress={acceptCorrection} />
          ) : null}
          {definitionEn ? (
            <View className="gap-1 rounded-xl bg-surface p-3">
              <View className="flex-row items-center justify-between">
                <Text className="text-caption font-semibold text-textMuted">
                  Định nghĩa tiếng Anh (lưu cùng từ)
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Bỏ định nghĩa tiếng Anh"
                  onPress={() => setValue("definition_en", "", { shouldDirty: true })}
                  className="min-h-[44px] justify-center px-2"
                >
                  <Text className="text-caption text-danger">Bỏ</Text>
                </Pressable>
              </View>
              {definitionEn.split("\n").map((d, i) => (
                <Text key={i} className="text-caption text-text">
                  {i + 1}. {d}
                </Text>
              ))}
            </View>
          ) : null}

          <Controller
            control={control}
            name="meaning_vi"
            render={({ field: { onChange, onBlur, value } }) => (
              <Input
                label="Nghĩa tiếng Việt (nhiều nghĩa ngăn bằng ; )"
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                error={errors.meaning_vi?.message}
                multiline
              />
            )}
          />

          <View className="flex-row gap-3">
            <View className="flex-1">
              <Controller
                control={control}
                name="part_of_speech"
                render={({ field: { onChange, onBlur, value } }) => (
                  <Input
                    label="Từ loại"
                    placeholder="noun, verb…"
                    value={value}
                    onChangeText={userEdited("part_of_speech", onChange)}
                    onBlur={onBlur}
                    error={errors.part_of_speech?.message}
                    autoCapitalize="none"
                  />
                )}
              />
            </View>
            <View className="flex-1">
              <Controller
                control={control}
                name="ipa"
                render={({ field: { onChange, onBlur, value } }) => (
                  <Input
                    label="IPA"
                    placeholder="/ˈdedlaɪn/"
                    value={value}
                    onChangeText={userEdited("ipa", onChange)}
                    onBlur={onBlur}
                    error={errors.ipa?.message}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                )}
              />
            </View>
          </View>

          <Controller
            control={control}
            name="synonyms"
            render={({ field: { onChange, onBlur, value } }) => (
              <Input
                label="Đồng nghĩa (ngăn bằng dấu phẩy, tối đa 5)"
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                error={errors.synonyms?.message}
                autoCapitalize="none"
              />
            )}
          />

          <Text className="text-caption font-semibold text-textMuted">Ví dụ</Text>
          {Array.from({ length: VISIBLE_EXAMPLES }, (_, i) => (
            <View key={i} className="gap-2 rounded-xl bg-surface p-3">
              <Controller
                control={control}
                name={`examples.${i}.en`}
                render={({ field: { onChange, onBlur, value } }) => (
                  <Input
                    placeholder="Câu tiếng Anh"
                    accessibilityLabel="Câu ví dụ tiếng Anh"
                    value={value}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    error={errors.examples?.[i]?.en?.message}
                    multiline
                  />
                )}
              />
              <Controller
                control={control}
                name={`examples.${i}.vi`}
                render={({ field: { onChange, onBlur, value } }) => (
                  <Input
                    placeholder="Dịch tiếng Việt"
                    accessibilityLabel="Bản dịch ví dụ"
                    value={value}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    error={errors.examples?.[i]?.vi?.message}
                    multiline
                  />
                )}
              />
            </View>
          ))}

          <Controller
            control={control}
            name="note"
            render={({ field: { onChange, onBlur, value } }) => (
              <Input
                label="Ghi chú"
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                error={errors.note?.message}
                multiline
              />
            )}
          />

          <Controller
            control={control}
            name="is_starred"
            render={({ field: { onChange, value } }) => (
              <View className="min-h-[44px] flex-row items-center justify-between">
                <Text className="text-body text-text">Gắn sao</Text>
                <Switch
                  value={value}
                  onValueChange={onChange}
                  accessibilityLabel="Gắn sao"
                  trackColor={{ true: colors.primary }}
                />
              </View>
            )}
          />

          {isEdit ? (
            <Pressable
              accessibilityRole="button"
              onPress={chooseList}
              className="min-h-[44px] flex-row items-center justify-between rounded-xl bg-surface px-3"
            >
              <Text className="text-body text-text">List</Text>
              <Text className="text-body text-primary">{targetList?.name ?? "…"}</Text>
            </Pressable>
          ) : null}

          {formError ? <Text className="text-body text-danger">{formError}</Text> : null}
          <Button title={isEdit ? "Lưu thay đổi" : "Thêm từ"} loading={isSubmitting} onPress={onSubmit} />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
