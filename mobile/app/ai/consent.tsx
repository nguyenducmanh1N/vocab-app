import { router } from "expo-router";
import { useEffect } from "react";

import { AiConsentSheet } from "@/features/ai/AiConsentSheet";
import { settleAiConsent } from "@/features/ai/consent";

/**
 * Sheet đồng ý dùng AI (transparentModal), mở bằng requestAiConsent().
 * Đóng bằng cách nào khác (vuốt, nút quay lại) thì coi như chọn Không.
 */
export default function AiConsentScreen() {
  useEffect(() => () => settleAiConsent(false), []);

  const done = (agreed: boolean) => {
    settleAiConsent(agreed);
    router.back();
  };
  return <AiConsentSheet onDone={done} />;
}
