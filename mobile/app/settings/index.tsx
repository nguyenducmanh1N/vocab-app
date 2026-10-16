import { useEffect } from "react";
import { ScrollView, Switch, Text, View } from "react-native";

import type { UserSettings } from "@/api/types";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Chip } from "@/components/Chip";
import { Stepper } from "@/components/Stepper";
import { AiConsentSection } from "@/features/settings/AiConsentSection";
import { NotificationSection, SettingRow } from "@/features/settings/NotificationSection";
import { flushSettings, updateSettings } from "@/features/settings/updateSettings";
import { stopAll } from "@/services/audio";
import { speak } from "@/services/speech";
import { useSettingsStore } from "@/stores/settingsStore";

const VOICES: { value: UserSettings["voice"]; label: string }[] = [
  { value: "en-US", label: "Anh–Mỹ" },
  { value: "en-GB", label: "Anh–Anh" },
];
const RATES = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
const DIRECTIONS: { value: UserSettings["card_direction"]; label: string }[] = [
  { value: "en_vi", label: "Anh → Việt" },
  { value: "vi_en", label: "Việt → Anh" },
];
const THEMES: { value: UserSettings["theme"]; label: string }[] = [
  { value: "system", label: "Theo máy" },
  { value: "light", label: "Sáng" },
  { value: "dark", label: "Tối" },
];
const SAMPLE = "Hello! This is how new words will sound.";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="gap-1">
      <Text className="pb-1 text-caption font-semibold uppercase text-textMuted">{title}</Text>
      {children}
    </Card>
  );
}

function ChipRow<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View className="flex-row flex-wrap gap-2 pb-2">
      {options.map((option) => (
        <Chip
          key={String(option.value)}
          label={option.label}
          selected={option.value === value}
          onPress={() => onChange(option.value)}
        />
      ))}
    </View>
  );
}

/**
 * Cài đặt (PLAN.md 7.3, 10.1): đổi là áp dụng ngay qua settingsStore và đồng bộ PATCH /me
 * sau 500 ms; rời màn thì gửi ngay phần còn chờ.
 */
export default function SettingsScreen() {
  const settings = useSettingsStore((s) => s.settings);

  useEffect(
    () => () => {
      stopAll();
      flushSettings().catch(() => undefined);
    },
    [],
  );

  return (
    <ScrollView contentContainerClassName="gap-4 p-4 pb-10" className="flex-1 bg-background">
      <Section title="Phát âm">
        <Text className="pt-1 text-body text-text">Giọng đọc</Text>
        <ChipRow options={VOICES} value={settings.voice} onChange={(voice) => updateSettings({ voice })} />
        <Text className="text-body text-text">Tốc độ đọc</Text>
        <ChipRow
          options={RATES.map((rate) => ({ value: rate, label: rate.toFixed(1) }))}
          value={settings.speech_rate}
          onChange={(speech_rate) => updateSettings({ speech_rate })}
        />
        <Button
          title="Nghe thử"
          variant="secondary"
          onPress={() => {
            stopAll();
            speak(SAMPLE); // đọc bằng giọng và tốc độ vừa chọn
          }}
        />
        <SettingRow label="Tự phát âm" hint="Đọc từ khi mặt tiếng Anh của thẻ hiện ra">
          <Switch
            value={settings.auto_play_audio}
            onValueChange={(auto_play_audio) => updateSettings({ auto_play_audio })}
            accessibilityLabel="Tự phát âm"
          />
        </SettingRow>
        <Text className="text-caption text-textMuted">
          Từ có file phát âm từ từ điển vẫn phát bằng file gốc; giọng và tốc độ áp dụng cho giọng máy.
        </Text>
      </Section>

      <Section title="Học">
        <SettingRow label="Mục tiêu mỗi ngày" hint="Số thẻ cần học; từ 10 thẻ trở lên để giữ chuỗi">
          <Stepper
            accessibilityLabel="Mục tiêu mỗi ngày"
            unit="thẻ"
            value={settings.daily_goal_cards}
            min={10}
            max={300}
            step={5}
            onChange={(daily_goal_cards) => updateSettings({ daily_goal_cards })}
          />
        </SettingRow>
        <SettingRow label="Từ mới mỗi ngày" hint="Trong Ôn tập hôm nay">
          <Stepper
            accessibilityLabel="Từ mới mỗi ngày"
            unit="từ"
            value={settings.daily_new_words}
            min={0}
            max={50}
            onChange={(daily_new_words) => updateSettings({ daily_new_words })}
          />
        </SettingRow>
        <SettingRow label="Ôn tối đa mỗi ngày" hint="Số lượt ôn từ đến hạn">
          <Stepper
            accessibilityLabel="Ôn tối đa mỗi ngày"
            unit="lượt"
            value={settings.max_reviews_per_day}
            min={10}
            max={500}
            step={10}
            onChange={(max_reviews_per_day) => updateSettings({ max_reviews_per_day })}
          />
        </SettingRow>
        <Text className="pt-1 text-body text-text">Chiều thẻ (Flashcard)</Text>
        <ChipRow
          options={DIRECTIONS}
          value={settings.card_direction}
          onChange={(card_direction) => updateSettings({ card_direction })}
        />
      </Section>

      <Section title="Giao diện">
        <ChipRow options={THEMES} value={settings.theme} onChange={(theme) => updateSettings({ theme })} />
      </Section>

      <NotificationSection />

      <AiConsentSection />
    </ScrollView>
  );
}
