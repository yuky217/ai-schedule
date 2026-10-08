import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { Task } from '@/domain/task';
import { useTheme } from '@/hooks/use-theme';

/**
 * 「现在做哪件」的横向选择器。
 *
 * 借用 iOS 时间轮的思路：**指针固定、内容滑动**。
 * 选中这件事由**位置**决定，不由颜色决定 —— 手指不用瞄准某个小按钮，
 * 停在哪一格，哪一格就是答案。这比"一排按钮里点一个"更省事，也更好边滚边看。
 *
 * 三格承担三种意图，顺序就是从左到右的"新 → 已有 → 更多"：
 *   ① 「新建」—— 没有名字就先干、结束再命名也可以，所以它排第一个。
 *      它被选中后**再点一下**，这一格就地变成输入框（输入框不单独占一行）。
 *   ② 今天的几件事（最多 5 条）—— 绝大多数情况下要做的就是这几件里的一件
 *   ③ 「＋」—— 想做的在收集箱深处时，从这里翻全部
 *
 * 刻意只放 5 条：滑动区一旦长了就变成"在轮盘里做筛选"，
 * 那比直接打开列表还慢。超出的一律交给第三个格子。
 */

export type FocusPickerOption =
  | { kind: 'new'; key: 'new' }
  | { kind: 'task'; key: string; task: Task; reason?: string | null }
  | { kind: 'more'; key: 'more' };

export interface FocusPickerProps {
  options: readonly FocusPickerOption[];
  /** 指针当前停在第几格（受控） */
  index: number;
  onIndexChange: (index: number) => void;
  /** 选中的那一格是不是「新建」 */
  newTitle?: string;
  onNewTitleChange?: (text: string) => void;
}

/**
 * 一格的宽度（也是吸附距离）与高度。
 *
 * 刻意压得比一开始小一圈：首页的主角是"开始"，不是"挑"。
 * 挑这一下只要看得清标题就够了，把省下来的高度让给那颗开始键。
 *
 * 宽度收到 100：格子只承担"认出是哪件"，不承担"读完标题"，
 * 再宽就是在给滑动区里的每一格白白交占地税。
 * 高度不动：任务格是两行标题 + 一行理由，56 已经刚好装满，再压就裁字了。
 */
const ITEM_WIDTH = 100;
const ITEM_HEIGHT = 56;

const clampIndex = (index: number, total: number): number =>
  Math.max(0, Math.min(Math.max(0, total - 1), index));

export function FocusPicker({
  options,
  index,
  onIndexChange,
  newTitle = '',
  onNewTitleChange,
}: FocusPickerProps) {
  const theme = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const offsetRef = useRef(0);
  /** 惯性是否还在跑（决定"松手后等一拍"要不要真的归位） */
  const momentumRef = useRef(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 滑动过程中"此刻停在指针下的那一格"，用来给选中的格子加视觉强调 */
  const [centered, setCentered] = useState(index);
  const [width, setWidth] = useState(0);

  const inset = Math.max(0, (width - ITEM_WIDTH) / 2);
  const safeIndex = clampIndex(index, options.length);

  /** 把某一格滚到指针下面 */
  const scrollToIndex = useMemo(
    () => (next: number, animated: boolean) => {
      const x = clampIndex(next, options.length) * ITEM_WIDTH;
      offsetRef.current = x;
      scrollRef.current?.scrollTo({ x, animated });
    },
    [options.length],
  );

  // 容器量到宽度之后再定位 —— 否则第一格会贴着左边，指针下面什么都没有
  useEffect(() => {
    if (!width) return;
    scrollToIndex(safeIndex, false);
    setCentered(safeIndex);
    // 只在宽度首次就绪时对一次位；之后交给 onScroll
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width]);

  // 外部改了选中项（例如从「全部」里挑了一件）→ 滚过去
  useEffect(() => {
    if (!width) return;
    if (Math.round(offsetRef.current / ITEM_WIDTH) === safeIndex) return;
    scrollToIndex(safeIndex, true);
    setCentered(safeIndex);
  }, [safeIndex, scrollToIndex, width]);

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = event.nativeEvent.contentOffset.x;
    offsetRef.current = x;
    const next = clampIndex(Math.round(x / ITEM_WIDTH), options.length);
    if (next !== centered) setCentered(next);
  };

  /**
   * 稳定下来之后：把最近的那一格对齐到指针下面，并上报选中项。
   *
   * 安卓/iOS 上 snapToInterval 本来就会对齐，这里再补一次是为了 Web ——
   * react-native-web 的吸附不总生效，不补的话松手停在哪就是哪，
   * "指针指向谁"就说不清了。
   */
  const settleAt = (x: number) => {
    const next = clampIndex(Math.round(x / ITEM_WIDTH), options.length);
    offsetRef.current = next * ITEM_WIDTH;
    setCentered(next);
    if (next !== safeIndex) onIndexChange(next);
    else if (x !== next * ITEM_WIDTH) scrollToIndex(next, true);
  };

  /**
   * 什么时候算"稳定"：有惯性就等惯性结束，没有（轻划一下 / Web 上不产生惯性）
   * 就在松手后短暂等一拍。
   *
   * 不能直接在 onScrollEndDrag 上归位 —— 那时动量还没跑完，
   * 拿着半路的位置去对齐，指针会停在一个用户没想选的地方。
   */
  const handleDragEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = event.nativeEvent.contentOffset.x;
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      if (momentumRef.current) return;
      settleAt(x);
    }, 140);
  };

  const handleMomentumBegin = () => {
    momentumRef.current = true;
  };

  const handleMomentumEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    momentumRef.current = false;
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleAt(event.nativeEvent.contentOffset.x);
  };

  useEffect(
    () => () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    },
    [],
  );

  return (
    <View style={styles.wrap}>
      <View style={styles.viewport} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={ITEM_WIDTH}
          decelerationRate="fast"
          disableIntervalMomentum
          scrollEventThrottle={32}
          contentContainerStyle={{ paddingHorizontal: inset }}
          onScroll={handleScroll}
          onScrollEndDrag={handleDragEnd}
          onMomentumScrollBegin={handleMomentumBegin}
          onMomentumScrollEnd={handleMomentumEnd}>
          {options.map((item, position) => (
            <FocusPickerCell
              key={item.key}
              option={item}
              active={position === centered}
              onPress={() => {
                setCentered(position);
                onIndexChange(position);
                scrollToIndex(position, true);
              }}
              newTitle={newTitle}
              onNewTitleChange={onNewTitleChange}
            />
          ))}
        </ScrollView>

        {/* 固定的指针：跨在当前这一格上，不随内容移动 */}
        <View
          pointerEvents="none"
          style={[
            styles.pointer,
            {
              left: inset,
              width: ITEM_WIDTH,
              borderColor: theme.text,
            },
          ]}
        />
      </View>

      <View style={styles.dots}>
        {options.map((item, position) => (
          <View
            key={item.key}
            style={[
              styles.dot,
              {
                backgroundColor: position === centered ? theme.text : theme.backgroundSelected,
              },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

function FocusPickerCell({
  option,
  active,
  onPress,
  newTitle,
  onNewTitleChange,
}: {
  option: FocusPickerOption;
  active: boolean;
  onPress: () => void;
  newTitle: string;
  onNewTitleChange?: (text: string) => void;
}) {
  const theme = useTheme();
  const color = active ? theme.text : theme.textSecondary;
  /**
   * 「新建」这一格的就地输入：只有它**已经**停在指针下、又被**再点一下**时，
   * 才变成输入框 —— 滑过它不算要写，点它才是"就写这件"。
   * 指针滑走即还原成「新建」，输入的草稿还留在 newTitle 里。
   */
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!active) setEditing(false);
  }, [active]);

  const handlePress = () => {
    onPress();
    if (option.kind === 'new' && active && onNewTitleChange) setEditing(true);
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={handlePress}
      style={[styles.cell, { width: ITEM_WIDTH, height: ITEM_HEIGHT }]}>
      <View style={styles.cellInner}>
        {option.kind === 'new' ? (
          editing ? (
            <TextInput
              autoFocus
              value={newTitle}
              onChangeText={onNewTitleChange}
              placeholder="这件事叫什么？"
              placeholderTextColor={theme.textSecondary}
              returnKeyType="done"
              onSubmitEditing={() => setEditing(false)}
              style={[styles.cellInput, { color: theme.text }]}
            />
          ) : (
            <>
              <Ionicons name="create-outline" size={18} color={color} />
              <ThemedText type="small" themeColor={active ? 'text' : 'textSecondary'} numberOfLines={1}>
                新建
              </ThemedText>
            </>
          )
        ) : option.kind === 'more' ? (
          <>
            <Ionicons name="add-circle-outline" size={20} color={color} />
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              从全部里挑
            </ThemedText>
          </>
        ) : (
          <>
            <ThemedText
              type={active ? 'smallBold' : 'small'}
              themeColor={active ? 'text' : 'textSecondary'}
              numberOfLines={2}
              style={styles.cellTitle}>
              {option.task.title}
            </ThemedText>
            {option.reason ? (
              <ThemedText
                type="small"
                themeColor="textSecondary"
                numberOfLines={1}
                style={styles.cellReason}>
                {option.reason}
              </ThemedText>
            ) : null}
          </>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  viewport: { height: ITEM_HEIGHT, justifyContent: 'center' },
  pointer: {
    position: 'absolute',
    top: 0,
    height: ITEM_HEIGHT,
    borderRadius: Spacing.three,
    borderWidth: 1,
  },
  cell: { alignItems: 'center', justifyContent: 'center' },
  cellInner: {
    flex: 1,
    alignSelf: 'stretch',
    marginHorizontal: Spacing.one,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.half,
  },
  cellTitle: { textAlign: 'center' },
  cellReason: { fontSize: 10, lineHeight: 13, textAlign: 'center' },
  cellInput: {
    flex: 1,
    alignSelf: 'stretch',
    textAlign: 'center',
    paddingVertical: Spacing.one,
    fontSize: 14,
  },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.one },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
});
