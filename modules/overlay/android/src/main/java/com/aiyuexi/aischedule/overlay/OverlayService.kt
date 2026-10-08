package com.aiyuexi.aischedule.overlay

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.view.Gravity
import android.view.MotionEvent
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import androidx.core.app.NotificationCompat
import kotlin.math.abs
import kotlin.math.roundToInt

/** 气泡直径（dp）。一只手点得到，又不会挡住内容。 */
private const val BUBBLE_DP = 56f

/** 贴边时离屏幕边缘留的距离（dp） */
private const val EDGE_MARGIN_DP = 8f

/**
 * 悬浮球的宿主服务。
 *
 * 必须是**前台服务**：普通后台服务在 App 退到后台后会被系统回收，
 * 气泡跟着消失，"悬浮窗"就不成立了。代价是一条常驻通知 ——
 * 那条通知顺势当"这东西怎么关"的入口，不算纯负担。
 *
 * 气泡不渲染 React Native：它只是 WindowManager 上一个圆形 View。
 * 点它 = 用 deep link 打开记录页（`aischedule://capture`）。
 * 这样"记录无感"只多花一次点击，而不用把整个记录页复刻进悬浮窗里 ——
 * 复刻一份就等于给记录动作另开一个入口，那正是本项目一直避免的事。
 */
class OverlayService : Service() {
  private var windowManager: WindowManager? = null
  private var container: FrameLayout? = null
  private var bubble: FrameLayout? = null
  private var bubbleParams: FrameLayout.LayoutParams? = null

  private var bubbleSize = 0
  private var screenWidth = 0
  private var screenHeight = 0

  private var downRawX = 0f
  private var downRawY = 0f
  private var startLeft = 0
  private var startTop = 0
  private var dragging = false

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_HIDE) {
      stopSelf()
      return START_NOT_STICKY
    }

    promoteToForeground()
    attachBubble()
    isRunning = true

    // START_STICKY：被系统回收后自己回来。回来时 intent 是 null，
    // 上面那条分支不成立，正好按"继续显示气泡"处理。
    return START_STICKY
  }

  override fun onDestroy() {
    detachBubble()
    isRunning = false
    super.onDestroy()
  }

  // ---------------- 前台服务 ----------------

  private fun promoteToForeground() {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager != null) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        "记录入口",
        NotificationManager.IMPORTANCE_LOW
      ).apply {
        description = "悬浮球一直在，随时点一下记一笔"
        setShowBadge(false)
      }
      manager.createNotificationChannel(channel)
    }

    val notification = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_overlay_notification)
      .setContentTitle("记录入口已开启")
      .setContentText("点一下悬浮球，随手记一笔")
      .setContentIntent(captureIntent())
      .setOngoing(true)
      .setShowWhen(false)
      .setSilent(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .build()

    // API 34 起，声明了 foregroundServiceType 的服务必须把类型一起传进去，
    // 否则启动就抛异常。34 以下不需要，传了反而有兼容风险。
    if (Build.VERSION.SDK_INT >= 34) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  // ---------------- 气泡 ----------------

  private fun attachBubble() {
    if (container != null) return

    val manager = getSystemService(Context.WINDOW_SERVICE) as? WindowManager ?: return
    val metrics = resources.displayMetrics
    screenWidth = metrics.widthPixels
    screenHeight = metrics.heightPixels
    bubbleSize = (BUBBLE_DP * metrics.density).roundToInt()

    // 用一个铺满屏幕的透明容器托着气泡，气泡靠 margin 定位。
    // 好处是拖拽时只要改自己的 margin，不用去动窗口参数。
    // 容器本身不可点、窗口又带 FLAG_NOT_FOCUSABLE，所以气泡之外的触摸会穿透过去。
    val root = FrameLayout(this)
    val view = buildBubble()
    val params = FrameLayout.LayoutParams(bubbleSize, bubbleSize).apply {
      leftMargin = screenWidth - bubbleSize - (EDGE_MARGIN_DP * metrics.density).roundToInt()
      topMargin = screenHeight / 2
    }
    root.addView(view, params)

    val windowParams = WindowManager.LayoutParams(
      WindowManager.LayoutParams.MATCH_PARENT,
      WindowManager.LayoutParams.MATCH_PARENT,
      overlayWindowType(),
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
        or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
        or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
      PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      x = 0
      y = 0
    }

    try {
      manager.addView(root, windowParams)
    } catch (_: Exception) {
      // 权限刚被撤销时会抛 SecurityException。静默失败即可，
      // 设置页下次进来读到 canDrawOverlays() === false，会如实告诉用户。
      return
    }

    windowManager = manager
    container = root
    bubble = view
    bubbleParams = params
  }

  private fun buildBubble(): FrameLayout {
    val density = resources.displayMetrics.density

    val view = FrameLayout(this)
    view.background = GradientDrawable().apply {
      shape = GradientDrawable.OVAL
      setColor(0xFAFFFFFF.toInt())
      setStroke((1.5f * density).roundToInt(), 0x1F000000)
    }
    view.elevation = 8f * density

    val icon = ImageView(this)
    icon.scaleType = ImageView.ScaleType.FIT_CENTER
    try {
      // 用应用自己的图标，用户一眼认得出这是谁
      icon.setImageDrawable(packageManager.getApplicationIcon(packageName))
    } catch (_: Exception) {
      // 拿不到就留个白圈，不影响点击
    }
    val iconSize = (bubbleSize * 0.56f).roundToInt()
    view.addView(icon, FrameLayout.LayoutParams(iconSize, iconSize, Gravity.CENTER))

    view.setOnTouchListener { _, event -> handleTouch(event) }
    return view
  }

  private fun handleTouch(event: MotionEvent): Boolean {
    val params = bubbleParams ?: return false
    val view = bubble ?: return false
    val slop = 12f * resources.displayMetrics.density

    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        downRawX = event.rawX
        downRawY = event.rawY
        startLeft = params.leftMargin
        startTop = params.topMargin
        dragging = false
        return true
      }

      MotionEvent.ACTION_MOVE -> {
        val dx = event.rawX - downRawX
        val dy = event.rawY - downRawY
        // 过一个小门槛才算拖拽，否则手指的抖动会把"点一下"判成"拖一下"
        if (!dragging && (abs(dx) > slop || abs(dy) > slop)) dragging = true
        if (dragging) {
          params.leftMargin =
            (startLeft + dx).roundToInt().coerceIn(0, maxOf(0, screenWidth - bubbleSize))
          params.topMargin =
            (startTop + dy).roundToInt().coerceIn(0, maxOf(0, screenHeight - bubbleSize))
          view.requestLayout()
        }
        return true
      }

      MotionEvent.ACTION_UP -> {
        if (dragging) snapToEdge() else openCapture()
        return true
      }

      MotionEvent.ACTION_CANCEL -> {
        if (dragging) snapToEdge()
        return true
      }
    }
    return false
  }

  /** 松手后吸到最近的那条边，别让球停在屏幕中间挡内容 */
  private fun snapToEdge() {
    val params = bubbleParams ?: return
    val view = bubble ?: return
    val margin = (EDGE_MARGIN_DP * resources.displayMetrics.density).roundToInt()
    val center = params.leftMargin + bubbleSize / 2
    params.leftMargin = if (center < screenWidth / 2) margin else screenWidth - bubbleSize - margin
    view.requestLayout()
  }

  // ---------------- 点一下之后 ----------------

  /**
   * 点气泡 = 打开应用并落到记录页。
   *
   * 走 deep link 而不是"把应用拉到前台"：拉前台只会回到上次那个页面，
   * 用户还得再点一次才能记 —— 那就白装了。scheme 必须与 app.json 的 `scheme` 一致。
   */
  private fun openCapture() {
    try {
      startActivity(deepLinkIntent())
      return
    } catch (_: Exception) {
      // 深链没被解析时退回"打开应用"。至少不会点了完全没反应。
    }
    val launcher = packageManager.getLaunchIntentForPackage(packageName) ?: return
    launcher.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
      startActivity(launcher)
    } catch (_: Exception) {
      // 到这里就真的没辙了，不折腾
    }
  }

  private fun deepLinkIntent(): Intent =
    Intent(Intent.ACTION_VIEW, Uri.parse(CAPTURE_URL))
      .setPackage(packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

  private fun captureIntent(): PendingIntent =
    PendingIntent.getActivity(
      this,
      0,
      deepLinkIntent(),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

  private fun detachBubble() {
    val manager = windowManager
    val root = container
    windowManager = null
    container = null
    bubble = null
    bubbleParams = null
    if (manager != null && root != null) {
      try {
        manager.removeView(root)
      } catch (_: Exception) {
        // 服务已经被系统回收时窗口可能早没了
      }
    }
  }

  private fun overlayWindowType(): Int =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    } else {
      @Suppress("DEPRECATION")
      WindowManager.LayoutParams.TYPE_PHONE
    }

  companion object {
    const val ACTION_SHOW = "com.aiyuexi.aischedule.overlay.SHOW"
    const val ACTION_HIDE = "com.aiyuexi.aischedule.overlay.HIDE"

    /** 必须与 app.json 里的 `scheme` 一致 */
    private const val CAPTURE_URL = "aischedule://capture"
    private const val CHANNEL_ID = "overlay-bubble"
    private const val NOTIFICATION_ID = 4201

    /** 气泡是不是正浮着。JS 侧 isShowing() 直接读它，省掉一次跨进程查询。 */
    @Volatile
    var isRunning: Boolean = false
  }
}
