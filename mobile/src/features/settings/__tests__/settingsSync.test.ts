import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import { applyPatch, createSettingsSync, mergePatch, type SettingsPatch } from "../settingsSync";

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

/** Cho các Promise đang dở chạy tiếp (fake timers không tự chạy microtask). */
const flushPromises = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

function setup(send: (patch: SettingsPatch) => Promise<string>) {
  const sent: SettingsPatch[] = [];
  const saved: [string, boolean][] = [];
  const errors: unknown[] = [];
  const sync = createSettingsSync({
    send: (patch) => {
      sent.push(patch);
      return send(patch);
    },
    onSaved: (result, hasPending) => saved.push([result, hasPending]),
    onError: (error) => errors.push(error),
  });
  return { sync, sent, saved, errors };
}

describe("mergePatch / applyPatch", () => {
  it("gộp sâu nhóm notify", () => {
    expect(
      mergePatch({ voice: "en-GB", notify: { reminder_time: "21:00" } }, { notify: { word_push: false } }),
    ).toEqual({ voice: "en-GB", notify: { reminder_time: "21:00", word_push: false } });
  });

  it("áp patch không làm mất khoá notify khác", () => {
    const settings = applyPatch(
      {
        daily_new_words: 10,
        max_reviews_per_day: 100,
        daily_goal_cards: 20,
        card_direction: "en_vi",
        voice: "en-US",
        speech_rate: 0.9,
        auto_play_audio: true,
        theme: "system",
        notify: {
          daily_reminder: true,
          reminder_time: "20:00",
          word_push: true,
          word_push_per_day: 3,
          window_start: "08:00",
          window_end: "22:00",
          streak_guard: true,
        },
      },
      { card_direction: "vi_en", notify: { word_push_per_day: 7 } },
    );
    expect(settings.card_direction).toBe("vi_en");
    expect(settings.notify).toMatchObject({ word_push_per_day: 7, reminder_time: "20:00" });
  });
});

describe("createSettingsSync", () => {
  it("nhiều thay đổi trong 500 ms chỉ gửi một lần, payload đã gộp", async () => {
    const { sync, sent, saved } = setup(async () => "ok");
    sync.update({ speech_rate: 0.7 });
    jest.advanceTimersByTime(300);
    sync.update({ voice: "en-GB", notify: { reminder_time: "21:00" } });
    jest.advanceTimersByTime(300);
    sync.update({ notify: { streak_guard: false } });
    expect(sent).toEqual([]); // chưa đủ 500 ms kể từ lần đổi cuối

    jest.advanceTimersByTime(500);
    await flushPromises();
    expect(sent).toEqual([
      { speech_rate: 0.7, voice: "en-GB", notify: { reminder_time: "21:00", streak_guard: false } },
    ]);
    expect(saved).toEqual([["ok", false]]);
    expect(sync.hasPending()).toBe(false);
  });

  it("đổi tiếp lúc đang gửi: gửi thêm một lần sau, báo còn thay đổi chờ gửi", async () => {
    let resolveFirst: (value: string) => void = () => undefined;
    let call = 0;
    const { sync, sent, saved } = setup(
      () =>
        new Promise<string>((resolve) => {
          call += 1;
          if (call === 1) resolveFirst = resolve;
          else resolve("second");
        }),
    );
    sync.update({ theme: "dark" });
    jest.advanceTimersByTime(500);
    await flushPromises();
    expect(sent).toHaveLength(1);

    sync.update({ card_direction: "vi_en" }); // trong lúc lần 1 chưa xong
    resolveFirst("first");
    await flushPromises();
    expect(saved).toEqual([["first", true]]);

    jest.advanceTimersByTime(500);
    await flushPromises();
    expect(sent).toEqual([{ theme: "dark" }, { card_direction: "vi_en" }]);
    expect(saved).toEqual([
      ["first", true],
      ["second", false],
    ]);
  });

  it("lỗi khi gửi thì gọi onError", async () => {
    const { sync, errors, saved } = setup(async () => {
      throw new Error("mạng lỗi");
    });
    sync.update({ daily_goal_cards: 30 });
    jest.advanceTimersByTime(500);
    await flushPromises();
    expect(errors).toHaveLength(1);
    expect(saved).toEqual([]);
  });

  it("flush() gửi ngay, không chờ 500 ms", async () => {
    const { sync, sent } = setup(async () => "ok");
    sync.update({ auto_play_audio: false });
    await sync.flush();
    expect(sent).toEqual([{ auto_play_audio: false }]);
    jest.advanceTimersByTime(1000);
    await flushPromises();
    expect(sent).toHaveLength(1); // không gửi lặp
  });
});
