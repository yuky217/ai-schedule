import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ChoiceSheet } from '@/components/choice-sheet';
import { DayDropBar } from '@/components/day-drop-bar';
import { EmptyState } from '@/components/empty-state';
import {
  ReorderableList,
  type DropPoint,
  type DropZoneRect,
} from '@/components/reorderable-list';
import { Screen } from '@/components/screen';
import { TaskRow } from '@/components/task-row';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { dayStripDays, dayStripIndexAt, type StripRect } from '@/domain/day-strip';
import {
  buildSemanticTime,
  buildTimeOnDay,
  SEMANTIC_TARGETS,
  type SemanticTarget,
} from '@/domain/schedule-presets';
import type { Task } from '@/domain/task';
import { useTheme } from '@/hooks/use-theme';
import { useAppStore } from '@/state/app-store';

/**
 * 收集箱 = 主文档里的"中档待规划"。
 *
 * 这一页存在的意义是：允许用户先记下来、不立刻决定时间。
 * 点条目进任务详情页 —— 那里第一步就是"定时间"（预设 chips 一次点按），
 * 同时还能写备注、设提醒和重复。收集箱本身不再承载编辑动作。
 *
 * 多出来三个动作：
 * - **长按拖动排序**：收集箱天然是一个"待消化队列"，顺序就是你心里的先后。
 *   拖过之后顺序会写进 sort_order 落库。
 * - **长按原地松手 → 语义词片**（2026-10-07 加）：弹一层「今天 / 明天 / 周末 /
 *   下周 / 稍后」。消化收集箱时的第一念是"今天做还是周末做"，不是"14:00 开始"，
 *   所以给一组按日期说话的词，点一下这条就安排好了，不必进详情页。
 * - **长按拖到底部的日期条 → 定到某一天**（2026-10-08 加）。语义词片只覆盖
 *   "今天到下周"这几个说法，具体到"下下周三"就没词了；拖到日期条上则能指到
 *   今天起两周内的任意一天，同样一步到位、同样不进详情页。
 *
 *   落点分工：**手指进了日期条就不再是排序，没进就还是排序**。两者共用一个
 *   长按手势（见 reorderable-list 的三种去向），所以不需要再多一个入口 ——
 *   "拖出去"和"拖一下顺序"本来就是同一个动作，区别只在松手时手指在哪儿。
 *
 *   为什么不能让日历页自己接这一拖：收集箱和日历是两个 Tab，手机上一次触摸
 *   跨不过去（拖到一半切页，手势会被系统掐断）。所以日历得**浮上来找手指**
 *   —— 这才是"拖到日历上"在手机上真正成立的样子。
 *
 * 再加一块**「已完成」折叠区**：勾掉的东西必须还能找回来。
 * 一条无时间的任务在收集箱里被勾掉之后，收集箱不收它（这里带 status != done）、
 * 日历不收它（没时间）、首页今天不收它（按时间匹配）、习惯页不收它（不是习惯）——
 * 四个列表全都不收，等于"勾一下=弄丢"。这一块就是它的落点，
 * 而且就地能撤销完成（`reopenTask`），不用跑去别的页面。
 *
 * 页首**不再挂操作说明**（2026-10-07 删）：原来有一张卡写着"点一下进详情页定时间、
 * 长按任一行可以拖动排序、勾掉的会收到「已完成」里" —— 三句里两句是通用的
 * （点一下进详情有 chevron 暗示，长按拖动是这类 App 的通用手势），一句是自然发生的
 * （勾完「已完成 N 件」自己就冒出来了）。常驻说明书=用户每次进来都要重读一遍。
 */
export default function InboxScreen() {
  const router = useRouter();
  const theme = useTheme();

  const inbox = useAppStore((state) => state.inbox);
  const recentlyDone = useAppStore((state) => state.recentlyDone);
  const completeTask = useAppStore((state) => state.completeTask);
  const reopenTask = useAppStore((state) => state.reopenTask);
  const reorderTasks = useAppStore((state) => state.reorderTasks);
  const scheduleTask = useAppStore((state) => state.scheduleTask);
  const [reordering, setReordering] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);
  /** 长按原地松手时选中的那一条 —— 非空就弹语义词片 */
  const [arranging, setArranging] = useState<Task | null>(null);

  /** 拖拽中浮在底部的日期条（只在拖拽时看得见） */
  const [barVisible, setBarVisible] = useState(false);
  /** 手指此刻悬在日期条的第几格 */
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  /** 交给手势层的落区（窗口 y 范围）—— 它要跑在 UI 线程里做判定 */
  const [dropZone, setDropZone] = useState<DropZoneRect | null>(null);
  /** 日期条格子区的窗口坐标：手指落在哪一格，全靠它算 */
  const barRect = useRef<StripRect | null>(null);

  // 拖拽开始时重算（依赖 barVisible）：挂着一整天不重启的话，"今天"会停在前一天
  const days = useMemo(() => dayStripDays(), [barVisible]);

  const handleBarMeasure = useCallback((rect: StripRect) => {
    barRect.current = rect;
    setDropZone({ top: rect.y, bottom: rect.y + rect.height });
  }, []);

  const handleZoneHover = useCallback((point: DropPoint | null) => {
    const rect = barRect.current;
    setHoverIndex(point && rect ? dayStripIndexAt(rect, point) : null);
  }, []);

  /**
   * 扔进日期条：落到那一格对应的那天。
   *
   * 走 buildTimeOnDay（与长按菜单同一份口径）：没时间的落到那天 23:59 截止
   * —— 用户说的是"这天做"，不是"这天 9 点开始"。落库后这条就离开收集箱、
   * 出现在日历那一天，**消失本身就是反馈**，不用再弹一句"已安排到周三"。
   */
  const handleDropOutside = useCallback(
    (task: Task, point: DropPoint) => {
      const rect = barRect.current;
      const index = rect ? dayStripIndexAt(rect, point) : null;
      if (index === null) return;
      const day = days[index];
      if (!day) return;
      const time = buildTimeOnDay(task, day);
      if (time) void scheduleTask(task.id, time);
    },
    [days, scheduleTask],
  );

  /**
   * 长按结束后紧接着还会来一次 click，得把它吞掉。
   *
   * 原生手势系统在手势激活后会 cancel 掉触摸，所以手机上没这个问题；
   * 但 **web 上 RNGH 的 Pan 不会阻止随后的 click** —— 实测长按一行会
   * 同时弹出语义词片**并且**跳进详情页（长按在勾选圈上还会顺手勾完）。
   * 用时间戳而不是布尔量：万一某端压根没发这次 click（或发了但我们已忽略），
   * 标志也不会永远挂着把用户后面的正常点击一起吃掉。
   */
  const longPressAt = useRef(0);
  const guarded = (action: (task: Task) => void) => (task: Task) => {
    if (Date.now() - longPressAt.current < 500) return;
    action(task);
  };

  return (
    <Screen
      title="收集箱"
      subtitle="先记下来，不必当场决定什么时候做"
      scrollEnabled={!reordering}
      right={
        <Pressable hitSlop={8} onPress={() => router.push('/capture')}>
          <Ionicons name="add" size={24} color={theme.text} />
        </Pressable>
      }
      floating={
        <DayDropBar
          days={days}
          hoverIndex={hoverIndex}
          visible={barVisible}
          onMeasure={handleBarMeasure}
        />
      }>
      {inbox.length ? (
        <View style={styles.list}>
          <ReorderableList
            items={inbox}
            keyOf={(task) => task.id}
            labelOf={(task) => task.title}
            gap={Spacing.two}
            dropZone={dropZone}
            onDropOutside={handleDropOutside}
            onZoneHover={handleZoneHover}
            onDraggingChange={(dragging) => {
              setReordering(dragging);
              setBarVisible(dragging);
              setHoverIndex(null);
              longPressAt.current = Date.now();
            }}
            onReorder={(ids) => void reorderTasks(ids)}
            onLongPressIdle={setArranging}
            renderItem={(task) => (
              <TaskRow
                task={task}
                onPress={guarded((t) => router.push(`/task/${t.id}`))}
                onComplete={guarded((t) => void completeTask(t.id))}
              />
            )}
          />
        </View>
      ) : (
        <EmptyState
          icon="file-tray-outline"
          title="收集箱是空的"
          hint="想到什么就丢进来，不用想清楚它属于哪里"
        />
      )}

      {/* 已完成：勾掉的东西有个地方待着，也能就地拿回来 */}
      {recentlyDone.length ? (
        <View style={styles.doneBlock}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: doneOpen }}
            onPress={() => setDoneOpen((value) => !value)}
            style={styles.doneHead}>
            <Ionicons name="checkmark-circle-outline" size={16} color={theme.textSecondary} />
            <ThemedText type="small" themeColor="textSecondary" style={styles.doneHeadText}>
              已完成 {recentlyDone.length} 件
            </ThemedText>
            <Ionicons
              name={doneOpen ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={theme.textSecondary}
            />
          </Pressable>

          {doneOpen ? (
            <View style={styles.list}>
              {recentlyDone.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onPress={(t) => router.push(`/task/${t.id}`)}
                  // 圈是勾上的，再点一下 = 拿回来（不是再完成一次）
                  onComplete={(t) => void reopenTask(t.id)}
                />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
      {/* 长按原地松手 → 语义词片：按"哪天"安排，不必先想几点几分。
          选中即落库（走 store 的 scheduleTask，与详情页同一条路），
          这条随即离开收集箱、出现在日历上 —— 消失本身就是反馈。 */}
      <ChoiceSheet
        visible={arranging !== null}
        title={arranging ? `安排「${arranging.title}」` : ''}
        options={SEMANTIC_TARGETS.map((target) => ({ key: target.id, label: target.label }))}
        onClose={() => setArranging(null)}
        onSelect={(key) => {
          const task = arranging;
          setArranging(null);
          if (!task) return;
          const time = buildSemanticTime(task, key as SemanticTarget);
          if (time) void scheduleTask(task.id, time);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  // 行间距由 ReorderableList 的 gap 统一处理（它要用间距算落点）
  list: {},
  doneBlock: { gap: Spacing.two },
  doneHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two },
  doneHeadText: { flex: 1 },
});
