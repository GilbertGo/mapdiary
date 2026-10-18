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
import kotlin.math.hypot
import kotlin.math.min
import kotlin.math.sin

// 달리는 중 화면 (둥근 시계 화면에 그려요). 옆으로 밀어 넘겨요:
// 0 A안 목표 링 · 1 B안 네 칸 숫자 · 2 C안 코치 신호등 · 3 1km 구간 · 4 멈춤·끝내기
// 2026-10-18 새 디자인(사용자 '이쁘게, 시인성 좋게, 지금은 초보티 나'): 검은 바탕에 흰 큰 숫자(좁은 굵은 글꼴, 숫자 폭 고정),
// 휴대폰 MPD 바닷가 색(산호 #FF8A4C · 하늘 #4FC3F7), 테두리 링·알약 딱지·그린 아이콘(이모지 안 씀)
class RunView(c: Context, private val onFinish: () -> Unit) : View(c) {
    companion object {
        const val PAGES = 5
        val CORAL = Color.parseColor("#FF8A4C"); val BLUE = Color.parseColor("#4FC3F7"); val GOLD = Color.parseColor("#FFD166")
        val RED = Color.parseColor("#FF4D5E"); val LATE = Color.parseColor("#FF7A59"); val MUTED = Color.parseColor("#8D97A5")
        val SURF = Color.parseColor("#16191E"); val LINE = Color.parseColor("#2A2F37"); val TRACK = Color.parseColor("#22262D")
        val INK = Color.parseColor("#1A0D06")
        // 예전 이름(시작 화면 등에서 써요)
        val ORANGE = CORAL; val GREEN = BLUE; val PINE = Color.parseColor("#2A2F37")
        fun alpha(c: Int, a: Int) = (c and 0xFFFFFF) or (a shl 24)
    }
    var page = Store.page(c).coerceIn(0, 2)
    var ambient = false
    private val p = Paint(Paint.ANTI_ALIAS_FLAG)
    private val numBold = Typeface.create("sans-serif-condensed", Typeface.BOLD)
    private val krBold = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
    private var downX = 0f; private var downY = 0f; private var downT = 0L
    private var holdStart = 0L   // 끝내기 길게 누르기
    private val HOLD_MS = 1500L
    private var W = 0f; private var cx = 0f; private var u = 0f

    private fun paint(color: Int) = p.apply { reset(); isAntiAlias = true; this.color = color }
    // 글자: num=true면 좁은 숫자 글꼴(폭 고정). 넘치면 줄여요. 그린 폭을 돌려줘요
    private fun text(cv: Canvas, s: String, x: Float, y: Float, size: Float, color: Int, b: Boolean = false, num: Boolean = false,
                     align: Paint.Align = Paint.Align.CENTER, max: Float = 0.84f): Float {
        paint(if (ambient) (if (color == Color.WHITE) Color.WHITE else Color.LTGRAY) else color)
        p.textSize = size; p.typeface = if (num) (if (b) numBold else Typeface.create("sans-serif-condensed", Typeface.NORMAL)) else if (b) krBold else Typeface.DEFAULT
        if (num) p.fontFeatureSettings = "tnum"
        p.textAlign = align
        val maxW = W * max; val w = p.measureText(s); if (w > maxW) p.textSize = size * maxW / w
        cv.drawText(s, x, y, p); return p.measureText(s)
    }
    private fun measure(s: String, size: Float, num: Boolean = true): Float {
        paint(Color.WHITE); p.textSize = size; p.typeface = if (num) numBold else krBold; if (num) p.fontFeatureSettings = "tnum"; return p.measureText(s)
    }
    private fun heart(cv: Canvas, x: Float, y: Float, r: Float, col: Int) {
        val path = Path().apply { moveTo(x, y + r * .9f); cubicTo(x - r * 1.6f, y - r * .2f, x - r * .7f, y - r * 1.3f, x, y - r * .4f)
            cubicTo(x + r * .7f, y - r * 1.3f, x + r * 1.6f, y - r * .2f, x, y + r * .9f); close() }
        cv.drawPath(path, paint(if (ambient) Color.LTGRAY else col))
    }
    // 알약 모양 딱지(옅은 색 바탕 + 같은 색 굵은 글자)
    private fun pill(cv: Canvas, s: String, y: Float, col: Int, size: Float) {
        val w = min(measure(s, size, false) + 7 * u, W * 0.7f); val h = size + 3.4f * u
        if (!ambient) cv.drawRoundRect(RectF(cx - w / 2, y - h / 2, cx + w / 2, y + h / 2), h / 2, h / 2, paint(alpha(col, 0x2E)))
        text(cv, s, cx, y + size * .36f, size, col, true, max = 0.62f)
    }
    // 테두리 링(진행 정도 f, 색 a→b, 끝에 흰 점)
    private fun ring(cv: Canvas, f: Float, a: Int, b: Int, r: Float = 46.5f * u, w: Float = 4.2f * u) {
        val box = RectF(cx - r, cx - r, cx + r, cx + r)
        paint(TRACK); p.style = Paint.Style.STROKE; p.strokeWidth = w; p.strokeCap = Paint.Cap.ROUND; cv.drawArc(box, 0f, 360f, false, p)
        val ff = f.coerceIn(0f, 1f); if (ff <= 0f) return
        paint(a); p.style = Paint.Style.STROKE; p.strokeWidth = w; p.strokeCap = Paint.Cap.ROUND
        p.shader = SweepGradient(cx, cx, intArrayOf(a, b, b), floatArrayOf(0f, ff.coerceAtLeast(0.01f), 1f)).apply { setLocalMatrix(Matrix().apply { setRotate(-90f, cx, cx) }) }
        cv.drawArc(box, -90f, 360f * ff, false, p); p.shader = null
        val ang = Math.toRadians((-90.0 + 360.0 * ff)); cv.drawCircle(cx + r * cos(ang).toFloat(), cx + r * sin(ang).toFloat(), w * .32f, paint(Color.WHITE))
    }
    private fun clock(): String { val c = Calendar.getInstance(); return "${c.get(Calendar.HOUR_OF_DAY)}:${String.format("%02d", c.get(Calendar.MINUTE))}" }

    override fun onDraw(cv: Canvas) {
        val now = System.currentTimeMillis(); W = width.toFloat(); cx = W / 2; u = min(W, height.toFloat()) / 100f   // u = 화면 크기의 1%
        cv.drawColor(Color.BLACK)
        if (ambient) pageAmbient(cv, now)
        else when (page) {
            0 -> pageA(cv, now)
            1 -> pageB(cv, now)
            2 -> pageC(cv, now)
            3 -> pageSplits(cv)
            else -> pageCtl(cv, now)
        }
        // 아래 점: 몇 번째 화면인지(지금 화면은 길쭉하게)
        if (!ambient) for (i in 0 until PAGES) {
            val x = cx + (i - (PAGES - 1) / 2f) * 3.4f * u; val y = 96f * u
            if (i == page) cv.drawRoundRect(RectF(x - 1.8f * u, y - .9f * u, x + 1.8f * u, y + .9f * u), .9f * u, .9f * u, paint(Color.WHITE))
            else cv.drawCircle(x, y, .85f * u, paint(Color.parseColor("#3B414A")))
        }
        if (!ambient && (Run.running || holdStart > 0)) postInvalidateDelayed(if (holdStart > 0) 30 else 1000)
    }

    private fun status(now: Long): Pair<String, Int> = when {
        Run.manualPause -> "잠시 멈춤" to CORAL
        !Run.gpsOn || Run.lastAcc < 0 -> "GPS 찾는 중" to MUTED
        Run.lastAcc > TRACK_MAX_ACC -> "GPS 약함" to LATE
        Run.paused(now) -> "멈춰 있어요" to CORAL
        else -> "기록 중" to BLUE
    }
    private fun frac(): Float { val g = Run.goal; return when (g.k) { "dist" -> (Run.walk / (g.v * 1000)).toFloat(); "time" -> (Run.moving / (g.v * 60000)).toFloat(); else -> ((Run.walk % 1000) / 1000).toFloat() } }
    private fun leftText(): String { val g = Run.goal; return when (g.k) { "dist" -> "${fmtDist(g.v * 1000 - Run.walk)} 남음"; "time" -> "${fmtTime((g.v * 60000 - Run.moving).toLong())} 남음"; else -> "" } }
    private fun goalSub(): String = when {
        Run.goal.k == "free" -> "자유 달리기 · 링은 이번 1km"
        Run.goalDone -> "목표 ${Run.goal.label()} 달성!"
        else -> "목표 ${Run.goal.label()} · ${leftText()}"
    }
    // 맨 위: 지금 시각 + 심박(빨간 하트)
    private fun topBar(cv: Canvas, now: Long) {
        text(cv, clock(), cx, 15.5f * u, 4.6f * u, MUTED, true, true)
        val hr = Run.hrNow(now)
        if (hr > 0) { val s = "$hr"; val tot = 5 * u + measure(s, 7 * u); heart(cv, cx - tot / 2 + 1.8f * u, 23.2f * u, 2.1f * u, RED); text(cv, s, cx - tot / 2 + 4.6f * u, 25.6f * u, 7 * u, Color.WHITE, true, true, Paint.Align.LEFT) }
        else { val (s, col) = status(now); text(cv, s, cx, 25f * u, 4.4f * u, col, true) }
    }
    // 큰 숫자 + 작은 단위를 가운데 맞춰 그려요
    private fun bigWithUnit(cv: Canvas, big: String, unit: String, y: Float, size: Float, unitSize: Float, unitCol: Int) {
        val bw = min(measure(big, size), W * 0.62f); val sz = if (measure(big, size) > W * 0.62f) size * W * 0.62f / measure(big, size) else size
        val kw = measure(unit, unitSize) + 1.2f * u; val x0 = cx - (bw + kw) / 2
        text(cv, big, x0, y, sz, Color.WHITE, true, true, Paint.Align.LEFT); text(cv, unit, x0 + bw + 1.2f * u, y, unitSize, unitCol, true, true, Paint.Align.LEFT)
    }

    // ---------- A안 · 목표 링 ----------
    private fun pageA(cv: Canvas, now: Long) {
        if (Run.goal.k == "free") ring(cv, frac(), BLUE, BLUE) else ring(cv, frac(), CORAL, if (Run.goalDone) GOLD else Color.parseColor("#FFB066"))
        topBar(cv, now)
        bigWithUnit(cv, fmtKm(Run.walk), "km", 57 * u, 31 * u, 7 * u, CORAL)
        text(cv, goalSub(), cx, 64.5f * u, 4.3f * u, if (Run.goalDone) GOLD else MUTED, max = 0.7f)
        cv.drawRect(cx - .15f * u, 68 * u, cx + .15f * u, 79 * u, paint(LINE))
        text(cv, fmtTime(Run.liveMoving(now)), cx - 15 * u, 76 * u, 9.5f * u, Color.WHITE, true, true, max = 0.3f); text(cv, "시간", cx - 15 * u, 80.6f * u, 3.4f * u, MUTED)
        text(cv, fmtPace(Run.nowPace(now)), cx + 15 * u, 76 * u, 9.5f * u, CORAL, true, true, max = 0.3f); text(cv, "페이스 /km", cx + 15 * u, 80.6f * u, 3.4f * u, MUTED)
        val (line, col) = coachShort()
        pill(cv, line, 87.5f * u, col, 3.8f * u)
    }
    // A안 맨 아래 한 줄 코치 판단
    private fun coachShort(): Pair<String, Int> {
        if (Run.goalDone) return "목표 달성!" to GOLD
        val J = Run.judge() ?: return (if (Run.goal.k == "free") "평균 ${fmtPace(Run.avgPace())}" else "달리면 예상이 나와요") to MUTED
        val d = J.diff
        return if (Run.goal.k == "dist") {
            if (d == null) "완주 예상 ${fmtTime(J.pred.toLong())}" to BLUE
            else if (abs(d) <= J.near) "목표와 딱 맞아요" to BLUE
            else if (d > 0) "▲ 목표보다 ${sayDur(d)} 빨라요" to BLUE else "▼ 목표보다 ${sayDur(-d)} 늦어요" to LATE
        } else {
            if (d == null) "예상 거리 ${fmtDist(J.pred)}" to BLUE
            else if (abs(d) <= J.near) "목표 거리와 딱 맞아요" to BLUE
            else if (d > 0) "▲ 목표보다 ${fmtDist(d)} 더" to BLUE else "▼ 목표보다 ${fmtDist(-d)} 모자라요" to LATE
        }
    }

    // ---------- B안 · 네 칸 숫자 ----------
    private fun pageB(cv: Canvas, now: Long) {
        val (st, sc) = status(now); val sLine = "$st · ${clock()}"; val sw = measure(sLine, 4.2f * u, false)
        cv.drawCircle(cx - sw / 2 - 2 * u, 15.1f * u, 1f * u, paint(sc)); text(cv, sLine, cx + 1f * u, 16.6f * u, 4.2f * u, MUTED)
        cv.drawRect(13 * u, 51 * u, 87 * u, 51.3f * u, paint(LINE)); cv.drawRect(cx - .15f * u, 24 * u, cx + .15f * u, 78 * u, paint(LINE))
        val hr = Run.hrNow(now)
        cell(cv, cx - 18 * u, 29 * u, "거리 km", fmtKm(Run.walk), Color.WHITE)
        cell(cv, cx + 18 * u, 29 * u, "시간", fmtTime(Run.liveMoving(now)), Color.WHITE)
        cell(cv, cx - 18 * u, 58 * u, "페이스", fmtPace(Run.nowPace(now)), CORAL)
        cell(cv, cx + 18 * u, 58 * u, "심박", if (hr > 0) "$hr" else "-", Color.WHITE)
        heart(cv, cx + 18 * u - 5.6f * u, 56.7f * u, 1.3f * u, RED)
        val J = Run.judge(); val g = Run.goal
        val bottom = when {
            Run.goalDone -> "목표 달성! 평균 ${fmtPace(Run.avgPace())}"
            J != null && g.k == "dist" -> "완주 예상 ${fmtTime(J.pred.toLong())}"
            J != null && g.k == "time" -> "예상 거리 ${fmtDist(J.pred)}"
            Run.cadNow(now) != null -> "케이던스 ${Run.cadNow(now)} · 평균 ${fmtPace(Run.avgPace())}"
            else -> "평균 페이스 ${fmtPace(Run.avgPace())}"
        }
        pill(cv, bottom, 87f * u, if (Run.goalDone) GOLD else BLUE, 3.9f * u)
    }
    private fun cell(cv: Canvas, x: Float, y: Float, lab: String, v: String, col: Int) {
        text(cv, lab, x, y, 3.8f * u, MUTED); text(cv, v, x, y + 15 * u, 14.5f * u, col, true, true, max = 0.33f)
    }

    // ---------- C안 · 코치 신호등 (앞서면 하늘색, 늦으면 산호색 바탕) ----------
    private fun pageC(cv: Canvas, now: Long) {
        val g = Run.goal; val J = Run.judge(); val d = J?.diff
        var title: String; var big: String; var sub: String; var col: Int
        when {
            Run.goalDone -> { title = "목표 달성!"; big = fmtKm(Run.walk) + "km"; sub = "달린 시간 ${fmtTime(Run.moving)}"; col = GOLD }
            J == null -> { title = if (g.k == "free") "평균 페이스" else "조금 더 달리면 나와요"; big = fmtPace(Run.avgPace()); sub = if (g.k == "free") "자유 달리기" else "목표 ${g.label()}"; col = MUTED }
            g.k == "dist" && d == null -> { title = "완주 예상"; big = fmtTime(J.pred.toLong()); sub = "목표 ${g.label()}"; col = BLUE }
            g.k == "time" && d == null -> { title = "예상 거리"; big = fmtDist(J.pred); sub = "${minLabel(g.v.toInt())} 동안"; col = BLUE }
            g.k == "dist" -> {
                val ok = d!! >= -J.near; col = if (ok) BLUE else LATE
                title = if (abs(d) <= J.near) "목표와 딱 맞아요" else if (d > 0) "목표 안에 들어와요" else "목표보다 늦어요"
                big = (if (d >= 0) "−" else "+") + fmtTime(abs(d).toLong()).trimStart('0').let { if (it.startsWith(":")) "0$it" else it }
                sub = "완주 예상 ${fmtTime(J.pred.toLong())} · 목표 ${fmtTime(J.target.toLong())}"
            }
            else -> {
                val ok = d!! >= -J.near; col = if (ok) BLUE else LATE
                title = if (abs(d) <= J.near) "목표 거리와 딱 맞아요" else if (d > 0) "목표보다 더 가요" else "목표 거리에 모자라요"
                big = (if (d >= 0) "+" else "−") + fmtDist(abs(d))
                sub = "예상 ${fmtDist(J.pred)} · 목표 ${fmtDist(J.target)}"
            }
        }
        val base = when (col) { LATE -> Color.parseColor("#4A1E10"); GOLD -> Color.parseColor("#4A3B10"); MUTED -> Color.parseColor("#1A1E24"); else -> Color.parseColor("#0E3A55") }
        paint(base); p.shader = RadialGradient(cx, 34 * u, 62 * u, base, Color.BLACK, Shader.TileMode.CLAMP); cv.drawCircle(cx, 50 * u, 75 * u, p); p.shader = null
        if (g.k != "free") ring(cv, frac(), col, col, 46.5f * u, 2.2f * u)
        val hr = Run.hrNow(now)
        text(cv, "${fmtKm(Run.walk)}km · ${fmtTime(Run.liveMoving(now))}" + if (hr > 0) " · ♥$hr" else "", cx, 17 * u, 4.2f * u, MUTED, num = true, max = 0.6f)
        pill(cv, title, 27 * u, col, 4.4f * u)
        text(cv, big, cx, 55 * u, 24 * u, col, true, true, max = 0.74f)
        text(cv, sub, cx, 64 * u, 4f * u, MUTED, max = 0.74f)
        bigWithUnit(cv, fmtPace(Run.nowPace(now)), "/km", 80 * u, 11 * u, 4 * u, MUTED)
    }

    // ---------- 1km 구간 (막대가 길수록 빠른 구간, 가장 빠른 곳은 산호색) ----------
    private fun pageSplits(cv: Canvas) {
        text(cv, "1km 구간", cx, 17 * u, 4.8f * u, CORAL, true)
        val sp = Run.splits
        if (sp.isEmpty()) text(cv, "1km를 달리면 여기에 쌓여요", cx, 47 * u, 4.6f * u, MUTED)
        else {
            val lo = sp.minOrNull() ?: 0L; val hi = sp.maxOrNull() ?: 0L; val show = sp.withIndex().toList().takeLast(5)
            show.forEachIndexed { i, (k, ms) ->
                val y = 27 * u + i * 9 * u; val best = ms == lo && sp.size > 1
                text(cv, "${k + 1}", 22 * u, y + 2.2f * u, 4.4f * u, MUTED, true, true, Paint.Align.RIGHT)
                val f = 0.45f + 0.55f * (hi - ms).toFloat() / maxOf(1L, hi - lo).toFloat()
                cv.drawRoundRect(RectF(25 * u, y - 1.6f * u, 59 * u, y + 2f * u), 1.8f * u, 1.8f * u, paint(TRACK))
                cv.drawRoundRect(RectF(25 * u, y - 1.6f * u, 25 * u + 34 * u * f, y + 2f * u), 1.8f * u, 1.8f * u, paint(if (best) CORAL else BLUE))
                text(cv, fmtPace(ms.toDouble()), 78 * u, y + 2.4f * u, 6.2f * u, if (best) CORAL else Color.WHITE, true, true, Paint.Align.RIGHT)
            }
        }
        val avgHr = Run.hrAvg(); val cad = Run.cadAvg()
        text(cv, "평균 ${fmtPace(Run.avgPace())}" + (if (avgHr > 0) " · ♥ 평균 $avgHr · 최고 ${Run.hrMax}" else ""), cx, 78 * u, 3.9f * u, MUTED, max = 0.7f)
        if (cad != null) text(cv, "케이던스 $cad · ${Run.steps}걸음", cx, 85 * u, 3.9f * u, MUTED, max = 0.6f)
    }

    // ---------- 멈춤 · 끝내기 (끝내기는 1.5초 꾹) ----------
    private fun btnL() = floatArrayOf(cx - 19 * u, 50 * u, 15.5f * u)
    private fun btnR() = floatArrayOf(cx + 19 * u, 50 * u, 15.5f * u)
    private fun pageCtl(cv: Canvas, now: Long) {
        pill(cv, if (Run.voice) "목소리 코치 켬" else "목소리 코치 끔", 19 * u, if (Run.voice) BLUE else MUTED, 4f * u)
        val L = btnL(); val R = btnR()
        if (Run.manualPause) {   // 다시 달리기(하늘색 동그라미 + 세모)
            cv.drawCircle(L[0], L[1], L[2], paint(BLUE))
            cv.drawPath(Path().apply { moveTo(L[0] - 3.6f * u, L[1] - 6 * u); lineTo(L[0] - 3.6f * u, L[1] + 6 * u); lineTo(L[0] + 6 * u, L[1]); close() }, paint(INK))
        } else {
            cv.drawCircle(L[0], L[1], L[2], paint(LINE))
            paint(Color.WHITE); cv.drawRoundRect(RectF(L[0] - 4.2f * u, L[1] - 6 * u, L[0] - 1.2f * u, L[1] + 6 * u), u, u, p); cv.drawRoundRect(RectF(L[0] + 1.2f * u, L[1] - 6 * u, L[0] + 4.2f * u, L[1] + 6 * u), u, u, p)
        }
        cv.drawCircle(R[0], R[1], R[2], paint(CORAL))
        cv.drawRoundRect(RectF(R[0] - 5 * u, R[1] - 5 * u, R[0] + 5 * u, R[1] + 5 * u), 1.6f * u, 1.6f * u, paint(INK))
        if (holdStart > 0) {
            val f = ((now - holdStart).toFloat() / HOLD_MS).coerceIn(0f, 1f); val rr = R[2] + 2.6f * u
            paint(Color.WHITE); p.style = Paint.Style.STROKE; p.strokeWidth = 1.8f * u; p.strokeCap = Paint.Cap.ROUND
            cv.drawArc(RectF(R[0] - rr, R[1] - rr, R[0] + rr, R[1] + rr), -90f, 360 * f, false, p)
            if (f >= 1f) { holdStart = 0; post { onFinish() } }
        }
        text(cv, if (Run.manualPause) "다시 달리기" else "멈춤", L[0], 73 * u, 4.6f * u, Color.WHITE, true, max = 0.34f)
        text(cv, "끝내기", R[0], 73 * u, 4.6f * u, Color.WHITE, true)
        text(cv, "끝내기는 1.5초 꾹 누르세요", cx, 82 * u, 3.9f * u, MUTED)
    }

    // ---------- 화면이 어두워졌을 때(앰비언트): 선과 글자만, 숫자 크게 ----------
    private fun pageAmbient(cv: Canvas, now: Long) {
        if (Run.goal.k != "free") {
            paint(Color.GRAY); p.style = Paint.Style.STROKE; p.strokeWidth = 1.2f * u; val r = 46.5f * u
            cv.drawArc(RectF(cx - r, cx - r, cx + r, cx + r), -90f, 360f * frac().coerceIn(0f, 1f), false, p)
        }
        text(cv, clock(), cx, 20 * u, 5 * u, Color.LTGRAY, true, true)
        bigWithUnit(cv, fmtKm(Run.walk), "km", 57 * u, 31 * u, 6 * u, Color.LTGRAY)
        text(cv, "${fmtTime(Run.liveMoving(now))}   ${fmtPace(Run.nowPace(now))}", cx, 76 * u, 9 * u, Color.WHITE, true, true)
    }

    // ---------- 손가락 ----------
    override fun onTouchEvent(e: MotionEvent): Boolean {
        val uu = min(width, height) / 100f
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                downX = e.x; downY = e.y; downT = System.currentTimeMillis()
                if (page == 4) { val R = btnR(); if (hypot(e.x - R[0], e.y - R[1]) < R[2] * 1.15f) { holdStart = downT; invalidate() } }
            }
            MotionEvent.ACTION_MOVE -> if (holdStart > 0 && hypot(e.x - downX, e.y - downY) > 12 * uu) { holdStart = 0; invalidate() }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                val dx = e.x - downX; val wasHold = holdStart > 0; holdStart = 0
                if (abs(dx) > width * 0.16f && abs(dx) > abs(e.y - downY)) { page = (page + (if (dx < 0) 1 else -1) + PAGES) % PAGES; if (page <= 2) Store.setPage(context, page); invalidate(); return true }
                if (wasHold) { invalidate(); return true }
                if (e.actionMasked == MotionEvent.ACTION_UP && page == 4 && hypot(dx, e.y - downY) < 8 * uu) {
                    val L = btnL()
                    if (hypot(e.x - L[0], e.y - L[1]) < L[2] * 1.15f) { Run.setPause(!Run.manualPause); performClick() }
                    else if (e.y < 30 * uu) { Run.voice = !Run.voice; Store.setVoice(context, Run.voice) }
                }
                invalidate()
            }
        }
        return true
    }
    override fun performClick(): Boolean { super.performClick(); return true }
}
