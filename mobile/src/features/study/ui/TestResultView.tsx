import { ScrollView, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { IconButton } from "@/components/IconButton";
import { ProgressRing } from "@/components/ProgressRing";
import { playWord } from "@/services/audio";

import type { TestResult } from "../testReview";

function verdict(percent: number): string {
  if (percent === 100) return "Tuyệt đối!";
  if (percent >= 80) return "Rất tốt!";
  if (percent >= 50) return "Khá ổn, ôn thêm các câu sai nhé.";
  return "Cần ôn lại thêm.";
}

/** Cuối bài kiểm tra: điểm và danh sách câu sai kèm đáp án (PLAN.md 10.3, P5.5). */
export function TestResultView({
  result,
  summaryReady,
  onDone,
}: {
  result: TestResult;
  summaryReady: boolean;
  onDone: () => void;
}) {
  return (
    <View className="flex-1">
      <ScrollView contentContainerClassName="gap-4 px-4 py-6">
        <View
          className="items-center gap-2"
          accessible
          accessibilityLabel={`Điểm: đúng ${result.correct} trên ${result.total} câu, ${result.percent} phần trăm`}
        >
          <ProgressRing value={result.total ? result.correct / result.total : 0} size={120}>
            <Text testID="test-score" className="text-[28px] font-bold text-text">
              {result.correct}/{result.total}
            </Text>
          </ProgressRing>
          <Text className="text-[22px] font-bold text-text">{result.percent}%</Text>
          <Text className="text-body text-textMuted">{verdict(result.percent)}</Text>
        </View>

        {result.wrong.length ? (
          <View className="gap-3">
            <Text className="text-body font-semibold text-text">Câu sai ({result.wrong.length})</Text>
            {result.wrong.map((item, index) => (
              <View key={item.key} className="flex-row gap-2 rounded-2xl bg-surface p-4">
                <View className="flex-1 gap-1">
                  <Text className="text-caption text-textMuted">
                    Câu sai {index + 1} · {item.ask}
                  </Text>
                  {item.sentence ? <Text className="text-body italic text-text">{item.sentence}</Text> : null}
                  <Text className="text-body text-danger">
                    Bạn trả lời: {item.given ? item.given : "(bỏ qua)"}
                  </Text>
                  <Text className="text-body font-semibold text-success">Đáp án: {item.answer}</Text>
                  {item.answer !== item.card.term ? (
                    <Text className="text-caption text-textMuted">
                      {item.card.term} · {item.card.meaning_vi}
                    </Text>
                  ) : null}
                </View>
                <IconButton
                  icon="volume-high-outline"
                  accessibilityLabel={`Nghe cách đọc ${item.card.term}`}
                  onPress={() => playWord(item.card.term, item.card.audio_url)}
                />
              </View>
            ))}
          </View>
        ) : (
          <Text className="text-center text-body text-textMuted">Không sai câu nào.</Text>
        )}
      </ScrollView>
      <View className="px-4 pt-2">
        <Button title="Xem tổng kết" disabled={!summaryReady} onPress={onDone} />
      </View>
    </View>
  );
}
