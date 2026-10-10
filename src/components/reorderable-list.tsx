import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { LONG_PRESS_PICKUP_MS } from '@/constants/gestures';
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
 *
 * **长按有三种去向**：
 * - 长按后**动**了 → 排序（最初只有这一种）；
 * - 长按后**原地松手** → 走 `onLongPressIdle`（收集箱用它弹"今天/明天/周末…"菜单，
 *   2026-10-07 加）。判据是位移量：手指按住时的自然抖动在几像素内，所以阈值取 8px；
 * - 长按后**拖进外部投递区** → 走 `onDropOutside`（收集箱用它把任务扔到底部的
 *   日期条上，2026-10-08 加）。
 *
 * 第三种去向与排序共用一个手势，靠**落点**分工：手指进了投递区就不再算插入位置、
 * 插入线收起、跟手浮层淡下去，松手交给调用方；没进就还是老老实实排序。
 * 不传 `dropZone` 的列表保持原样。
 *
 * `reorderable: false` 的列表（收集箱里按时间排的那几档）**三种去向都还在**，
 * 只是"排序"那一路被关掉：松手不回写顺序、也不画插入线 —— 因为那些档的
 * 先后是算出来的，拖了会弹回原处，比不能拖更像坏了。
 */
export interface ReorderableListProps<T> {
  items: T[];
  /** 取稳定 id，重排后回传的就是这个顺序 */
  keyOf: (item: T) => string;
  /** 浮层上显示什么（一般就是这行的标题） */
  labelOf: (item: T) => string;
  renderItem: (item: T, index: number, dragging: boolean) => ReactNode;
  /**
   * 排序后回传新顺序。**`reorderable: false` 的列表不会调用它**，
   * 那种情况下可以不传。
   */
  onReorder?: (ids: string[]) => void;
  /**
   * 这一档**能不能拖动排序**（默认 `true`）。
   *
   * `false` 时长按照样抓得起来、照样跟手、照样能拖进外部投递区、
   * 原地松手照样走 `onLongPressIdle` —— **只是松手不改顺序**，也不画插入线。
   *
   * 为什么要有这个开关：收集箱改成「已过期 / 今天 / 往后」这类**按时间排**
   * 的档之后，档内顺序是算出来的、不是用户排的。此时还给排序，用户拖完松手
   * 位置会弹回原处 —— 那比干脆不能拖更糟（看起来像坏了）。
   * 所以那些档只留"拖出去定时间"这一路，把排序关掉。
   */
  reorderable?: boolean;
  /**
   * 长按后**原地松手**（没拖动）时回调 —— 用来弹一层菜单。
   * 传了它，长按就有了两种去向；不传则只有排序。
   */
  onLongPressIdle?: (item: T) => void;
  onDraggingChange?: (dragging: boolean) => void;
  /**
   * 外部投递区（**窗口坐标**的 y 范围）：手指拖进来就不再是排序，而是
   * "把这一条交出去"。
   *
   * 进没进落区在 worklet 里直接比数字、不回 JS —— 手指每动一下都问一次 JS，
   * "进没进"就会慢半拍，表现出来就是格子高亮追不上手指。所以范围走 shared
   * value 而不是闭包捕获：闭包捕获会逼着手势对象在范围变化时重建，
   * 而**拖到一半重建手势会被系统直接打断**。
   */
  dropZone?: DropZoneRect | null;
  /** 松手时手指在投递区内 → 交出这一条与手指位置（由调用方算落在哪一格） */
  onDropOutside?: (item: T, point: DropPoint) => void;
  /** 手指在投递区内的位置变化（null = 离开了），用来让对应的那一格亮起来 */
  onZoneHover?: (point: DropPoint | null) => void;
  /** 行间距（用 marginBottom 实现，落点计算仍然准 —— onLayout 量的是含间距的位置） */
  gap?: number;
  /** 关掉拖拽（比如列表为空时） */
  enabled?: boolean;
}

/** 投递区在窗口里的纵向范围 */
export interface DropZoneRect {
  top: number;
  bottom: number;
}

/** 手指在窗口里的位置 */
export interface DropPoint {
  x: number;
  y: number;
}

interface RowBox {
  y: number;
  h: number;
}

/**
 * 长按后位移小于它，就算"原地松手"。
 * 手指按住时的自然抖动通常只有一两像素，8px 既容得下抖动、
 * 又不至于把"想挪一格"的小拖拽误判成原地（一格至少有几十像素）。
 */
const IDLE_THRESHOLD = 8;

/** 手指在投递区内每移动这么多像素，回一次 JS 更新高亮 */
const ZONE_HOVER_STEP = 10;

/**
 * 拖到投递区里时，跟手浮层淡下去。
 * 不淡的话它是一整条横幅、正好盖在日期格上 —— 用户看不见自己要扔的那一格，
 * 只能凭感觉松手。
 */
const ZONE_GHOST_OPACITY = 0.3;

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
  reorderable = true,
  onLongPressIdle,
  onDraggingChange,
  dropZone,
  onDropOutside,
  onZoneHover,
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
  /** 能不能拖动排序。放进 ref 是为了不让手势对象依赖它而重建 */
  const reorderableRef = useRef(reorderable);
  reorderableRef.current = reorderable;
  const onLongPressIdleRef = useRef(onLongPressIdle);
  onLongPressIdleRef.current = onLongPressIdle;
  const onDraggingChangeRef = useRef(onDraggingChange);
  onDraggingChangeRef.current = onDraggingChange;
  const onDropOutsideRef = useRef(onDropOutside);
  onDropOutsideRef.current = onDropOutside;
  const onZoneHoverRef = useRef(onZoneHover);
  onZoneHoverRef.current = onZoneHover;
  /** JS 侧的"此刻在不在落区里"，用来决定插入线还画不画、悬停回调要不要送 */
  const inZoneRef = useRef(false);

  const dragY = useSharedValue(0);
  const ghostOpacity = useSharedValue(0);
  /** 节流：手指每移动这么多像素才算一次落点 */
  const lastMove = useSharedValue(0);

  /* ---- 投递区（UI 线程读，不回 JS 判定） ---- */
  const zoneTop = useSharedValue(-1);
  const zoneBottom = useSharedValue(-1);
  const inZone = useSharedValue(0);
  const zoneGhost = useSharedValue(1);
  const lastZoneY = useSharedValue(0);

  // 范围变化只改 shared value，不动手势对象 —— 拖到一半重建会被系统打断
  useEffect(() => {
    zoneTop.value = dropZone?.top ?? -1;
    zoneBottom.value = dropZone?.bottom ?? -1;
  }, [dropZone?.bottom, dropZone?.top, zoneBottom, zoneTop]);

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
      // 不能排序的档不画插入线：落点从头到尾就是它自己，画出来只是骗人
      setTargetIndex(reorderableRef.current ? index : null);
      zoneGhost.value = 1;
      onDraggingChangeRef.current?.(true);
    },
    [zoneGhost],
  );

  const move = useCallback((index: number, dy: number) => {
    if (!reorderableRef.current) return;
    const rects = rowsRef.current;
    const row = rects[index];
    if (!row) return;
    setTargetIndex(indexAtY(rects, row.y + dy + row.h / 2));
  }, []);

  /** 进/出落区：进了就收起插入线；出去时把格子高亮一起收掉 */
  const setZone = useCallback((next: boolean) => {
    inZoneRef.current = next;
    if (next) setTargetIndex(null);
    else onZoneHoverRef.current?.(null);
  }, []);

  /** 落区内的位置变化：只负责转给父层，落在哪一格由父层算（它才知道格子的坐标） */
  const hoverZone = useCallback((point: DropPoint) => {
    if (!inZoneRef.current) return;
    onZoneHoverRef.current?.(point);
  }, []);

  const finish = useCallback(() => {
    setActiveIndex(null);
    setTargetIndex(null);
    inZoneRef.current = false;
    onZoneHoverRef.current?.(null);
    onDraggingChangeRef.current?.(false);
  }, []);

  const commit = useCallback(
    (index: number, dy: number) => {
      const rects = rowsRef.current;
      const row = rects[index];
      const ids = itemsRef.current.map(keyOfRef.current);
      finish();
      // 这一档的先后是**算出来的**（按时间），不让拖拽改写它 —— 见 props.reorderable。
      // 拖起来照样有浮层跟手，只是松手不改顺序，也不留插入线。
      if (!reorderableRef.current) return;
      if (!row || ids.length < 2) return;

      const target = indexAtY(rects, row.y + dy + row.h / 2);
      if (target === index) return;
      onReorderRef.current?.(moveItem(ids, index, target));
    },
    [finish],
  );

  /**
   * 长按后原地松手：先把拖拽视觉复位，再把这一行交出去。
   * 没传 onLongPressIdle 的列表就什么都不发生（保持"长按只有排序"的老行为）。
   */
  const idle = useCallback(
    (index: number) => {
      const item = itemsRef.current[index];
      finish();
      if (item !== undefined) onLongPressIdleRef.current?.(item);
    },
    [finish],
  );

  /** 扔进投递区：复位拖拽视觉，把这一条连同手指位置交出去 */
  const dropOutside = useCallback(
    (index: number, point: DropPoint) => {
      const item = itemsRef.current[index];
      finish();
      if (item !== undefined) onDropOutsideRef.current?.(item, point);
    },
    [finish],
  );

  const gestureFor = useCallback(
    (index: number) =>
      Gesture.Pan()
        // 与月视图一致：长按先"拾起"，避免和单击、滚动抢。
        // 同一个常量（constants/gestures），两边手感不会各走各的
        .activateAfterLongPress(LONG_PRESS_PICKUP_MS)
        .shouldCancelWhenOutside(false)
        .onStart(() => {
          'worklet';
          dragY.value = 0;
          lastMove.value = 0;
          lastZoneY.value = 0;
          ghostOpacity.value = 1;
          zoneGhost.value = 1;
          inZone.value = 0;
          runOnJS(begin)(index);
        })
        .onUpdate((event) => {
          'worklet';
          dragY.value = event.translationY;

          const nowInZone =
            zoneBottom.value > 0 &&
            event.absoluteY >= zoneTop.value &&
            event.absoluteY <= zoneBottom.value;
          if (nowInZone !== (inZone.value === 1)) {
            inZone.value = nowInZone ? 1 : 0;
            zoneGhost.value = nowInZone ? ZONE_GHOST_OPACITY : 1;
            runOnJS(setZone)(nowInZone);
          }

          if (nowInZone) {
            // 已进落区：不再算排序落点，只把手指位置转出去点亮对应的格子
            if (Math.abs(event.absoluteY - lastZoneY.value) >= ZONE_HOVER_STEP) {
              lastZoneY.value = event.absoluteY;
              runOnJS(hoverZone)({ x: event.absoluteX, y: event.absoluteY });
            }
            return;
          }

          if (Math.abs(event.translationY - lastMove.value) > 10) {
            lastMove.value = event.translationY;
            runOnJS(move)(index, event.translationY);
          }
        })
        .onEnd((event) => {
          'worklet';
          const nowInZone =
            zoneBottom.value > 0 &&
            event.absoluteY >= zoneTop.value &&
            event.absoluteY <= zoneBottom.value;
          const wanted = nowInZone;
          inZone.value = 0;
          zoneGhost.value = 1;

          if (wanted) {
            runOnJS(dropOutside)(index, { x: event.absoluteX, y: event.absoluteY });
            return;
          }
          // 长按之后没怎么动就松手 = 想弹菜单，不是想排序
          if (Math.abs(event.translationY) < IDLE_THRESHOLD) {
            runOnJS(idle)(index);
            return;
          }
          runOnJS(commit)(index, event.translationY);
        })
        .onFinalize(() => {
          'worklet';
          ghostOpacity.value = 0;
          inZone.value = 0;
          zoneGhost.value = 1;
        }),
    [
      begin,
      commit,
      dragY,
      dropOutside,
      ghostOpacity,
      hoverZone,
      idle,
      inZone,
      lastMove,
      lastZoneY,
      move,
      setZone,
      zoneBottom,
      zoneGhost,
      zoneTop,
    ],
  );

  const ghostStyle = useAnimatedStyle(() => ({
    opacity: ghostOpacity.value * zoneGhost.value,
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

      {/* 插入位指示线（拖进落区后 targetIndex 被清空，这条自然消失） */}
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
