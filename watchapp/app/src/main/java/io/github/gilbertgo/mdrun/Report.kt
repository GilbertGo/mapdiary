package io.github.gilbertgo.mdrun

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import android.view.View
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar
import kotlin.math.abs
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt

// 달리고 나서 자세히 보기 (2026-10-19, 사용자 '달리고 나서 데이터 보고 자세히 분석하는 기능'):
// 저장한 기록 하나로 ① 요약 ② 한눈에 보기(페이스 흐름·존2·심박 드리프트·케이던스·자세 판단 글) ③ 심박·페이스 그래프
// ④ 심박 존 시간 ⑤ 1km 구간 전부 ⑥ 케이던스·자세 평균 을 위에서 아래로 그려요(용두로 내려 봄)
// 오른 높이(m): 휴대폰 index.html elevStats와 똑같이 — 앞뒤 2점(5점) 평균, 기준보다 4m 넘게 오르면 더하고 4m 넘게 내리면 기준만 내림
fun gainOf(a: List<Double>): Int {
    val h = a.indices.map { i -> (maxOf(0, i - 2)..minOf(a.size - 1, i + 2)).map { a[it] }.average() }
    var up = 0.0; var ref = h[0]
    for (v in h) { if (v - ref > 4) { up += v - ref; ref = v } else if (ref - v > 4) ref = v }
    return up.roundToInt()
}

class Report(o: JSONObject) {
    class Note(val title: String, val detail: String, val col: Int)
    val id = o.optString("id"); val name = o.optString("name"); val at = o.optLong("at")
    val sum: JSONObject = o.optJSONObject("sum") ?: JSONObject()
    val walk = sum.optDouble("walk", 0.0); val moving = sum.optLong("moving"); val steps = sum.optInt("steps")
    val hrAvg = sum.optInt("hrAvg"); val hrMax = sum.optInt("hrMax"); val cad = sum.optInt("cad")
    val hrMaxSet = sum.optInt("hrMaxSet", Run.hrMaxSet).let { if (it < 100) Run.hrMaxSet else it }
    val zone = LongArray(5).also { z -> sum.optJSONArray("zone")?.let { a -> for (k in 0 until min(5, a.length())) z[k] = a.optLong(k) } }
    val goal = Goal.from(o.optJSONObject("goal")); val goalDone = o.optBoolean("goalDone")
    val splits: List<Long> = JSONArray(o.optJSONObject("data")?.optString("walkSplits:$id", "[]") ?: "[]").let { a -> (0 until a.length()).map { a.getLong(it) } }
    val series: List<Run.Sample> = o.optJSONArray("series")?.let { a -> (0 until a.length()).map { Run.sampleOf(a.getJSONArray(it)) } } ?: emptyList()
    val avgPace: Double? = if (walk > 50 && moving > 0) moving / (walk / 1000) else null
    // 고도: 길 점의 4번째 값(GPS 높이, m) → (시작부터 ms, 높이)
    val alts: List<Pair<Long, Double>> = try { JSONArray(o.optJSONObject("data")?.optString("track:$id", "[]") ?: "[]").let { a ->
        (0 until a.length()).mapNotNull { k -> val q = a.optJSONArray(k); if (q != null && q.length() >= 4 && !q.isNull(3)) (q.optLong(2) - at) to q.optDouble(3) else null } } } catch (e: Exception) { emptyList() }
    // 오른 높이(m): gainOf(휴대폰 elevStats와 같은 셈)
    val gain: Int? = alts.map { it.second }.let { a -> if (a.size < 5) null else {
        gainOf(a) } }
    fun zoneLo(z: Int) = (hrMaxSet * (.5 + .1 * z)).roundToInt()
    // 등산 기록인지 · 다닌 시간(시작~끝) · 운동 뒤 심박(끝낼 때 → 1분 뒤 → 2분 뒤)
    val hike = o.optString("sport") == "hike" || o.optJSONObject("data")?.optString("walkMode:$id") == "\"hike\""
    val elapsed = maxOf(0L, o.optLong("end") - at)
    val hrEnd = sum.optInt("hrEnd"); val hr1 = sum.optInt("hr1"); val hr2 = sum.optInt("hr2")

    // 심박 드리프트(%): 앞 절반과 뒤 절반의 '속도 ÷ 심박'이 얼마나 떨어졌는지. 처음 10분(몸 푸는 시간)은 빼요
    val drift: Double? = run {
        val ok = series.filter { it.hr > 0 && it.pace != null && it.pace < 900000 }
        val skip = if ((ok.lastOrNull()?.t ?: 0) > 1_800_000) 600_000 else 0
        val s = ok.filter { it.t >= skip }; if (s.size < 12) return@run null
        val h = s.size / 2
        fun eff(l: List<Run.Sample>) = l.map { 1.0 / it.pace!! / it.hr }.average()
        val a = eff(s.subList(0, h)); val b = eff(s.subList(h, s.size)); (a - b) / a * 100
    }
    val regAvg = series.mapNotNull { it.reg }.takeIf { it.size >= 5 }?.average()
    val gAvg = series.mapNotNull { it.g }.takeIf { it.size >= 5 }?.average()
    val stride: Double? = if (steps > 100) walk / steps else null

    fun notes(): List<Note> {
        val out = ArrayList<Note>()
        val BLUE = RunView.BLUE; val GOLD = RunView.GOLD; val CORAL = RunView.CORAL; val MUTED = RunView.MUTED
        // 목표
        if (goal.k != "free") out.add(if (goalDone) Note("목표 ${goal.label()} 달성", if (goal.tgtLabel().isNotEmpty()) "목표 ${goal.tgtLabel()}" else "끝까지 해냈어요", GOLD)
            else Note("목표 ${goal.label()}에 못 미쳤어요", "다음엔 목표를 조금 낮춰도 좋아요", CORAL))
        // 운동 뒤 심박 회복(1분에 몇 떨어졌나)
        if (hrEnd > 0 && hr1 > 0) { val d = hrEnd - hr1; out.add(when {
            d >= 20 -> Note("심박 회복 빨라요 · 1분에 −$d", "끝낼 때 $hrEnd → 1분 뒤 $hr1 · 심폐 체력이 좋아요", BLUE)
            d >= 12 -> Note("심박 회복 보통 · 1분에 −$d", "끝낼 때 $hrEnd → 1분 뒤 $hr1", GOLD)
            else -> Note("심박 회복 느려요 · 1분에 −$d", "피곤하거나 컨디션이 안 좋을 수 있어요 · 오늘은 푹 쉬어요", CORAL) }) }
        // 등산: 오른 높이와 1시간에 오른 높이
        if (hike && gain != null && gain >= 30 && elapsed > 600_000) out.add(Note("오른 높이 ${gain}m", "1시간에 ${(gain / (elapsed / 3_600_000.0)).roundToInt()}m 올랐어요", RunView.ALTC))
        // 페이스 흐름
        if (!hike && splits.size >= 2) {
            val h = splits.size / 2; val a = splits.subList(0, h).average(); val b = splits.subList(splits.size - h, splits.size).average()
            val d = (b - a) / a * 100; val mean = splits.average(); val cv = sqrt(splits.sumOf { (it - mean) * (it - mean) } / splits.size) / mean * 100
            out.add(when {
                d < -1.5 -> Note("네거티브 스플릿!", "후반(${fmtPace(b)})이 전반(${fmtPace(a)})보다 빨랐어요", BLUE)
                abs(d) <= 3 && cv <= 4 -> Note("페이스가 고르게 유지됐어요", "1km마다 차이 ${cv.roundToInt()}%", BLUE)
                d > 6 -> Note("후반에 페이스가 처졌어요", "전반 ${fmtPace(a)} → 후반 ${fmtPace(b)}, 처음을 조금 천천히", CORAL)
                else -> Note("페이스가 조금 흔들렸어요", "전반 ${fmtPace(a)} · 후반 ${fmtPace(b)}", GOLD)
            })
        }
        // 존2
        val zt = zone.sum()
        if (zt > 120_000) {
            val z2 = zone[1] * 100 / zt; val hi = (zone[2] + zone[3] + zone[4]) * 100 / zt
            out.add(when {
                z2 >= 60 -> Note(if (hike) "존2로 꾸준히 걸었어요 · 존2 $z2%" else "존2 러닝 잘했어요 · 존2 $z2%", "존2 ${zoneLo(1)}~${zoneLo(2) - 1} 안에서 오래 " + (if (hike) "걸었어요" else "달렸어요"), BLUE)
                hi >= 50 -> Note("존3 이상이 $hi%예요", (if (hike) "오르막에서 쉬어 가며 심박 " else "존2로 달리려면 심박 ") + "${zoneLo(2) - 1} 아래로, 더 천천히", CORAL)
                else -> Note("존2 $z2% · 존3 이상 $hi%", "존2 비율 60%를 넘겨 보세요", GOLD)
            })
        }
        // 심박 드리프트
        drift?.let { d -> out.add(when {
            d < 5 -> Note("심박 드리프트 ${String.format("%.1f", d)}%", "5% 아래 · 유산소 체력이 버텨 줬어요", BLUE)
            d < 10 -> Note("심박 드리프트 ${String.format("%.1f", d)}%", "후반에 같은 속도에 심박이 조금 올랐어요", GOLD)
            else -> Note("심박 드리프트 ${String.format("%.1f", d)}%", "후반 심박이 많이 올랐어요 · 더위·피로·속도 확인", CORAL)
        }) }
        // 케이던스
        if (!hike && cad > 0) out.add(when {
            cad >= 170 -> Note("케이던스 $cad 좋아요", "발을 빠르고 가볍게 디뎠어요", BLUE)
            cad >= 160 -> Note("케이던스 $cad 보통", "170을 목표로 보폭을 조금 줄여 보세요", GOLD)
            else -> Note("케이던스 $cad 낮아요", "가이드 소리를 170~175에 맞춰 연습해 보세요", CORAL)
        })
        // 자세
        if (!hike) regAvg?.let { r -> if (r > 7) out.add(Note("걸음 리듬이 흔들렸어요 ${r.roundToInt()}%", "일정한 박자로 · 케이던스 가이드가 도움 돼요", GOLD)) }
        if (!hike) gAvg?.let { g -> if (g > 4) out.add(Note("착지 충격이 세요 ${String.format("%.1f", g)}G", "발을 몸 아래에 살짝 내려놓듯", GOLD)) }
        if (out.isEmpty()) out.add(Note("기록이 짧아요", if (hike) "1km 넘게 걸으면 자세히 분석해 드려요" else "1km 넘게 달리면 자세히 분석해 드려요", MUTED))
        return out
    }
}

class ReportView(c: Context, private val r: Report, private val justDone: Boolean) : View(c) {
    private val p = Paint(Paint.ANTI_ALIAS_FLAG)
    private val numBold = Typeface.create("sans-serif-condensed", Typeface.BOLD)
    private val krBold = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
    private var u = 1f; private var cx = 0f; private var W = 0f
    private val L get() = 13 * u; private val R get() = W - 13 * u
    private val CORAL = RunView.CORAL; private val BLUE = RunView.BLUE; private val MUTED = RunView.MUTED; private val RED = RunView.RED
    private val notes = r.notes()
    var detail = false   // 2026-10-19 사용자 '와치로는 간단하게, 폰으로는 상세하게': 시계는 요약 + 판단 글 3개까지

    private fun paint(col: Int) = p.apply { reset(); isAntiAlias = true; color = col }
    private fun text(cv: Canvas?, s: String, x: Float, y: Float, size: Float, col: Int, b: Boolean = false, num: Boolean = false, al: Paint.Align = Paint.Align.CENTER) {
        if (cv == null) return
        paint(col); p.textSize = size; p.typeface = if (num) numBold else if (b) krBold else Typeface.DEFAULT; if (num) p.fontFeatureSettings = "tnum"; p.textAlign = al
        val mw = R - L; val w = p.measureText(s); if (w > mw) p.textSize = size * mw / w
        cv.drawText(s, x, y, p)
    }
    // 글을 폭에 맞춰 여러 줄로 나눠요(낱말 단위, 넘치면 글자 단위)
    private fun wrap(s: String, size: Float, b: Boolean, maxW: Float): List<String> {
        paint(Color.WHITE); p.textSize = size; p.typeface = if (b) krBold else Typeface.DEFAULT
        val out = ArrayList<String>(); var line = ""
        for (w in s.split(" ")) { val t = if (line.isEmpty()) w else "$line $w"
            if (p.measureText(t) <= maxW) line = t else { if (line.isNotEmpty()) out.add(line); line = w } }
        if (line.isNotEmpty()) out.add(line); return out
    }
    private fun head(cv: Canvas?, s: String, y: Float): Float { text(cv, s, cx, y, 5.6f * u, Color.WHITE, true); return y + 7 * u }

    // cv가 null이면 높이만 셈
    private fun drawAll(cv: Canvas?): Float {
        if (!detail) return drawSimple(cv)
        var y = 14 * u
        val c = Calendar.getInstance().apply { timeInMillis = r.at }
        val days = arrayOf("일", "월", "화", "수", "목", "금", "토")
        if (justDone) { text(cv, "저장했어요!", cx, y, 5.4f * u, BLUE, true); y += 7 * u }
        text(cv, "${c.get(Calendar.MONTH) + 1}월 ${c.get(Calendar.DAY_OF_MONTH)}일 (${days[c.get(Calendar.DAY_OF_WEEK) - 1]}) ${c.get(Calendar.HOUR_OF_DAY)}:${String.format("%02d", c.get(Calendar.MINUTE))}", cx, y, 5f * u, MUTED, true); y += 18 * u
        // 큰 거리
        if (cv != null) { paint(Color.WHITE); p.typeface = numBold; p.textSize = 20 * u; val ks = fmtKm(r.walk); val kw = p.measureText(ks); p.textSize = 6 * u; val uw = p.measureText("km"); val x0 = cx - (kw + uw + u) / 2
            text(cv, ks, x0, y, 20 * u, Color.WHITE, true, true, Paint.Align.LEFT); text(cv, "km", x0 + kw + u, y, 6 * u, CORAL, true, true, Paint.Align.LEFT) }
        y += 9 * u
        text(cv, "${fmtTime(r.moving)} · 평균 ${fmtPace(r.avgPace)}", cx, y, 6 * u, Color.WHITE, true, true); y += 7 * u
        if (r.hrAvg > 0) { text(cv, "심박 평균 ${r.hrAvg} · 최고 ${r.hrMax}", cx, y, 5f * u, MUTED, true); y += 6 * u }
        y += 6 * u

        // 한눈에 보기
        y = head(cv, "한눈에 보기", y)
        for (n in if (detail) notes else notes.take(3)) {
            val tl = wrap(n.title, 5.2f * u, true, R - L - 5 * u); val dl = wrap(n.detail, 4.8f * u, false, R - L - 5 * u)
            cv?.drawCircle(L + 1.4f * u, y - 1.6f * u, 1.3f * u, paint(n.col))
            tl.forEach { text(cv, it, L + 4.5f * u, y, 5.2f * u, n.col, true, al = Paint.Align.LEFT); y += 6.4f * u }
            dl.forEach { text(cv, it, L + 4.5f * u, y, 4.8f * u, Color.parseColor("#C9D1DB"), al = Paint.Align.LEFT); y += 6 * u }
            y += 3 * u
        }
        y += 4 * u
        // 심박 · 페이스 그래프
        if (r.series.size >= 2) {
            y = head(cv, "심박 · 페이스", y)
            val top = y; val bot = y + 38 * u
            if (cv != null) graph(cv, top, bot)
            y = bot + 7 * u
            if (cv != null) { cv.drawRect(L, y - 2.6f * u, L + 4 * u, y - 1.6f * u, paint(RED)); text(cv, "심박", L + 5.5f * u, y, 4.8f * u, MUTED, al = Paint.Align.LEFT)
                cv.drawRect(cx - 4 * u, y - 2.6f * u, cx, y - 1.6f * u, paint(CORAL)); text(cv, "페이스", cx + 1.5f * u, y, 4.8f * u, MUTED, al = Paint.Align.LEFT) }
            y += 6 * u; text(cv, "파란 띠 = 존2 · 페이스는 위가 빠름", cx, y, 4.8f * u, BLUE); y += 10 * u
        }

        // 심박 존
        val zt = r.zone.sum()
        if (zt > 0) {
            y = head(cv, "심박 존", y)
            val mx = (r.zone.maxOrNull() ?: 1L).coerceAtLeast(1L)
            for (i in 0 until 5) { val k = 4 - i; val ms = r.zone[k]
                text(cv, "존${k + 1}", L + 9 * u, y, 5f * u, if (k == 1) Color.WHITE else RunView.ZONE[k], true, al = Paint.Align.RIGHT)
                cv?.drawRoundRect(RectF(L + 11 * u, y - 3.2f * u, L + 41 * u, y - .4f * u), 1.4f * u, 1.4f * u, paint(RunView.TRACK))
                if (ms > 0) cv?.drawRoundRect(RectF(L + 11 * u, y - 3.2f * u, L + 11 * u + 30 * u * (ms.toFloat() / mx).coerceAtLeast(.05f), y - .4f * u), 1.4f * u, 1.4f * u, paint(RunView.ZONE[k]))
                text(cv, "${fmtTime(ms)} ${ms * 100 / zt}%", R, y, 4.8f * u, if (k == 1) Color.WHITE else MUTED, true, true, Paint.Align.RIGHT)
                y += 7.5f * u }
            text(cv, "최대 심박 ${r.hrMaxSet} 기준 · 존2 ${r.zoneLo(1)}~${r.zoneLo(2) - 1}", cx, y, 4.8f * u, MUTED); y += 11 * u
        }

        // 1km 구간
        if (r.splits.isNotEmpty()) {
            y = head(cv, "1km 구간", y)
            val lo = r.splits.minOrNull()!!; val hi = r.splits.maxOrNull()!!
            r.splits.forEachIndexed { k, ms ->
                val best = ms == lo && r.splits.size > 1; val worst = ms == hi && r.splits.size > 2
                text(cv, "${k + 1}", L + 6 * u, y, 5f * u, MUTED, true, true, Paint.Align.RIGHT)
                val f = 0.35f + 0.65f * (hi - ms).toFloat() / maxOf(1L, hi - lo).toFloat()
                cv?.drawRoundRect(RectF(L + 9 * u, y - 3.2f * u, L + 44 * u, y - .4f * u), 1.4f * u, 1.4f * u, paint(RunView.TRACK))
                cv?.drawRoundRect(RectF(L + 9 * u, y - 3.2f * u, L + 9 * u + 35 * u * f, y - .4f * u), 1.4f * u, 1.4f * u, paint(if (best) CORAL else BLUE))
                text(cv, fmtPace(ms.toDouble()), R, y, 5.6f * u, if (best) CORAL else if (worst) MUTED else Color.WHITE, true, true, Paint.Align.RIGHT)
                y += 7.5f * u }
            text(cv, "산호색 = 가장 빠른 1km", cx, y, 4.8f * u, MUTED); y += 11 * u
        }

        // 케이던스 · 자세
        if (r.cad > 0 || r.regAvg != null || r.gAvg != null) {
            y = head(cv, "케이던스 · 자세", y)
            fun row(lab: String, v: String) { text(cv, lab, L, y, 5f * u, MUTED, al = Paint.Align.LEFT); text(cv, v, R, y, 5.6f * u, Color.WHITE, true, true, Paint.Align.RIGHT); y += 7.5f * u }
            if (r.cad > 0) row("평균 케이던스", "${r.cad} spm")
            r.stride?.let { row("평균 보폭", String.format("%.2f m", it)) }
            if (r.steps > 0) row("걸음 수", "${r.steps}")
            r.regAvg?.let { row("걸음 고르기", "${it.roundToInt()}%") }
            r.gAvg?.let { row("착지 충격", String.format("%.1f G", it)) }
            text(cv, "자세 값은 손목 센서로 짐작한 대략값", cx, y, 4.6f * u, MUTED); y += 8 * u
        }
        return y + 4 * u
    }

    // 2026-10-19 사용자가 삼성헬스 시계 결과 화면 사진을 보내 줌 → 시계 요약을 그 모양으로:
    // ① 색깔 숫자 네 줄(거리·시간·페이스·심박) ② 페이스 그래프(채운 산 + 평균 점선 · 평균/최고) ③ 심박수 그래프(존 색 선 + 뒤에 회색 페이스 · 평균/최대)
    // ④ 심박수 구간(5→1 막대·시간) ⑤ 한눈에 보기 3개 ⑥ 휴대폰에서 자세히
    private fun title(cv: Canvas?, s: String, y: Float): Float { text(cv, s, L + 2 * u, y, 6.2f * u, Color.WHITE, true, al = Paint.Align.LEFT); return y + 6 * u }
    private fun rule(cv: Canvas?, y: Float) { if (cv != null) { paint(RunView.LINE); p.strokeWidth = .35f * u; cv.drawLine(L + 6 * u, y, R - 6 * u, y, p) } }
    private fun kv(cv: Canvas?, lab: String, v: String, y: Float, dots: Boolean = false) {
        text(cv, (if (dots) "···  " else "") + lab, L + 3 * u, y, 5.2f * u, Color.WHITE, true, al = Paint.Align.LEFT)
        text(cv, v, R - 3 * u, y, 5.6f * u, Color.WHITE, true, true, Paint.Align.RIGHT)
    }
    private fun dotted(cv: Canvas, x0: Float, x1: Float, y: Float) { paint(Color.WHITE); var x = x0; while (x < x1) { cv.drawCircle(x, y, .32f * u, p); x += 1.6f * u } }
    private fun smooth(s: List<Run.Sample>) = s.indices.map { i -> (maxOf(0, i - 2)..minOf(s.size - 1, i + 2)).mapNotNull { j -> s[j].pace?.takeIf { it < 900000 } }.let { l -> if (s[i].pace == null || l.isEmpty()) null else l.average() } }

    private fun drawSimple(cv: Canvas?): Float {
        var y = 16 * u
        val c = Calendar.getInstance().apply { timeInMillis = r.at }
        val days = arrayOf("일", "월", "화", "수", "목", "금", "토")
        text(cv, if (justDone) "저장했어요!" else "${c.get(Calendar.MONTH) + 1}월 ${c.get(Calendar.DAY_OF_MONTH)}일 (${days[c.get(Calendar.DAY_OF_WEEK) - 1]}) ${c.get(Calendar.HOUR_OF_DAY)}:${String.format("%02d", c.get(Calendar.MINUTE))}",
            cx, y, 5f * u, if (justDone) BLUE else MUTED, true)
        y += 15 * u
        // ① 색깔 숫자 줄
        val rows = ArrayList<Triple<String, String, Int>>()
        rows.add(Triple(fmtKm(r.walk), "km", RunView.GOLD))
        if (r.hike) { rows.add(Triple(fmtTime(r.elapsed), "", BLUE)); r.gain?.let { rows.add(Triple("↑$it", "m", RunView.ALTC)) } }   // 등산: 다닌 시간 · 오른 높이
        else { rows.add(Triple(fmtTime(r.moving), "", BLUE)); rows.add(Triple(fmtPace(r.avgPace), "/km", CORAL)) }
        if (r.hrAvg > 0) rows.add(Triple("${r.hrAvg}", "bpm", RED))
        val x0 = L + 17 * u; val top = y - 11 * u
        rows.forEach { (v, unit, col) ->
            if (cv != null) { paint(col); p.typeface = numBold; p.fontFeatureSettings = "tnum"; p.textSize = 13 * u; p.textAlign = Paint.Align.LEFT; cv.drawText(v, x0, y, p)
                val w = p.measureText(v); p.textSize = 5.6f * u; p.typeface = krBold; if (unit.isNotEmpty()) cv.drawText(unit, x0 + w + 1.2f * u, y, p) }
            y += 14 * u }
        if (cv != null) { paint(RunView.LINE); p.strokeWidth = .4f * u; cv.drawLine(x0 - 4 * u, top, x0 - 4 * u, y - 12 * u, p)
            text(cv, if (r.hike) "HIKE" else "RUN", x0 - 9 * u, (top + y - 12 * u) / 2 + 1.6f * u, 4.2f * u, CORAL, true, true) }
        y += 2 * u; rule(cv, y); y += 12 * u
        y = recovery(cv, y)

        val s = r.series.let { all -> val st = maxOf(1, all.size / 120); all.filterIndexed { i, _ -> i % st == 0 || i == all.size - 1 } }
        val gL = L + 3 * u; val gR = R - 3 * u
        val t0 = s.firstOrNull()?.t?.toFloat() ?: 0f; val t1 = maxOf(s.lastOrNull()?.t?.toFloat() ?: 0f, t0 + 60000f)
        fun xOf(t: Long) = gL + (gR - gL) * (t - t0) / (t1 - t0)
        val sm = smooth(s); val ps = sm.filterNotNull()

        // ①-2 한눈에 그래프(2026-10-23 사용자 '세 그래프를 합치면?' → 추천대로 달린 뒤 화면에): 달리는 중엔 세 칸이 잘 읽히고,
        //   달린 뒤엔 한 칸에 겹쳐 '오르막에서 심박이 오르고 페이스가 떨어진' 관계를 봄. 바닥 은빛 산 = 고도(아래 42%),
        //   보라 선 = 페이스(위가 빠름, 위 62%. 2026-10-23 존4 산호와 헷갈려 보라로), 굵은 선 = 심박(그때 존 색) + 존2 띠
        val hsAll = s.filter { it.hr > 0 }
        val al = r.alts.let { a -> val st = maxOf(1, a.size / 160); a.filterIndexed { i, _ -> i % st == 0 || i == a.size - 1 } }
        if (hsAll.size >= 2 || ps.size >= 2 || al.size >= 2) {
            y = title(cv, "한눈에 그래프", y)
            var lx = L + 2 * u
            for ((t, col) in listOf("━ 심박" to BLUE, "━ 페이스" to RunView.CADC, "▲ 고도" to RunView.ALTC)) {
                text(cv, t, lx, y + 1 * u, 4.4f * u, col, true, al = Paint.Align.LEFT); lx += (t.length * 3.6f + 4f) * u }
            y += 4 * u
            val gt = y + 2 * u; val gb = y + 32 * u
            if (cv != null) {
                if (al.size >= 2) {
                    val av = al.indices.map { i -> (maxOf(0, i - 3)..minOf(al.size - 1, i + 3)).map { al[it].second }.average() }
                    var aLo = av.minOrNull()!!; var aHi = av.maxOrNull()!!; if (aHi - aLo < 20) { val m = (aHi + aLo) / 2; aLo = m - 10; aHi = m + 10 }
                    fun yA(a: Double) = (gb - (gb - gt) * .42 * ((a - aLo) / (aHi - aLo)).coerceIn(0.0, 1.0)).toFloat()
                    fun xA(t: Long) = xOf(t).coerceIn(gL, gR)
                    val area = Path(); val line = Path()
                    al.forEachIndexed { i, q -> val x = xA(q.first); val yy = yA(av[i]); if (i == 0) { area.moveTo(x, gb); area.lineTo(x, yy); line.moveTo(x, yy) } else { area.lineTo(x, yy); line.lineTo(x, yy) } }
                    area.lineTo(xA(al.last().first), gb); area.close()
                    cv.drawPath(area, paint(RunView.alpha(RunView.ALTC, 0x2A)))
                    paint(RunView.alpha(RunView.ALTC, 0x90)); p.style = Paint.Style.STROKE; p.strokeWidth = .5f * u; p.strokeJoin = Paint.Join.ROUND; cv.drawPath(line, p)
                }
                if (hsAll.size >= 2) {
                    val hLo = (minOf(hsAll.minOf { it.hr }, r.zoneLo(1)) - 5).toFloat(); val hHi = (maxOf(hsAll.maxOf { it.hr }, r.zoneLo(2)) + 5).toFloat()
                    fun yH(h: Int) = gb - (gb - gt) * ((h - hLo) / (hHi - hLo)).coerceIn(0f, 1f)
                    zoneBands(cv, gL, gR) { yH(it) }
                    if (ps.size >= 2) { val fast = ps.minOrNull()!!; val slow = maxOf(ps.maxOrNull()!!, fast + 1); val path = Path(); var first = true
                        s.forEachIndexed { i, q -> val pc = sm[i] ?: return@forEachIndexed; val x = xOf(q.t); val yy = gt + (gb - gt) * .62f * ((pc - fast) / (slow - fast)).toFloat(); if (first) path.moveTo(x, yy) else path.lineTo(x, yy); first = false }
                        paint(RunView.CADC); p.style = Paint.Style.STROKE; p.strokeWidth = .7f * u; p.strokeJoin = Paint.Join.ROUND; cv.drawPath(path, p) }
                    paint(BLUE); p.style = Paint.Style.STROKE; p.strokeWidth = 1.1f * u; p.strokeCap = Paint.Cap.ROUND
                    for (i in 1 until hsAll.size) { val a = hsAll[i - 1]; val b = hsAll[i]
                        p.color = RunView.ZONE[((a.hr + b.hr) / 2.0 / r.hrMaxSet).let { f -> when { f < .6 -> 0; f < .7 -> 1; f < .8 -> 2; f < .9 -> 3; else -> 4 } }]
                        cv.drawLine(xOf(a.t), yH(a.hr), xOf(b.t), yH(b.hr), p) }
                } else if (ps.size >= 2) { val fast = ps.minOrNull()!!; val slow = maxOf(ps.maxOrNull()!!, fast + 1); val path = Path(); var first = true
                    s.forEachIndexed { i, q -> val pc = sm[i] ?: return@forEachIndexed; val x = xOf(q.t); val yy = gt + (gb - gt) * .62f * ((pc - fast) / (slow - fast)).toFloat(); if (first) path.moveTo(x, yy) else path.lineTo(x, yy); first = false }
                    paint(RunView.CADC); p.style = Paint.Style.STROKE; p.strokeWidth = .7f * u; cv.drawPath(path, p) }
                paint(RunView.LINE); p.strokeWidth = .35f * u; cv.drawLine(gL, gb, gR, gb, p)
            }
            y = gb + 5 * u
            text(cv, "0", gL, y, 4.2f * u, MUTED, num = true, al = Paint.Align.LEFT)
            text(cv, fmtTime((s.lastOrNull()?.t ?: al.lastOrNull()?.first ?: 0L) - (s.firstOrNull()?.t ?: 0L)), gR, y, 4.2f * u, MUTED, num = true, al = Paint.Align.RIGHT)
            y += 8 * u
            if (r.gain != null) { kv(cv, "오른 높이", "${r.gain} m", y); y += 5 * u }
            rule(cv, y); y += 12 * u
        }

        // ② 페이스
        if (ps.size >= 2 && r.avgPace != null) {
            y = title(cv, "페이스", y)
            val gt = y + 2 * u; val gb = y + 22 * u
            val slow = ps.maxOrNull()!! * 1.05; val fast = ps.minOrNull()!! * .95
            fun yP(pc: Double) = gb - (gb - gt) * ((slow - pc) / (slow - fast)).toFloat().coerceIn(0f, 1f)
            if (cv != null) {
                val line = Path(); val area = Path(); var first = true; var lastX = gL
                s.forEachIndexed { i, q -> val pc = sm[i] ?: return@forEachIndexed; val x = xOf(q.t); val yy = yP(pc)
                    if (first) { line.moveTo(x, yy); area.moveTo(x, gb); area.lineTo(x, yy) } else { line.lineTo(x, yy); area.lineTo(x, yy) }; first = false; lastX = x }
                area.lineTo(lastX, gb); area.close()
                paint(CORAL); p.shader = android.graphics.LinearGradient(0f, gt, 0f, gb, RunView.alpha(CORAL, 0xB0), RunView.alpha(CORAL, 0x18), android.graphics.Shader.TileMode.CLAMP); cv.drawPath(area, p)
                paint(CORAL); p.style = Paint.Style.STROKE; p.strokeWidth = .8f * u; p.strokeJoin = Paint.Join.ROUND; cv.drawPath(line, p)
                paint(RunView.LINE); p.strokeWidth = .35f * u; cv.drawLine(gL, gb, gR, gb, p)
                dotted(cv, gL, gR, yP(r.avgPace))
            }
            y = gb + 9 * u
            kv(cv, "평균", "${fmtPace(r.avgPace)} /km", y, true); y += 7.5f * u
            kv(cv, "최고 페이스", "${fmtPace(ps.minOrNull())} /km", y); y += 5 * u
            rule(cv, y); y += 12 * u
        }

        // ③ 심박수
        val hs = s.filter { it.hr > 0 }
        if (hs.size >= 2 && r.hrAvg > 0) {
            y = title(cv, "심박수", y)
            val gt = y + 2 * u; val gb = y + 22 * u
            val lo = (hs.minOf { it.hr } - 8).toFloat(); val hi = (hs.maxOf { it.hr } + 8).toFloat()
            fun yH(h: Int) = gb - (gb - gt) * ((h - lo) / (hi - lo)).coerceIn(0f, 1f)
            if (cv != null) {
                // 뒤에 옅은 회색 페이스 산(삼성헬스처럼)
                if (ps.size >= 2) { val slow = ps.maxOrNull()!! * 1.05; val fast = ps.minOrNull()!! * .95; val area = Path(); var first = true; var lastX = gL
                    s.forEachIndexed { i, q -> val pc = sm[i] ?: return@forEachIndexed; val x = xOf(q.t); val yy = gb - (gb - gt) * .55f * ((slow - pc) / (slow - fast)).toFloat().coerceIn(0f, 1f)
                        if (first) { area.moveTo(x, gb); area.lineTo(x, yy) } else area.lineTo(x, yy); first = false; lastX = x }
                    area.lineTo(lastX, gb); area.close(); cv.drawPath(area, paint(Color.parseColor("#2B3038"))) }
                zoneBands(cv, gL, gR) { yH(it) }
                paint(RunView.LINE); p.strokeWidth = .35f * u; cv.drawLine(gL, gb, gR, gb, p)
                p.style = Paint.Style.STROKE; p.strokeWidth = 1.1f * u; p.strokeCap = Paint.Cap.ROUND
                for (i in 1 until hs.size) { val a = hs[i - 1]; val b = hs[i]
                    p.color = RunView.ZONE[((a.hr + b.hr) / 2.0 / r.hrMaxSet).let { f -> when { f < .6 -> 0; f < .7 -> 1; f < .8 -> 2; f < .9 -> 3; else -> 4 } }]
                    cv.drawLine(xOf(a.t), yH(a.hr), xOf(b.t), yH(b.hr), p) }
                dotted(cv, gL, gR, yH(r.hrAvg))
            }
            y = gb + 9 * u
            kv(cv, "평균", "${r.hrAvg} bpm", y, true); y += 7.5f * u
            kv(cv, "최대", "${r.hrMax} bpm", y); y += 5 * u
            rule(cv, y); y += 12 * u
        }

        // ④ 심박수 구간
        val zt = r.zone.sum()
        if (zt > 0) {
            y = title(cv, "심박수 구간", y); y += 4 * u
            val mx = (r.zone.maxOrNull() ?: 1L).coerceAtLeast(1L)
            for (k in 4 downTo 0) { val ms = r.zone[k]
                text(cv, "${k + 1}", L + 5 * u, y, 5.6f * u, Color.WHITE, true, true)
                if (ms > 0) cv?.drawRoundRect(RectF(L + 10 * u, y - 3.6f * u, L + 10 * u + 34 * u * (ms.toFloat() / mx).coerceAtLeast(.06f), y - .4f * u), 1.6f * u, 1.6f * u, paint(RunView.ZONE[k]))
                text(cv, fmtTime(ms), R - 3 * u, y, 5.6f * u, Color.WHITE, true, true, Paint.Align.RIGHT)
                y += 8 * u }
            text(cv, "존2 ${r.zoneLo(1)}~${r.zoneLo(2) - 1} · 최대 심박 ${r.hrMaxSet} 기준", cx, y, 4.6f * u, MUTED); y += 4 * u
            rule(cv, y); y += 12 * u
        }

        // ⑤ 한눈에 보기
        y = title(cv, "한눈에 보기", y) + 2 * u
        for (n in notes.take(3)) {
            val tl = wrap(n.title, 5.2f * u, true, R - L - 5 * u); val dl = wrap(n.detail, 4.8f * u, false, R - L - 5 * u)
            cv?.drawCircle(L + 1.4f * u, y - 1.6f * u, 1.3f * u, paint(n.col))
            tl.forEach { text(cv, it, L + 4.5f * u, y, 5.2f * u, n.col, true, al = Paint.Align.LEFT); y += 6.4f * u }
            dl.forEach { text(cv, it, L + 4.5f * u, y, 4.8f * u, Color.parseColor("#C9D1DB"), al = Paint.Align.LEFT); y += 6 * u }
            y += 3 * u
        }
        rule(cv, y); y += 9 * u
        // ⑥ 휴대폰에서 자세히
        for (l in wrap("1km 구간·케이던스는 휴대폰 MPD → 내 MPD에서 자세히 봐요", 4.8f * u, false, R - L))
            { text(cv, l, cx, y, 4.8f * u, BLUE); y += 6 * u }
        text(cv, if (Wear.sent(context, r.id) || Link.sent(context, r.id)) "휴대폰으로 보냈어요 ✓" else "휴대폰과 이어지면 보내요", cx, y, 4.8f * u, MUTED, true); y += 6 * u
        return y + 6 * u
    }

    // 운동 뒤 심박 회복: 재는 동안(끝낸 뒤 2분)은 남은 시간·지금 심박, 다 재면 끝낼 때 → 1분 뒤 → 2분 뒤
    private var recState = ""
    private fun recovery(cv: Canvas?, y0: Float): Float {
        val live = Recover.id == r.id
        val end = if (live) Recover.end else r.hrEnd; val h1 = if (live) Recover.h1 else r.hr1; val h2 = if (live) Recover.h2 else r.hr2
        val active = Recover.active(r.id)
        val st = if (active) "a" else if (end > 0 && h1 > 0) "v" else if (live) "x" else ""
        if (cv != null && st != recState) { recState = st; post { requestLayout() } }
        if (cv == null) recState = st
        if (st.isEmpty()) return y0
        var y = title(cv, "운동 뒤 심박", y0) + 4 * u
        when (st) {
            "a" -> {
                val left = maxOf(0L, 120_000 - (System.currentTimeMillis() - Recover.t0))
                kv(cv, "재는 중", "${fmtTime(left)} 남음", y); y += 7.5f * u
                val now = Run.hrNow(System.currentTimeMillis())
                kv(cv, "지금 심박", if (now > 0) "$now bpm" else "--", y); y += 7.5f * u
                for (l in wrap("2분 동안 심박이 얼마나 빨리 내려가는지 봐요. 시계를 찬 채 편히 쉬어요.", 4.6f * u, false, R - L - 6 * u)) { text(cv, l, cx, y, 4.6f * u, MUTED); y += 5.6f * u }
                if (cv != null) postInvalidateDelayed(1000)
            }
            "v" -> {
                kv(cv, "끝낼 때", "$end bpm", y); y += 7.5f * u
                kv(cv, "1분 뒤", "$h1  −${end - h1}", y); y += 7.5f * u
                if (h2 > 0) { kv(cv, "2분 뒤", "$h2  −${end - h2}", y); y += 7.5f * u }
                val d = end - h1
                text(cv, if (d >= 20) "회복이 빨라요 · 1분에 20 넘게" else if (d >= 12) "회복 보통 · 1분에 12~19" else "회복이 느린 편 · 1분에 12 아래", cx, y, 4.8f * u, if (d >= 20) BLUE else if (d >= 12) RunView.GOLD else CORAL, true); y += 3 * u
            }
            else -> { for (l in wrap("심박이 재지지 않아 회복은 못 쟀어요", 4.6f * u, false, R - L - 6 * u)) { text(cv, l, cx, y, 4.6f * u, MUTED); y += 5.6f * u } }
        }
        y += 2 * u; rule(cv, y); return y + 12 * u
    }

    // 바탕은 존2 띠만(다른 존은 심박 선 색으로 구분). yH는 칸 밖이면 가장자리로 붙여 주는 함수라 그대로 써요
    private fun zoneBands(cv: Canvas, x0: Float, x1: Float, yH: (Int) -> Float) {
        for (z in 0 until 5) { val a = yH(if (z == 4) r.hrMaxSet + 60 else r.zoneLo(z + 1)); val b = yH(r.zoneLo(z))
            if (z == 1 && b - a > .5f) cv.drawRect(x0, a, x1, b, paint(RunView.alpha(RunView.ZONE[z], 0x34))) }   // 존2 띠만(2026-10-23 '후')
    }

    private fun graph(cv: Canvas, top: Float, bot: Float) {
        val all = r.series; val step = maxOf(1, all.size / 160); val s = all.filterIndexed { i, _ -> i % step == 0 || i == all.size - 1 }
        val t0 = s.first().t.toFloat(); val t1 = maxOf(s.last().t.toFloat(), t0 + 60000f)
        fun xOf(t: Long) = L + (R - L) * (t - t0) / (t1 - t0)
        val hLo = r.hrMaxSet * .5f; val hHi = r.hrMaxSet.toFloat()
        fun yH(h: Int) = bot - (bot - top) * ((h - hLo) / (hHi - hLo)).coerceIn(0f, 1f)
        zoneBands(cv, L, R) { yH(it) }
        paint(RunView.LINE); p.strokeWidth = .3f * u; cv.drawLine(L, bot, R, bot, p)
        val sm = s.indices.map { i -> (maxOf(0, i - 2)..minOf(s.size - 1, i + 2)).mapNotNull { j -> s[j].pace?.takeIf { it < 900000 } }.let { l -> if (s[i].pace == null || l.isEmpty()) null else l.average() } }
        val ps = sm.filterNotNull()
        if (ps.size >= 2) { val lo = ps.minOrNull()!! - 10000; val hi = ps.maxOrNull()!! + 10000; val path = Path(); var first = true
            s.forEachIndexed { i, q -> val pc = sm[i]; if (pc != null) { val x = xOf(q.t); val y = top + (bot - top) * ((pc - lo) / (hi - lo)).toFloat(); if (first) path.moveTo(x, y) else path.lineTo(x, y); first = false } }
            paint(CORAL); p.style = Paint.Style.STROKE; p.strokeWidth = .8f * u; p.strokeJoin = Paint.Join.ROUND; cv.drawPath(path, p) }
        val hs = s.filter { it.hr > 0 }
        if (hs.size >= 2) { paint(RED); p.style = Paint.Style.STROKE; p.strokeWidth = 1f * u; p.strokeCap = Paint.Cap.ROUND
            for (i in 1 until hs.size) { val a = hs[i - 1]; val b = hs[i]
                p.color = RunView.ZONE[((a.hr + b.hr) / 2.0 / r.hrMaxSet).let { f -> when { f < .6 -> 0; f < .7 -> 1; f < .8 -> 2; f < .9 -> 3; else -> 4 } }]
                cv.drawLine(xOf(a.t), yH(a.hr), xOf(b.t), yH(b.hr), p) } }
        text(cv, "0", L, bot + 4.6f * u, 4.4f * u, MUTED, num = true, al = Paint.Align.LEFT)
        text(cv, fmtTime(s.last().t - s.first().t), R, bot + 4.6f * u, 4.4f * u, MUTED, num = true, al = Paint.Align.RIGHT)
    }

    override fun onMeasure(wSpec: Int, hSpec: Int) {
        W = MeasureSpec.getSize(wSpec).toFloat(); u = min(W, resources.displayMetrics.heightPixels.toFloat()) / 100f; cx = W / 2
        setMeasuredDimension(W.toInt(), drawAll(null).toInt())
    }
    override fun onDraw(cv: Canvas) { cv.drawColor(Color.BLACK); drawAll(cv) }
}
