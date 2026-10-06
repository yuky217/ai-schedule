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

  setAdvancedEnabled: (value: boolean) => void;
  setAiEnabled: (value: boolean) => void;
  toggleCapability: (capability: AiCapability, value: boolean) => void;
  setAiConfig: (patch: Partial<AiConfig>) => void;
  setDefaultFocusMinutes: (minutes: number) => void;
  setHapticsEnabled: (value: boolean) => void;
  reset: () => void;
}

const initial = {
  advancedEnabled: false,
  aiEnabled: false,
  capabilities: defaultCapabilityFlags(),
  aiConfig: emptyAiConfig,
  defaultFocusMinutes: 25,
  hapticsEnabled: true,
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
