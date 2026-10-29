package io.github.gilbertgo.mdrun

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.view.MotionEvent
import android.view.View
import kotlin.math.abs
import kotlin.math.min

// ▶ 러닝 시작을 누르면 나오는 목표 세팅 (2026-10-19, 휴대폰 '러닝 준비' 화면과 같은 항목, 시계라 한 장에 한 가지):
// ① 이번 러닝 목표(거리, − + · 칩) → ② 목표 시간(− + · 칩, 페이스 계산) → ③ 케이던스 비프(− + · 방식) + 음성 안내 → ④ 출발(사진 · 요약 · ▶ 출발)
// 옆으로 밀어 넘기고, 첫 장에서 오른쪽으로 밀면 첫 화면으로. 고른 값은 바로 저장(다음에도 그대로)
class SetupView(c: Context, private val onGo: () -> Unit, private val onBack: () -> Unit) : View(c) {
    private val p = Paint(Paint.ANTI_ALIAS_FLAG)
    private val numBold = Typeface.create("sans-serif-condensed", Typeface.BOLD)
    private val krBold = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
    private val CORAL = RunView.CORAL; private val MUTED = RunView.MUTED; private val SURF = Color.parseColor("#22262D")
    private val photo by lazy { Link.hero(context) }
    var page = 0   // order 안의 차례
    // 등산은 케이던스 비프 장(2)을 건너뛰어요(음성 안내는 마지막 장에)
    private val order = if (Run.hike) listOf(0, 1, 3) else listOf(0, 1, 2, 3)
    private val last get() = order.size - 1
    private val sportTag get() = if (Run.hike) "HIKE" else "OUTDOOR RUN"
    private var km = 0.0; private var min = 0
    private var W = 0f; private var cx = 0f; private var u = 0f
    private val hits = mutableListOf<Pair<RectF, () -> Unit>>()

    init {
        val g = Store.goal(c)
        when (g.k) { "dist" -> { km = g.v; min = g.t / 60 }; "time" -> { km = 0.0; min = g.v.toInt() } }
    }
    private fun save() = Store.setGoal(context, if (km > 0) Goal("dist", km, min * 60) else if (min > 0) Goal("time", min.toDouble()) else Goal())
    private fun kmTxt() = if (km <= 0) "자유" else if (km == 21.0975) "21.1" else if (km == 42.195) "42.2" else String.format("%.1f", km)

    private fun paint(color: Int) = p.apply { reset(); isAntiAlias = true; this.color = color }
    private fun text(cv: Canvas, s: String, x: Float, y: Float, size: Float, color: Int, b: Boolean = false, num: Boolean = false) {
        paint(color); p.textSize = size; p.typeface = if (num) numBold else if (b) krBold else Typeface.DEFAULT; if (num) p.fontFeatureSettings = "tnum"
        p.textAlign = Paint.Align.CENTER; cv.drawText(s, x, y, p)
    }
    private fun measure(s: String, size: Float) = paint(Color.WHITE).apply { textSize = size; typeface = krBold }.measureText(s)
    private fun mono(cv: Canvas, s: String, y: Float) { paint(Color.parseColor("#FFD2B8")); p.textSize = 3.4f * u; p.typeface = Typeface.MONOSPACE; p.letterSpacing = .16f; p.textAlign = Paint.Align.CENTER; cv.drawText(s, cx, y, p) }
    // − 큰 숫자 + 줄
    private fun stepper(cv: Canvas, big: String, unit: String, y: Float, minus: () -> Unit, plus: () -> Unit) {
        text(cv, big, cx, y + 6.5f * u, 17f * u, Color.WHITE, true, true)
        text(cv, unit, cx, y + 13.5f * u, 4.2f * u, MUTED)
        for ((dx, s, f) in listOf(Triple(-30f, "−", minus), Triple(30f, "+", plus))) {
            val x = cx + dx * u; cv.drawCircle(x, y, 7.5f * u, paint(SURF)); text(cv, s, x, y + 2.8f * u, 8f * u, Color.WHITE, true)
            hits.add(RectF(x - 9 * u, y - 9 * u, x + 9 * u, y + 9 * u) to { f(); invalidate() })
        }
    }
    // 칩 줄 (고른 것은 흰 바탕)
    private fun chips(cv: Canvas, items: List<Pair<String, Boolean>>, y: Float, onPick: (Int) -> Unit) {
        val sz = 3.9f * u; val padX = 2.6f * u; val gap = 1.4f * u; val h = 7.4f * u
        val ws = items.map { measure(it.first, sz) + padX * 2 }; var x = cx - (ws.sum() + gap * (items.size - 1)) / 2
        items.forEachIndexed { i, (s, on) ->
            val r = RectF(x, y - h / 2, x + ws[i], y + h / 2)
            cv.drawRoundRect(r, h / 2, h / 2, paint(if (on) Color.WHITE else SURF))
            text(cv, s, r.centerX(), y + 1.4f * u, sz, if (on) RunView.INK else Color.WHITE, true)
            hits.add(RectF(r).apply { inset(-.6f * u, -2 * u) } to { onPick(i); invalidate() }); x += ws[i] + gap
        }
    }

    override fun onDraw(cv: Canvas) {
        W = width.toFloat(); cx = W / 2; u = min(W, height.toFloat()) / 100f; hits.clear()
        cv.drawColor(Color.BLACK)
        when (order[page.coerceIn(0, last)]) {
            0 -> {
                mono(cv, "READY / $sportTag", 17f * u)
                text(cv, if (Run.hike) "이번 등산 목표" else "이번 러닝 목표", cx, 25f * u, 5f * u, Color.WHITE, true)
                stepper(cv, kmTxt(), if (km > 0) "km" else "거리 없이", 42f * u,
                    { km = if (km <= 1) 0.0 else Math.round((km - 0.5) * 2) / 2.0; save() }, { km = if (km <= 0) 1.0 else minOf(42.195, Math.round((km + 0.5) * 2) / 2.0); save() })
                val opts = if (Run.hike) listOf(0.0, 3.0, 5.0, 10.0, 15.0) else listOf(0.0, 3.0, 5.0, 10.0, 21.0975)
                chips(cv, opts.map { (if (it == 0.0) "자유" else if (it == 21.0975) "21.1" else num(it)) to (km == it) }, 66f * u) { km = opts[it]; save() }
            }
            1 -> {
                text(cv, "목표 시간", cx, 22f * u, 5f * u, Color.WHITE, true)
                stepper(cv, if (min > 0) "$min" else "—", if (min > 0) (if (km > 0) "분 · 1km ${fmtPace(min * 60000.0 / km)}" else "분 동안") else "제한 없음",
                    40f * u, { min = maxOf(0, min - 1).let { if (it in 1..4) 0 else it }; save() }, { min = if (min < 5) 5 else min + 1; save() })
                val opts = listOf(0, 30, 45, 60, 90)
                chips(cv, opts.map { (if (it == 0) "제한 없음" else "$it") to (min == it) }, 64f * u) { min = opts[it]; save() }
            }
            2 -> {
                text(cv, "케이던스 비프", cx, 22f * u, 5f * u, Color.WHITE, true)
                stepper(cv, "${Cadence.spm}", "SPM · ▶ 미리 듣기", 40f * u, { Cadence.setSpm(context, Cadence.spm - 5) }, { Cadence.setSpm(context, Cadence.spm + 5) })
                hits.add(RectF(cx - 18 * u, 50 * u, cx + 18 * u, 57 * u) to { Cadence.preview(context) })
                val ks = listOf(Cadence.OFF, Cadence.SOUND, Cadence.VIB, Cadence.BOTH)
                chips(cv, ks.map { (if (it == Cadence.BOTH) "둘 다" else Cadence.label(it)) to (Cadence.kind == it) }, 63f * u) { Cadence.set(context, ks[it]) }
                chips(cv, listOf((if (Run.voice) "음성 안내 켜짐" else "음성 안내 꺼짐") to Run.voice), 75f * u) { Run.voice = !Run.voice; Store.setVoice(context, Run.voice) }
            }
            else -> {
                val H = height.toFloat()
                photo?.let { bm -> val sc = maxOf(W / bm.width, H / bm.height); val dw = bm.width * sc; val dh = bm.height * sc
                    cv.drawBitmap(bm, null, RectF((W - dw) / 2, (H - dh) * .75f, (W - dw) / 2 + dw, (H - dh) * .75f + dh), paint(Color.WHITE).apply { isFilterBitmap = true }) }
                cv.drawColor(Color.argb(150, 6, 30, 55))
                mono(cv, "READY / $sportTag", 22f * u)
                text(cv, if (Run.hike) "오늘의 길로." else "오늘의 리듬으로.", cx, 33f * u, 6.6f * u, Color.WHITE, true)
                val g = Store.goal(context)
                text(cv, "🎯 ${g.label()}${if (g.tgtLabel().isNotEmpty()) " · " + g.tgtLabel() else ""}" + (if (Cadence.kind != Cadence.OFF && !Run.hike) " · ♩ ${Cadence.spm}" else ""), cx, 42f * u, 4.2f * u, Color.WHITE)
                val gs = "▶  출발"; val gw = measure(gs, 6.6f * u) + 16 * u; val gh = 14f * u; val gy = 58f * u
                val r = RectF(cx - gw / 2, gy - gh / 2, cx + gw / 2, gy + gh / 2)
                cv.drawRoundRect(r, gh / 2, gh / 2, paint(CORAL)); text(cv, gs, cx, gy + 2.4f * u, 6.6f * u, Color.WHITE, true)
                hits.add(RectF(r).apply { inset(-3 * u, -3 * u) } to onGo)
                val a = Run.lastAcc
                text(cv, if (a < 0) "GPS 찾는 중 · 하늘이 트인 곳에서" else if (a <= 20) "● GPS 준비됐어요" else "GPS 잡는 중 · ${a.toInt()}m", cx, 73f * u, 3.8f * u, if (a in 0f..20f) RunView.BLUE else Color.WHITE)
                if (Run.hike) chips(cv, listOf((if (Run.voice) "음성 안내 켜짐" else "음성 안내 꺼짐") to Run.voice), 80.5f * u) { Run.voice = !Run.voice; Store.setVoice(context, Run.voice) }
            }
        }
        // 아래 쪽 점 + 넘기기 안내
        for (i in 0..last) cv.drawCircle(cx + (i - last / 2f) * 3.4f * u, 88f * u, (if (i == page) .95f else .7f) * u, paint(if (i == page) Color.WHITE else Color.parseColor("#555A62")))
        if (page < last) { text(cv, "›", 93f * u, 52f * u, 8f * u, MUTED, true); hits.add(RectF(86 * u, 40 * u, 100 * u, 64 * u) to { page++; invalidate() }) }
        if (page > 0) { text(cv, "‹", 7f * u, 52f * u, 8f * u, MUTED, true); hits.add(RectF(0f, 40 * u, 14 * u, 64 * u) to { page--; invalidate() }) }
    }

    private var dx = 0f; private var dy = 0f
    override fun onTouchEvent(e: MotionEvent): Boolean {
        when (e.action) {
            MotionEvent.ACTION_DOWN -> { dx = e.x; dy = e.y }
            MotionEvent.ACTION_UP -> {
                val mx = e.x - dx
                if (abs(mx) > 12 * u && abs(mx) > abs(e.y - dy)) {   // 옆으로 밀기
                    if (mx < 0 && page < last) page++ else if (mx > 0) { if (page > 0) page-- else onBack() }
                    invalidate(); return true
                }
                hits.lastOrNull { it.first.contains(e.x, e.y) }?.second?.invoke()
            }
        }
        return true
    }
}
