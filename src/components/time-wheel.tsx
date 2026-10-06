import { useCallback, useEffect, useRef } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * 时 / 分双滚轮。
 *
 * 为什么自己写而不是装 @react-native-community/datetimepicker：
 * 1. 那个库是原生控件，**Web 端根本不支持** —— 而这个项目的 web 端是要能用的；
 * 2. 它给的是系统时间选择器（时钟表盘 / 对话框），风格不受控；
 * 3. 我们只需要"时 + 分"两列，滚动吸附是 ScrollView 的原生能力。
 *
 * 分钟步进为 1 分钟（不是常见的 5 分钟）：用户要的是"能设成 19:37"，
 * 5 分钟粒度看着整齐，但会把"会议 14:07 开始"这种事永远挡在门外。
 *
 * ── 滚轮修过的坑（都是真机上撞出来的，别改回去）────────────────────────────
 *
 * 0. **滚动手势在真机上靠不住，所以行点选不是锦上添花，是保底通道。**
 *    四层防备（nestedScrollEnabled、外层滚动锁、自动解锁、结算容差）之后，
 *    真机上仍有"轮子滚不动"的报告。不再赌第五层手势修复：每一行数字
 *    **可以直接点选**（点谁选谁，iOS 滚轮的同款行为）—— 这条路不经过
 *    任何滚动冲突，在所有设备上必然可用。滚动只是加速，不是唯一入口。
 *
 * 1. **竖直 ScrollView 套竖直 ScrollView，内层滚不动。**
 *    滚轮的每个使用点（自定义时间面板、安排面板）都把它放在另一个竖直
 *    ScrollView 里，Android 上外层会把手势整个吃掉，表现就是"轮子根本动不了"，
 *    而下面的 `:00 / :15 / :30 / :45` 按钮还能点 —— 因为那是点不是滚。
 *    两手准备：内层开 `nestedScrollEnabled`（Android 官方就是这个开关），
 *    **并且**手指按住轮子期间通知外层把滚动关掉（`onScrollLockChange`）。
 *    后者是兜底：万一某些机型 nested scrolling 仍被拦截，至少这里一定有效。
 *
 * 2. **挂载时没有滚到当前值。** 以前用 `useRef(index)` 做"自己滚出来的别回滚"的
 *    判据，副作用是首次挂载就命中了 early return —— 于是不管草稿是 09:00 还是 19:37，
 *    轮子初始都停在 `00` 那档。现在用 `firstRun` 单独记"是不是第一次"。
 *
 * 3. **没滚过半格时不吸附。** 拖一点点松手，轮子会停在两个刻度之间。现在结算时
 *    发现离原位不到一格就吸回去；`Math.abs(...) > 1` 这个容差是必须的 ——
 *    否则 scrollTo 触发 onScroll、onScroll 又触发吸附，会变成死循环。
 */

const ITEM_HEIGHT = 36;
/** 可见行数（奇数，中间那行是选中项） */
const VISIBLE_ROWS = 5;
const WHEEL_HEIGHT = ITEM_HEIGHT * VISIBLE_ROWS;
/** 上下留白：让首/末项也能滚到正中间 */
const PAD = (WHEEL_HEIGHT - ITEM_HEIGHT) / 2;

/**
 * 按住轮子后多久自动解锁外层滚动。
 * 为什么要有这个兜底：`onTouchEnd` 只在手指抬起时送到**触摸起点所在的那个 View**，
 * 手指滑出轮子才松开时不一定送得到。没有这道保险，外层滚动会被永久关掉 ——
 * 那是比"轮子滚不动"更糟的 bug。拖动期间每次 onScroll 都会把这个窗口续上。
 */
const SCROLL_LOCK_MS = 700;

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

export interface TimeWheelProps {
  /** 当天第几分钟，0..1439 */
  minutesOfDay: number;
  onChange: (minutesOfDay: number) => void;
  /**
   * 手指按住滚轮期间调 `true`，松开调 `false`。
   * 拿到这个信号的外层容器应该把**自己的滚动**关掉（见文件头第 1 条）。
   */
  onScrollLockChange?: (locked: boolean) => void;
}

export function TimeWheel({ minutesOfDay, onChange, onScrollLockChange }: TimeWheelProps) {
  const theme = useTheme();
  const hour = Math.floor(minutesOfDay / 60);
  const minute = minutesOfDay % 60;

  const setHour = useCallback(
    (next: number) => onChange(next * 60 + minute),
    [minute, onChange],
  );
  const setMinute = useCallback(
    (next: number) => onChange(hour * 60 + next),
    [hour, onChange],
  );

  /** 按住 / 松开：给外层滚动加锁、解锁（带自动解锁兜底） */
  const unlockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hold = useCallback(
    (ms = SCROLL_LOCK_MS) => {
      if (!onScrollLockChange) return;
      onScrollLockChange(true);
      if (unlockTimer.current) clearTimeout(unlockTimer.current);
      unlockTimer.current = setTimeout(() => {
        unlockTimer.current = null;
        onScrollLockChange(false);
      }, ms);
    },
    [onScrollLockChange],
  );
  const release = useCallback(() => {
    if (unlockTimer.current) {
      clearTimeout(unlockTimer.current);
      unlockTimer.current = null;
    }
    onScrollLockChange?.(false);
  }, [onScrollLockChange]);

  useEffect(
    () => () => {
      if (unlockTimer.current) clearTimeout(unlockTimer.current);
    },
    [],
  );

  return (
    <View
      style={styles.row}
      // 触摸起点落在这个区域里就先锁住外层滚动；onScroll 会不断续期
      onTouchStart={() => hold()}
      onTouchEnd={release}
      onTouchCancel={release}>
      {/* 中选高亮带：两条横线夹住当前值（系统日期轮的同款语言） */}
      <View pointerEvents="none" style={styles.bandWrap}>
        <View style={[styles.bandLine, { backgroundColor: theme.backgroundSelected }]} />
        <View style={[styles.bandLine, { backgroundColor: theme.backgroundSelected }]} />
      </View>

      <Wheel
        values={HOURS}
        index={hour}
        onIndexChange={setHour}
        format={(v) => String(v).padStart(2, '0')}
        accessibilityLabel="小时"
        onActivity={hold}
      />
      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.colon}>
        :
      </ThemedText>
      <Wheel
        values={MINUTES}
        index={minute}
        onIndexChange={setMinute}
        format={(v) => String(v).padStart(2, '0')}
        accessibilityLabel="分钟"
        onActivity={hold}
      />
    </View>
  );
}

interface WheelProps {
  values: number[];
  index: number;
  onIndexChange: (value: number) => void;
  format: (value: number) => string;
  accessibilityLabel: string;
  /** 轮子在滚（含动量）—— 用来把外层滚动的锁续期 */
  onActivity: () => void;
}

function Wheel({
  values,
  index,
  onIndexChange,
  format,
  accessibilityLabel,
  onActivity,
}: WheelProps) {
  const theme = useTheme();
  const ref = useRef<ScrollView>(null);
  /** 我们自己滚出来的下标 —— 用来区分"外部改了值"和"用户滚轮子" */
  const reported = useRef(index);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 首次挂载要定位到当前值，但不能带动画（别让用户看见它从 00 滚过去） */
  const firstRun = useRef(true);

  const scrollToIndex = useCallback((value: number, animated: boolean) => {
    ref.current?.scrollTo({ y: value * ITEM_HEIGHT, animated });
  }, []);

  /**
   * 定位：挂载时到当前值；外部改值（点快捷分、切预设）时跟过去。
   * 用户自己滚出来的不重复滚，否则会和惯性打架。
   */
  useEffect(() => {
    const isFirst = firstRun.current;
    firstRun.current = false;
    if (!isFirst && reported.current === index) return;

    reported.current = index;
    scrollToIndex(index, !isFirst);

    if (isFirst) {
      // Android 上挂载当帧布局可能还没完成，这时 scrollTo 会被丢掉 → 下一帧补一次
      const timer = setTimeout(() => scrollToIndex(index, false), 32);
      return () => clearTimeout(timer);
    }
  }, [index, scrollToIndex]);

  useEffect(
    () => () => {
      if (settle.current) clearTimeout(settle.current);
    },
    [],
  );

  /**
   * 结算：把"滚到哪儿了"换算成下标。
   *
   * 只挂一个入口（滚动停止 120ms 后结算）：**不挂 `onScrollEndDrag`** ——
   * 那一刻动量还没跑完，拿着半路的位置去对齐会把轮子停在用户没想选的地方
   * （横向的专注选择器踩过同一个坑）。Web 端没有 momentum 事件，
   * 这个 120ms 防抖正好把它一起覆盖了。
   */
  const settleAt = useCallback(
    (offsetY: number) => {
      const raw = Math.round(offsetY / ITEM_HEIGHT);
      const next = values[Math.max(0, Math.min(values.length - 1, raw))];
      if (next === undefined) return;

      if (next === index) {
        // 没滚过半格：吸回原位。容差 1px 是为了不把自己滚出来的 onScroll 再触发一次
        if (Math.abs(offsetY - index * ITEM_HEIGHT) > 1) scrollToIndex(index, true);
        return;
      }
      reported.current = next;
      onIndexChange(next);
      // 兜一下 Web（那边的吸附不总生效）；原生端本来就已经吸附到位，等于空转
      scrollToIndex(next, true);
    },
    [index, onIndexChange, scrollToIndex, values],
  );

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      onActivity();
      const offsetY = event.nativeEvent.contentOffset.y;
      if (settle.current) clearTimeout(settle.current);
      settle.current = setTimeout(() => settleAt(offsetY), 120);
    },
    [onActivity, settleAt],
  );

  return (
    <ScrollView
      ref={ref}
      accessibilityLabel={accessibilityLabel}
      showsVerticalScrollIndicator={false}
      // Android：允许在另一个 ScrollView 里自己滚（否则外层会把手势全吃掉）
      nestedScrollEnabled
      snapToInterval={ITEM_HEIGHT}
      decelerationRate="fast"
      scrollEventThrottle={16}
      contentContainerStyle={styles.wheelContent}
      onScroll={handleScroll}
      style={styles.wheel}>
      {values.map((value) => {
        const active = value === index;
        return (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityLabel={format(value)}
            // 点谁选谁：滚动手势的保底通道（见文件头第 0 条）。
            // 只在值确实变了时走 onChange，避免点中选行触发多余的父级重渲染。
            onPress={() => {
              if (value === index) return;
              reported.current = value;
              onIndexChange(value);
              scrollToIndex(value, true);
            }}
            style={styles.item}>
            <ThemedText
              type={active ? 'smallBold' : 'small'}
              themeColor={active ? 'text' : 'textSecondary'}
              style={[styles.itemText, !active && styles.itemIdle]}>
              {format(value)}
            </ThemedText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  bandWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bandLine: { width: '72%', height: StyleSheet.hairlineWidth },
  wheel: { height: WHEEL_HEIGHT, flexGrow: 0, width: 76 },
  wheelContent: { paddingVertical: PAD },
  item: { height: ITEM_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  itemText: { fontSize: 20, lineHeight: 26 },
  itemIdle: { fontSize: 16, opacity: 0.55 },
  colon: { fontSize: 20, lineHeight: 26, paddingBottom: Spacing.one },
});
