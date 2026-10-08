#!/usr/bin/env bash
# 项目内命令入口：Bash 工具不继承 cwd，npx 必须在项目根执行（2026-10-08）
# 用法: bash run.sh <tsc|test|apk|vitest...>
cd "$(dirname "$0")" || exit 1
export npm_config_cache="D:/艾粤希/.npm-cache"
export HOME="D:/艾粤希/.expo-home"
export EXPO_NO_TELEMETRY=1
CMD="$1"
shift
case "$CMD" in
  tsc) exec npx tsc --noEmit "$@" ;;
  test) exec npx vitest run "$@" ;;
  # 出 APK：Windows 路径不能含中文（clang/ninja/prefab 都按 GBK 读 UTF-8 会乱码），
  # 所以项目必须放在纯 ASCII 路径下构建。全套 env 缺一不可，逐条理由见下面注释。
  apk)
    # PATH 里的 node 是 22.22.2，跑 prebuild 会 0xC0000409 崩，必须用 24
    export PATH="D:/node:$PATH"
    # gradle 缓存/TEMP 若落在 C:\Users\艾粤希（中文）→ prefab 生成的 .bat 乱码
    export GRADLE_USER_HOME="D:/gradle-home"
    export TMP="D:/tmp-build" TEMP="D:/tmp-build"
    export ANDROID_HOME="D:/Android/Sdk"
    # which java 拿到的是 Oracle javapath shim，dirname 会得到错目录，直接写死
    export JAVA_HOME="D:/java_JDK"
    exec ./gradlew assembleDebug --no-daemon -x lint --max-workers=4 "$@" ;;
  *) exec "$CMD" "$@" ;;
esac

