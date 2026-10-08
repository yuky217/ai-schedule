package com.aiyuexi.aischedule.overlay

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.ContextCompat
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * 悬浮窗（记录入口）—— Android 专属能力。
 *
 * 为什么只有 Android：iOS 没有公开 API 允许应用在自己的窗口之外绘制，
 * 所以那边这个模块连编都不编（见 expo-module.config.json 的 platforms）。
 *
 * 为什么自己写而不装现成的库：候选都试过，两条路都堵着 ——
 * 一条用的是普通后台服务（Android 8 以后 App 一退后台气泡就被系统收走），
 * 另一条的 gradle 依赖的是 `com.facebook.react:react-native`，那个制品在
 * Maven 上只发到 0.71，跟本项目的 0.86 并排放会撞类。这里只有五个方法，
 * 自己写反而更短、更可控。
 *
 * 边界：本模块只管"球在不在"。点球之后去哪，由 Service 用 deep link 交给应用。
 */
class OverlayModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    // JS 侧用 requireOptionalNativeModule('Overlay') 找这个名字
    Name("Overlay")

    // 模块能加载就说明是 Android 独立版。Expo Go / 网页端根本找不到这个模块
    Function("isSupported") { true }

    Function("canDrawOverlays") {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        Settings.canDrawOverlays(context)
      } else {
        true
      }
    }

    Function("isShowing") { OverlayService.isRunning }

    // 跳系统设置页让用户授权。回来之后还得再调一次 show()，由 JS 侧负责
    AsyncFunction("requestPermission") {
      val activity = appContext.currentActivity ?: throw Exceptions.MissingActivity()
      activity.startActivity(
        Intent(
          Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
          Uri.parse("package:${context.packageName}")
        )
      )
      true
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("show") {
      ContextCompat.startForegroundService(context, serviceIntent(OverlayService.ACTION_SHOW))
      true
    }.runOnQueue(Queues.MAIN)

    // 用 stopService 而不是给服务发"隐藏"指令：
    // 服务结束会走 onDestroy，那里负责把 View 摘下来，不用额外同步
    AsyncFunction("hide") {
      context.stopService(serviceIntent(OverlayService.ACTION_HIDE))
      true
    }.runOnQueue(Queues.MAIN)
  }

  private fun serviceIntent(action: String): Intent =
    Intent(context, OverlayService::class.java).setAction(action)
}
