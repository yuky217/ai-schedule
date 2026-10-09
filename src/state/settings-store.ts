import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  AI_CAPABILITIES,
  defaultCapabilityFlags,
  emptyAiConfig,
  type AiCapability,
  type AiConfig,
  type CapabilityGate,
} from '@/capabilities/types';

/**
 * 用户偏好设置（主文档第二节设计原则的落点）。
 *
 * 「默认极简，按需展开」「高级功能默认关闭，由用户自己开启」——
 * 所以这里所有高级开关的初值都是 false，且这份设置要持久化，
 * 用户开过一次就不该下次又被重置回去。
 */

export interface SettingsState {
  /** 高级功能总开关：关闭时设置页只看得到基础项 */
  advancedEnabled: boolean;
  /** AI 能力总开关 */
  aiEnabled: boolean;
  /** 单项 AI 能力：用户可以只开"语义检索"不开"自动排期" */
  capabilities: Record<AiCapability, boolean>;
  aiConfig: AiConfig;
  /** 专注默认时长（分钟） */
  defaultFocusMinutes: number;
  /** 触感反馈（勾选完成时的轻微震动） */
  hapticsEnabled: boolean;
  /**
   * 用户想不想要桌面悬浮球（Android 独立版才有）。
   * 放这里只为一件事：用户开过一次之后，下次启动能自己回来，不用再点一遍。
   * 它记的是**用户意愿**，不是"现在有没有浮着" —— 后者永远以原生侧为准。
   */
  overlayEnabled: boolean;
  /**
   * 日历里要不要课表这一栏。
   *
   * 默认**开**：课表是这个 App 的一块正功能（不是"高级功能"），
   * 而"要不要"多数人自己知道 —— 上班族把它关掉，日历就只剩自己的安排，
   * 学生的日历里则会多出"这段时间有课"这层背景。
   * 关掉不只是藏起「课」那一栏：日/周视图里的课程背景带也一起不画。
   */
  timetableEnabled: boolean;
  /**
   * 简约模式：关掉界面上所有"替自己解释"的文字 ——
   * 页面副标题、卡片上那行小字（hint）、日历底部的形状图例、记录页的提示行。
   *
   * **只关说明书，不关数据**：任务上的时间、提醒几点是内容，把它们关掉
   * App 就没法用了。关的是那些"长按可以拖到…""考试不带完成态…"这类句子 ——
   * 用熟之后它们只剩噪音，而且它们一多，界面就在跟人说话，而不是让人看内容。
   *
   * 默认**关**：第一次来的人还不知道那些圆点是什么意思，图例这时候有用。
   * 它是个开关而不是直接删掉，正因为"有没有用"取决于用户用多久。
   */
  simpleMode: boolean;

  setAdvancedEnabled: (value: boolean) => void;
  setAiEnabled: (value: boolean) => void;
  toggleCapability: (capability: AiCapability, value: boolean) => void;
  setAiConfig: (patch: Partial<AiConfig>) => void;
  setDefaultFocusMinutes: (minutes: number) => void;
  setHapticsEnabled: (value: boolean) => void;
  setOverlayEnabled: (value: boolean) => void;
  setTimetableEnabled: (value: boolean) => void;
  setSimpleMode: (value: boolean) => void;
  reset: () => void;
}

const initial = {
  advancedEnabled: false,
  aiEnabled: false,
  capabilities: defaultCapabilityFlags(),
  aiConfig: emptyAiConfig,
  defaultFocusMinutes: 25,
  hapticsEnabled: true,
  overlayEnabled: false,
  timetableEnabled: true,
  simpleMode: false,
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...initial,

      setAdvancedEnabled: (value) => set({ advancedEnabled: value }),

      // 关掉 AI 总开关时，把单项能力一并关掉，避免"总开关关了但某项还在跑"
      setAiEnabled: (value) =>
        set((state) => ({
          aiEnabled: value,
          capabilities: value ? state.capabilities : defaultCapabilityFlags(),
        })),

      toggleCapability: (capability, value) =>
        set((state) => ({
          capabilities: { ...state.capabilities, [capability]: value },
        })),

      setAiConfig: (patch) => set((state) => ({ aiConfig: { ...state.aiConfig, ...patch } })),

      setDefaultFocusMinutes: (minutes) =>
        set({ defaultFocusMinutes: Math.max(1, Math.round(minutes)) }),

      setHapticsEnabled: (value) => set({ hapticsEnabled: value }),

      setOverlayEnabled: (value) => set({ overlayEnabled: value }),

      setTimetableEnabled: (value) => set({ timetableEnabled: value }),

      setSimpleMode: (value) => set({ simpleMode: value }),

      reset: () => set({ ...initial, capabilities: defaultCapabilityFlags() }),
    }),
    {
      name: 'ai-schedule-settings',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      // 旧版本没有的字段用默认值补齐，避免升级后读到 undefined
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<SettingsState>;
        return {
          ...current,
          ...saved,
          capabilities: { ...defaultCapabilityFlags(), ...(saved.capabilities ?? {}) },
          aiConfig: { ...emptyAiConfig, ...(saved.aiConfig ?? {}) },
        };
      },
    },
  ),
);

/** 给能力层用的开关视图 */
export const selectCapabilityGate = (state: SettingsState): CapabilityGate => ({
  // 总开关关闭时，单项视为全关
  enabled: state.aiEnabled ? state.capabilities : defaultCapabilityFlags(),
  config: state.aiConfig,
});

export const isAnyAiEnabled = (state: SettingsState): boolean =>
  state.aiEnabled && AI_CAPABILITIES.some((cap) => state.capabilities[cap.id]);
