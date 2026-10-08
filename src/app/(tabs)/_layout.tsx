import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router/js-tabs';

import { useTheme } from '@/hooks/use-theme';

/**
 * 底部五个 Tab —— 就是主文档"本体层"的几个入口。
 *
 * 注意这里没有"AI"入口：AI 是能力和入口，不是界面本身，
 * 它出现在首页的记录框里、收集箱的整理动作里，但不需要自己占一个 Tab。
 * 也没有"纪念日"入口：它落在日历页的格子与卡片上（不提醒、不催办的东西，
 * 不该跟任务抢导航位）。
 *
 * 「首页」排在正中间：左手右手都够得着，而且它回答"现在做哪件"，
 * 本来就是五个入口里被点得最多的那个。注意 Tab 顺序**只影响显示顺序**，
 * 冷启动落在哪个页面由下面的 anchor 决定 —— 别把两件事混为一谈。
 */

/** 冷启动仍然落在首页，不管它在 Tab 栏排第几 */
export const unstable_settings = {
  anchor: 'index',
};

export default function TabsLayout() {
  const theme = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.text,
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarStyle: {
          backgroundColor: theme.background,
          borderTopColor: theme.backgroundSelected,
        },
        tabBarLabelStyle: { fontSize: 11 },
      }}>
      <Tabs.Screen
        name="inbox"
        options={{
          title: '收集箱',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="file-tray-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: '日历',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="calendar-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          title: '首页',
          tabBarIcon: ({ color, size }) => <Ionicons name="today-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="projects"
        options={{
          title: '项目',
          tabBarIcon: ({ color, size }) => <Ionicons name="albums-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="ideas"
        options={{
          title: '想法',
          tabBarIcon: ({ color, size }) => <Ionicons name="bulb-outline" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
