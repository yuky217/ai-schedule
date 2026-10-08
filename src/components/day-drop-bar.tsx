import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { DAY_STRIP_COLS, type StripRect } from '@/domain/day-strip';
import { useTheme } from '@/hooks/use-theme';

/**
 * 日期投递条：拖拽时浮在页面底部的一条日期带（今天起两周）。
 *
 * 它只负责"长什么样"和"自己占哪儿" —— 手指落在第几格由页面拿这条的外框、
 * 调 `dayStripIndexAt` 算，不在这里判。两个理由：
 * 1. 判定要用**手指的窗口坐标**，那是手势层的东西，组件拿不到；
 * 2. 纯函数放 domain 里能单测（条外、边界、格数不足一行），留在组件里只能靠手点。
 *
 * 为什么要把外框量给页面：这条是拖拽开始后才浮出来的，而"手指进没进落区"
 * 得在手势层提前知道（判定要跑在 UI 线程）。所以页面先拿到它的窗口坐标，
 * 再当数字交给手势。
 *
 * **不写任何说明文字**：它只在你按住一条任务、往外拖的时候出现，出现即语义 ——
 * 一排日期格 + 手指正悬在某一格上，不需要再写一句"拖到哪天"。（常驻说明书
 * 才需要删，这种"只在某个状态出现"的提示留着不吵。）
 */

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'] as const;

export interface DayDropBarProps {
  days: readonly Date[];
  /** 当前悬停的格（0 起），null = 手指不在条上 */
  hoverIndex: number | null;
  /** 拖拽中才看得见；不拖时整条收起来（透明、不吃事件） */
  visible: boolean;
  /** 量出**格子区**的窗口坐标（不含外边距，与命中检测的外框一致） */
  onMeasure: (rect: StripRect) => void;
}

export function DayDropBar({ days, hoverIndex, visible, onMeasure }: DayDropBarProps) {
  const theme = useTheme();
  const gridRef = useRef<View>(null);
  const fade = useSharedValue(0);

  const measure = () => {
    gridRef.current?.measureInWindow((x, y, width, height) => {
      onMeasure({ x, y, width, height });
    });
  };

  useEffect(() => {
    fade.value = withTiming(visible ? 1 : 0, { duration: 140 });
  }, [fade, visible]);

  /*
    每次 days 换新（页面在拖拽开始时重算，顺带把跨午夜的情况修正）就重量一次：
    条的位置在挂载后一般不变，但屏幕旋转、键盘弹出都会让它挪地方，
    而命中检测全靠这个外框 —— 量错了，手指明明在格子上也会判成"条外"。
  */
  useEffect(measure, [days]); // eslint-disable-line react-hooks/exhaustive-deps

  const style = useAnimatedStyle(() => ({
    opacity: fade.value,
    transform: [{ translateY: (1 - fade.value) * 14 }],
  }));

  const rows: Date[][] = [];
  for (let i = 0; i < days.length; i += DAY_STRIP_COLS) {
    rows.push(days.slice(i, i + DAY_STRIP_COLS));
  }

  const today = new Date().toDateString();

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.bar,
        { backgroundColor: theme.background, borderColor: theme.backgroundSelected },
        style,
      ]}>
      <View ref={gridRef} onLayout={measure} collapsable={false} style={styles.grid}>
        {rows.map((row, rowIndex) => (
          <View key={rowIndex} style={styles.row}>
            {row.map((day, colIndex) => {
              const index = rowIndex * DAY_STRIP_COLS + colIndex;
              const hovered = hoverIndex === index;
              return (
                <View
                  key={day.getTime()}
                  style={[
                    styles.cell,
                    hovered && {
                      backgroundColor: theme.backgroundSelected,
                      borderColor: theme.text,
                      borderWidth: 2,
                    },
                  ]}>
                  <ThemedText
                    type="small"
                    themeColor={hovered ? 'text' : 'textSecondary'}
                    style={styles.weekday}>
                    {day.toDateString() === today ? '今天' : WEEKDAYS[day.getDay()]}
                  </ThemedText>
                  <ThemedText type="smallBold" style={styles.dayText}>
                    {day.getDate()}
                  </ThemedText>
                </View>
              );
            })}
          </View>
        ))}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    width: '100%',
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.two,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
  },
  grid: { gap: Spacing.half },
  row: { flexDirection: 'row' },
  cell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.one,
    borderRadius: Spacing.two,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  weekday: { fontSize: 11, lineHeight: 14 },
  dayText: { fontSize: 15, lineHeight: 19 },
});
