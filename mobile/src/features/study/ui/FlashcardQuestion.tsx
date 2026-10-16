import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { IconButton } from "@/components/IconButton";
import { FlipCard } from "@/components/study/FlipCard";
import { SwipeCard, type SwipeDirection } from "@/components/study/SwipeCard";
import { playWord } from "@/services/audio";
import { useSettingsStore } from "@/stores/settingsStore";

import { flashcardQuality, swipeQuality, type FlashcardRating } from "../quality";
import type { CardDirection, Quality, Question } from "../types";
import { hapticResult, hapticSelect } from "./feedback";

const RATINGS: { rating: FlashcardRating; label: string; tone: string }[] = [
  { rating: "forgot", label: "Quên", tone: "bg-danger" },
  { rating: "hard", label: "Khó", tone: "bg-warning" },
  { rating: "good", label: "Được", tone: "bg-primary" },
  { rating: "easy", label: "Dễ", tone: "bg-success" },
];

/** Mặt tiếng Anh: từ, IPA, loại từ. */
function EnglishFace({ question }: { question: Question }) {
  const { card } = question;
  return (
    <View className="flex-1 items-center justify-center gap-2">
      <Text className="text-center text-word font-bold text-text" adjustsFontSizeToFit numberOfLines={3}>
        {card.term}
      </Text>
      {card.ipa ? <Text className="text-body text-textMuted">{card.ipa}</Text> : null}
      {card.part_of_speech ? (
        <Text className="text-caption text-textMuted">{card.part_of_speech}</Text>
      ) : null}
    </View>
  );
}

/** Mặt sau đủ thông tin: nghĩa, định nghĩa, câu ví dụ. */
function DetailFace({ question, direction }: { question: Question; direction: CardDirection }) {
  const { card } = question;
  const example = card.examples[0];
  return (
    <View className="flex-1 justify-center gap-3">
      {direction === "vi_en" ? (
        <EnglishFace question={question} />
      ) : (
        <Text className="text-center text-[24px] font-bold text-text">{card.meaning_vi}</Text>
      )}
      {direction === "vi_en" ? (
        <Text className="text-center text-body text-text">{card.meaning_vi}</Text>
      ) : null}
      {example ? (
        <View className="gap-1 rounded-xl bg-background p-3">
          <Text className="text-body italic text-text">{example.en}</Text>
          {example.vi ? <Text className="text-caption text-textMuted">{example.vi}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

function FrontFace({ question, direction }: { question: Question; direction: CardDirection }) {
  if (direction === "en_vi") return <EnglishFace question={question} />;
  return (
    <View className="flex-1 items-center justify-center">
      <Text className="text-center text-[28px] font-bold text-text">{question.card.meaning_vi}</Text>
    </View>
  );
}

/** Một thẻ flashcard; đặt key theo câu hỏi để trạng thái lật bắt đầu lại. */
export function FlashcardQuestion({
  question,
  direction,
  onRate,
}: {
  question: Question;
  direction: CardDirection;
  onRate: (quality: Quality) => void;
}) {
  const autoPlay = useSettingsStore((s) => s.settings.auto_play_audio);
  const [flipped, setFlipped] = useState(false);
  const { card } = question;
  const listen = () => playWord(card.term, card.audio_url);

  // Tự đọc khi mặt tiếng Anh hiện ra (PLAN.md 10.4).
  const englishVisible = direction === "en_vi" ? !flipped : flipped;
  const playedRef = useRef(false);
  useEffect(() => {
    if (autoPlay && englishVisible && !playedRef.current) {
      playedRef.current = true;
      playWord(card.term, card.audio_url);
    }
  }, [autoPlay, englishVisible, card.term, card.audio_url]);

  const flip = () => {
    hapticSelect();
    setFlipped((f) => !f);
  };
  const rate = (quality: Quality) => {
    hapticResult(quality >= 3);
    onRate(quality);
  };

  return (
    <>
      <View className="flex-1 px-4 py-4">
        <SwipeCard onSwipe={(dir: SwipeDirection) => rate(swipeQuality(dir))} onTap={flip}>
          <FlipCard
            flipped={flipped}
            front={<FrontFace question={question} direction={direction} />}
            back={<DetailFace question={question} direction={direction} />}
          />
        </SwipeCard>
      </View>
      <View className="gap-3 px-4 pb-2">
        <View className="flex-row items-center justify-center gap-2">
          <IconButton icon="volume-high" accessibilityLabel={`Nghe cách đọc ${card.term}`} onPress={listen} />
          <Text className="text-caption text-textMuted">Vuốt phải: nhớ · Vuốt trái: chưa nhớ</Text>
        </View>
        {flipped ? (
          <View className="flex-row gap-2">
            {RATINGS.map(({ rating, label, tone }) => (
              <Pressable
                key={rating}
                accessibilityRole="button"
                onPress={() => rate(flashcardQuality(rating))}
                className={`min-h-[52px] flex-1 items-center justify-center rounded-xl ${tone} active:opacity-80`}
              >
                <Text className="text-body font-semibold text-onFill">{label}</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <Button title="Lật thẻ" onPress={flip} />
        )}
      </View>
    </>
  );
}
