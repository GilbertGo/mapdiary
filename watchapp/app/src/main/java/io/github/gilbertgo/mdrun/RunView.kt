package io.github.gilbertgo.mdrun

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.view.MotionEvent
import android.view.View
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.min

// 달리는 중 화면 (둥근 시계 화면에 그려요). 옆으로 밀어 넘겨요:
// 0 A안 목표 링 · 1 B안 네 칸 숫자 · 2 C안 코치 신호등 · 3 1km 구간 · 4 멈춤·끝내기
class RunView(c: Context, private val onFinish: () -> Unit) : View(c) {
    companion object {
        const val PAGES = 5
        val ORANGE = Color.parseColor("#F4A259"); val GREEN = Color.parseColor("#7FD6A4"); val MUTED = Color.parseColor("#9AA7A0")
        val RED = Color.parseColor("#FF6B6B"); val PINE = Color.parseColor("#1E3B2F"); val TRACK = Color.parseColor("#24302A")
        val GOLD = Color.parseColor("#FFD166"); val LATE = Color.parseColor("#F4A259")
    }
    var page = Store.page(c).coerceIn(0, 2)
    var ambient = false
    private val p = Paint(Paint.ANTI_ALIAS_FLAG)
    private val bold = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
    private var downX = 0f; private var downY = 0f; private var downT = 0L
    private var holdStart = 0L   // 끝내기 길게 누르기
    private val HOLD_MS = 1500L

    private fun text(cv: Canvas, s: String, x: Float, y: Float, size: Float, color: Int, b: Boolean = false, align: Paint.Align = Paint.Align.CENTER) {
        p.reset(); p.isAntiAlias = true; p.textSize = size; p.color = if (ambient) (if (color == Color.WHITE) Color.WHITE else Color.LTGRAY) else color
        p.typeface = if (b) bold else Typeface.DEFAULT; p.textAlign = align
        // 넘치면 줄여요
        val maxW = width * 0.84f; val w = p.measureText(s); if (w > maxW) p.textSize = size * maxW / w
        cv.drawText(s, x, y, p)
    }

    override fun onDraw(cv: Canvas) {
        val now = System.currentTimeMillis(); val W = width.toFloat(); val H = height.toFloat(); val cx = W / 2; val u = min(W, H) / 100f   // u = 화면 크기의 1%
        cv.drawColor(Color.BLACK)
        when (page) {
            0 -> pageA(cv, now, cx, u)
            1 -> pageB(cv, now, cx, u)
            2 -> pageC(cv, now, cx, u)
            3 -> pageSplits(cv, now, cx, u)
            else -> pageCtl(cv, now, cx, u)
        }
        // 아래 점: 몇 번째 화면인지
        if (!ambient) for (i in 0 until PAGES) { p.reset(); p.isAntiAlias = true; p.color = if (i == page) Color.WHITE else Color.parseColor("#4A524E"); cv.drawCircle(cx + (i - (PAGES - 1) / 2f) * 3.2f * u, H - 4.5f * u, (if (i == page) 1.1f else 0.8f) * u, p) }
        if (!ambient && (Run.running || holdStart > 0)) postInvalidateDelayed(if (holdStart > 0) 30 else 1000)
    }

    private fun status(now: Long): String = when {
        Run.manualPause -> "⏸ 멈춤"
        !Run.gpsOn || Run.lastAcc < 0 -> "GPS 찾는 중"
        Run.lastAcc > TRACK_MAX_ACC -> "GPS 약함"
        Run.paused(now) -> "⏸ 멈춰 있어요"
        else -> "● 기록 중"
    }
    private fun goalLine(): String { val g = Run.goal; return if (g.k == "free") "자유 달리기" else "목표 ${g.label()}" + if (Run.goalDone) " · 달성!" else "" }
    private fun frac(): Float { val g = Run.goal; return when (g.k) { "dist" -> (Run.walk / (g.v * 1000)).toFloat(); "time" -> (Run.moving / (g.v * 60000)).toFloat(); else -> 0f } }
    private fun leftText(): String { val g = Run.goal; return when (g.k) { "dist" -> "${fmtDist(g.v * 1000 - Run.walk)} 남음"; "time" -> "${fmtTime((g.v * 60000 - Run.moving).toLong())} 남음"; else -> "" } }

    // ---------- A안 · 목표 링 ----------
    private fun pageA(cv: Canvas, now: Long, cx: Float, u: Float) {
        val r = 47f * u; val ring = RectF(cx - r, 50 * u - r, cx + r, 50 * u + r)
        p.reset(); p.isAntiAlias = true; p.style = Paint.Style.STROKE; p.strokeWidth = 3.4f * u; p.strokeCap = Paint.Cap.ROUND
        if (Run.goal.k != "free") {
            p.color = if (ambient) Color.DKGRAY else TRACK; cv.drawArc(ring, 0f, 360f, false, p)
            p.color = if (ambient) Color.LTGRAY else if (Run.goalDone) GOLD else ORANGE; cv.drawArc(ring, -90f, 360f * frac().coerceIn(0f, 1f), false, p)
        }
        val hr = Run.hrNow(now)
        text(cv, if (hr > 0) "♥ $hr" else status(now), cx, 21 * u, 6.2f * u, if (hr > 0) RED else MUTED)
        // 큰 거리 + km
        p.reset(); p.isAntiAlias = true; p.typeface = bold; p.textSize = 27 * u; val big = fmtKm(Run.walk); val bw = p.measureText(big)
        p.textSize = 9 * u; val kw = p.measureText(" km"); val x0 = cx - (bw + kw) / 2
        text(cv, big, x0, 50 * u, 27f * u, Color.WHITE, true, Paint.Align.LEFT)
        text(cv, " km", x0 + bw, 50 * u, 9f * u, ORANGE, true, Paint.Align.LEFT)
        text(cv, if (Run.goal.k == "free") "자유 달리기" else if (Run.goalDone) "목표 ${Run.goal.label()} 달성!" else "목표 ${Run.goal.label()} · ${leftText()}", cx, 60 * u, 5.6f * u, MUTED)
        text(cv, "${fmtTime(Run.liveMoving(now))}  ·  ${fmtPace(Run.nowPace(now))}", cx, 72 * u, 10.5f * u, Color.WHITE, true)
        val (line, col) = coachShort()
        text(cv, line, cx, 83 * u, 5.8f * u, col, true)
    }
    // A안 맨 아래 한 줄 코치 판단
    private fun coachShort(): Pair<String, Int> {
        if (Run.goalDone) return "🎉 목표 달성!" to GOLD
        val J = Run.judge() ?: return (if (Run.goal.k == "free") "평균 ${fmtPace(Run.avgPace())}" else "달리면 나와요") to MUTED
        val d = J.diff
        return if (Run.goal.k == "dist") {
            if (d == null) "완주 예상 ${fmtTime(J.pred.toLong())}" to GREEN
            else if (kotlin.math.abs(d) <= J.near) "● 목표와 딱 맞아요" to GREEN
            else if (d > 0) "▲ 목표보다 ${sayDur(d)} 빨라요" to GREEN else "▼ 목표보다 ${sayDur(-d)} 늦어요" to LATE
        } else {
            if (d == null) "예상 거리 ${fmtDist(J.pred)}" to GREEN
            else if (kotlin.math.abs(d) <= J.near) "● 목표 거리와 딱 맞아요" to GREEN
            else if (d > 0) "▲ 목표보다 ${fmtDist(d)} 더" to GREEN else "▼ 목표보다 ${fmtDist(-d)} 모자라요" to LATE
        }
    }

    // ---------- B안 · 네 칸 숫자 ----------
    private fun pageB(cv: Canvas, now: Long, cx: Float, u: Float) {
        text(cv, "${status(now)} · ${goalLine()}", cx, 17 * u, 5.2f * u, MUTED)
        val lx = cx - 19 * u; val rx = cx + 19 * u
        text(cv, "거리", lx, 28 * u, 4.8f * u, MUTED); text(cv, fmtKm(Run.walk), lx, 43 * u, 15f * u, Color.WHITE, true)
        text(cv, "시간", rx, 28 * u, 4.8f * u, MUTED); text(cv, fmtTime(Run.liveMoving(now)), rx, 43 * u, 15f * u, Color.WHITE, true)
        val hr = Run.hrNow(now)
        text(cv, "페이스", lx, 54 * u, 4.8f * u, MUTED); text(cv, fmtPace(Run.nowPace(now)), lx, 68 * u, 13.5f * u, ORANGE, true)
        text(cv, "심박", rx, 54 * u, 4.8f * u, MUTED); text(cv, if (hr > 0) "$hr" else "-", rx, 68 * u, 13.5f * u, RED, true)
        val J = Run.judge(); val g = Run.goal
        val bottom = when {
            Run.goalDone -> "목표 달성! 평균 ${fmtPace(Run.avgPace())}"
            J != null && g.k == "dist" -> "완주 예상 ${fmtTime(J.pred.toLong())}"
            J != null && g.k == "time" -> "예상 거리 ${fmtDist(J.pred)}"
            Run.cadNow(now) != null -> "케이던스 ${Run.cadNow(now)} · 평균 ${fmtPace(Run.avgPace())}"
            else -> "평균 페이스 ${fmtPace(Run.avgPace())}"
        }
        text(cv, bottom, cx, 82 * u, 5.4f * u, GREEN, true)
    }

    // ---------- C안 · 코치 신호등 (빠르면 초록, 늦으면 주황 바탕) ----------
    private fun pageC(cv: Canvas, now: Long, cx: Float, u: Float) {
        val g = Run.goal; val J = Run.judge(); val d = J?.diff
        var title: String; var big: String; var sub: String; var col: Int
        when {
            Run.goalDone -> { title = "목표 달성!"; big = fmtKm(Run.walk) + "km"; sub = "달린 시간 ${fmtTime(Run.moving)}"; col = GOLD }
            J == null -> { title = if (g.k == "free") "평균 페이스" else "조금 더 달리면 나와요"; big = fmtPace(Run.avgPace()); sub = if (g.k == "free") "자유 달리기" else goalLine(); col = MUTED }
            g.k == "dist" && d == null -> { title = "완주 예상"; big = fmtTime(J.pred.toLong()); sub = "목표 ${g.label()}"; col = GREEN }
            g.k == "time" && d == null -> { title = "예상 거리"; big = fmtDist(J.pred); sub = "${minLabel(g.v.toInt())} 동안"; col = GREEN }
            g.k == "dist" -> {
                val ok = d!! >= -J.near; col = if (ok) GREEN else LATE
                title = if (kotlin.math.abs(d) <= J.near) "목표와 딱 맞아요" else if (d > 0) "목표 안에 들어와요" else "목표보다 늦어요"
                big = (if (d >= 0) "−" else "+") + fmtTime(kotlin.math.abs(d).toLong()).trimStart('0').let { if (it.startsWith(":")) "0$it" else it }
                sub = "완주 예상 ${fmtTime(J.pred.toLong())} (목표 ${fmtTime(J.target.toLong())})"
            }
            else -> {
                val ok = d!! >= -J.near; col = if (ok) GREEN else LATE
                title = if (kotlin.math.abs(d) <= J.near) "목표 거리와 딱 맞아요" else if (d > 0) "목표보다 더 가요" else "목표 거리에 모자라요"
                big = (if (d >= 0) "+" else "−") + fmtDist(kotlin.math.abs(d))
                sub = "예상 ${fmtDist(J.pred)} (목표 ${fmtDist(J.target)})"
            }
        }
        if (!ambient) {
            val base = if (col == LATE) Color.parseColor("#4A2E12") else if (col == GOLD) Color.parseColor("#4A3B10") else if (col == MUTED) Color.parseColor("#1E2622") else Color.parseColor("#1F4B33")
            p.reset(); p.isAntiAlias = true; p.shader = RadialGradient(cx, 30 * u, 60 * u, base, Color.BLACK, Shader.TileMode.CLAMP)
            cv.drawCircle(cx, 50 * u, 75 * u, p); p.shader = null
        }
        val hr = Run.hrNow(now)
        text(cv, "${fmtKm(Run.walk)}km · ${fmtTime(Run.liveMoving(now))}" + if (hr > 0) " · ♥$hr" else "", cx, 18 * u, 5.4f * u, MUTED)
        text(cv, title, cx, 31 * u, 6.6f * u, col, true)
        text(cv, big, cx, 54 * u, 21f * u, col, true)
        text(cv, sub, cx, 66 * u, 4.9f * u, MUTED)
        text(cv, "${fmtPace(Run.nowPace(now))} /km", cx, 80 * u, 10.5f * u, Color.WHITE, true)
    }

    // ---------- 1km 구간 ----------
    private fun pageSplits(cv: Canvas, now: Long, cx: Float, u: Float) {
        text(cv, "1km 구간", cx, 17 * u, 6f * u, ORANGE, true)
        val sp = Run.splits
        if (sp.isEmpty()) text(cv, "1km를 달리면 여기에 쌓여요", cx, 45 * u, 5.4f * u, MUTED)
        else {
            val lo = sp.minOrNull() ?: 0L; val show = sp.withIndex().toList().takeLast(5)
            show.forEachIndexed { i, (k, ms) ->
                val y = 28 * u + i * 9.5f * u
                text(cv, "${k + 1}km", cx - 22 * u, y, 5.4f * u, MUTED, false, Paint.Align.LEFT)
                text(cv, fmtPace(ms.toDouble()), cx + 22 * u, y, 6.6f * u, if (ms == lo && sp.size > 1) RED else Color.WHITE, true, Paint.Align.RIGHT)
            }
        }
        val avgHr = Run.hrAvg(); val cad = Run.cadAvg()
        text(cv, "평균 ${fmtPace(Run.avgPace())}" + (if (avgHr > 0) " · ♥ 평균 $avgHr 최고 ${Run.hrMax}" else ""), cx, 78 * u, 4.8f * u, GREEN)
        if (cad != null) text(cv, "케이던스 $cad · ${Run.steps}걸음", cx, 86 * u, 4.6f * u, MUTED)
    }

    // ---------- 멈춤 · 끝내기 (끝내기는 1.5초 꾹) ----------
    private fun btnL(u: Float, cx: Float) = floatArrayOf(cx - 20 * u, 50 * u, 17 * u)
    private fun btnR(u: Float, cx: Float) = floatArrayOf(cx + 20 * u, 50 * u, 17 * u)
    private fun pageCtl(cv: Canvas, now: Long, cx: Float, u: Float) {
        text(cv, if (Run.voice) "🔊 목소리 코치 켬 (누르면 끔)" else "🔇 목소리 코치 끔 (누르면 켬)", cx, 20 * u, 5f * u, MUTED)
        val L = btnL(u, cx); val R = btnR(u, cx)
        p.reset(); p.isAntiAlias = true; p.color = PINE; cv.drawCircle(L[0], L[1], L[2], p)
        p.color = Color.parseColor("#5A2A1A"); cv.drawCircle(R[0], R[1], R[2], p)
        text(cv, if (Run.manualPause) "▶" else "⏸", L[0], L[1] + 3 * u, 11f * u, Color.WHITE, true)
        text(cv, if (Run.manualPause) "계속" else "멈춤", L[0], L[1] + 11 * u, 4.6f * u, Color.WHITE)
        text(cv, "■", R[0], R[1] + 3 * u, 11f * u, ORANGE, true)
        text(cv, "끝내기", R[0], R[1] + 11 * u, 4.6f * u, Color.WHITE)
        if (holdStart > 0) {
            val f = ((now - holdStart).toFloat() / HOLD_MS).coerceIn(0f, 1f)
            p.reset(); p.isAntiAlias = true; p.style = Paint.Style.STROKE; p.strokeWidth = 2.2f * u; p.color = ORANGE; p.strokeCap = Paint.Cap.ROUND
            cv.drawArc(RectF(R[0] - R[2] - 2 * u, R[1] - R[2] - 2 * u, R[0] + R[2] + 2 * u, R[1] + R[2] + 2 * u), -90f, 360 * f, false, p)
            if (f >= 1f) { holdStart = 0; post { onFinish() } }
        }
        text(cv, "끝내기는 1.5초 꾹 누르세요", cx, 80 * u, 4.8f * u, MUTED)
    }

    // ---------- 손가락 ----------
    override fun onTouchEvent(e: MotionEvent): Boolean {
        val u = min(width, height) / 100f; val cx = width / 2f
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                downX = e.x; downY = e.y; downT = System.currentTimeMillis()
                if (page == 4) { val R = btnR(u, cx); if (hypot(e.x - R[0], e.y - R[1]) < R[2] * 1.15f) { holdStart = downT; invalidate() } }
            }
            MotionEvent.ACTION_MOVE -> if (holdStart > 0 && hypot(e.x - downX, e.y - downY) > 12 * u) { holdStart = 0; invalidate() }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                val dx = e.x - downX; val wasHold = holdStart > 0; holdStart = 0
                if (abs(dx) > width * 0.16f && abs(dx) > abs(e.y - downY)) { page = (page + (if (dx < 0) 1 else -1) + PAGES) % PAGES; if (page <= 2) Store.setPage(context, page); invalidate(); return true }
                if (wasHold) { invalidate(); return true }
                if (e.actionMasked == MotionEvent.ACTION_UP && page == 4 && hypot(dx, e.y - downY) < 8 * u) {
                    val L = btnL(u, cx)
                    if (hypot(e.x - L[0], e.y - L[1]) < L[2] * 1.15f) { Run.setPause(!Run.manualPause); performClick() }
                    else if (e.y < 30 * u) { Run.voice = !Run.voice; Store.setVoice(context, Run.voice) }
                }
                invalidate()
            }
        }
        return true
    }
    override fun performClick(): Boolean { super.performClick(); return true }
}
