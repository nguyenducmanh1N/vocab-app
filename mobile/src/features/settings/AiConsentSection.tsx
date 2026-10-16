import { useState } from "react";
import { Alert, Text } from "react-native";

import { messageFor } from "@/api/errorMessages";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { requestAiConsent, withdrawAiConsent } from "@/features/ai/consent";
import { useAuthStore } from "@/stores/authStore";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("vi-VN");
}

/** Xem trạng thái, đồng ý hoặc rút lại đồng ý gửi nội dung cho Google Gemini (PLAN.md 9.16). */
export function AiConsentSection() {
  const consentAt = useAuthStore((s) => s.user?.ai_consent_at ?? null);
  const [busy, setBusy] = useState(false);

  const withdraw = () =>
    Alert.alert(
      "Rút lại đồng ý dùng AI?",
      "App sẽ thôi gửi nội dung cho Google Gemini. Gợi ý từ, Tự điền, lọc từ trong ảnh và AI nhận xét sẽ hỏi lại trước khi dùng. Từ đã lưu vẫn giữ nguyên.",
      [
        { text: "Huỷ", style: "cancel" },
        {
          text: "Rút lại",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            try {
              await withdrawAiConsent();
            } catch (err) {
              Alert.alert("Chưa rút lại được", messageFor(err));
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );

  return (
    <Card className="gap-1">
      <Text className="pb-1 text-caption font-semibold uppercase text-textMuted">AI</Text>
      <Text className="text-body text-text">Gửi nội dung cho Google Gemini</Text>
      <Text className="pb-2 text-caption text-textMuted">
        {consentAt
          ? `Đã đồng ý ngày ${formatDate(consentAt)}`
          : "Chưa đồng ý: các tính năng AI sẽ hỏi trước khi dùng"}
      </Text>
      {consentAt ? (
        <Button title="Rút lại đồng ý" variant="danger" onPress={withdraw} loading={busy} />
      ) : (
        <Button title="Xem và đồng ý" variant="secondary" onPress={() => void requestAiConsent()} />
      )}
    </Card>
  );
}
