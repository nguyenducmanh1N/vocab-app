import { Text, View } from "react-native";

import { IconButton } from "@/components/IconButton";
import { playWord } from "@/services/audio";

import type { StudyCard } from "../types";

/** Đáp án đúng hiện sau mỗi câu: từ, IPA, nghĩa, nút nghe lại. */
export function AnswerReveal({ card, correct }: { card: StudyCard; correct: boolean }) {
  return (
    <View
      className={`flex-row items-center gap-3 rounded-2xl border-2 bg-surface p-4 ${
        correct ? "border-success" : "border-danger"
      }`}
      accessibilityLiveRegion="polite"
    >
      <View className="flex-1 gap-1">
        <Text className={`text-caption font-semibold ${correct ? "text-success" : "text-danger"}`}>
          {correct ? "Chính xác!" : "Chưa đúng — đáp án:"}
        </Text>
        <Text className="text-[22px] font-bold text-text">{card.term}</Text>
        {card.ipa ? <Text className="text-caption text-textMuted">{card.ipa}</Text> : null}
        <Text className="text-body text-text">{card.meaning_vi}</Text>
      </View>
      <IconButton
        icon="volume-high"
        accessibilityLabel={`Nghe cách đọc ${card.term}`}
        onPress={() => playWord(card.term, card.audio_url)}
      />
    </View>
  );
}
