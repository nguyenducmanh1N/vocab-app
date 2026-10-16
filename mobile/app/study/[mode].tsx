import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { messageFor } from "@/api/errorMessages";
import type { StudyMode } from "@/api/types";
import { EmptyState } from "@/components/EmptyState";
import { IconButton } from "@/components/IconButton";
import { ProgressBar } from "@/components/ProgressBar";
import { finishToSummary } from "@/features/study/finishSession";
import { isMcq } from "@/features/study/generators";
import { testResult } from "@/features/study/testReview";
import { FlashcardQuestion } from "@/features/study/ui/FlashcardQuestion";
import { IntroCard } from "@/features/study/ui/IntroCard";
import { MatchStudy } from "@/features/study/ui/MatchStudy";
import { McqQuestion } from "@/features/study/ui/McqQuestion";
import { SpeakingQuestion } from "@/features/study/ui/SpeakingQuestion";
import { TestResultView } from "@/features/study/ui/TestResultView";
import { TypeWordQuestion } from "@/features/study/ui/TypeWordQuestion";
import { useStudySession } from "@/features/study/useStudySession";
import { stopAll } from "@/services/audio";
import { useStudySummaryStore } from "@/stores/studySummaryStore";

const SUPPORTED: readonly StudyMode[] = ["review", "flashcard", "mcq", "typing", "learn", "dictation", "cloze", "speaking", "test"];

/** Ghép cặp là trò chơi trên lưới, không theo từng câu hỏi: màn riêng. */
export default function StudyRoute() {
  const { mode } = useLocalSearchParams<{ mode: string }>();
  return mode === "match" ? <MatchStudy /> : <StudyScreen />;
}

function StudyScreen() {
  const params = useLocalSearchParams<{
    mode: string;
    listId?: string;
    retry?: string;
    extra?: string; // Ôn tập hôm nay: số từ mới học thêm ngoài hạn mức
  }>();
  const mode = params.mode as StudyMode;
  const isRetry = params.retry === "1";
  // "Ôn lại từ sai": thẻ lấy từ phiên vừa xong (giữ cố định từ lúc mở màn), không gọi API.
  const [retrySource] = useState(() => (isRetry ? useStudySummaryStore.getState().retry : null));
  const session = useStudySession(
    mode,
    params.listId ?? null,
    retrySource,
    Number(params.extra) || 0,
  );
  const [ending, setEnding] = useState(false);
  const finishedRef = useRef(false);
  const isTest = mode === "test";
  // Kiểm tra: hết bài thì hiện điểm và câu sai trước khi sang màn tổng kết.
  const result = useMemo(
    () => (isTest && session.graded?.length ? testResult(session.graded) : null),
    [isTest, session.graded],
  );
  const [summaryReady, setSummaryReady] = useState(false);
  // Màn không có header: tự chừa khoảng an toàn (tai thỏ, thanh Home).
  const insets = useSafeAreaInsets();

  useEffect(() => stopAll, []);

  /** Ghi lô cuối vào hàng đợi (nhanh, chạy cả khi mất mạng) rồi sang màn tổng kết. */
  const finishAndSummarize = async () => {
    finishedRef.current = true;
    stopAll();
    if (await finishToSummary(session.finish)) router.replace("/study/summary");
    else router.back();
  };

  // Hết thẻ: sang màn tổng kết (kiểm tra: hiện điểm trước, kết quả vẫn được gửi ngay).
  useEffect(() => {
    if (!session.done || session.answered === 0 || finishedRef.current) return;
    if (isTest) {
      finishedRef.current = true;
      stopAll();
      finishToSummary(session.finish).then(setSummaryReady);
      return;
    }
    finishAndSummarize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.done, session.answered]);

  const exit = () => {
    if (session.answered === 0 || finishedRef.current) {
      router.back();
      return;
    }
    Alert.alert("Kết thúc phiên?", `Đã học ${session.answered} thẻ, kết quả sẽ được lưu.`, [
      { text: "Học tiếp", style: "cancel" },
      {
        text: "Kết thúc",
        onPress: () => {
          setEnding(true); // hết thẻ thì session.done đã hiện vòng chờ; kết thúc giữa chừng thì cần
          finishAndSummarize();
        },
      },
    ]);
  };

  const total = session.answered + session.remaining;
  let body;
  if (!SUPPORTED.includes(mode)) {
    body = (
      <EmptyState
        icon="construct-outline"
        title="Chế độ này sắp có"
        actionLabel="Quay lại"
        onAction={() => router.back()}
      />
    );
  } else if (isRetry && !retrySource) {
    body = (
      <EmptyState
        icon="refresh-outline"
        title="Không còn dữ liệu phiên trước"
        description="Mở lại phiên học từ list hoặc Trang chủ."
        actionLabel="Quay lại"
        onAction={() => router.back()}
      />
    );
  } else if (session.queue.isPending) {
    body = <ActivityIndicator className="flex-1" />;
  } else if (session.queue.isError) {
    body = (
      <EmptyState
        icon="cloud-offline-outline"
        title="Không tải được thẻ"
        description={messageFor(session.queue.error)}
        actionLabel="Thử lại"
        onAction={() => session.queue.refetch()}
      />
    );
  } else if (total === 0 && session.skipped > 0) {
    body = (
      <EmptyState
        icon="document-text-outline"
        title="Chưa có câu ví dụ phù hợp"
        description={`${session.skipped} từ bị bỏ qua vì không có câu ví dụ chứa chính từ đó. Thêm câu ví dụ cho từ rồi thử lại.`}
        actionLabel="Quay lại"
        onAction={() => router.back()}
      />
    );
  } else if (total === 0) {
    body = (
      <EmptyState
        icon="checkmark-done-outline"
        title="Chưa có từ để học"
        description={
          mode === "review" ? "Hôm nay không còn từ đến hạn hay từ mới." : "List này chưa có từ, hoặc bạn đã học hết."
        }
        actionLabel="Quay lại"
        onAction={() => router.back()}
      />
    );
  } else if (result) {
    body = (
      <TestResultView
        result={result}
        summaryReady={summaryReady}
        onDone={() => router.replace("/study/summary")}
      />
    );
  } else if (session.done || ending) {
    body = <ActivityIndicator className="flex-1" />;
  } else if (session.question) {
    const { question } = session;
    if (question.intro) {
      body = <IntroCard key={question.id} question={question} onContinue={session.skipIntro} />;
    } else if (question.kind === "flip") {
      body = (
        <FlashcardQuestion
          key={question.id}
          question={question}
          direction={session.direction}
          onRate={session.rate}
        />
      );
    } else if (isMcq(question.kind) || (question.kind === "cloze" && question.options)) {
      body = (
        <McqQuestion
          key={question.id}
          question={question}
          onAnswer={session.answer}
          onNext={session.next}
          elapsedMs={session.elapsedMs}
          silent={isTest}
        />
      );
    } else if (
      question.kind === "type_word" ||
      question.kind === "dictation" ||
      question.kind === "cloze"
    ) {
      body = (
        <TypeWordQuestion
          key={question.id}
          question={question}
          onAnswer={session.answer}
          onNext={session.next}
          elapsedMs={session.elapsedMs}
          silent={isTest}
        />
      );
    } else if (question.kind === "speak") {
      body = <SpeakingQuestion key={question.id} question={question} onRate={session.rate} />;
    }
  }

  // learn: tiến độ theo số từ đã thuộc; chế độ khác theo số câu đã trả lời.
  const counter =
    mode === "learn"
      ? `${session.learned.done}/${session.learned.total} từ`
      : total
        ? `${session.answered}/${total}`
        : "";

  return (
    <View
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 12) }}
    >
      <View className="flex-row items-center gap-3 px-2">
        <IconButton icon="close" tone="muted" accessibilityLabel="Thoát phiên học" onPress={exit} />
        {session.canUndo ? (
          <IconButton
            icon="arrow-undo"
            tone="muted"
            accessibilityLabel="Hoàn tác câu vừa trả lời"
            onPress={session.undo}
          />
        ) : null}
        <View className="flex-1">
          <ProgressBar value={session.progressValue} accessibilityLabel="Tiến độ phiên học" />
        </View>
        <Text className="min-w-[48px] pr-2 text-right text-caption text-textMuted">{counter}</Text>
      </View>
      {/* Điền chỗ trống: báo số từ bị bỏ ở đầu phiên. */}
      {session.skipped > 0 && total > 0 && session.answered === 0 ? (
        <Text className="px-4 pt-1 text-caption text-textMuted" accessibilityLiveRegion="polite">
          Bỏ qua {session.skipped} từ không có câu ví dụ chứa chính từ đó.
        </Text>
      ) : null}
      {/* Bàn phím (chế độ gõ từ) không che ô nhập và nút. */}
      <KeyboardAvoidingView behavior="padding" className="flex-1">
        {body}
      </KeyboardAvoidingView>
    </View>
  );
}
