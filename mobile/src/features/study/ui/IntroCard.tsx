import { useEffect } from "react";
import { ScrollView, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { IconButton } from "@/components/IconButton";
import { playWord } from "@/services/audio";
import { useSettingsStore } from "@/stores/settingsStore";

import type { Question } from "../types";

/**
 * Giới thiệu từ mới trong Ôn tập hôm nay (PLAN.md 10.3): xem đủ thông tin, không chấm,
 * không gửi kết quả. Các từ mới được giới thiệu lần lượt trước, rồi mới tới phần trả lời.
 */
export function IntroCard({ question, onContinue }: { question: Question; onContinue: () => void }) {
  const { card } = question;
  const autoPlay = useSettingsStore((s) => s.settings.auto_play_audio);
  const example = card.examples[0];
  const position = question.introPosition;
  const last = !position || position.index === position.total;

  useEffect(() => {
    if (autoPlay) playWord(card.term, card.audio_url);
  }, [autoPlay, card.term, card.audio_url]);

  return (
    <ScrollView contentContainerClassName="flex-grow gap-4 px-4 py-6">
      <Text className="text-center text-caption font-semibold uppercase text-primary">
        {position ? `Từ mới ${position.index}/${position.total}` : "Từ mới"}
      </Text>
      <View className="flex-1 justify-center gap-4 rounded-2xl bg-surface p-6">
        <View className="items-center gap-1">
          <View className="flex-row items-center gap-1">
            <Text className="text-center text-word font-bold text-text" adjustsFontSizeToFit numberOfLines={2}>
              {card.term}
            </Text>
            <IconButton
              icon="volume-high"
              accessibilityLabel={`Nghe cách đọc ${card.term}`}
              onPress={() => playWord(card.term, card.audio_url)}
            />
          </View>
          {card.ipa ? <Text className="text-body text-textMuted">{card.ipa}</Text> : null}
          {card.part_of_speech ? (
            <Text className="text-caption text-textMuted">{card.part_of_speech}</Text>
          ) : null}
        </View>
        <Text className="text-center text-[22px] font-semibold text-text">{card.meaning_vi}</Text>
        {example ? (
          <View className="gap-1 rounded-xl bg-background p-3">
            <Text className="text-body italic text-text">{example.en}</Text>
            {example.vi ? <Text className="text-caption text-textMuted">{example.vi}</Text> : null}
          </View>
        ) : null}
      </View>
      <Button title={last ? "Bắt đầu trả lời" : "Từ tiếp theo"} onPress={onContinue} />
    </ScrollView>
  );
}
