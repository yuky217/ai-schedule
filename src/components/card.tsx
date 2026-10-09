import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSettings } from '@/state/settings-store';

/**
 * 分组卡片：把一组相关内容圈在一起，降低页面的视觉噪音。
 *
 * **简约模式在这里落地**（hint 那一行）：hint 是"替这块内容解释自己"的那句小字
 * （「长按任一行，拖到上面的日期格即可改期」），全站有几十处，
 * 由卡片统一收口，不让每个页面自己判断一次。
 */
export interface CardProps {
  title?: string;
  hint?: string;
  right?: ReactNode;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /**
   * 去掉背景框：这内容**不属于"被圈起来的一组"**，它就是页面本身。
   * 首页的专注区用它 —— 它要的是"这里是页面的重心"，不是"这儿又有一张卡"。
   * （框一多，页面上排着的就变成一串同权重的方块，重心反而没了。）
   */
  bare?: boolean;
}

export function Card({ title, hint, right, children, style, bare }: CardProps) {
  const theme = useTheme();
  const simpleMode = useSettings((state) => state.simpleMode);
  const showHint = Boolean(hint) && !simpleMode;
  return (
    <View
      style={[
        styles.card,
        bare ? styles.bare : { backgroundColor: theme.backgroundElement },
        style,
      ]}>
      {title || right ? (
        <View style={styles.header}>
          <View style={styles.headerText}>
            {title ? <ThemedText type="smallBold">{title}</ThemedText> : null}
            {showHint ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
                {hint}
              </ThemedText>
            ) : null}
          </View>
          {right}
        </View>
      ) : null}
      <View style={styles.body}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    gap: Spacing.three,
  },
  bare: { paddingHorizontal: 0, paddingVertical: 0, borderRadius: 0 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  headerText: { flex: 1, gap: Spacing.half },
  hint: { fontSize: 12, lineHeight: 16 },
  body: { gap: Spacing.two },
});
