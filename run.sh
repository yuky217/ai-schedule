#!/usr/bin/env bash
# 项目内命令入口：Bash 工具不继承 cwd，npx 必须在项目根执行（2026-10-08）
# 用法: bash /d/艾粤希/ai-schedule/run.sh <tsc|test|vitest...>
cd "$(dirname "$0")" || exit 1
export npm_config_cache="D:/艾粤希/.npm-cache"
export HOME="D:/艾粤希/.expo-home"
export EXPO_NO_TELEMETRY=1
CMD="$1"
shift
case "$CMD" in
  tsc) exec npx tsc --noEmit "$@" ;;
  test) exec npx vitest run "$@" ;;
  *) exec "$CMD" "$@" ;;
esac
