import Ionicons from "@expo/vector-icons/Ionicons";
import { File } from "expo-file-system";
import type { ComponentProps } from "react";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { aiButtonTitle, useAiConsent } from "@/features/ai/consent";
import { aiErrorMessage, isRetryable } from "@/features/ai/format";
import { useSpeakingFeedback } from "@/hooks/useAi";
import { playWord, speakSentence, stopAll } from "@/services/audio";
import { SLOW_RATE, speak } from "@/services/speech";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTheme } from "@/theme/useTheme";

import { speakingQuality, type SpeakingRating } from "../quality";
import { ensureSpeakingConsent, GEMINI_FREE_TIER_NOTE } from "../speakingConsent";
import type { Quality, Question } from "../types";
import { hapticResult, hapticSelect } from "./feedback";
import { SpeakingFeedbackCard } from "./SpeakingFeedbackCard";
import { useSpeakingRecorder } from "./useSpeakingRecorder";

const RATINGS: { rating: SpeakingRating; label: string; tone: string }[] = [
  { rating: "not_yet", label: "Chưa được", tone: "bg-danger" },
  { rating: "ok", label: "Tạm", tone: "bg-warning" },
  { rating: "good", label: "Tốt", tone: "bg-primary" },
  { rating: "great", label: "Rất tốt", tone: "bg-success" },
];

function PillButton({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`min-h-[44px] flex-row items-center gap-1.5 rounded-full bg-surface px-4 active:opacity-70 ${
        disabled ? "opacity-50" : ""
      }`}
    >
      <Ionicons name={icon} size={18} color={colors.primary} />
      <Text className="text-body font-semibold text-primary">{label}</Text>
    </Pressable>
  );
}

function formatSeconds(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `0:${String(seconds).padStart(2, "0")}`;
}

/**
 * Luyện nói: nghe câu mẫu, ghi âm, nghe lại, tự chấm 4 mức (PLAN.md 10.3, 10.4, bảng q ở 9.2).
 * Có thể nhờ Gemini nhận xét bản ghi (9.11); nhận xét chỉ để tham khảo, người học vẫn tự chấm.
 */
export function SpeakingQuestion({
  question,
  onRate,
}: {
  question: Question;
  onRate: (quality: Quality) => void;
}) {
  const { colors } = useTheme();
  const autoPlay = useSettingsStore((s) => s.settings.auto_play_audio);
  const mic = useSpeakingRecorder();
  const { card, prompt } = question;
  const isWord = prompt === card.term; // từ chưa có câu ví dụ: luyện nói chính từ
  const aiFeedback = useSpeakingFeedback();
  const aiConsent = useAiConsent();
  // Bản ghi mà nhận xét đang hiện thuộc về; ghi lại thì nhận xét cũ ẩn đi.
  const [feedbackUri, setFeedbackUri] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const feedbackForCurrent = feedbackUri !== null && feedbackUri === mic.recordingUri;

  const askAi = async () => {
    const uri = mic.recordingUri;
    if (!uri || mic.recording || aiFeedback.isPending) return;
    mic.stopPlayback();
    // Đồng ý dùng AI chung (9.16) rồi mới tới đồng ý gửi bản ghi giọng nói; chọn Không thì vẫn tự chấm.
    if (!(await aiConsent.ensure())) return;
    if (!(await ensureSpeakingConsent())) return;
    setFeedbackUri(uri);
    setReadError(null);
    aiFeedback.reset();
    let audio: string;
    try {
      audio = await new File(uri).base64();
    } catch {
      setReadError("Không đọc được bản ghi. Hãy ghi lại.");
      return;
    }
    aiFeedback.mutate({
      audio_base64: audio,
      mime_type: "audio/m4a",
      reference_text: prompt.slice(0, 300),
      ...(isWord ? {} : { term: card.term }),
    });
  };

  const listen = (slow = false) => {
    if (mic.recording) return;
    mic.stopPlayback();
    if (slow) {
      stopAll();
      speak(prompt, SLOW_RATE);
    } else if (isWord) {
      playWord(card.term, card.audio_url);
    } else {
      speakSentence(prompt);
    }
  };

  // Tự phát mẫu một lần khi câu hiện ra (PLAN.md 10.4).
  const playedRef = useRef(false);
  useEffect(() => {
    if (!autoPlay || playedRef.current) return;
    playedRef.current = true;
    if (isWord) playWord(card.term, card.audio_url);
    else speakSentence(prompt);
  }, [autoPlay, isWord, prompt, card.term, card.audio_url]);

  const toggleRecord = () => {
    hapticSelect();
    if (mic.recording) mic.stop();
    else mic.start();
  };

  const rate = (quality: Quality) => {
    if (mic.recording) return;
    hapticResult(quality >= 3);
    onRate(quality);
  };

  const denied = mic.permission === "denied";
  const canRate = !mic.recording && (mic.recordingUri !== null || denied);

  return (
    <>
      <ScrollView contentContainerClassName="flex-grow gap-6 px-4 py-6">
        <View className="flex-1 justify-center gap-3">
          <Text className="text-center text-body text-textMuted">
            {isWord ? "Đọc to từ sau" : "Đọc to câu sau"}
          </Text>
          <Text
            testID="study-prompt"
            className={`text-center font-bold text-text ${isWord ? "text-word" : "text-[24px] leading-8"}`}
          >
            {prompt}
          </Text>
          {question.translation ? (
            <Text className="text-center text-body text-textMuted">{question.translation}</Text>
          ) : null}
          <Text className="text-center text-caption text-textMuted">
            {[isWord ? null : card.term, card.ipa, isWord ? card.meaning_vi : null]
              .filter(Boolean)
              .join(" · ")}
          </Text>
          <View className="flex-row justify-center gap-2 pt-2">
            <PillButton icon="volume-high" label="Nghe mẫu" onPress={() => listen()} disabled={mic.recording} />
            <PillButton
              icon="hourglass-outline"
              label="Nghe chậm"
              onPress={() => listen(true)}
              disabled={mic.recording}
            />
          </View>
        </View>

        {denied ? (
          <View className="gap-2 rounded-xl bg-warning/10 p-3">
            <Text className="text-body text-text">
              Chưa có quyền dùng micro nên không ghi âm được. Bạn vẫn có thể nghe mẫu, đọc to và tự chấm.
            </Text>
            <Pressable accessibilityRole="button" onPress={mic.openSettings} className="self-start py-1">
              <Text className="text-body font-semibold text-primary">Mở Cài đặt để cấp quyền</Text>
            </Pressable>
          </View>
        ) : (
          <View className="items-center gap-3">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={mic.recording ? "Dừng ghi âm" : mic.recordingUri ? "Ghi lại" : "Ghi âm"}
              accessibilityState={{ disabled: mic.permission !== "granted" }}
              disabled={mic.permission !== "granted"}
              onPress={toggleRecord}
              className={`h-20 w-20 items-center justify-center rounded-full active:opacity-80 ${
                mic.recording ? "bg-danger" : "bg-primary"
              } ${mic.permission !== "granted" ? "opacity-50" : ""}`}
            >
              <Ionicons name={mic.recording ? "stop" : "mic"} size={36} color={colors.onFill} />
            </Pressable>
            <Text className="text-caption text-textMuted">
              {mic.recording
                ? `Đang ghi ${formatSeconds(mic.durationMs)} · bấm để dừng`
                : mic.recordingUri
                  ? "Bấm micro để ghi lại"
                  : "Bấm micro rồi đọc to"}
            </Text>
            {mic.recordingUri && !mic.recording ? (
              <View className="flex-row justify-center gap-2">
                <PillButton
                  icon={mic.playingRecording ? "pause" : "play"}
                  label="Nghe lại bản ghi"
                  onPress={mic.playingRecording ? mic.stopPlayback : mic.playRecording}
                />
                <PillButton icon="volume-high-outline" label="Nghe lại mẫu" onPress={() => listen()} />
              </View>
            ) : null}
            {mic.recordingUri && !mic.recording ? (
              <View className="w-full items-center gap-2 pt-2">
                <PillButton
                  icon="sparkles"
                  label={
                    aiFeedback.isPending && feedbackForCurrent
                      ? "Đang nghe bản ghi…"
                      : aiButtonTitle("AI nhận xét", aiConsent.granted)
                  }
                  onPress={askAi}
                  disabled={aiFeedback.isPending}
                />
                <Text className="px-2 text-center text-caption text-textMuted">{GEMINI_FREE_TIER_NOTE}</Text>
                {feedbackForCurrent && readError ? (
                  <Text className="text-center text-caption text-danger">{readError}</Text>
                ) : null}
                {feedbackForCurrent && aiFeedback.error ? (
                  <View className="items-center gap-1">
                    <Text className="text-center text-caption text-danger">
                      {aiErrorMessage(aiFeedback.error)}
                    </Text>
                    {isRetryable(aiFeedback.error) ? (
                      <Pressable accessibilityRole="button" onPress={askAi} className="min-h-[44px] justify-center">
                        <Text className="text-body font-semibold text-primary">Thử lại</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
                {feedbackForCurrent && aiFeedback.data ? (
                  <SpeakingFeedbackCard feedback={aiFeedback.data} />
                ) : null}
              </View>
            ) : null}
            {mic.error ? (
              <View className="flex-row items-center gap-1.5">
                <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
                <Text className="text-caption text-danger">{mic.error}</Text>
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>
      <View className="gap-2 px-4 pb-2">
        {canRate ? (
          <>
            <Text className="text-center text-caption text-textMuted">Bạn đọc thế nào?</Text>
            <View className="flex-row gap-2">
              {RATINGS.map(({ rating, label, tone }) => (
                <Pressable
                  key={rating}
                  accessibilityRole="button"
                  onPress={() => rate(speakingQuality(rating))}
                  className={`min-h-[52px] flex-1 items-center justify-center rounded-xl px-1 ${tone} active:opacity-80`}
                >
                  <Text className="text-center text-body font-semibold text-onFill">{label}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : (
          <Text className="min-h-[52px] text-center text-caption text-textMuted">
            Ghi âm rồi nghe lại để tự chấm
          </Text>
        )}
      </View>
    </>
  );
}
