import { useCallback, useEffect, useRef } from 'react';
import {
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
 * 3. 我们只需要"时 + 分"两列，滚动吸附是 ScrollView 的原生能力，100 行足够。
 *
 * 分钟步进为 1 分钟（不是常见的 5 分钟）：用户要的是"能设成 19:37"，
 * 5 分钟粒度看着整齐，但会把"会议 14:07 开始"这种事永远挡在门外。
 */

const ITEM_HEIGHT = 36;
/** 可见行数（奇数，中间那行是选中项） */
const VISIBLE_ROWS = 5;
const WHEEL_HEIGHT = ITEM_HEIGHT * VISIBLE_ROWS;
/** 上下留白：让首/末项也能滚到正中间 */
const PAD = (WHEEL_HEIGHT - ITEM_HEIGHT) / 2;

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

export interface TimeWheelProps {
  /** 当天第几分钟，0..1439 */
  minutesOfDay: number;
  onChange: (minutesOfDay: number) => void;
}

export function TimeWheel({ minutesOfDay, onChange }: TimeWheelProps) {
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

  return (
    <View style={styles.row}>
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
}

function Wheel({ values, index, onIndexChange, format, accessibilityLabel }: WheelProps) {
  const theme = useTheme();
  const ref = useRef<ScrollView>(null);
  /** 我们自己滚出来的下标 —— 用来区分"外部改了值"和"用户滚轮子" */
  const reported = useRef(index);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 外部改值（点快捷分、切预设）时把轮子滚过去；自己滚出来的不再滚，否则会和惯性打架
  useEffect(() => {
    if (reported.current === index) return;
    reported.current = index;
    ref.current?.scrollTo({ y: index * ITEM_HEIGHT, animated: true });
  }, [index]);

  useEffect(
    () => () => {
      if (settle.current) clearTimeout(settle.current);
    },
    [],
  );

  const report = useCallback(
    (offsetY: number) => {
      const raw = Math.round(offsetY / ITEM_HEIGHT);
      const next = values[Math.max(0, Math.min(values.length - 1, raw))];
      if (next === undefined || next === index) return;
      reported.current = next;
      onIndexChange(next);
    },
    [index, onIndexChange, values],
  );

  /**
   * Web 端没有 momentum 事件，用"滚动停止 120ms 后结算"兜底；
   * 原生端 onMomentumScrollEnd 会先到，两者都会走到 report，重复调用是幂等的。
   */
  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offsetY = event.nativeEvent.contentOffset.y;
      if (settle.current) clearTimeout(settle.current);
      settle.current = setTimeout(() => report(offsetY), 120);
    },
    [report],
  );

  return (
    <ScrollView
      ref={ref}
      accessibilityLabel={accessibilityLabel}
      showsVerticalScrollIndicator={false}
      snapToInterval={ITEM_HEIGHT}
      decelerationRate="fast"
      scrollEventThrottle={16}
      contentContainerStyle={styles.wheelContent}
      onScroll={handleScroll}
      onMomentumScrollEnd={(e) => report(e.nativeEvent.contentOffset.y)}
      onScrollEndDrag={(e) => report(e.nativeEvent.contentOffset.y)}
      style={styles.wheel}>
      {values.map((value) => {
        const active = value === index;
        return (
          <View key={value} style={styles.item}>
            <ThemedText
              type={active ? 'smallBold' : 'small'}
              themeColor={active ? 'text' : 'textSecondary'}
              style={[styles.itemText, !active && styles.itemIdle]}>
              {format(value)}
            </ThemedText>
          </View>
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
