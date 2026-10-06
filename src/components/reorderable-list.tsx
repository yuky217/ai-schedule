import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { moveItem } from '@/domain/ordering';
import { useTheme } from '@/hooks/use-theme';

/**
 * 长按拖拽手动排序的列表（借鉴滴答清单 / Todoist 的列表拖拽）。
 *
 * 为什么不像月视图那样自己做命中检测：
 * 这里的行高**不固定**（标题可能两行、可能带标签），所以不能靠"行高 × 位移"算落点。
 * 换成"每行 onLayout 记下自己的 y/h，落点用『手指中心落在第几行』求" ——
 * 与行高无关，也就不会因为内容变化而错位。
 *
 * 视觉反馈三件套，缺一都会让人不知道松手会怎样：
 * 1. 被拖的那行淡下去（原位留个坑）；
 * 2. 手指上跟着一块浮层，显示这行的标题；
 * 3. 目标位置画一条插入线。
 * 拖拽期间由父层锁住滚动（onDraggingChange），否则手指竖直移动会被滚动抢走。
 */
export interface ReorderableListProps<T> {
  items: T[];
  /** 取稳定 id，重排后回传的就是这个顺序 */
  keyOf: (item: T) => string;
  /** 浮层上显示什么（一般就是这行的标题） */
  labelOf: (item: T) => string;
  renderItem: (item: T, index: number, dragging: boolean) => ReactNode;
  onReorder: (ids: string[]) => void;
  onDraggingChange?: (dragging: boolean) => void;
  /** 行间距（用 marginBottom 实现，落点计算仍然准 —— onLayout 量的是含间距的位置） */
  gap?: number;
  /** 关掉拖拽（比如列表为空时） */
  enabled?: boolean;
}

interface RowBox {
  y: number;
  h: number;
}

/** 手指中心落在第几行 */
function indexAtY(rows: RowBox[], y: number): number {
  if (!rows.length) return 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]!;
    if (y >= row.y) return i;
  }
  return 0;
}

export function ReorderableList<T>({
  items,
  keyOf,
  labelOf,
  renderItem,
  onReorder,
  onDraggingChange,
  gap = 0,
  enabled = true,
}: ReorderableListProps<T>) {
  const theme = useTheme();

  const [rows, setRows] = useState<RowBox[]>([]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [targetIndex, setTargetIndex] = useState<number | null>(null);

  /** 手势里读不到 JS state，所有"最新值"都放 ref */
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const keyOfRef = useRef(keyOf);
  keyOfRef.current = keyOf;
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;
  const onDraggingChangeRef = useRef(onDraggingChange);
  onDraggingChangeRef.current = onDraggingChange;

  const dragY = useSharedValue(0);
  const ghostOpacity = useSharedValue(0);
  /** 节流：手指每移动这么多像素才算一次落点 */
  const lastMove = useSharedValue(0);

  const recordRow = useCallback((index: number, y: number, h: number) => {
    setRows((current) => {
      const next = [...current];
      next[index] = { y, h };
      return next;
    });
  }, []);

  const begin = useCallback(
    (index: number) => {
      setActiveIndex(index);
      setTargetIndex(index);
      onDraggingChangeRef.current?.(true);
    },
    [],
  );

  const move = useCallback((index: number, dy: number) => {
    const rects = rowsRef.current;
    const row = rects[index];
    if (!row) return;
    setTargetIndex(indexAtY(rects, row.y + dy + row.h / 2));
  }, []);

  const finish = useCallback(() => {
    setActiveIndex(null);
    setTargetIndex(null);
    onDraggingChangeRef.current?.(false);
  }, []);

  const commit = useCallback(
    (index: number, dy: number) => {
      const rects = rowsRef.current;
      const row = rects[index];
      const ids = itemsRef.current.map(keyOfRef.current);
      finish();
      if (!row || ids.length < 2) return;

      const target = indexAtY(rects, row.y + dy + row.h / 2);
      if (target === index) return;
      onReorderRef.current(moveItem(ids, index, target));
    },
    [finish],
  );

  const gestureFor = useCallback(
    (index: number) =>
      Gesture.Pan()
        // 与月视图一致：长按先"拾起"，避免和单击、滚动抢
        .activateAfterLongPress(220)
        .shouldCancelWhenOutside(false)
        .onStart(() => {
          'worklet';
          dragY.value = 0;
          lastMove.value = 0;
          ghostOpacity.value = 1;
          runOnJS(begin)(index);
        })
        .onUpdate((event) => {
          'worklet';
          dragY.value = event.translationY;
          if (Math.abs(event.translationY - lastMove.value) > 10) {
            lastMove.value = event.translationY;
            runOnJS(move)(index, event.translationY);
          }
        })
        .onEnd((event) => {
          'worklet';
          runOnJS(commit)(index, event.translationY);
        })
        .onFinalize(() => {
          'worklet';
          ghostOpacity.value = 0;
        }),
    [begin, commit, dragY, ghostOpacity, lastMove, move],
  );

  const ghostStyle = useAnimatedStyle(() => ({
    opacity: ghostOpacity.value,
    transform: [{ translateY: dragY.value }],
  }));

  const activeRow = activeIndex !== null ? rows[activeIndex] : undefined;
  const targetRow = targetIndex !== null ? rows[targetIndex] : undefined;
  const lineTop =
    targetRow && targetIndex !== null && activeIndex !== null
      ? targetRow.y + (targetIndex > activeIndex ? targetRow.h : 0)
      : null;

  const gestures = useMemo(
    () => items.map((_, index) => gestureFor(index)),
    // 行数变化时重建手势；顺序变化不影响（下标就是行位置）
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items.length, gestureFor],
  );

  return (
    <View>
      {items.map((item, index) => {
        const dragging = index === activeIndex;
        return (
          <View
            key={keyOf(item)}
            onLayout={(e) =>
              recordRow(index, e.nativeEvent.layout.y, e.nativeEvent.layout.height)
            }
            style={[
              dragging ? styles.draggingRow : undefined,
              index < items.length - 1 && gap ? { marginBottom: gap } : undefined,
            ]}>
            {enabled ? (
              <GestureDetector gesture={gestures[index] ?? Gesture.Pan()}>
                <View>{renderItem(item, index, dragging)}</View>
              </GestureDetector>
            ) : (
              renderItem(item, index, false)
            )}
          </View>
        );
      })}

      {/* 插入位指示线 */}
      {lineTop !== null ? (
        <View
          pointerEvents="none"
          style={[styles.insertLine, { top: lineTop, backgroundColor: theme.text }]}
        />
      ) : null}

      {/* 跟手的浮层 */}
      {activeRow && activeIndex !== null ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.ghost,
            {
              top: activeRow.y,
              height: activeRow.h,
              backgroundColor: theme.text,
            },
            ghostStyle,
          ]}>
          <ThemedText
            type="smallBold"
            numberOfLines={1}
            style={[styles.ghostText, { color: theme.background }]}>
            {labelOf(items[activeIndex]!)}
          </ThemedText>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  draggingRow: { opacity: 0.25 },
  insertLine: { position: 'absolute', left: 0, right: 0, height: 2, borderRadius: 1 },
  ghost: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    justifyContent: 'center',
    opacity: 0.92,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
  },
  ghostText: { fontSize: 13 },
});
