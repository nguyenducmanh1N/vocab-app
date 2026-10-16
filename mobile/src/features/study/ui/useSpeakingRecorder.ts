/**
 * Ghi âm cho Luyện nói (PLAN.md 10.4): xin quyền micro lần đầu, ghi vào file tạm, nghe lại.
 * Bản ghi chỉ rời máy khi người học bấm "AI nhận xét" (PLAN.md 9.11); rời câu là xoá các file
 * đã ghi của câu đó.
 */
import {
  PermissionStatus,
  RecordingPresets,
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { File } from "expo-file-system";
import { useEffect, useRef, useState } from "react";
import { AppState, Linking } from "react-native";

import { setRecordingMode, stopAll } from "@/services/audio";

export const MAX_RECORDING_MS = 20_000; // ghi quá lâu thì tự dừng

export type MicPermission = "checking" | "granted" | "denied";

function deleteFile(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // file tạm trong cache: không xoá được thì iOS tự dọn
  }
}

export function useSpeakingRecorder() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 250);
  const player = useAudioPlayer(null);
  const playerStatus = useAudioPlayerStatus(player);
  const [permission, setPermission] = useState<MicPermission>("checking");
  const [recording, setRecording] = useState(false);
  const [recordingUri, setRecordingUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Trạng thái dùng trong callback và lúc dọn dẹp (không render).
  const liveRef = useRef({
    recording: false,
    starting: null as Promise<void> | null,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
    uris: [] as string[],
  });

  // Quyền micro: chưa hỏi thì hỏi; quay lại app (vd. từ Cài đặt) thì kiểm tra lại.
  useEffect(() => {
    let active = true;
    const check = async (ask: boolean) => {
      try {
        let response = await getRecordingPermissionsAsync();
        if (ask && response.status === PermissionStatus.UNDETERMINED) {
          response = await requestRecordingPermissionsAsync();
        }
        if (active) setPermission(response.granted ? "granted" : "denied");
      } catch {
        if (active) setPermission("denied");
      }
    };
    check(true);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") check(false);
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  // Rời câu (chấm xong, thoát phiên): dừng ghi, trả loa ngoài, xoá file tạm.
  useEffect(() => {
    const live = liveRef.current;
    return () => {
      clearTimeout(live.timer);
      if (live.recording) {
        live.recording = false;
        try {
          recorder.stop().catch(() => undefined);
        } catch {
          // recorder đã được giải phóng cùng màn
        }
      }
      setRecordingMode(false).catch(() => undefined);
      live.uris.forEach(deleteFile);
    };
  }, [recorder]);

  const stop = async () => {
    const live = liveRef.current;
    await live.starting;
    if (!live.recording) return;
    live.recording = false;
    clearTimeout(live.timer);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (uri) {
        live.uris.push(uri);
        setRecordingUri(uri);
      }
    } catch {
      setError("Không lưu được bản ghi. Hãy ghi lại.");
    } finally {
      setRecording(false);
      // Tắt chế độ ghi để nghe lại ra loa ngoài (xem setRecordingMode).
      await setRecordingMode(false).catch(() => undefined);
    }
  };

  const start = async () => {
    const live = liveRef.current;
    if (live.recording || permission !== "granted") return;
    stopAll();
    player.pause();
    setError(null);
    live.recording = true;
    setRecording(true);
    live.starting = (async () => {
      try {
        await setRecordingMode(true);
        await recorder.prepareToRecordAsync();
        recorder.record();
        live.timer = setTimeout(() => {
          stop();
        }, MAX_RECORDING_MS);
      } catch {
        live.recording = false;
        setRecording(false);
        setRecordingMode(false).catch(() => undefined);
        setError("Không ghi âm được. Kiểm tra micro rồi thử lại.");
      } finally {
        live.starting = null;
      }
    })();
    await live.starting;
  };

  /** Nghe lại bản ghi vừa rồi (dừng câu mẫu đang phát). */
  const playRecording = () => {
    if (!recordingUri || liveRef.current.recording) return;
    stopAll();
    try {
      player.replace({ uri: recordingUri });
      player.seekTo(0).catch(() => undefined);
      player.play();
    } catch {
      setError("Không phát được bản ghi.");
    }
  };

  /** Dừng phát bản ghi (trước khi phát câu mẫu). */
  const stopPlayback = () => player.pause();

  return {
    permission,
    recording,
    durationMs: recording ? recorderState.durationMillis : 0,
    recordingUri,
    playingRecording: playerStatus.playing,
    error,
    start,
    stop,
    playRecording,
    stopPlayback,
    openSettings: () => Linking.openSettings(),
  };
}
