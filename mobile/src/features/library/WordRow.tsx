import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { memo, useEffect, useRef } from "react";
import { Pressable, Text, View, type AccessibilityActionEvent } from "react-native";
import Swipeable, { type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";

import type { WordOut } from "@/api/types";
import { IconButton } from "@/components/IconButton";
import { playWord } from "@/services/audio";
import { useTheme } from "@/theme/useTheme";

import { LEVEL_LABELS, LEVEL_TEXT_CLASS } from "./labels";

type WordRowProps = {
  word: WordOut;
  onDelete: (word: WordOut) => void;
};

function editWord(word: WordOut): void {
  router.push({ pathname: "/word/edit", params: { wordId: word.id, listId: word.list_id } });
}

// VoiceOver không vuốt được: Nghe/Sửa/Xoá là thao tác (vuốt lên/xuống để chọn) của cả hàng.
const A11Y_ACTIONS = [
  { name: "activate" },
  { name: "play", label: "Nghe cách đọc" },
  { name: "edit", label: "Sửa" },
  { name: "delete", label: "Xoá" },
];

function SwipeActions({
  word,
  methods,
  onDelete,
}: {
  word: WordOut;
  methods: SwipeableMethods;
  onDelete: (word: WordOut) => void;
}) {
  const { colors } = useTheme();
  return (
    <View className="flex-row">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Sửa ${word.term}`}
        onPress={() => {
          methods.close();
          editWord(word);
        }}
        className="w-20 items-center justify-center bg-primary"
      >
        <Ionicons name="create-outline" size={22} color={colors.onFill} />
        <Text className="text-caption text-onFill">Sửa</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Xoá ${word.term}`}
        onPress={() => {
          methods.close();
          onDelete(word);
        }}
        className="w-20 items-center justify-center bg-danger"
      >
        <Ionicons name="trash-outline" size={22} color={colors.onFill} />
        <Text className="text-caption text-onFill">Xoá</Text>
      </Pressable>
    </View>
  );
}

/** Dòng từ trong Chi tiết list; vuốt sang trái để Sửa/Xoá. */
function WordRowView({ word, onDelete }: WordRowProps) {
  const { colors } = useTheme();
  const swipeRef = useRef<SwipeableMethods>(null);
  // FlashList tái sử dụng ô khi cuộn: đóng hàng đang vuốt mở để từ khác không hiện sẵn Sửa/Xoá.
  useEffect(() => {
    swipeRef.current?.close();
  }, [word.id]);

  const open = () => router.push({ pathname: "/word/[id]", params: { id: word.id } });
  const onAction = (event: AccessibilityActionEvent) => {
    switch (event.nativeEvent.actionName) {
      case "activate":
        return open();
      case "play":
        return playWord(word.term, word.audio_url);
      case "edit":
        return editWord(word);
      case "delete":
        return onDelete(word);
    }
  };
  const level = LEVEL_LABELS[word.progress.level];

  return (
    <Swipeable
      ref={swipeRef}
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      renderRightActions={(_progress, _translation, methods) => (
        <SwipeActions word={word} methods={methods} onDelete={onDelete} />
      )}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${word.term}, ${word.meaning_vi}, ${level}${word.is_starred ? ", gắn sao" : ""}`}
        accessibilityHint="Mở chi tiết từ. Có thao tác Nghe, Sửa, Xoá."
        accessibilityActions={A11Y_ACTIONS}
        onAccessibilityAction={onAction}
        onPress={open}
        className="min-h-[64px] flex-row items-center gap-2 border-b border-textMuted/10 bg-surface py-3 pl-4 pr-1 active:opacity-80"
      >
        <View className="flex-1 gap-0.5">
          <Text className="text-body font-semibold text-text" numberOfLines={1}>
            {word.term}
          </Text>
          {/* IPA dòng riêng: cụm từ dài thì IPA không bị cắt hay đè nhãn bên phải. */}
          {word.ipa ? (
            <Text className="text-caption text-textMuted" numberOfLines={1}>
              {word.ipa}
            </Text>
          ) : null}
          <Text className="text-caption text-text" numberOfLines={1}>
            {word.meaning_vi}
          </Text>
        </View>
        <View className="items-end gap-1">
          <Text className={`text-caption font-semibold ${LEVEL_TEXT_CLASS[word.progress.level]}`}>
            {level}
          </Text>
          {word.is_starred ? <Ionicons name="star" size={14} color={colors.warning} /> : null}
        </View>
        {/* Nút riêng: bấm loa chỉ phát âm, không mở Chi tiết từ. */}
        <IconButton
          icon="volume-high-outline"
          size={22}
          accessibilityLabel={`Nghe cách đọc ${word.term}`}
          onPress={() => playWord(word.term, word.audio_url)}
        />
      </Pressable>
    </Swipeable>
  );
}

export const WordRow = memo(WordRowView);
