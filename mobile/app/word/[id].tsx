import { Stack, router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";

import { messageFor } from "@/api/errorMessages";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { IconButton } from "@/components/IconButton";
import { confirmDestructive, showError } from "@/features/library/dialogs";
import { dueLabel, LEVEL_LABELS, LEVEL_TEXT_CLASS } from "@/features/library/labels";
import { useList, useWord } from "@/hooks/useLibrary";
import { useWordMutations } from "@/hooks/useLibraryMutations";
import { playWord, speakSentence, stopAll } from "@/services/audio";
import { cacheInBackground } from "@/services/audioCache";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="gap-2">
      <Text className="text-caption font-semibold uppercase text-textMuted">{title}</Text>
      {children}
    </View>
  );
}

export default function WordScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const word = useWord(id);
  const list = useList(word.data?.list_id ?? "");
  const { update, remove } = useWordMutations();

  // Rời màn hình thì dừng âm thanh đang phát.
  useEffect(() => stopAll, []);

  // Tải sẵn file phát âm về máy để nghe được cả khi offline.
  const audioUrl = word.data?.audio_url;
  useEffect(() => {
    if (audioUrl) cacheInBackground(audioUrl);
  }, [audioUrl]);

  if (word.isPending) {
    return <ActivityIndicator className="flex-1 bg-background" />;
  }
  if (word.isError) {
    return (
      <View className="flex-1 justify-center bg-background">
        <EmptyState
          icon="alert-circle-outline"
          title="Không mở được từ này"
          description={messageFor(word.error)}
          actionLabel="Quay lại"
          onAction={() => router.back()}
        />
      </View>
    );
  }

  const w = word.data;
  const toggleStar = () =>
    update.mutate({ id: w.id, body: { is_starred: !w.is_starred } }, { onError: (e) => showError(e) });
  const edit = () =>
    router.push({ pathname: "/word/edit", params: { wordId: w.id, listId: w.list_id } });
  const del = async () => {
    if (!(await confirmDestructive(`Xoá "${w.term}"?`, "Tiến độ ôn của từ này cũng bị xoá."))) return;
    try {
      await remove.mutateAsync(w.id);
      router.back();
    } catch (err) {
      showError(err);
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: "",
          headerRight: () => (
            <IconButton
              icon={w.is_starred ? "star" : "star-outline"}
              tone="warning"
              accessibilityLabel={w.is_starred ? "Bỏ gắn sao" : "Gắn sao"}
              onPress={toggleStar}
            />
          ),
        }}
      />
      <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-5 p-4 pb-12">
        <View className="gap-1">
          <View className="flex-row items-center gap-2">
            <Text className="flex-shrink text-word font-bold text-text" selectable>
              {w.term}
            </Text>
            <IconButton
              icon="volume-high"
              size={28}
              accessibilityLabel={`Nghe cách đọc ${w.term}`}
              onPress={() => playWord(w.term, w.audio_url)}
            />
          </View>
          <Text className="text-body text-textMuted">
            {[w.ipa, w.part_of_speech].filter(Boolean).join(" · ") || "Chưa có IPA"}
          </Text>
          {list.data ? (
            <Pressable
              accessibilityRole="link"
              onPress={() => router.push({ pathname: "/list/[id]", params: { id: list.data.id } })}
            >
              <Text className="py-2 text-caption text-primary">List: {list.data.name}</Text>
            </Pressable>
          ) : null}
        </View>

        <Section title="Nghĩa">
          <Text className="text-body text-text" selectable>
            {w.meaning_vi}
          </Text>
        </Section>

        {w.definition_en ? (
          <Section title="Định nghĩa tiếng Anh">
            {w.definition_en.split("\n").map((d, i) => (
              <Text key={i} className="text-body text-text" selectable>
                {i + 1}. {d}
              </Text>
            ))}
          </Section>
        ) : null}

        {w.synonyms.length ? (
          <Section title="Đồng nghĩa">
            <Text className="text-body text-text">{w.synonyms.join(", ")}</Text>
          </Section>
        ) : null}

        {w.examples.length ? (
          <Section title="Ví dụ">
            {w.examples.map((ex, i) => (
              <Card key={i} className="flex-row items-start gap-2">
                <View className="flex-1 gap-1">
                  <Text className="text-body text-text">{ex.en}</Text>
                  {ex.vi ? <Text className="text-caption text-textMuted">{ex.vi}</Text> : null}
                </View>
                <IconButton
                  icon="volume-medium-outline"
                  accessibilityLabel={`Nghe câu ví dụ ${i + 1}`}
                  onPress={() => speakSentence(ex.en)}
                />
              </Card>
            ))}
          </Section>
        ) : null}

        {w.note ? (
          <Section title="Ghi chú">
            <Text className="text-body text-text">{w.note}</Text>
          </Section>
        ) : null}

        <Section title="Tiến độ">
          <Card className="flex-row items-center justify-between">
            <Text className={`text-body font-semibold ${LEVEL_TEXT_CLASS[w.progress.level]}`}>
              {LEVEL_LABELS[w.progress.level]}
            </Text>
            <Text className="text-caption text-textMuted">{dueLabel(w.progress.due_at)}</Text>
          </Card>
        </Section>

        <View className="gap-3 pt-2">
          <Button title="Sửa" variant="secondary" onPress={edit} />
          <Button title="Xoá từ" variant="danger" loading={remove.isPending} onPress={del} />
        </View>
      </ScrollView>
    </>
  );
}
