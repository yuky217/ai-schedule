import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import {
  BackHandler,
  Dimensions,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * 从**右侧**拉出的一层抽屉。
 *
 * ## 为什么是"从侧面伸出来"
 *
 * 收集箱这种"池子"不该占一个底部 Tab，但也不该完全没有入口 ——
 * 在日历上安排事情时，最常冒出来的念头恰恰是"我还有哪些没安排的"。
 * 放在屏幕侧面，它平时只露出一条把手（不占版面），
 * 需要时一拉就出来，不用离开当前这张日历。
 *
 * ## 为什么收起时还露着一条把手
 *
 * 手势是看不见的：不露一点，没人知道屏幕右边能拉。
 * 把手是**面板自己的左边缘**（面板整体平移，收起时只露出最左这一条）——
 * 这样只有一个会动的东西，不会出现"把手和面板错位"这种事。
 *
 * ## 为什么不做嵌套滚动
 *
 * 里面的列表直接交给页面自己管（本项目踩过嵌套滚动的坑：
 * 滚动锁、超时兜底、web 上还不一样）。这里只负责"拉出来 / 收回去"。
 */

/** 面板宽度：手机上够放一行标题，宽屏上不超过 360 */
const DRAWER_MAX_WIDTH = 360;
const DRAWER_WIDTH_RATIO = 0.86;
/** 收起时露在屏幕上的那一条（把手）有多宽 */
const HANDLE_WIDTH = 26;
/** 开合动画时长（毫秒） */
const TOGGLE_MS = 220;

const SCREEN_WIDTH = Dimensions.get('window').width;
const DRAWER_WIDTH = Math.min(SCREEN_WIDTH * DRAWER_WIDTH_RATIO, DRAWER_MAX_WIDTH);
/** 面板从"收起"到"全开"要走的距离 */
const TRAVEL = DRAWER_WIDTH - HANDLE_WIDTH;

export function SideDrawer({
  open,
  onOpenChange,
  handleLabel = '收集箱',
  children,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /** 把手上竖着写的那两个字 */
  handleLabel?: string;
  children: ReactNode;
}) {
  const theme = useTheme();
  /** 0 = 收起，1 = 全开。跟手期间直接改它，松手才回 JS 决定落到哪头 */
  const progress = useSharedValue(open ? 1 : 0);
  const startProgress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(open ? 1 : 0, { duration: TOGGLE_MS });
  }, [open, progress]);

  /*
   * 面板的静止位置（progress=0）就已经露着把手了 —— 靠样式里的
   * `right: -(DRAWER_WIDTH - HANDLE_WIDTH)` 把它推出屏幕右边，只留一条在里头。
   * 所以这里平移的只是"再往左拉出多少"：0 → -TRAVEL（整个面板进来）。
   * 别在这里再补一个把手宽度，那会把收起态那条也推出屏幕去。
   */
  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -TRAVEL * progress.value }],
  }));

  const scrimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [0, 0.36]),
  }));

  const handleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.6], [1, 0]),
  }));

  /**
   * 横向拖动把手/面板：跟手，松手按"走过一半 / 甩得够快"决定开合。
   * 只认横向 —— 竖向留给里面的列表滚动。
   */
  const pan = Gesture.Pan()
    .onStart(() => {
      startProgress.value = progress.value;
    })
    .onUpdate((event) => {
      // 往左拖是"打开"：progress 变大
      const delta = -event.translationX / TRAVEL;
      progress.value = Math.min(1, Math.max(0, startProgress.value + delta));
    })
    .onEnd((event) => {
      const velocityOpen = event.velocityX < -400;
      const velocityClose = event.velocityX > 400;
      const next = velocityOpen
        ? true
        : velocityClose
          ? false
          : progress.value > 0.5;
      progress.value = withTiming(next ? 1 : 0, { duration: TOGGLE_MS });
      runOnJS(onOpenChange)(next);
    });

  /**
   * 安卓返回键：抽屉开着时先收抽屉，不要直接退出页面 ——
   * 用户按返回的那一刻，他想退掉的是"刚拉出来的这层"。
   */
  useEffect(() => {
    if (!open || Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onOpenChange(false);
      return true;
    });
    return () => subscription.remove();
  }, [open, onOpenChange]);

  return (
    <View style={styles.layer} pointerEvents="box-none">
      {/* 遮罩：只有开着时才接得住点击（点它 = 收起），收起时完全不挡下面的页面 */}
      <Animated.View
        style={[styles.scrim, scrimStyle]}
        pointerEvents={open ? 'auto' : 'none'}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => onOpenChange(false)} />
      </Animated.View>

      <GestureDetector gesture={pan}>
        <Animated.View
          style={[
            styles.panel,
            { backgroundColor: theme.background, borderColor: theme.backgroundSelected, right: -DRAWER_WIDTH + HANDLE_WIDTH },
            panelStyle,
          ]}>
          {/*
            把手：面板最左那一条。收起时它露在屏幕上，是唯一的入口；
            面板拉开后它就淡出（那时候整个面板都能点了，不需要再靠它）。
            点它也是打开 —— 手势看不见，总得有个能点的东西。
          */}
          <Animated.View style={[styles.handle, handleStyle]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`拉开${handleLabel}`}
              onPress={() => onOpenChange(true)}
              style={styles.handlePress}>
              <Ionicons name="chevron-back" size={13} color={theme.textSecondary} />
              <ThemedText type="small" themeColor="textSecondary" style={styles.handleText}>
                {handleLabel}
              </ThemedText>
            </Pressable>
          </Animated.View>

          {/*
            内容**一直挂着**（不随 open 卸载）：收起是一段 220ms 的动画，
            这时候内容突然消失会被看见（面板还在屏幕上，里面却空了）。
            代价是常驻渲染，收集箱就那么几十条，值。
          */}
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyInner}
            showsVerticalScrollIndicator={false}
            pointerEvents={open ? 'auto' : 'none'}>
            {children}
          </ScrollView>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  scrim: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: '#000' },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: DRAWER_WIDTH,
    borderLeftWidth: StyleSheet.hairlineWidth,
    paddingLeft: HANDLE_WIDTH,
  },
  handle: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: HANDLE_WIDTH,
    justifyContent: 'center',
    alignItems: 'center',
  },
  handlePress: { alignItems: 'center', gap: 2, paddingVertical: Spacing.three },
  // 竖排：两个字叠着写，比横过来转 90° 好认
  handleText: { fontSize: 11, lineHeight: 14, textAlign: 'center' },
  body: { flex: 1, paddingTop: Spacing.four, paddingRight: Spacing.three },
  bodyInner: { gap: Spacing.two, paddingBottom: Spacing.five },
});
