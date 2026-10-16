import Ionicons from "@expo/vector-icons/Ionicons";
import { Text, View } from "react-native";

import type { SpeakingCriterion, SpeakingFeedback } from "@/api/types";
import { useTheme } from "@/theme/useTheme";

const CRITERIA: { key: "pronunciation" | "stress" | "fluency"; label: string }[] = [
  { key: "pronunciation", label: "Phát âm" },
  { key: "stress", label: "Trọng âm" },
  { key: "fluency", label: "Trôi chảy" },
];

function ScoreDots({ score }: { score: number }) {
  return (
    <View className="flex-row gap-1" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {[1, 2, 3, 4, 5].map((n) => (
        <View key={n} className={`h-2 w-2 rounded-full ${n <= score ? "bg-primary" : "bg-textMuted/25"}`} />
      ))}
    </View>
  );
}

function CriterionRow({ label, value }: { label: string; value: SpeakingCriterion }) {
  return (
    <View className="gap-1" accessible accessibilityLabel={`${label}: ${value.score} trên 5. ${value.comment_vi}`}>
      <View className="flex-row items-center justify-between">
        <Text className="text-body font-semibold text-text">{label}</Text>
        <View className="flex-row items-center gap-2">
          <ScoreDots score={value.score} />
          <Text className="text-caption text-textMuted">{value.score}/5</Text>
        </View>
      </View>
      <Text className="text-caption text-textMuted">{value.comment_vi}</Text>
    </View>
  );
}

/** Nhận xét của Gemini cho bản ghi luyện nói (PLAN.md 9.11); chỉ để tham khảo, không tự chấm. */
export function SpeakingFeedbackCard({ feedback }: { feedback: SpeakingFeedback }) {
  const { colors } = useTheme();
  const scored = feedback.status === "ok";

  return (
    <View className="w-full gap-3 rounded-2xl bg-surface p-4">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-1.5">
          <Ionicons name="sparkles" size={18} color={colors.primary} />
          <Text className="text-body font-semibold text-text">Nhận xét của AI</Text>
        </View>
        {scored && feedback.overall !== null ? (
          <Text className="text-body font-bold text-primary" accessibilityLabel={`Tổng ${feedback.overall} trên 5`}>
            {feedback.overall}/5
          </Text>
        ) : null}
      </View>

      {scored ? (
        <>
          {CRITERIA.map(({ key, label }) => {
            const value = feedback[key];
            return value ? <CriterionRow key={key} label={label} value={value} /> : null;
          })}
          {feedback.fixes.length > 0 ? (
            <View className="gap-2 border-t border-textMuted/10 pt-3">
              <Text className="text-caption font-semibold uppercase text-textMuted">Cần sửa</Text>
              {feedback.fixes.map((fix) => (
                <View key={fix.word} className="gap-0.5">
                  <Text className="text-body text-text">
                    <Text className="font-semibold">{fix.word}</Text>
                    {fix.ipa ? <Text className="text-textMuted"> {fix.ipa}</Text> : null}
                  </Text>
                  <Text className="text-caption text-text">{fix.issue_vi}</Text>
                  <Text className="text-caption text-success">→ {fix.tip_vi}</Text>
                </View>
              ))}
            </View>
          ) : null}
          <Text className="text-body text-text">{feedback.summary_vi}</Text>
        </>
      ) : (
        <View className="flex-row gap-2 rounded-xl bg-warning/10 p-3">
          <Ionicons name="alert-circle-outline" size={18} color={colors.warning} />
          <Text className="flex-1 text-body text-text">{feedback.summary_vi}</Text>
        </View>
      )}

      {feedback.transcript ? (
        <Text className="text-caption text-textMuted">AI nghe được: “{feedback.transcript}”</Text>
      ) : null}
      <Text className="text-caption text-textMuted">
        {scored
          ? `Còn ${feedback.remaining_today} lượt hôm nay.`
          : `Lần này không tính lượt (còn ${feedback.remaining_today} lượt hôm nay).`}{" "}
        Nhận xét của AI chỉ mang tính tham khảo.
      </Text>
    </View>
  );
}
