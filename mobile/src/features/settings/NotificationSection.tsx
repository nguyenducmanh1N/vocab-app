import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useFocusEffect } from "expo-router";
import { useCallback, useState, type ReactNode } from "react";
import { Alert, Linking, Switch, Text, View } from "react-native";

import type { NotifySettings } from "@/api/types";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Chip } from "@/components/Chip";
import { parseHHMM } from "@/features/notifications/schedule";
import {
  ensurePermission,
  getPermissionState,
  rescheduleAll,
  scheduledCount,
  type PermissionState,
} from "@/services/notifications";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTheme } from "@/theme/useTheme";

import { updateSettings } from "./updateSettings";

const PER_DAY = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

function toDate(hhmm: string): Date {
  const minutes = parseHHMM(hhmm);
  const date = new Date();
  date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return date;
}

function toHHMM(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <View className="min-h-[52px] flex-row items-center gap-3 py-2">
      <View className="flex-1">
        <Text className="text-body text-text">{label}</Text>
        {hint ? <Text className="text-caption text-textMuted">{hint}</Text> : null}
      </View>
      {children}
    </View>
  );
}

export function TimeField({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (hhmm: string) => void;
  label: string;
}) {
  const { scheme } = useTheme();
  return (
    <DateTimePicker
      value={toDate(value)}
      mode="time"
      display="compact"
      locale="vi-VN" // iOS: định dạng 24 giờ
      themeVariant={scheme}
      accessibilityLabel={label}
      onChange={(_event: DateTimePickerEvent, date?: Date) => {
        if (date) onChange(toHHMM(date));
      }}
    />
  );
}

/**
 * Nhóm Thông báo của màn Cài đặt (notify ở PLAN.md 7.3). Đổi là áp dụng ngay qua settingsStore
 * (app/_layout.tsx làm lại lịch thông báo) và đồng bộ PATCH /me sau 500 ms.
 */
export function NotificationSection() {
  const notify = useSettingsStore((s) => s.settings.notify);
  const [permission, setPermission] = useState<PermissionState | null>(null);
  const [pending, setPending] = useState<number | null>(null);

  const refreshStatus = useCallback(() => {
    getPermissionState().then(setPermission).catch(() => undefined);
    if (__DEV__) scheduledCount().then(setPending).catch(() => undefined);
  }, []);

  useFocusEffect(refreshStatus);

  const save = (patch: Partial<NotifySettings>) => {
    const next = { ...notify, ...patch };
    if (parseHHMM(next.window_start) >= parseHHMM(next.window_end)) {
      Alert.alert("Khung giờ chưa hợp lệ", "Giờ bắt đầu phải sớm hơn giờ kết thúc.");
      return;
    }
    updateSettings({ notify: patch });
    if (__DEV__) setTimeout(refreshStatus, 1500); // chờ lịch mới được đặt xong rồi đếm lại
  };

  const enable = async () => {
    if (permission === "denied") {
      await Linking.openSettings();
      return;
    }
    if (await ensurePermission()) await rescheduleAll().catch(() => undefined);
    refreshStatus();
  };

  return (
    <>
      {permission && permission !== "granted" ? (
        <Card className="gap-2 border border-warning/40">
          <Text className="text-body font-semibold text-text">
            {permission === "denied" ? "Thông báo đang bị tắt" : "Chưa bật thông báo"}
          </Text>
          <Text className="text-caption text-textMuted">
            {permission === "denied"
              ? "Bật lại trong Cài đặt của iPhone để nhận nhắc học và từ vựng."
              : "Cho phép thông báo để nhận nhắc học và từ vựng mỗi ngày."}
          </Text>
          <Button
            title={permission === "denied" ? "Mở Cài đặt" : "Bật thông báo"}
            variant="secondary"
            onPress={enable}
          />
        </Card>
      ) : null}

      <Card className="gap-1">
        <Text className="pb-1 text-caption font-semibold uppercase text-textMuted">Thông báo · Nhắc học</Text>
        <SettingRow label="Nhắc học hằng ngày" hint="Nhắc ôn tập vào giờ đã chọn">
          <Switch
            value={notify.daily_reminder}
            onValueChange={(value) => save({ daily_reminder: value })}
            accessibilityLabel="Nhắc học hằng ngày"
          />
        </SettingRow>
        {notify.daily_reminder ? (
          <SettingRow label="Giờ nhắc">
            <TimeField
              label="Giờ nhắc"
              value={notify.reminder_time}
              onChange={(value) => save({ reminder_time: value })}
            />
          </SettingRow>
        ) : null}
        <SettingRow label="Giữ chuỗi ngày học" hint="Nhắc lúc 21:30 nếu hôm nay chưa học đủ 10 thẻ">
          <Switch
            value={notify.streak_guard}
            onValueChange={(value) => save({ streak_guard: value })}
            accessibilityLabel="Giữ chuỗi ngày học"
          />
        </SettingRow>
      </Card>

      <Card className="gap-1">
        <Text className="pb-1 text-caption font-semibold uppercase text-textMuted">Thông báo · Từ vựng</Text>
        <SettingRow label="Thông báo từ vựng" hint="Gửi từ đang học kèm nghĩa và câu ví dụ">
          <Switch
            value={notify.word_push}
            onValueChange={(value) => save({ word_push: value })}
            accessibilityLabel="Thông báo từ vựng"
          />
        </SettingRow>
        {notify.word_push ? (
          <>
            <Text className="pt-2 text-body text-text">Số từ mỗi ngày</Text>
            <View className="flex-row flex-wrap gap-2 py-2">
              {PER_DAY.map((n) => (
                <Chip
                  key={n}
                  label={String(n)}
                  selected={notify.word_push_per_day === n}
                  onPress={() => save({ word_push_per_day: n })}
                />
              ))}
            </View>
            <SettingRow label="Từ" hint="Bắt đầu gửi lúc">
              <TimeField
                label="Giờ bắt đầu gửi từ vựng"
                value={notify.window_start}
                onChange={(value) => save({ window_start: value })}
              />
            </SettingRow>
            <SettingRow label="Đến" hint="Ngừng gửi lúc">
              <TimeField
                label="Giờ ngừng gửi từ vựng"
                value={notify.window_end}
                onChange={(value) => save({ window_end: value })}
              />
            </SettingRow>
          </>
        ) : null}
      </Card>

      {__DEV__ ? (
        <Card className="gap-2">
          <Text className="text-caption text-textMuted">
            (Chỉ khi phát triển) Đang chờ {pending ?? "…"} thông báo.
          </Text>
          <Button
            title="Làm lại lịch ngay"
            variant="secondary"
            onPress={() => rescheduleAll().catch(() => undefined).finally(refreshStatus)}
          />
        </Card>
      ) : null}
    </>
  );
}
