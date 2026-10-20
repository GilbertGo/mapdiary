package io.github.gilbertgo.mdrun

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.LinearGradient
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

// 시작 화면 첫 장: 사진 + 테두리 고리(시안 W1, 아래 onDraw 설명). ▶ 러닝 시작 → 목표 세팅(SetupView).
// 용두를 돌리거나 위로 밀면 아래에 설정 줄이 이어져요
class HomeView(c: Context, private val act: Act) : View(c) {
    class Act(val start: () -> Unit, val goal: () -> Unit, val update: (() -> Unit)?, val guide: () -> Unit = {})
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
    private val playR get() = 9.5f * u
    private val playY get() = 83.5f * u
    private var pillBox = RectF(); private var updBox = RectF(); private var guideBox = RectF()
    var guideTxt = ""; var guideOn = false   // 케이던스 가이드 알약(목표 알약 옆, 2026-10-19 사용자 '중요하니 앞쪽으로')

    override fun onMeasure(w: Int, h: Int) {
        val s = MeasureSpec.getSize(w); setMeasuredDimension(s, resources.displayMetrics.heightPixels)
    }

    // 2026-10-19 사용자가 시안 W1 고름: 휴대폰 첫 화면과 같은 사진(세 사람)을 어둡게 깔고, 테두리 전체가 주간 목표 고리.
    // 가운데 'TUESDAY, YOUR PACE' · THIS WEEK · 이번 주 km · '/ 주간 목표' · 요일 점 · ▶ 러닝 시작 · 아래 GPS·목표 한 줄 (문구는 사용자가 만든 PACE 앱 것)
    private var photo = Link.hero(c)
    fun reloadPhoto() { photo = Link.hero(context); invalidate() }
    private var goBox = RectF()
    override fun onDraw(cv: Canvas) {
        val now = System.currentTimeMillis(); W = width.toFloat(); cx = W / 2; u = min(W, height.toFloat()) / 100f
        cv.drawColor(Color.BLACK)
        val H = height.toFloat()
        photo?.let { bm -> val sc = maxOf(W / bm.width, H / bm.height); val dw = bm.width * sc; val dh = bm.height * sc
            cv.drawBitmap(bm, null, RectF((W - dw) / 2, (H - dh) * .75f, (W - dw) / 2 + dw, (H - dh) * .75f + dh), paint(Color.WHITE).apply { isFilterBitmap = true }) }
        paint(Color.WHITE); p.shader = RadialGradient(cx, H / 2, W * .62f, intArrayOf(Color.argb(95, 6, 30, 55), Color.argb(225, 6, 30, 55)), floatArrayOf(.15f, 1f), Shader.TileMode.CLAMP)
        cv.drawRect(0f, 0f, W, H, p); p.shader = null
        // 2026-10-20 휴대폰과 같이: 아래쪽을 더 어둡게 덮어 단추가 내려앉게
        paint(Color.WHITE); p.shader = LinearGradient(0f, H * .55f, 0f, H, Color.argb(0, 6, 30, 55), Color.argb(170, 6, 30, 55), Shader.TileMode.CLAMP); cv.drawRect(0f, H * .55f, W, H, p); p.shader = null

        // 테두리 고리: 이번 주 거리 / 주간 목표
        val f = (week.km / week.goalKm).toFloat().coerceIn(0f, 1f)
        val r = 47.6f * u; val w = 1.7f * u; val box = RectF(cx - r, cx - r, cx + r, cx + r)
        paint(a(Color.WHITE, 70)); p.style = Paint.Style.STROKE; p.strokeWidth = w; cv.drawArc(box, 0f, 360f, false, p)
        if (f <= 0f) cv.drawCircle(cx, cx - r, w * .95f, paint(CORAL))   // 0km면 맨 위 산호 시작 점
        if (f > 0f) {
            paint(CORAL); p.style = Paint.Style.STROKE; p.strokeWidth = w; p.strokeCap = Paint.Cap.ROUND
            cv.drawArc(box, -90f, 360f * f, false, p)
            val ang = Math.toRadians(-90.0 + 360.0 * f); cv.drawCircle(cx + r * cos(ang).toFloat(), cx + r * sin(ang).toFloat(), w * .42f, paint(Color.WHITE))
        }

        // 맨 위: 새 판 알림(금색 알약) 또는 'TUESDAY, YOUR PACE'
        val c = Calendar.getInstance()
        if (updName.isNotEmpty()) {
            val s = "새 판 $updName 설치"; val tw = measure(s, 4.6f * u, false) + 6 * u; val h = 8f * u; val y = 15f * u
            updBox = RectF(cx - tw / 2, y - h / 2, cx + tw / 2, y + h / 2)
            cv.drawRoundRect(updBox, h / 2, h / 2, paint(GOLD))
            text(cv, s, cx, y + 1.6f * u, 4.6f * u, RunView.INK, true)
        } else {
            updBox = RectF()
            val day = arrayOf("SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY")[c.get(Calendar.DAY_OF_WEEK) - 1]
            paint(Color.parseColor("#FFD2B8")); p.textSize = 3.6f * u; p.typeface = Typeface.MONOSPACE; p.letterSpacing = .18f; p.textAlign = Paint.Align.CENTER
            cv.drawText("$day, YOUR PACE", cx, 16f * u, p)
        }
        text(cv, "THIS WEEK", cx, 24.5f * u, 4f * u, a(Color.WHITE, 215), true)
        val ks = if (week.km < 100) String.format("%.1f", week.km) else String.format("%.0f", week.km)
        text(cv, ks, cx, 42.5f * u, 17f * u, Color.WHITE, true, true)
        text(cv, "/ 주간 목표 ${week.goalKm} km", cx, 50f * u, 4.4f * u, Color.WHITE)
        // 요일 점(월~일): 달린 날 산호, 오늘은 흰 테
        val today = (c.get(Calendar.DAY_OF_WEEK) + 5) % 7
        for (i in 0 until 7) {
            val x = cx + (i - 3) * 4.4f * u; val y = 56.5f * u
            // 2026-10-20 휴대폰과 같이: 점 크기는 모두 같게, 오늘은 같은 크기의 흰 테(달린 날이면 속은 산호)
            if (i == today) { if (week.days[i]) cv.drawCircle(x, y, 1.15f * u, paint(CORAL)); paint(Color.WHITE); p.style = Paint.Style.STROKE; p.strokeWidth = .45f * u; cv.drawCircle(x, y, 1.0f * u, p) }
            else cv.drawCircle(x, y, 1.15f * u, paint(if (week.days[i]) CORAL else a(Color.WHITE, 80)))
        }
        // ▶ 러닝 시작 (산호 알약)
        val gs = "▶  러닝 시작"; val gw = measure(gs, 5.6f * u, false) + 12 * u; val gh = 11.5f * u; val gy = 69f * u
        goBox = RectF(cx - gw / 2, gy - gh / 2, cx + gw / 2, gy + gh / 2)
        // 2026-10-20 휴대폰과 같이: 투명한 검정 + 가는 흰 테, ▶만 산호
        cv.drawRoundRect(goBox, gh / 2, gh / 2, paint(Color.argb(92, 0, 0, 0)))
        paint(a(Color.WHITE, 95)); p.style = Paint.Style.STROKE; p.strokeWidth = .35f * u; cv.drawRoundRect(goBox, gh / 2, gh / 2, p)
        val tri = "▶"; val tw0 = measure(tri, 5.6f * u, false); val rest = "  러닝 시작"; val rw = measure(rest, 5.6f * u, false); val tx = cx - (tw0 + rw) / 2
        text(cv, tri, tx, gy + 2f * u, 5.6f * u, CORAL, true, align = Paint.Align.LEFT); text(cv, rest, tx + tw0, gy + 2f * u, 5.6f * u, Color.WHITE, true, align = Paint.Align.LEFT)
        // 아래 한 줄: GPS · 목표
        val ready = gpsAcc in 0f..20f
        val gl = (if (gpsAcc < 0) "GPS 찾는 중" else if (ready) "GPS 준비" else "GPS ${gpsAcc.toInt()}m") + "  ·  🎯 " + goal.label() + (if (goal.tgtLabel().isNotEmpty()) " " + goal.tgtLabel() else "")
        val lw = measure(gl, 3.8f * u, false); val lx = cx - lw / 2 + 1.6f * u; val ly = 80f * u
        cv.drawCircle(lx - 2.8f * u, ly - 1.3f * u, .9f * u, paint(if (ready) BLUE else MUTED))
        text(cv, gl, lx, ly, 3.8f * u, a(Color.WHITE, 220), false, align = Paint.Align.LEFT)
        text(cv, "︿ 밀어 올리면 기록·설정", cx, 88f * u, 3.4f * u, a(Color.WHITE, 150))   // 2026-10-19 사용자 '용두? 그게 뭐야?' → 쉬운 말로
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
                else if (RectF(goBox).apply { inset(-2 * u, -3 * u) }.contains(x, y)) act.start()
                else if (y > 75 * u && y < 84 * u) act.goal()
                return true
            }
        }
        return true
    }
}
