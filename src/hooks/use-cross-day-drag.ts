import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { View, ViewStyle } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import type { AnimatedStyle } from 'react-native-reanimated';

import { LONG_PRESS_PICKUP_MS } from '@/constants/gestures';
import type { Task } from '@/domain/task';

/**
 * 跨天拖拽改期（月视图的日期格 / 周视图的天卡片共用）。
 *
 * 为什么用 react-native-gesture-handler + react-native-reanimated：
 * - 手势在原生层识别，不再经过 JS 的手势响应链，不会跟子元素的点击、
 *   外层滚动、横向翻页互相抢（之前手写 PanResponder 就是死在这里）；
 * - **长按才拿起**，单击仍然照常触发行内按钮（点开 / 勾完成），不必让用户去掐中
 *   一个 26px 的 ⠿ 手柄；
 * - 跟手的浮块由 shared value 驱动，跑在 UI 线程；命中检测（哪个格子高亮）
 *   才走 JS，并且做了位移节流，手指移动 12px 才回一次 JS。
 *
 * 这一层只负责"拿起 / 移动 / 落下 + 告诉我落在哪个格子"，
 * 落下去之后做什么（改期、改天）交给调用方。
 */

export interface CellRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 浮块宽度（固定，方便按手指居中） */
const GHOST_WIDTH = 172;
/** 手指移动多少 px 才回一次 JS 做命中检测 */
const HIT_TEST_STEP = 12;
/** 长按多久才拾起（与收集箱排序同一个数，见 constants/gestures） */
const PICKUP_MS = LONG_PRESS_PICKUP_MS;
/**
 * 按住期间允许手指移动多少 px（2026-10-10）。
 *
 * 这是"长按拖拽有时不成功"的真正原因：以前用 `Pan().activateAfterLongPress()`，
 * 而 **Pan 没有 `maxDistance`** —— 手指按下之后的自然抖动一旦超过触摸阈值，
 * 长按就前功尽弃，于是表现为"有时能拖、有时拖不起来"。
 * `LongPress` 有 `maxDistance`，把这段抖动容忍掉，拿起来就稳得多。
 *
 * 24pt 是个刻意的折中：够吃掉一次自然的按压抖动，又不至于大到"滑动列表"被
 * 误判成"拿起"（系统触摸阈值通常在 8–10pt）。
 */
const DRIFT_PX = 24;

/** 面板 / 行拿到的就是这个（长按 + 拖 的组合体，不是单个 Pan） */
export type CrossDayDragGesture = ReturnType<typeof Gesture.Simultaneous>;

export interface CrossDayDragOptions {
  /** 松手且落在某个格子上时触发 */
  onDrop: (task: Task, cellKey: string) => void;
  /** 拾起时的触感反馈（默认轻震一下） */
  onPickUp?: (task: Task) => void;
}

export interface CrossDayDrag {
  /** 正在拖的任务（null = 没在拖） */
  draggingTask: Task | null;
  /** 当前悬停的格子 key，用于高亮 */
  dropTargetKey: string | null;
  /** 把某个格子注册进来（返回稳定的 ref 回调，可安全传给 ref） */
  registerCell: (key: string) => (view: View | null) => void;
  /** 给某一行生成拖拽手势；同一个 task 的手势对象保持稳定，避免拖到一半被重建 */
  gestureFor: (task: Task) => CrossDayDragGesture;
  /** 浮块的动画样式，直接给 <Animated.View style={[styles.ghost, ghostStyle]} /> */
  ghostStyle: AnimatedStyle<ViewStyle>;
  /** 浮块正在显示（用于决定要不要挂载浮层节点） */
  ghostVisible: boolean;
}

export function useCrossDayDrag({ onDrop, onPickUp }: CrossDayDragOptions): CrossDayDrag {
  const [draggingTask, setDraggingTask] = useState<Task | null>(null);
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null);
  const [ghostVisible, setGhostVisible] = useState(false);

  const cellsRef = useRef(new Map<string, View>());
  const refCallbacks = useRef(new Map<string, (view: View | null) => void>());
  const rectsRef = useRef(new Map<string, CellRect>());
  const dropRef = useRef<string | null>(null);
  const draggingRef = useRef<Task | null>(null);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;
  /**
   * 手势对象按 id 缓存（拖到一半重建手势会被系统打断），
   * 所以手势里只捕获 id；任务本体放这里，每次渲染刷新，保证落下时用的是最新时间。
   */
  const tasksRef = useRef(new Map<string, Task>());

  /* 手指的屏幕坐标（UI 线程写） */
  const fingerX = useSharedValue(0);
  const fingerY = useSharedValue(0);
  const opacity = useSharedValue(0);
  const lastHitX = useSharedValue(0);
  const lastHitY = useSharedValue(0);
  /** 已经"拿起"了（长按已激活）。拖拽手势等它为 1 才肯生效 —— 见 gestureFor */
  const pickedUp = useSharedValue(0);

  /**
   * 浮块位置用**屏幕坐标**（手指的 absoluteX/Y）而不是"容器内坐标"。
   *
   * 原来的写法要减掉容器在窗口里的偏移（offsetX/offsetY），前提是浮块挂在
   * 那个容器里面。但拖拽源头现在可能落在容器之外 —— 日历页把收集箱抽屉
   * 挪到了 Screen 的 bottomBar（滚动区的兄弟节点），它不在 containerRef 里。
   * 这时"容器内坐标"算出来的位置是错的，浮块会飘到别处。
   *
   * 改成屏幕坐标后，浮块自身用 position:'fixed'（见调用方的 styles.ghost），
   * 与源头在哪个容器无关 —— 手势层不再需要知道调用方的布局长什么样。
   */
  const ghostStyle = useAnimatedStyle<ViewStyle>(() => ({
    opacity: opacity.value,
    transform: [
      { translateX: fingerX.value - GHOST_WIDTH / 2 },
      { translateY: fingerY.value - 22 },
    ],
  }));
  // 页面被卸载时别把浮块留在屏幕上
  useEffect(() => () => { opacity.value = 0; }, [opacity]);

  /** 一次性采集全部格子的窗口坐标 */
  const measureCells = useCallback(() => {
    for (const [key, view] of cellsRef.current) {
      view.measureInWindow((x, y, width, height) => {
        rectsRef.current.set(key, { x, y, width, height });
      });
    }
  }, []);

  const registerCell = useCallback((key: string) => {
    const cached = refCallbacks.current.get(key);
    if (cached) return cached;
    const callback = (view: View | null) => {
      if (view) {
        cellsRef.current.set(key, view);
      } else {
        cellsRef.current.delete(key);
        rectsRef.current.delete(key);
      }
    };
    refCallbacks.current.set(key, callback);
    return callback;
  }, []);

  const hitTest = useCallback((x: number, y: number): string | null => {
    for (const [key, rect] of rectsRef.current) {
      if (
        x >= rect.x &&
        x <= rect.x + rect.width &&
        y >= rect.y &&
        y <= rect.y + rect.height
      ) {
        return key;
      }
    }
    return null;
  }, []);

  const reset = useCallback(() => {
    draggingRef.current = null;
    dropRef.current = null;
    opacity.value = 0;
    setDraggingTask(null);
    setDropTargetKey(null);
    setGhostVisible(false);
  }, [opacity]);

  const begin = useCallback(
    (id: string, x: number, y: number) => {
      const task = tasksRef.current.get(id);
      if (!task) return;
      draggingRef.current = task;
      dropRef.current = null;
      fingerX.value = x;
      fingerY.value = y;
      opacity.value = 1;
      setDraggingTask(task);
      setDropTargetKey(null);
      setGhostVisible(true);
      measureCells();
      if (onPickUp) {
        onPickUp(task);
      } else {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      }
    },
    [fingerX, fingerY, measureCells, onPickUp, opacity],
  );

  const move = useCallback(
    (x: number, y: number) => {
      const key = hitTest(x, y);
      if (key !== dropRef.current) {
        dropRef.current = key;
        setDropTargetKey(key);
      }
    },
    [hitTest],
  );

  const end = useCallback(
    (x: number, y: number) => {
      const task = draggingRef.current;
      const key = hitTest(x, y);
      reset();
      if (task && key) onDropRef.current(task, key);
    },
    [hitTest, reset],
  );

  const cancel = useCallback(() => {
    // 手势被系统打断（来电、切后台）时兜底收起，避免浮块留在屏幕上
    if (!draggingRef.current) return;
    reset();
  }, [reset]);

  const gestureCache = useRef(new Map<string, CrossDayDragGesture>());

  const gestureFor = useCallback(
    (task: Task) => {
      // 每次渲染都刷新一份最新任务；手势里只捕获 id，所以手势对象可以长期复用
      tasksRef.current.set(task.id, task);
      const cached = gestureCache.current.get(task.id);
      if (cached) return cached;

      /*
       * 两个手势分工（2026-10-10 修"长按拖拽有时不成功"）：
       *
       * - **hold（长按）只负责"拿起"**。它有 `maxDistance`，所以按住期间
       *   手指的微小抖动不会再把长按判掉 —— 这正是以前 `Pan.activateAfterLongPress`
       *   偶发失灵的根因。
       * - **pan（拖）只负责"跟着走"**，而且是**手动激活**：没拿起之前它不生效，
       *   所以不会跟页面滚动抢；`pickedUp` 为 1 之后手指一动才转成拖拽。
       *
       * 必须是 `Simultaneous`：长按激活之后，Pan 要能**同时**继续活着跟手。
       *
       * 点击仍由行内那个 `Pressable` 处理（这里一个手势都不碰它）——
       * 所以"点开详情 / 勾完成"的老行为一点没变，也就不会出现
       * "点勾选圈顺手把详情也打开了"这种回归。
       */
      const hold = Gesture.LongPress()
        .minDuration(PICKUP_MS)
        .maxDistance(DRIFT_PX)
        .shouldCancelWhenOutside(false)
        .onStart((event) => {
          'worklet';
          pickedUp.value = 1;
          fingerX.value = event.absoluteX;
          fingerY.value = event.absoluteY;
          lastHitX.value = event.absoluteX;
          lastHitY.value = event.absoluteY;
          runOnJS(begin)(task.id, event.absoluteX, event.absoluteY);
        })
        .onFinalize(() => {
          'worklet';
          pickedUp.value = 0;
        });

      const pan = Gesture.Pan()
        .manualActivation(true)
        // 手指离开这一行也要继续跟手
        .shouldCancelWhenOutside(false)
        .onTouchesMove((_event, manager) => {
          'worklet';
          if (pickedUp.value) manager.activate();
        })
        .onUpdate((event) => {
          'worklet';
          fingerX.value = event.absoluteX;
          fingerY.value = event.absoluteY;
          // 节流：位移够一步才回 JS 算落点，浮块本身不受影响
          if (
            Math.abs(event.absoluteX - lastHitX.value) +
              Math.abs(event.absoluteY - lastHitY.value) >=
            HIT_TEST_STEP
          ) {
            lastHitX.value = event.absoluteX;
            lastHitY.value = event.absoluteY;
            runOnJS(move)(event.absoluteX, event.absoluteY);
          }
        })
        .onEnd((event) => {
          'worklet';
          runOnJS(end)(event.absoluteX, event.absoluteY);
        })
        .onFinalize(() => {
          'worklet';
          runOnJS(cancel)();
        });

      const gesture = Gesture.Simultaneous(hold, pan);
      gestureCache.current.set(task.id, gesture);
      return gesture;
    },
    [begin, cancel, end, fingerX, fingerY, lastHitX, lastHitY, move, pickedUp],
  );

  return useMemo(
    () => ({
      draggingTask,
      dropTargetKey,
      registerCell,
      gestureFor,
      ghostStyle,
      ghostVisible,
    }),
    [draggingTask, dropTargetKey, ghostStyle, ghostVisible, gestureFor, registerCell],
  );
}
