import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { TaskRow } from '@/components/task-row';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { Task } from '@/domain/task';
import type { TodoBucket, TodoGroup } from '@/domain/todo';
import type { CrossDayDragGesture } from '@/hooks/use-cross-day-drag';
import { useTheme } from '@/hooks/use-theme';

/**
 * 收集箱面板：**日历页上唯一的收集箱**（2026-10-10）。
 *
 * 以前同一份数据有两个入口 —— 月视图底部那条（拖拽源头，只在月视图）和右侧
 * 拉出的抽屉（任何视图都能拉，但它是全屏遮罩，盖住月历于是拖不到格子上）。
 * 用户眼里就是"两个收集箱"，而且**各有各的残缺**。现在合成这一个：
 *
 * - **任何视图都能拉出**（继承右侧抽屉的好处）；
 * - **它本身就是拖拽源头**（继承底部那条的好处，且不再限于月视图）；
 * - 收起时只占一条细把手，不再是常驻的一大块。
 *
 * 三档磁吸点：
 * 1. **peek** —— 只有把手「收集箱 · N 件」，不占版面；
 * 2. **expanded** —— 拉出手把，列出「已过期」+「还没排时间」两档，每行可拖到日历格子上；
 * 3. **full** —— 从展开态再往上拉过阈值 → 跳收集箱全页（"拉出后再拉"）。
 *
 * **手势只挂在把手上**：面板里每一行都带着自己的长按拖拽手势，如果外层再挂一个
 * 普通 Pan（按下即激活），它会把手势全抢走 —— 行就再也拖不起来了。
 * 把手是唯一"没有别的交互"的地方，让它专门负责展开/收起，两边互不干扰。
 */

/** 把手高度：收起时整块面板就只剩这么高 */
const HEADER_H = 46;
/** 清单区最高多少；再长也只给这么多，剩下的进全页看 */
const MAX_LIST_H = 320;
/** 弹簧：跟手松开后回弹 */
const SPRING = { stiffness: 260, damping: 26, mass: 0.7 };
/** 展开态再往上拉多少 px 算"要去收集箱全页" */
const FULL_PULL = 90;
/** 向上甩的速度阈值（px/s）：甩得够快也算"要去全页" */
const FULL_FLING = 700;
/** 判定"想展开 / 想收起"的最小位移 */
const SWITCH_STEP = 24;

export interface InboxPanelProps {
  /**
   * 面板只列这两档：「已过期」和「还没排时间」（见 `docs/未完成与检索方案`）。
   *
   * - 「已过期」排在前：它是**最该先安排**的那一档；
   * - 「还没排时间」不能省：删掉日历第五栏「待办」之后，**没时间的事在日历页
   *   唯一的落点就是这个面板**（其余四栏都要求有时间才进得去）。
   *
   * 「今天 / 往后 / 已完成」不进来：那些在月历和收集箱页里都看得见。
   * 面板是掠影、不是第二份全量清单 —— 有界才不会糊掉半个屏幕。
   */
  groups: TodoGroup[];
  /** 拖拽手势（来自 useCrossDayDrag）。不传 = 这一栏只可看、不可拖 */
  gestureFor?: (task: Task) => CrossDayDragGesture;
  onOpenTask?: (task: Task) => void;
  onCompleteTask?: (task: Task) => void;
  /** 拉到最上面一档：进收集箱全页 */
  onOpenFull?: () => void;
  /**
   * 外部正在拖某一行（拖拽已开始）。为真时面板**自动缩回 peek** ——
   * 否则它压在月历上方，手指根本够不到日期格，这一拖就永远落不下去。
   */
  collapseWhen?: boolean;
  /** 面板里最多列几条（跨两档合计，剩下的走全页） */
  limit?: number;
}

export function InboxPanel({
  groups,
  gestureFor,
  onOpenTask,
  onCompleteTask,
  onOpenFull,
  collapseWhen = false,
  limit = 6,
}: InboxPanelProps) {
  const theme = useTheme();

  const [expanded, setExpanded] = useState(false);
  /** 清单区的自然高度（onLayout 量出来），决定 expanded 档要展开到多少 */
  const [listH, setListH] = useState(0);

  const height = useSharedValue(HEADER_H);
  const fullHeight = useSharedValue(HEADER_H);
  const startHeight = useSharedValue(HEADER_H);

  const listHeight = Math.min(listH, MAX_LIST_H);
  /** 展开档的目标高度；没有内容时展开＝没得展开，仍然只显示把手 */
  const expandedHeight = HEADER_H + (listHeight > 0 ? listHeight + Spacing.two : 0);

  // 内容高度变了要同步给 worklet（量出来之前是 0，第一次展开会先按把手高度算）
  useEffect(() => {
    fullHeight.value = expandedHeight;
  }, [expandedHeight, fullHeight]);

  const goTo = useCallback(
    (next: boolean) => {
      setExpanded(next);
      height.value = withSpring(next ? expandedHeight : HEADER_H, SPRING);
    },
    [expandedHeight, height],
  );

  /**
   * 松手时决定落到哪一档。
   *
   * 它要同时读位移、速度、"当前展开到多少"和最新一版的回调，而手势对象是
   * 长期缓存的（拖到一半重建会被系统打断）—— 所以真正的逻辑挂在一个 ref 上，
   * 每次渲染刷新，手势里只调一个**永不变化**的壳子（见 runSettle）。
   */
  const settleRef = useRef<(translationY: number, velocityY: number) => void>(() => undefined);
  settleRef.current = (translationY, velocityY) => {
    const pulledUp = -translationY;
    // 1) 从展开态再往上拉（或往上甩）→ 去收集箱全页
    if (expanded && (pulledUp >= FULL_PULL || velocityY <= -FULL_FLING)) {
      setExpanded(false);
      height.value = withSpring(HEADER_H, SPRING);
      onOpenFull?.();
      return;
    }
    // 2) 方向明确就听方向的；位移太小就听"过没过半"
    let next: boolean;
    if (translationY <= -SWITCH_STEP) next = true;
    else if (translationY >= SWITCH_STEP) next = false;
    else next = height.value > (HEADER_H + fullHeight.value) / 2;
    goTo(next);
  };

  /** 传给 runOnJS 的必须是稳定引用；它只负责转给 ref 里最新的那份逻辑 */
  const runSettle = useCallback((translationY: number, velocityY: number) => {
    settleRef.current(translationY, velocityY);
  }, []);

  /** 拖拽期间自动缩回；拖完再放回来（用户刚才就在用它） */
  const wasExpanded = useRef(false);
  useEffect(() => {
    if (collapseWhen) {
      wasExpanded.current = expanded;
      setExpanded(false);
      height.value = withSpring(HEADER_H, SPRING);
    } else if (wasExpanded.current) {
      setExpanded(true);
      height.value = withSpring(expandedHeight, SPRING);
      wasExpanded.current = false;
    }
    // 只在"是否正在拖"翻转时跑：把 expanded 放进依赖会在每次展开时把它又收回去
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapseWhen]);

  const handleGesture = useMemo(
    () =>
      Gesture.Pan()
        .onStart(() => {
          'worklet';
          startHeight.value = height.value;
        })
        .onUpdate((event) => {
          'worklet';
          // 跟手：把手往上推 = 长高。夹在 [把手, 展开档] 之间，
          // 超出展开档的那一段不跟手 —— 它是"要去全页"的信号，不是面板该变高。
          const next = startHeight.value - event.translationY;
          const max = fullHeight.value;
          height.value = next < HEADER_H ? HEADER_H : next > max ? max : next;
        })
        .onEnd((event) => {
          'worklet';
          runOnJS(runSettle)(event.translationY, event.velocityY);
        }),
    [fullHeight, height, runSettle, startHeight],
  );

  const panelStyle = useAnimatedStyle(() => ({
    height: height.value,
  }));

  /** 两档合起来几件 —— 把手上的那个数字 */
  const total = groups.reduce((sum, group) => sum + group.tasks.length, 0);
  /**
   * 摊成"档标题 + 这一档露出来的行"，**跨档合计不超过 limit 条**。
   * 名额从前往后发：「已过期」先拿（它排在最前，也最该被看见），
   * 剩下的才轮到「还没排时间」。
   */
  const sections = useMemo(() => {
    let left = limit;
    const out: Array<{ bucket: TodoBucket; title: string; tasks: Task[] }> = [];
    for (const group of groups) {
      if (left <= 0) break;
      const tasks = group.tasks.slice(0, left);
      left -= tasks.length;
      if (tasks.length) out.push({ bucket: group.bucket, title: group.title, tasks });
    }
    return out;
  }, [groups, limit]);
  const rest = total - sections.reduce((sum, section) => sum + section.tasks.length, 0);

  return (
    <Animated.View
      style={[
        styles.panel,
        {
          backgroundColor: theme.backgroundElement,
          borderColor: theme.backgroundSelected,
        },
        panelStyle,
      ]}>
      <GestureDetector gesture={handleGesture}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={expanded ? '收起收集箱' : '展开收集箱'}
          onPress={() => goTo(!expanded)}
          style={styles.handle}>
          <View
            style={[styles.handleBar, { backgroundColor: theme.backgroundSelected }]}
          />
          <Ionicons name="file-tray-outline" size={15} color={theme.textSecondary} />
          <ThemedText type="smallBold" style={styles.handleText}>
            收集箱 · {total} 件
          </ThemedText>
          <Ionicons
            name={expanded ? 'chevron-down' : 'chevron-up'}
            size={15}
            color={theme.textSecondary}
          />
        </Pressable>
      </GestureDetector>

      {/*
        内容**始终挂载**（收起时只是被裁掉 + 不吃触摸）：不挂载就量不到高度，
        expanded 档该展开多少就永远是 0。与月历下拉清单同一个做法。
      */}
      <View
        style={styles.body}
        onLayout={(event) => setListH(event.nativeEvent.layout.height)}
        pointerEvents={expanded ? 'auto' : 'none'}>
        {sections.map((section) => (
          <View key={section.bucket} style={styles.section}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.sectionTitle}>
              {section.title}
            </ThemedText>
            {section.tasks.map((task) => {
              const row = (
                <TaskRow
                  task={task}
                  // 面板本身就是"还没安排"的桶，每条再标待规划是冗余
                  showPendingLabel={false}
                  onPress={onOpenTask ? () => onOpenTask(task) : undefined}
                  onComplete={onCompleteTask ? () => onCompleteTask(task) : undefined}
                />
              );
              return gestureFor ? (
                <GestureDetector key={task.id} gesture={gestureFor(task)}>
                  <View>{row}</View>
                </GestureDetector>
              ) : (
                <View key={task.id}>{row}</View>
              );
            })}
          </View>
        ))}

        {rest > 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={onOpenFull}
            style={styles.moreRow}>
            <ThemedText type="small" themeColor="textSecondary">
              还有 {rest} 件 · 去收集箱
            </ThemedText>
          </Pressable>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderTopLeftRadius: Spacing.three,
    borderTopRightRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    // 高度由动画驱动（panelStyle），这里只负责把超出的部分裁掉
    overflow: 'hidden',
  },
  handle: {
    height: HEADER_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  handleBar: {
    position: 'absolute',
    top: 7,
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  handleText: { flex: 1 },
  body: { paddingHorizontal: Spacing.two, paddingBottom: Spacing.two, gap: Spacing.two },
  /** 一档 = 档标题 + 它露出来的那几行 */
  section: { gap: Spacing.one },
  sectionTitle: { paddingHorizontal: Spacing.one },
  moreRow: { alignItems: 'center', paddingVertical: Spacing.two },
});
