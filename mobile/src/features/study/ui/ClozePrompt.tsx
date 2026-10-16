import { Text, View } from "react-native";

import { CLOZE_BLANK } from "../generators";
import type { Question } from "../types";

/** Câu ví dụ có chỗ trống (Điền chỗ trống), kèm nghĩa tiếng Việt của câu. */
export function ClozePrompt({ question, label }: { question: Question; label: string }) {
  const [before, after = ""] = question.prompt.split(CLOZE_BLANK);
  return (
    <View className="gap-3">
      <Text className="text-center text-body text-textMuted">{label}</Text>
      <Text
        testID="study-prompt"
        accessibilityLabel={`${before} chỗ trống ${after}`}
        className="text-center text-[22px] font-semibold leading-8 text-text"
      >
        {before}
        <Text className="font-bold text-primary">{CLOZE_BLANK}</Text>
        {after}
      </Text>
      {question.translation ? (
        <Text className="text-center text-body text-textMuted">{question.translation}</Text>
      ) : null}
    </View>
  );
}
