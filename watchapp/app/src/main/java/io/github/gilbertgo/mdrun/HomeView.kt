package io.github.gilbertgo.mdrun

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.SweepGradient
import android.graphics.Typeface
import android.view.MotionEvent
import android.view.View
import java.util.Calendar
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin

// 시작 화면 첫 장 (2026-10-19, 사용자 '아주 감각적으로'): 검은 하늘 아래에서 떠오르는 산호빛 해(숨 쉬듯 밝아졌다 어두워짐),
// 테두리 링 = 이번 주 달린 거리 / 주간 목표, 가운데 큰 숫자, 요일 점 7개(달린 날 산호), 목표 알약, 아래 큰 둥근 ▶ 시작.
// 용두를 돌리거나 위로 밀면 아래에 설정 줄이 이어져요
class HomeView(c: Context, private val act: Act) : View(c) {
    class Act(val start: () -> Unit, val goal: () -> Unit, val update: (() -> Unit)?)
    class Week(val km: Double, val runs: Int, val days: BooleanArray, val goalKm: Int)
    var week = Week(0.0, 0, BooleanArray(7), 20)
    var gpsAcc = -1f
    var goal = Goal()
    var updName = ""
    private val p = Paint(Paint.ANTI_ALIAS_FLAG)
    private val numBold = Typeface.create("sans-serif-condensed", Typeface.BOLD)
    private val krBold = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
    private val born = System.currentTimeMillis()
    private var W = 0f; private var cx = 0f; private var u = 0f
    private val CORAL = RunView.CORAL; private val GOLD = RunView.GOLD; private val BLUE = RunView.BLUE; private val MUTED = RunView.MUTED
    private fun a(c: Int, al: Int) = RunView.alpha(c, al.coerceIn(0, 255))
    private fun paint(color: Int) = p.apply { reset(); isAntiAlias = true; this.color = color }
    private fun text(cv: Canvas, s: String, x: Float, y: Float, size: Float, color: Int, b: Boolean = false, num: Boolean = false, align: Paint.Align = Paint.Align.CENTER): Float {
        paint(color); p.textSize = size; p.typeface = if (num) (if (b) numBold else Typeface.create("sans-serif-condensed", Typeface.NORMAL)) else if (b) krBold else Typeface.DEFAULT
        if (num) p.fontFeatureSettings = "tnum"
        p.textAlign = align; cv.drawText(s, x, y, p); return p.measureText(s)
    }
    private fun measure(s: String, size: Float, num: Boolean): Float { paint(Color.WHITE); p.textSize = size; p.typeface = if (num) numBold else krBold; if (num) p.fontFeatureSettings = "tnum"; return p.measureText(s) }

    // 버튼 자리(눌렀는지 볼 때 써요)
    private val playR get() = 10.5f * u
    private val playY get() = 82.5f * u
    private var pillBox = RectF(); private var updBox = RectF()

    override fun onMeasure(w: Int, h: Int) {
        val s = MeasureSpec.getSize(w); setMeasuredDimension(s, resources.displayMetrics.heightPixels)
    }

    override fun onDraw(cv: Canvas) {
        val now = System.currentTimeMillis(); W = width.toFloat(); cx = W / 2; u = min(W, height.toFloat()) / 100f
        val br = ((sin((now - born) / 1000.0 * 2 * Math.PI / 3.2) + 1) / 2).toFloat()   // 3.2초에 한 번 숨쉬기 0..1
        cv.drawColor(Color.BLACK)
        // 떠오르는 해: 화면 아래에서 번지는 산호빛 + 그 위 옅은 금빛
        paint(Color.WHITE); p.shader = RadialGradient(cx, 112f * u, 78f * u, intArrayOf(a(CORAL, 120 + (40 * br).toInt()), a(CORAL, 40), a(CORAL, 0)), floatArrayOf(0f, .55f, 1f), Shader.TileMode.CLAMP)
        cv.drawRect(0f, 0f, W, height.toFloat(), p); p.shader = null
        paint(Color.WHITE); p.shader = RadialGradient(cx, 104f * u, 40f * u, intArrayOf(a(GOLD, 70), a(GOLD, 0)), null, Shader.TileMode.CLAMP)
        cv.drawRect(0f, 0f, W, height.toFloat(), p); p.shader = null
        // 별 몇 개(위쪽 하늘)
        for ((sx, sy, k) in listOf(Triple(24f, 26f, 0), Triple(78f, 22f, 1), Triple(70f, 38f, 2), Triple(30f, 41f, 3), Triple(86f, 47f, 4))) {
            val tw = ((sin((now - born) / 1000.0 * 1.3 + k * 1.7) + 1) / 2).toFloat()
            cv.drawCircle(sx * u, sy * u, (.35f + .25f * tw) * u, paint(a(Color.WHITE, 60 + (110 * tw).toInt())))
        }

        // 테두리 링: 이번 주 거리 / 주간 목표 (금 → 산호)
        val f = (week.km / week.goalKm).toFloat().coerceIn(0f, 1f)
        val r = 47f * u; val w = 2.6f * u; val box = RectF(cx - r, cx - r, cx + r, cx + r)
        paint(Color.parseColor("#1D2127")); p.style = Paint.Style.STROKE; p.strokeWidth = w; cv.drawArc(box, 0f, 360f, false, p)
        if (f > 0f) {
            paint(CORAL); p.style = Paint.Style.STROKE; p.strokeWidth = w; p.strokeCap = Paint.Cap.ROUND
            p.shader = SweepGradient(cx, cx, intArrayOf(GOLD, CORAL, CORAL), floatArrayOf(0f, f.coerceAtLeast(.01f), 1f)).apply { setLocalMatrix(Matrix().apply { setRotate(-90f, cx, cx) }) }
            cv.drawArc(box, -90f, 360f * f, false, p); p.shader = null
            val ang = Math.toRadians(-90.0 + 360.0 * f); val ex = cx + r * cos(ang).toFloat(); val ey = cx + r * sin(ang).toFloat()
            cv.drawCircle(ex, ey, w * (1.1f + .5f * br), paint(a(CORAL, 70)))
            cv.drawCircle(ex, ey, w * .42f, paint(Color.WHITE))
        }

        // 맨 위: 새 판 알림(금색 알약) 또는 시각
        val c = Calendar.getInstance()
        if (updName.isNotEmpty()) {
            val s = "새 판 $updName 설치"; val tw = measure(s, 3.8f * u, false) + 6 * u; val h = 7f * u; val y = 13.5f * u
            updBox = RectF(cx - tw / 2, y - h / 2, cx + tw / 2, y + h / 2)
            cv.drawRoundRect(updBox, h / 2, h / 2, paint(GOLD))
            text(cv, s, cx, y + 1.35f * u, 3.8f * u, RunView.INK, true)
        } else {
            updBox = RectF()
            text(cv, "${c.get(Calendar.HOUR_OF_DAY)}:${String.format("%02d", c.get(Calendar.MINUTE))}", cx, 15f * u, 6.4f * u, Color.WHITE, true, true)
        }
        // GPS: 준비되면 하늘색 점이 맥박처럼
        val ready = gpsAcc in 0f..20f
        val gs = if (gpsAcc < 0) "GPS 찾는 중" else if (ready) "GPS ${gpsAcc.toInt()}m" else "GPS 잡는 중 ${gpsAcc.toInt()}m"
        val gw = measure(gs, 3.3f * u, false); val gx = cx - gw / 2 + 1.6f * u; val gy = 21.3f * u
        val dc = if (ready) BLUE else MUTED
        if (ready) cv.drawCircle(gx - 3.2f * u, gy - 1.1f * u, (1f + 1.1f * br) * u, paint(a(BLUE, (90 * (1 - br)).toInt())))
        cv.drawCircle(gx - 3.2f * u, gy - 1.1f * u, .9f * u, paint(dc))
        text(cv, gs, gx, gy, 3.3f * u, dc, true, align = Paint.Align.LEFT)

        // 가운데: 이번 주 거리
        text(cv, "이번 주", cx, 33f * u, 3.6f * u, MUTED, true)
        val ks = if (week.km < 100) String.format("%.1f", week.km) else String.format("%.0f", week.km)
        val big = 19f * u; val unit = 5.4f * u
        val kw = measure(ks, big, true); val uw = measure("km", unit, true); val x0 = cx - (kw + uw + .8f * u) / 2
        text(cv, ks, x0, 50.5f * u, big, Color.WHITE, true, true, Paint.Align.LEFT)
        text(cv, "km", x0 + kw + .8f * u, 50.5f * u, unit, CORAL, true, true, Paint.Align.LEFT)
        text(cv, "주간 목표 ${week.goalKm}km · ${week.runs}번 달렸어요", cx, 56.5f * u, 3.2f * u, MUTED)
        // 요일 점(월~일): 달린 날 산호, 오늘은 흰 테두리
        val today = (c.get(Calendar.DAY_OF_WEEK) + 5) % 7
        for (i in 0 until 7) {
            val x = cx + (i - 3) * 4.6f * u; val y = 61.5f * u
            if (week.days[i]) cv.drawCircle(x, y, 1.25f * u, paint(CORAL))
            else cv.drawCircle(x, y, .8f * u, paint(if (i < today) Color.parseColor("#3B414A") else Color.parseColor("#262A31")))
            if (i == today) { paint(Color.WHITE); p.style = Paint.Style.STROKE; p.strokeWidth = .35f * u; cv.drawCircle(x, y, 2f * u, p) }
        }

        // 목표 알약(누르면 목표 고르기)
        val gl = goal.label() + (if (goal.tgtPace() > 0) "  ·  ${fmtPace(goal.tgtPace())}" else "")
        val pw = measure(gl, 3.4f * u, false) + 7 * u; val ph = 6.2f * u; val py = 67.6f * u
        pillBox = RectF(cx - pw / 2, py - ph / 2, cx + pw / 2, py + ph / 2)
        cv.drawRoundRect(pillBox, ph / 2, ph / 2, paint(a(Color.WHITE, 26)))
        text(cv, gl, cx, py + 1.2f * u, 3.4f * u, Color.WHITE, true)

        // 시작 단추: 산호 동그라미 + 숨쉬는 빛 + 진한 ▶
        val R = playR; val py2 = playY
        paint(Color.WHITE); p.shader = RadialGradient(cx, py2, R * 1.9f, intArrayOf(a(CORAL, 110 + (70 * br).toInt()), a(CORAL, 0)), floatArrayOf(.45f, 1f), Shader.TileMode.CLAMP)
        cv.drawCircle(cx, py2, R * 1.9f, p); p.shader = null
        paint(Color.WHITE); p.shader = RadialGradient(cx - R * .35f, py2 - R * .45f, R * 1.4f, intArrayOf(Color.parseColor("#FFB07F"), CORAL, Color.parseColor("#F06A2E")), floatArrayOf(0f, .55f, 1f), Shader.TileMode.CLAMP)
        cv.drawCircle(cx, py2, R, p); p.shader = null
        val t = R * .42f
        cv.drawPath(Path().apply { moveTo(cx - t * .7f, py2 - t); lineTo(cx + t, py2); lineTo(cx - t * .7f, py2 + t); close() }, paint(RunView.INK))
        // 아래 '더 보기' 꺾쇠
        paint(a(Color.WHITE, 90)); p.style = Paint.Style.STROKE; p.strokeWidth = .5f * u; p.strokeCap = Paint.Cap.ROUND
        cv.drawPath(Path().apply { moveTo(cx - 1.6f * u, 95.3f * u); lineTo(cx, 96.6f * u); lineTo(cx + 1.6f * u, 95.3f * u) }, p)

        // 처음 1분만 움직이고(배터리), 그 뒤엔 30초마다 시각만 새로
        postInvalidateDelayed(if (now - born < 60000) 50 else 30000)
    }

    private var dx = 0f; private var dy = 0f
    override fun onTouchEvent(e: MotionEvent): Boolean {
        when (e.action) {
            MotionEvent.ACTION_DOWN -> { dx = e.x; dy = e.y; return true }
            MotionEvent.ACTION_UP -> {
                if (abs(e.x - dx) > 4 * u || abs(e.y - dy) > 4 * u) return true
                val x = e.x; val y = e.y
                if (!updBox.isEmpty && updBox.contains(x, y)) act.update?.invoke()
                else if (Math.hypot((x - cx).toDouble(), (y - playY).toDouble()) < playR * 1.5) act.start()
                else if (RectF(pillBox).apply { inset(-2 * u, -2 * u) }.contains(x, y)) act.goal()
                return true
            }
        }
        return true
    }
}
