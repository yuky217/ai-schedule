import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef } from 'react';
import { Animated, Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * 记完的轻反馈：大勾一跳 + 归属一行，1.6 秒自动关页，点一下立即关。
 *
 * 为什么不是整张结果卡：记完的那页唯一的职责是"告诉用户成了"，
 * 为这个信号让用户再按一次关闭是纯负担。通行的做法是**成功态动效 + 自动消失**
 * （支付完成页的大勾、Gmail 的 snackbar、iOS 的触觉反馈都是同一个思路：
 * 动作已成功，反馈要自己退场，不能变成一道新工序）。
 */
export function CaptureSuccess({
  label,
  title,
  hint,
  onDone,
}: {
  /** 归属说明，如「已归入收集箱」 */
  label: string;
  /** 记下的正文 */
  title: string;
  /** 可选补充（如「到点会提醒你」） */
  hint?: string;
  /** 动效播完（或用户点了一下）后调用 —— 通常就是关页 */
  onDone: () => void;
}) {
  const theme = useTheme();
  const scale = useRef(new Animated.Value(0.3)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    Animated.parallel([
      Animated.spring(scale, {
        toValue: 1,
        friction: 5,
        tension: 160,
        useNativeDriver: Platform.OS !== 'web',
      }),
      Animated.timing(fade, {
        toValue: 1,
        duration: 180,
        useNativeDriver: Platform.OS !== 'web',
      }),
    ]).start();
    const timer = setTimeout(onDone, 1600);
    return () => clearTimeout(timer);
  }, [onDone, scale, fade]);

  return (
    <Pressable onPress={onDone} style={styles.wrap}>
      <Animated.View
        style={[
          styles.circle,
          { backgroundColor: theme.backgroundSelected, transform: [{ scale }], opacity: fade },
        ]}>
        <Ionicons name="checkmark" size={40} color={theme.text} />
      </Animated.View>
      <Animated.View style={[styles.textWrap, { opacity: fade }]}>
        <ThemedText type="smallBold">{label}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
          {title}
        </ThemedText>
        {hint ? (
          <ThemedText type="small" themeColor="textSecondary">
            {hint}
          </ThemedText>
        ) : null}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    minHeight: 260,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
  },
  circle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: { alignItems: 'center', gap: Spacing.one, paddingHorizontal: Spacing.four },
});
