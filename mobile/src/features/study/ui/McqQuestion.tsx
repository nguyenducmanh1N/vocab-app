import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { IconButton } from "@/components/IconButton";
import { playWord } from "@/services/audio";
import { useSettingsStore } from "@/stores/settingsStore";

import { answerQuality } from "../quality";
import type { Quality, Question } from "../types";
import { AnswerReveal } from "./AnswerReveal";
import { ClozePrompt } from "./ClozePrompt";
import { hapticSelect } from "./feedback";
import { ListenPrompt } from "./ListenPrompt";
import { useAfterAnswer } from "./useAfterAnswer";

type Props = {
  question: Question;
  onAnswer: (quality: Quality, isCorrect: boolean, given?: string) => void;
  onNext: () => void;
  elapsedMs: () => number;
  /** Bài kiểm tra: không báo đúng/sai, chọn xong sang câu tiếp ngay. */
  silent?: boolean;
};

function Prompt({ question }: { question: Question }) {
  const { card } = question;
  const listen = () => playWord(card.term, card.audio_url);

  if (question.kind === "cloze") {
    return <ClozePrompt question={question} label="Chọn từ điền vào chỗ trống" />;
  }
  if (question.kind === "mcq_audio") {
    return <ListenPrompt card={card} label="Nghe và chọn từ đúng" />;
  }
  if (question.kind === "mcq_vi_en") {
    return (
      <View className="items-center gap-2">
        <Text className="text-body text-textMuted">Chọn từ tiếng Anh có nghĩa</Text>
        <Text testID="study-prompt" className="text-center text-[28px] font-bold text-text">
          {card.meaning_vi}
        </Text>
      </View>
    );
  }
  return (
    <View className="items-center gap-1">
      <Text className="text-body text-textMuted">Chọn nghĩa đúng</Text>
      <View className="flex-row items-center gap-1">
        <Text
          testID="study-prompt"
          className="text-center text-word font-bold text-text"
          adjustsFontSizeToFit
          numberOfLines={2}
        >
          {card.term}
        </Text>
        <IconButton icon="volume-high-outline" accessibilityLabel={`Nghe ${card.term}`} onPress={listen} />
      </View>
      {card.ipa ? <Text className="text-body text-textMuted">{card.ipa}</Text> : null}
      {card.part_of_speech ? (
        <Text className="text-caption text-textMuted">{card.part_of_speech}</Text>
      ) : null}
    </View>
  );
}

/** Trắc nghiệm 4 lựa chọn: mcq_en_vi, mcq_vi_en, mcq_audio, cloze dạng chọn (PLAN.md 10.3). */
export function McqQuestion({ question, onAnswer, onNext, elapsedMs, silent = false }: Props) {
  const { card } = question;
  const autoPlay = useSettingsStore((s) => s.settings.auto_play_audio);
  const [chosen, setChosen] = useState<string | null>(null);
  const { result, reveal } = useAfterAnswer(card, onNext);

  // mcq_audio luôn đọc (câu hỏi là âm thanh); mcq_en_vi đọc theo cài đặt.
  useEffect(() => {
    if (question.kind === "mcq_audio" || (question.kind === "mcq_en_vi" && autoPlay)) {
      playWord(card.term, card.audio_url);
    }
  }, [question.kind, autoPlay, card.term, card.audio_url]);

  const choose = (option: string) => {
    if (result !== null) return;
    hapticSelect();
    const correct = option === question.answer;
    onAnswer(answerQuality({ correct, responseMs: elapsedMs() }), correct, option);
    if (silent) {
      onNext();
      return;
    }
    setChosen(option);
    reveal(correct);
  };

  const optionClass = (option: string) => {
    if (result === null) return "border-textMuted/30 bg-surface";
    if (option === question.answer) return "border-success bg-success/10";
    if (option === chosen) return "border-danger bg-danger/10";
    return "border-textMuted/20 bg-surface opacity-60";
  };

  return (
    <ScrollView contentContainerClassName="flex-grow gap-4 px-4 py-6">
      <View className="flex-1 justify-center">
        <Prompt question={question} />
      </View>
      <View className="gap-3">
        {question.options?.map((option, index) => (
          <Pressable
            key={option}
            testID={`mcq-option-${index}`}
            accessibilityRole="button"
            accessibilityState={{ disabled: result !== null, selected: option === chosen }}
            onPress={() => choose(option)}
            className={`min-h-[56px] justify-center rounded-xl border-2 px-4 py-3 ${optionClass(option)}`}
          >
            <Text className="text-body text-text">{option}</Text>
          </Pressable>
        ))}
      </View>
      {result !== null ? (
        <View className="gap-3">
          <AnswerReveal card={card} correct={result} />
          <Button title="Tiếp tục" onPress={onNext} />
        </View>
      ) : null}
    </ScrollView>
  );
}
