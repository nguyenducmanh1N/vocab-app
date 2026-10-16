import { Pressable, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { playWord, stopAll } from "@/services/audio";
import { SLOW_RATE, speak } from "@/services/speech";

import type { StudyCard } from "../types";

/** Đề bài bằng âm thanh (trắc nghiệm nghe, nghe chép): nút nghe lại và nghe chậm, không hiện chữ. */
export function ListenPrompt({ card, label }: { card: StudyCard; label: string }) {
  const listen = () => playWord(card.term, card.audio_url);
  const listenSlow = () => {
    stopAll();
    speak(card.term, SLOW_RATE);
  };

  return (
    <View className="items-center gap-3">
      <Text className="text-body text-textMuted">{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Nghe lại"
        onPress={listen}
        className="h-24 w-24 items-center justify-center rounded-full bg-primary active:opacity-80"
      >
        <Text className="text-[40px]">🔊</Text>
      </Pressable>
      <Button title="Nghe chậm" variant="ghost" onPress={listenSlow} />
    </View>
  );
}
