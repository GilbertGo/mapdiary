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
import kotlin.math.roundToInt
import kotlin.math.sin

// 달리는 중 화면 (둥근 시계 화면에 그려요). 옆으로 밀어 넘겨요:
// 달리기 · 목표(목표 있을 때) · 몸(심박·케이던스) · 1km 구간 · 멈춤·끝내기
// 2026-10-18 새 디자인(사용자 '이쁘게, 시인성 좋게, 지금은 초보티 나'): 검은 바탕에 흰 큰 숫자(좁은 굵은 글꼴, 숫자 폭 고정),
// 휴대폰 MPD 바닷가 색(산호 #FF8A4C · 하늘 #4FC3F7), 테두리 링·알약 딱지·그린 아이콘(이모지 안 씀)
class RunView(c: Context, private val onFinish: () -> Unit) : View(c) {
    companion object {
        const val P_MAIN = 0; const val P_COACH = 1; const val P_BODY = 2; const val P_SPLIT = 3; const val P_CTL = 4; const val P_ZONE = 5; const val P_GRAPH = 6; const val P_FORM = 7
        // 심박 존 색: 존1 회색 · 존2 하늘 · 존3 금 · 존4 산호 · 존5 빨강
        val ZONE = intArrayOf(Color.parseColor("#9AA5B4"), Color.parseColor("#4FC3F7"), Color.parseColor("#FFD166"), Color.parseColor("#FF8A4C"), Color.parseColor("#FF4D5E"))
        val ZNAME = arrayOf("회복", "유산소", "템포", "역치", "최대")
        val CORAL = Color.parseColor("#FF8A4C"); val BLUE = Color.parseColor("#4FC3F7"); val GOLD = Color.parseColor("#FFD166")
        val RED = Color.parseColor("#FF4D5E"); val LATE = Color.parseColor("#FF7A59"); val MUTED = Color.parseColor("#8D97A5")
        val SURF = Color.parseColor("#16191E"); val LINE = Color.parseColor("#2A2F37"); val TRACK = Color.parseColor("#22262D")
        val INK = Color.parseColor("#1A0D06")
        val CADC = Color.parseColor("#C3A6FF")   // 케이던스 보라
        val ALTC = Color.parseColor("#D7E3F0")   // 고도 옅은 은빛(녹색·누런색 안 씀)
        // 예전 이름(시작 화면 등에서 써요)
        val ORANGE = CORAL; val GREEN = BLUE; val PINE = Color.parseColor("#2A2F37")
        fun alpha(c: Int, a: Int) = (c and 0xFFFFFF) or (a shl 24)
    }
    var page = Store.page(c).coerceIn(0, 3)
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

    // 화면 차례: 달리기 → 목표(목표가 있을 때만) → 몸(심박·케이던스) → 1km 구간 → 멈춤·끝내기
    // 2026-10-19 정리(사용자 '중복되는 내용, 조잡해, 작은 글씨 안 보여'): 한 화면에 한 가지 일만, 같은 숫자는 한 곳에만,
    // 글자는 가장 작아도 화면의 5%(이름표), 색은 화면마다 강조 하나
    private fun pages(): List<Int> = if (Run.goal.k == "free") listOf(P_MAIN, P_BODY, P_ZONE, P_GRAPH, P_FORM, P_SPLIT, P_CTL) else listOf(P_MAIN, P_COACH, P_BODY, P_ZONE, P_GRAPH, P_FORM, P_SPLIT, P_CTL)
    private val LAB = 5f   // 이름표 글자 크기(u)

    override fun onDraw(cv: Canvas) {
        val now = System.currentTimeMillis(); W = width.toFloat(); cx = W / 2; u = min(W, height.toFloat()) / 100f   // u = 화면 크기의 1%
        cv.drawColor(Color.BLACK)
        val ps = pages(); if (page !in ps) page = P_MAIN
        if (ambient) pageAmbient(cv, now)
        else when (page) {
            P_MAIN -> pageMain(cv, now)
            P_COACH -> pageCoach(cv)
            P_BODY -> pageBody(cv, now)
            P_ZONE -> pageZones(cv)
            P_GRAPH -> pageGraph(cv, now)
            P_FORM -> pageForm(cv, now)
            P_SPLIT -> pageSplits(cv)
            else -> pageCtl(cv, now)
        }
        // 아래 점: 몇 번째 화면인지(지금 화면은 길쭉하게)
        if (!ambient) ps.forEachIndexed { i, id ->
            val x = cx + (i - (ps.size - 1) / 2f) * 3.6f * u; val y = 96f * u
            if (id == page) cv.drawRoundRect(RectF(x - 1.9f * u, y - 1f * u, x + 1.9f * u, y + 1f * u), u, u, paint(Color.WHITE))
            else cv.drawCircle(x, y, .9f * u, paint(Color.parseColor("#4A515C")))
        }
        if (!ambient && (Run.running || holdStart > 0)) postInvalidateDelayed(if (holdStart > 0) 30 else 1000)
    }

    // 기록이 순조로우면 null, 아니면 알릴 말
    private fun alert(now: Long): Pair<String, Int>? = when {
        Run.manualPause -> "잠시 멈춤" to CORAL
        !Run.gpsOn || Run.lastAcc < 0 -> "GPS 찾는 중" to MUTED
        Run.lastAcc > TRACK_MAX_ACC -> "GPS 약함" to LATE
        Run.paused(now) -> "멈춰 있어요" to CORAL
        else -> null
    }
    private fun frac(): Float { val g = Run.goal; return when (g.k) { "dist" -> (Run.walk / (g.v * 1000)).toFloat(); "time" -> (Run.moving / (g.v * 60000)).toFloat(); else -> ((Run.walk % 1000) / 1000).toFloat() } }
    private fun leftText(): String { val g = Run.goal; return when (g.k) { "dist" -> "${fmtDist(g.v * 1000 - Run.walk)} 남음"; "time" -> "${fmtTime((g.v * 60000 - Run.moving).toLong())} 남음"; else -> "" } }
    // 큰 숫자 + 작은 단위를 가운데 맞춰 그려요
    private fun bigWithUnit(cv: Canvas, big: String, unit: String, y: Float, size: Float, unitSize: Float, unitCol: Int, col: Int = Color.WHITE) {
        val mw = measure(big, size); val sz = if (mw > W * 0.62f) size * W * 0.62f / mw else size; val bw = min(mw, W * 0.62f)
        val kw = measure(unit, unitSize) + 1.2f * u; val x0 = cx - (bw + kw) / 2
        text(cv, big, x0, y, sz, col, true, true, Paint.Align.LEFT); text(cv, unit, x0 + bw + 1.2f * u, y, unitSize, unitCol, true, true, Paint.Align.LEFT)
    }

    // ---------- 1. 달리기: 링(목표까지, 자유 달리기는 이번 1km) · 거리 크게 · 시간 | 지금 페이스 ----------
    private fun pageMain(cv: Canvas, now: Long) {
        when { Run.goalDone -> ring(cv, frac(), GOLD, GOLD); Run.goal.k == "free" -> ring(cv, frac(), BLUE, BLUE); else -> ring(cv, frac(), CORAL, Color.parseColor("#FFB066")) }
        val al = alert(now)
        val hr = Run.hrNow(now)
        if (al != null) pill(cv, al.first, 18 * u, al.second, LAB * u)
        else if (hr > 0) { val z = Run.zoneOf(hr); pill(cv, "존${z + 1} · $hr", 18 * u, ZONE[z], 5.4f * u) }
        else text(cv, clock(), cx, 20 * u, 6 * u, MUTED, true, true)
        bigWithUnit(cv, fmtKm(Run.walk), "km", 55 * u, 30 * u, 7 * u, CORAL)
        if (Run.goal.k != "free") text(cv, if (Run.goalDone) "목표 달성!" else leftText(), cx, 64 * u, LAB * u, if (Run.goalDone) GOLD else MUTED, true, max = 0.6f)
        cv.drawRect(cx - .2f * u, 70 * u, cx + .2f * u, 87 * u, paint(LINE))
        text(cv, fmtTime(Run.liveMoving(now)), cx - 16 * u, 80 * u, 11 * u, Color.WHITE, true, true, max = 0.3f)
        text(cv, "시간", cx - 16 * u, 87 * u, LAB * u, MUTED)
        text(cv, fmtPace(Run.nowPace(now)), cx + 16 * u, 80 * u, 11 * u, Color.WHITE, true, true, max = 0.3f)
        text(cv, "페이스", cx + 16 * u, 87 * u, LAB * u, MUTED)
    }

    // ---------- 2. 목표: 이대로면 목표보다 얼마나 빠른지/늦는지 (앞서면 하늘색, 늦으면 산호색) ----------
    private fun pageCoach(cv: Canvas) {
        val g = Run.goal; val J = Run.judge(); val d = J?.diff
        var title: String; var big: String; var sub: String; var col: Int
        when {
            Run.goalDone -> { title = "목표 달성!"; big = g.label(); sub = "평균 ${fmtPace(Run.avgPace())}"; col = GOLD }
            J == null -> { title = "목표 ${g.label()}"; big = "…"; sub = "조금 더 달리면 예상이 나와요"; col = MUTED }
            g.k == "dist" && d == null -> { title = "완주 예상"; big = fmtTime(J.pred.toLong()); sub = "목표 ${g.label()}"; col = BLUE }
            g.k == "time" && d == null -> { title = "예상 거리"; big = fmtDist(J.pred); sub = "${minLabel(g.v.toInt())} 동안"; col = BLUE }
            g.k == "dist" -> {
                col = if (d!! >= -J.near) BLUE else LATE
                title = if (abs(d) <= J.near) "딱 맞아요" else if (d > 0) "빨라요" else "늦어요"
                big = (if (d >= 0) "−" else "+") + fmtTime(abs(d).toLong()).trimStart('0').let { if (it.startsWith(":")) "0$it" else it }
                sub = if (d < -J.near && J.need > 0) "필요 페이스 ${fmtPace(J.need)}" else "완주 예상 ${fmtTime(J.pred.toLong())}"
            }
            else -> {
                col = if (d!! >= -J.near) BLUE else LATE
                title = if (abs(d) <= J.near) "딱 맞아요" else if (d > 0) "더 가요" else "모자라요"
                big = (if (d >= 0) "+" else "−") + fmtDist(abs(d))
                sub = "예상 ${fmtDist(J.pred)}"
            }
        }
        val base = when (col) { LATE -> Color.parseColor("#3E1A0E"); GOLD -> Color.parseColor("#3E320E"); MUTED -> Color.parseColor("#15191E"); else -> Color.parseColor("#0B3049") }
        paint(base); p.shader = RadialGradient(cx, 40 * u, 60 * u, base, Color.BLACK, Shader.TileMode.CLAMP); cv.drawCircle(cx, 50 * u, 75 * u, p); p.shader = null
        ring(cv, frac(), col, col, 46.5f * u, 2.4f * u)
        text(cv, "목표 ${g.label()}", cx, 22 * u, LAB * u, MUTED, true, max = 0.6f)
        pill(cv, title, 32 * u, col, 5.6f * u)
        text(cv, big, cx, 60 * u, 23 * u, col, true, true, max = 0.74f)
        text(cv, sub, cx, 72 * u, 5.6f * u, Color.WHITE, true, max = 0.7f)
    }

    // ---------- 3. 몸: 지금 존 · 심박 크게 · 존 막대(어디쯤인지) · 존2 범위 · 케이던스 ----------
    private fun pageBody(cv: Canvas, now: Long) {
        val hr = Run.hrNow(now); val z = if (hr > 0) Run.zoneOf(hr) else -1
        if (z >= 0) pill(cv, "존${z + 1} · ${ZNAME[z]}", 20 * u, ZONE[z], 5.4f * u) else text(cv, "심박 재는 중", cx, 21 * u, LAB * u, MUTED, true)
        val s = if (hr > 0) "$hr" else "-"; val sz = 22 * u; val tw = measure(s, sz) + 9 * u; val x0 = cx - tw / 2
        heart(cv, x0 + 3 * u, 40 * u, 3.2f * u, if (z >= 0) ZONE[z] else RED)
        text(cv, s, x0 + 8.5f * u, 48 * u, sz, Color.WHITE, true, true, Paint.Align.LEFT)
        // 존 막대: 다섯 칸, 지금 존은 진하게 + 흰 점이 그 존 안 어디쯤인지
        val L = 17 * u; val Wd = 66 * u; val gap = .8f * u; val cw = (Wd - gap * 4) / 5; val y = 55.5f * u; val h = 2.8f * u
        for (k in 0 until 5) { val x = L + k * (cw + gap)
            cv.drawRoundRect(RectF(x, y - h / 2, x + cw, y + h / 2), h / 2, h / 2, paint(if (k == z) ZONE[k] else alpha(ZONE[k], 0x50))) }
        if (z >= 0) { val f = ((hr.toDouble() / Run.hrMaxSet - (.5 + .1 * z)) / .1).coerceIn(0.0, 1.0).toFloat(); val zz = if (hr.toDouble() / Run.hrMaxSet < .5) 0f else f
            val x = L + z * (cw + gap) + cw * zz; cv.drawCircle(x, y, 2.2f * u, paint(Color.WHITE)); cv.drawCircle(x, y, 1.2f * u, paint(ZONE[z])) }
        text(cv, "존2 ${Run.zoneLo(1)}~${Run.zoneLo(2) - 1}", cx, 64 * u, LAB * u, BLUE, true)
        cv.drawRect(26 * u, 68 * u, 74 * u, 68.3f * u, paint(LINE))
        val cad = Run.cadNow(now)
        if (Cadence.kind != Cadence.OFF) bigWithUnit(cv, cad?.toString() ?: "-", " / ${Cadence.spm}", 80 * u, 11 * u, 5f * u, CORAL)
        else bigWithUnit(cv, cad?.toString() ?: "-", "spm", 80 * u, 11 * u, 5f * u, MUTED)
        text(cv, "케이던스", cx, 87 * u, LAB * u, MUTED)
    }

    // ---------- 3-2. 존별 시간 (존5가 위, 존2는 이름을 흰색으로) + 평균·최고 심박 ----------
    private fun pageZones(cv: Canvas) {
        text(cv, "심박 존 시간", cx, 20 * u, 5.6f * u, Color.WHITE, true)
        val mx = (Run.zoneMs.maxOrNull() ?: 0L).coerceAtLeast(1L)
        for (i in 0 until 5) { val k = 4 - i; val y = 30 * u + i * 10.5f * u; val ms = Run.zoneMs[k]
            text(cv, "존${k + 1}", 24 * u, y + 2.3f * u, 5.4f * u, if (k == 1) Color.WHITE else ZONE[k], true, false, Paint.Align.RIGHT)
            cv.drawRoundRect(RectF(27 * u, y - 1.6f * u, 55 * u, y + 1.6f * u), 1.6f * u, 1.6f * u, paint(TRACK))
            if (ms > 0) cv.drawRoundRect(RectF(27 * u, y - 1.6f * u, 27 * u + 28 * u * (ms.toFloat() / mx).coerceAtLeast(.06f), y + 1.6f * u), 1.6f * u, 1.6f * u, paint(ZONE[k]))
            text(cv, fmtTime(ms), 80 * u, y + 2.5f * u, 6.4f * u, if (k == 1) Color.WHITE else MUTED, true, true, Paint.Align.RIGHT)
        }
        text(cv, if (Run.hrAvg() > 0) "평균 ${Run.hrAvg()} · 최고 ${Run.hrMax}" else "심박이 아직 없어요", cx, 87 * u, LAB * u, MUTED, true)
    }

    // ---------- 심박·페이스 그래프: 파란 띠 = 존2, 빨간 선 = 심박, 산호 선 = 페이스(위로 갈수록 빠름) ----------
    private fun pageGraph(cv: Canvas, now: Long) {
        // 2026-10-21 사용자가 달리며 찍은 영상을 보내며 '시인성 개선': 선 세 개가 한 칸에 겹쳐 무엇이 무엇인지 안 보였음
        // → 칸을 셋으로 나눔(위 큰 칸 심박 · 가운데 페이스 · 아래 케이던스), 선은 굵고 부드럽게, 심박 선은 그때 존 색으로,
        //   칸마다 왼쪽에 이름(그 선 색), 오른쪽 끝 점 옆에 지금 값. 위 색 안내 줄은 뺌(칸 이름이 대신)
        val win = 20 * 60000L; val el = now - Run.startAt
        val hrNow = Run.hrNow(now); val paceNow = Run.nowPace(now)
        val cadNow = Run.cadNow(now)
        val all = Run.series.filter { it.t >= el - win } + Run.Sample(el, hrNow, paceNow, cadNow)
        paint(Color.BLACK); cv.drawCircle(cx, cx, cx, p)
        // 2026-10-21 사용자 '아래 값들을 오른편으로, 왼쪽 축 글씨 키워': 아래 세 칸 줄을 없애고 지금 값을 칸마다 오른쪽에,
        //   그만큼 칸을 위아래로 넓힘. 왼쪽 칸 이름은 크게(심박 5.4u · 페이스·케이던스 4.4u)
        val X0 = 25 * u; val X1 = 65 * u; val VX = 90 * u   // VX = 지금 값 오른쪽 끝
        val HR0 = 15 * u; val HR1 = 46 * u; val PC0 = 51 * u; val PC1 = 62 * u; val CD0 = 67 * u; val CD1 = 78 * u
        // 칸 바탕: 아주 옅은 둥근 판
        for ((t, b) in listOf(HR0 to HR1, PC0 to PC1, CD0 to CD1)) cv.drawRoundRect(RectF(X0 - 1.5f * u, t - 1.2f * u, X1 + 1.5f * u, b + 1.2f * u), 2f * u, 2f * u, paint(alpha(Color.WHITE, 0x12)))
        // 칸 이름은 칸 왼쪽 바깥에(선을 가리지 않게)
        text(cv, "심박", X0 - 2.4f * u, (HR0 + HR1) / 2 + 1.9f * u, 5.4f * u, Color.WHITE, true, align = Paint.Align.RIGHT)
        text(cv, "페이스", X0 - 2.4f * u, (PC0 + PC1) / 2 + 1.5f * u, 4.4f * u, CORAL, true, align = Paint.Align.RIGHT)
        text(cv, "고도", X0 - 2.4f * u, (CD0 + CD1) / 2 + 1.5f * u, 4.4f * u, ALTC, true, align = Paint.Align.RIGHT)
        val hs = all.filter { it.hr > 0 }
        val z2lo = Run.zoneLo(1); val z2hi = Run.zoneLo(2)
        val hLo = (minOf(hs.minOfOrNull { it.hr } ?: z2lo, z2lo) - 5).toFloat(); val hHi = (maxOf(hs.maxOfOrNull { it.hr } ?: z2hi, z2hi) + 5).toFloat()
        fun yH(h: Float) = HR1 - (HR1 - HR0) * ((h - hLo) / (hHi - hLo)).coerceIn(0f, 1f)
        // 존2 띠 + 오른쪽에 존 번호(그 존 높이 가운데)
        // 2026-10-23 사용자 '심박 존 별로 색깔 구분': 존마다 옅은 바탕 띠(존2만 조금 진하게) — 선도 그 존 색
        for (z in 0 until 5) { val lo = maxOf(Run.zoneLo(z).toFloat(), hLo); val hi = minOf(if (z == 4) hHi else Run.zoneLo(z + 1).toFloat(), hHi)
            if (hi > lo) cv.drawRect(X0, yH(hi), X1, yH(lo), paint(alpha(ZONE[z], if (z == 1) 0x34 else 0x16))) }
        for (z in 0 until 5) {
            val lo = maxOf(Run.zoneLo(z).toFloat(), hLo); val hi = minOf(if (z == 4) hHi else Run.zoneLo(z + 1).toFloat(), hHi)
            if (hi - lo < (hHi - hLo) * .12f) continue
            text(cv, "${z + 1}", X1 + 3.2f * u, yH((lo + hi) / 2) + 1.3f * u, 3.6f * u, ZONE[z], true, true)
        }
        if (all.size < 3 || hs.size < 2) {
            text(cv, "달리면 10초마다 그려져요", cx, (HR0 + HR1) / 2 + 1.5f * u, 4.4f * u, Color.parseColor("#C9D1DB"), true)
        } else {
            val t0 = all.first().t.toFloat(); val t1 = maxOf(all.last().t.toFloat(), t0 + 60000f)
            fun xOf(t: Long) = X0 + (X1 - X0) * (t - t0) / (t1 - t0)
            fun smooth(v: List<Double?>, k: Int) = v.indices.map { i -> if (v[i] == null) null else (maxOf(0, i - k)..minOf(v.size - 1, i + k)).mapNotNull { v[it] }.average() }
            fun stroke(c: Int, w: Float) { paint(c); p.style = Paint.Style.STROKE; p.strokeWidth = w; p.strokeJoin = Paint.Join.ROUND; p.strokeCap = Paint.Cap.ROUND }
            // 심박: 굵은 선, 구간마다 그때 존 색
            val hsm = smooth(hs.map { it.hr.toDouble() }, 2).map { it!!.toFloat() }
            for (i in 1 until hs.size) { stroke(ZONE[Run.zoneOf(hsm[i].roundToInt())], 1.1f * u)
                cv.drawLine(xOf(hs[i - 1].t), yH(hsm[i - 1]), xOf(hs[i].t), yH(hsm[i]), p) }
            val lx = xOf(hs.last().t); val ly = yH(hsm.last())
            cv.drawCircle(lx, ly, 1.7f * u, paint(Color.WHITE)); cv.drawCircle(lx, ly, 1.0f * u, paint(ZONE[Run.zoneOf(hs.last().hr)]))
            // 페이스(위가 빠름)
            val ps = smooth(all.map { it.pace?.takeIf { v -> v < 900000 } }, 3)
            val pv = ps.filterNotNull()
            if (pv.size >= 2) { val lo = pv.minOrNull()!! - 10000; val hi = pv.maxOrNull()!! + 10000
                val path = Path(); var first = true; var ex = 0f; var ey = 0f
                all.forEachIndexed { i, q -> val v = ps[i] ?: return@forEachIndexed; ex = xOf(q.t); ey = PC0 + (PC1 - PC0) * ((v - lo) / (hi - lo)).toFloat(); if (first) path.moveTo(ex, ey) else path.lineTo(ex, ey); first = false }
                stroke(CORAL, .85f * u); cv.drawPath(path, p); cv.drawCircle(ex, ey, 1.1f * u, paint(CORAL)) }
            else text(cv, "--", cx, PC1, 3.6f * u, MUTED, true)
            // 고도 (2026-10-23 사용자 '케이던스 빼고 고도를 넣어'): GPS 높이를 앞뒤 3점 평균, 아래를 옅게 채운 산 모양.
            //   GPS 높이는 몇 m씩 흔들려서 칸 높이는 적어도 20m로(평지가 산처럼 보이지 않게)
            val aps = Run.pts.filter { it.alt != null && it.t - Run.startAt >= el - win }
            if (aps.size >= 2) {
                val asm = smooth(aps.map { it.alt }, 3).map { it!! }
                var aLo = asm.minOrNull()!!; var aHi = asm.maxOrNull()!!
                if (aHi - aLo < 20) { val m = (aHi + aLo) / 2; aLo = m - 10; aHi = m + 10 }
                fun yA(a: Double) = (CD1 - (CD1 - CD0) * ((a - aLo) / (aHi - aLo)).coerceIn(0.0, 1.0)).toFloat()
                fun xA(p: Pt) = xOf(p.t - Run.startAt).coerceIn(X0, X1)
                val line = Path(); val fill = Path()
                aps.forEachIndexed { i, q -> val x = xA(q); val y = yA(asm[i]); if (i == 0) { line.moveTo(x, y); fill.moveTo(x, CD1); fill.lineTo(x, y) } else { line.lineTo(x, y); fill.lineTo(x, y) } }
                fill.lineTo(xA(aps.last()), CD1); fill.close()
                cv.drawPath(fill, paint(alpha(ALTC, 0x38)))
                stroke(ALTC, .85f * u); cv.drawPath(line, p); cv.drawCircle(xA(aps.last()), yA(asm.last()), 1.1f * u, paint(ALTC))
            } else text(cv, "--", cx, CD1, 3.6f * u, MUTED, true)
            // 시간: 처음 · 지금
            text(cv, if (el > win) "−20분" else "0분", X0, CD1 + 5.2f * u, 3.6f * u, MUTED, true, align = Paint.Align.LEFT)
            text(cv, "지금", X1, CD1 + 5.2f * u, 3.6f * u, MUTED, true, align = Paint.Align.RIGHT)
        }
        // 지금 값: 칸마다 오른쪽(심박은 존 색 + 아래 '존1')
        val zc = if (hrNow > 0) ZONE[Run.zoneOf(hrNow)] else MUTED
        val hy = (HR0 + HR1) / 2
        text(cv, if (hrNow > 0) "$hrNow" else "--", VX, hy + 2.4f * u, 8f * u, zc, true, true, Paint.Align.RIGHT, max = 0.16f)
        text(cv, if (hrNow > 0) "존${Run.zoneOf(hrNow) + 1}" else "심박", VX, hy + 7.4f * u, 3.8f * u, zc, true, align = Paint.Align.RIGHT)
        text(cv, if (paceNow != null) fmtPace(paceNow) else "--", VX, (PC0 + PC1) / 2 + 2.3f * u, 6.4f * u, CORAL, true, true, Paint.Align.RIGHT, max = 0.21f)
        // 고도: 지금 높이 + 아래 작게 오른 높이(처음부터, 4m 넘게 오를 때만 더함 — 휴대폰 elevStats와 같은 셈)
        val altNow = Run.pts.lastOrNull { it.alt != null }?.alt
        text(cv, if (altNow != null) "${altNow.roundToInt()}m" else "--", VX - 1.5f * u, (CD0 + CD1) / 2 + 2.3f * u, 6.4f * u, ALTC, true, true, Paint.Align.RIGHT, max = 0.19f)
        val up = altGain()
        if (up != null) text(cv, "↑ ${up}m", VX - 2.5f * u, CD1 + 2.2f * u, 3.6f * u, MUTED, true, true, Paint.Align.RIGHT)
    }

    // 오른 높이(m): gainOf(Report.kt, 휴대폰 elevStats와 같은 셈)
    private fun altGain(): Int? {
        val a = Run.pts.mapNotNull { it.alt }; if (a.size < 5) return null
        return gainOf(a)
    }

    // ---------- 달리기 자세: 케이던스 · 보폭 · 걸음 고르기 · 착지 충격 (손목 센서로 짐작) ----------
    private fun pageForm(cv: Canvas, now: Long) {
        text(cv, "달리기 자세", cx, 20 * u, 5.6f * u, Color.WHITE, true)
        cv.drawRect(cx - .15f * u, 26 * u, cx + .15f * u, 78 * u, paint(LINE)); cv.drawRect(16 * u, 51.8f * u, 84 * u, 52.1f * u, paint(LINE))
        val cad = Run.cadNow(now); val st = Run.stride(now); val reg = Run.formReg(now); val g = Run.formImpact(now)
        fun tag(v: Double?, good: Double, ok: Double, lowGood: Boolean, t: Array<String>): Pair<String, Int> = when {
            v == null -> "-" to MUTED
            if (lowGood) v <= good else v >= good -> t[0] to BLUE
            if (lowGood) v <= ok else v >= ok -> t[1] to GOLD
            else -> t[2] to CORAL }
        fcell(cv, cx - 17 * u, 32 * u, "케이던스", cad?.toString() ?: "-", tag(cad?.toDouble(), 170.0, 160.0, false, arrayOf("좋아요", "보통", "낮아요")))
        fcell(cv, cx + 17 * u, 32 * u, "보폭", if (st != null) String.format("%.2fm", st) else "-", (if (st != null) "참고" else "-") to MUTED)
        fcell(cv, cx - 17 * u, 58 * u, "걸음 고르기", if (reg != null) "${reg.roundToInt()}%" else "-", tag(reg, 4.0, 7.0, true, arrayOf("고르게", "보통", "흔들려요")))
        fcell(cv, cx + 17 * u, 58 * u, "착지 충격", if (g != null) String.format("%.1fG", g) else "-", tag(g, 3.0, 4.0, true, arrayOf("부드러워요", "보통", "세요")))
        val tip = when {
            cad != null && cad < 160 -> "보폭 줄이고 발을 빠르게"
            reg != null && reg > 7 -> "리듬을 일정하게"
            g != null && g > 4 -> "발을 살짝 내려놓듯"
            else -> "손목 센서로 짐작한 값"
        }
        text(cv, tip, cx, 87 * u, LAB * u, MUTED, true, max = 0.62f)
    }
    private fun fcell(cv: Canvas, x: Float, y: Float, lab: String, v: String, tg: Pair<String, Int>) {
        text(cv, lab, x, y, 4.6f * u, MUTED, true, max = 0.32f)
        text(cv, v, x, y + 11 * u, 10 * u, Color.WHITE, true, true, max = 0.32f)
        text(cv, tg.first, x, y + 17.5f * u, 4.6f * u, tg.second, true, max = 0.32f)
    }

    // ---------- 4. 1km 구간 (막대가 길수록 빠른 구간, 가장 빠른 곳은 산호색) ----------
    private fun pageSplits(cv: Canvas) {
        text(cv, "1km 구간", cx, 20 * u, 5.6f * u, Color.WHITE, true)
        val sp = Run.splits
        if (sp.isEmpty()) { text(cv, "1km를 달리면", cx, 47 * u, 5.6f * u, MUTED); text(cv, "여기에 쌓여요", cx, 55 * u, 5.6f * u, MUTED) }
        else {
            val lo = sp.minOrNull() ?: 0L; val hi = sp.maxOrNull() ?: 0L; val show = sp.withIndex().toList().takeLast(4)
            show.forEachIndexed { i, (k, ms) ->
                val y = 33 * u + i * 11 * u; val best = ms == lo && sp.size > 1
                text(cv, "${k + 1}", 21 * u, y + 2.4f * u, 6 * u, MUTED, true, true, Paint.Align.RIGHT)
                val f = 0.4f + 0.6f * (hi - ms).toFloat() / maxOf(1L, hi - lo).toFloat()
                cv.drawRoundRect(RectF(25 * u, y - 1.8f * u, 54 * u, y + 1.8f * u), 1.8f * u, 1.8f * u, paint(TRACK))
                cv.drawRoundRect(RectF(25 * u, y - 1.8f * u, 25 * u + 29 * u * f, y + 1.8f * u), 1.8f * u, 1.8f * u, paint(if (best) CORAL else BLUE))
                text(cv, fmtPace(ms.toDouble()), 81 * u, y + 2.8f * u, 7.6f * u, if (best) CORAL else Color.WHITE, true, true, Paint.Align.RIGHT)
            }
        }
        text(cv, "평균 ${fmtPace(Run.avgPace())}", cx, 86 * u, LAB * u, MUTED, true)
    }

    // ---------- 5. 멈춤 · 끝내기 (끝내기는 1.5초 꾹) + 목소리·가이드 켜고 끄기 ----------
    private fun btnL() = floatArrayOf(cx - 18.5f * u, 48 * u, 14f * u)
    private fun btnR() = floatArrayOf(cx + 18.5f * u, 48 * u, 14f * u)
    private fun pageCtl(cv: Canvas, now: Long) {
        pill(cv, if (Run.voice) "목소리 켬" else "목소리 끔", 19 * u, if (Run.voice) BLUE else MUTED, LAB * u)
        val L = btnL(); val R = btnR()
        if (Run.manualPause) {   // 다시 달리기(하늘색 동그라미 + 세모)
            cv.drawCircle(L[0], L[1], L[2], paint(BLUE))
            cv.drawPath(Path().apply { moveTo(L[0] - 3.4f * u, L[1] - 5.6f * u); lineTo(L[0] - 3.4f * u, L[1] + 5.6f * u); lineTo(L[0] + 5.6f * u, L[1]); close() }, paint(INK))
        } else {
            cv.drawCircle(L[0], L[1], L[2], paint(LINE))
            paint(Color.WHITE); cv.drawRoundRect(RectF(L[0] - 4f * u, L[1] - 5.6f * u, L[0] - 1.2f * u, L[1] + 5.6f * u), u, u, p); cv.drawRoundRect(RectF(L[0] + 1.2f * u, L[1] - 5.6f * u, L[0] + 4f * u, L[1] + 5.6f * u), u, u, p)
        }
        cv.drawCircle(R[0], R[1], R[2], paint(CORAL))
        cv.drawRoundRect(RectF(R[0] - 4.6f * u, R[1] - 4.6f * u, R[0] + 4.6f * u, R[1] + 4.6f * u), 1.5f * u, 1.5f * u, paint(INK))
        if (holdStart > 0) {
            val f = ((now - holdStart).toFloat() / HOLD_MS).coerceIn(0f, 1f); val rr = R[2] + 2.4f * u
            paint(Color.WHITE); p.style = Paint.Style.STROKE; p.strokeWidth = 1.8f * u; p.strokeCap = Paint.Cap.ROUND
            cv.drawArc(RectF(R[0] - rr, R[1] - rr, R[0] + rr, R[1] + rr), -90f, 360 * f, false, p)
            if (f >= 1f) { holdStart = 0; post { onFinish() } }
        }
        text(cv, if (Run.manualPause) "다시" else "멈춤", L[0], 70 * u, 5.4f * u, Color.WHITE, true, max = 0.34f)
        text(cv, "끝내기", R[0], 70 * u, 5.4f * u, Color.WHITE, true)
        text(cv, "1.5초 꾹", R[0], 76 * u, 4.6f * u, MUTED)
        pill(cv, if (Cadence.kind != Cadence.OFF) "가이드 ${Cadence.spm} 켬" else "가이드 끔", 87 * u, if (Cadence.kind != Cadence.OFF) CORAL else MUTED, LAB * u)
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
                if (page == P_CTL) { val R = btnR(); if (hypot(e.x - R[0], e.y - R[1]) < R[2] * 1.15f) { holdStart = downT; invalidate() } }
            }
            MotionEvent.ACTION_MOVE -> if (holdStart > 0 && hypot(e.x - downX, e.y - downY) > 12 * uu) { holdStart = 0; invalidate() }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                val dx = e.x - downX; val wasHold = holdStart > 0; holdStart = 0
                if (abs(dx) > width * 0.16f && abs(dx) > abs(e.y - downY)) { val ps = pages(); val i = ps.indexOf(page).coerceAtLeast(0)
                    page = ps[(i + (if (dx < 0) 1 else -1) + ps.size) % ps.size]; if (page != P_CTL) Store.setPage(context, page); invalidate(); return true }
                if (wasHold) { invalidate(); return true }
                if (e.actionMasked == MotionEvent.ACTION_UP && page == P_CTL && hypot(dx, e.y - downY) < 8 * uu) {
                    val L = btnL()
                    if (hypot(e.x - L[0], e.y - L[1]) < L[2] * 1.15f) { Run.setPause(!Run.manualPause); performClick() }
                    else if (e.y < 30 * uu) { Run.voice = !Run.voice; Store.setVoice(context, Run.voice) }
                    else if (e.y > 83 * uu) Cadence.set(context, if (Cadence.kind != Cadence.OFF) Cadence.OFF else Cadence.last)
                }
                invalidate()
            }
        }
        return true
    }
    override fun performClick(): Boolean { super.performClick(); return true }
}
