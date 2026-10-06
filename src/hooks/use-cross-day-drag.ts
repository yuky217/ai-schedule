import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { View, ViewStyle } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import type { AnimatedStyle } from 'react-native-reanimated';

import type { Task } from '@/domain/task';

/**
 * 跨天拖拽改期（月视图的日期格 / 周视图的天卡片共用）。
 *
 * 为什么用 react-native-gesture-handler + react-native-reanimated：
 * - 手势在原生层识别，不再经过 JS 的手势响应链，不会跟子元素的点击、
 *   外层滚动、横向翻页互相抢（之前手写 PanResponder 就是死在这里）；
 * - `activateAfterLongPress` 让"整行长按"就能拿起，不必让用户去掐中
 *   一个 26px 的 ⠿ 手柄；而单击仍然照常触发行内按钮；
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

export interface CrossDayDragOptions {
  /** 浮层所在容器：用于把窗口坐标换算成容器内坐标 */
  containerRef: RefObject<View | null>;
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
  gestureFor: (task: Task) => ReturnType<typeof Gesture.Pan>;
  /** 浮块的动画样式，直接给 <Animated.View style={[styles.ghost, ghostStyle]} /> */
  ghostStyle: AnimatedStyle<ViewStyle>;
  /** 浮块正在显示（用于决定要不要挂载浮层节点） */
  ghostVisible: boolean;
}

export function useCrossDayDrag({
  containerRef,
  onDrop,
  onPickUp,
}: CrossDayDragOptions): CrossDayDrag {
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

  /* 手指的窗口坐标（UI 线程写）+ 容器的窗口偏移（JS 线程写） */
  const fingerX = useSharedValue(0);
  const fingerY = useSharedValue(0);
  const offsetX = useSharedValue(0);
  const offsetY = useSharedValue(0);
  const opacity = useSharedValue(0);
  const lastHitX = useSharedValue(0);
  const lastHitY = useSharedValue(0);

  const ghostStyle = useAnimatedStyle<ViewStyle>(() => ({
    opacity: opacity.value,
    transform: [
      { translateX: fingerX.value - offsetX.value - GHOST_WIDTH / 2 },
      { translateY: fingerY.value - offsetY.value - 22 },
    ],
  }));

  /** 容器在窗口里的位置：挂载时量一次，每次拾起前再量一次（键盘弹出、tab 切换都会变） */
  const measureContainer = useCallback(() => {
    containerRef.current?.measureInWindow((x, y) => {
      offsetX.value = x;
      offsetY.value = y;
    });
  }, [containerRef, offsetX, offsetY]);

  useEffect(() => {
    measureContainer();
  }, [measureContainer]);

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
      measureContainer();
      measureCells();
      if (onPickUp) {
        onPickUp(task);
      } else {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      }
    },
    [fingerX, fingerY, measureCells, measureContainer, onPickUp, opacity],
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

  const gestureCache = useRef(new Map<string, ReturnType<typeof Gesture.Pan>>());

  const gestureFor = useCallback(
    (task: Task) => {
      // 每次渲染都刷新一份最新任务；手势里只捕获 id，所以手势对象可以长期复用
      tasksRef.current.set(task.id, task);
      const cached = gestureCache.current.get(task.id);
      if (cached) return cached;
      const gesture = Gesture.Pan()
        // 长按 200ms 才进入拖拽：单击照常触发行内按钮，不用掐手柄
        .activateAfterLongPress(200)
        // 手指离开这一行也要继续跟手
        .shouldCancelWhenOutside(false)
        .onStart((event) => {
          'worklet';
          fingerX.value = event.absoluteX;
          fingerY.value = event.absoluteY;
          lastHitX.value = event.absoluteX;
          lastHitY.value = event.absoluteY;
          runOnJS(begin)(task.id, event.absoluteX, event.absoluteY);
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
      gestureCache.current.set(task.id, gesture);
      return gesture;
    },
    [begin, cancel, end, fingerX, fingerY, lastHitX, lastHitY, move],
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
