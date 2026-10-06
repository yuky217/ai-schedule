import { StyleSheet, View } from 'react-native';

import type { FocusDay } from '@/domain/review';
import { useTheme } from '@/hooks/use-theme';

/**
 * 专注趋势柱状图。
 *
 * 自己画而不引图表库：需求只是"一排柱子"，为了它拖进一个
 * 几十 KB、还带 Web 端兼容问题的依赖不划算。
 *
 * 两处刻意的设计：
 * - **没专注的日子也留一根 2px 的底桩**，这样眼睛能看到"这是一条连续的时间轴"，
 *   而不是几根孤零零的柱子 —— 中间的空白和"那天你休息了"是两件事。
 * - **每根柱子的宽度靠 flex 均分**，所以 7 天和 30 天都不用改代码，
 *   柱子自动变细，不会溢出也不会被裁掉。
 */
export interface FocusBarsProps {
  days: FocusDay[];
  /** 图表区高度（含柱子与底桩的可用高度）*/
  height?: number;
}

const MIN_BAR = 3;
const EMPTY_BAR = 2;

export function FocusBars({ days, height = 76 }: FocusBarsProps) {
  const theme = useTheme();
  if (!days.length) return null;

  const max = days.reduce((peak, day) => (day.seconds > peak ? day.seconds : peak), 0);
  const scale = max > 0 ? max : 1;
  const usable = Math.max(MIN_BAR, height - 6);

  return (
    <View style={[styles.row, { height }]}>
      {days.map((day) => {
        const active = day.seconds > 0;
        const barHeight = active ? Math.max(MIN_BAR, Math.round((day.seconds / scale) * usable)) : EMPTY_BAR;
        return (
          <View key={day.dayKey} style={styles.column}>
            <View
              accessibilityLabel={`${day.dayKey} 专注 ${Math.round(day.seconds / 60)} 分钟`}
              style={[
                styles.bar,
                {
                  height: barHeight,
                  backgroundColor: active ? theme.text : theme.backgroundSelected,
                  opacity: active ? 1 : 0.6,
                  borderColor: day.isToday ? theme.textSecondary : 'transparent',
                  borderWidth: day.isToday ? 1 : 0,
                },
              ]}
            />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  column: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 2 },
});
