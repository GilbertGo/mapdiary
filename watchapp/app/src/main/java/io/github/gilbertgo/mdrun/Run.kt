package io.github.gilbertgo.mdrun

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.roundToLong
import kotlin.math.sin
import kotlin.math.sqrt

// ---------- 러닝 한 번의 계산 (휴대폰 MD Run의 러닝 코드를 시계로 옮긴 것) ----------
// 위치 점이 오면 거리·움직인 시간·1km 구간을 세고, 목표·코치 말을 정해요.
// 화면(MainActivity)과 기록 도우미(RunService)가 같이 써요.

const val TRACK_MIN_M = 15.0          // 15m 넘게 움직여야 새 점
const val TRACK_MAX_ACC = 60f         // GPS 오차가 60m보다 크면 버려요
const val CAR_MS = 25 / 3.6           // 이보다 빠르면 차(탈것)로 보고 거리에서 빼요
const val PAUSE_MS = 15000L           // 15초 넘게 새 점이 없으면 멈춘 것

class Pt(val lat: Double, val lng: Double, val t: Long, val alt: Double?)

// 목표: free 자유 달리기 / dist (v km, t 완주 목표 초) / time (v 분, d 목표 km)
data class Goal(val k: String = "free", val v: Double = 0.0, val t: Int = 0, val d: Double = 0.0) {
    fun label(): String = when (k) {
        "dist" -> if (v == 21.0975) "하프" else if (v == 42.195) "풀코스" else "${num(v)}km"
        "time" -> minLabel(v.toInt())
        else -> "자유 달리기"
    }
    fun say(): String = when (k) {
        "dist" -> if (v == 21.0975) "하프 코스" else if (v == 42.195) "풀코스" else "${num(v)}킬로미터"
        "time" -> minLabel(v.toInt())
        else -> ""
    }
    fun tgtLabel(): String = if (k == "dist" && t > 0) fmtTime(t * 1000L) else if (k == "time" && d > 0) "${num(d)}km" else ""
    fun tgtPace(): Double = if (k == "dist" && t > 0) t * 1000.0 / v else if (k == "time" && d > 0) v * 60000.0 / d else 0.0   // 1km에 몇 ms
    fun toJson(): JSONObject = JSONObject().put("k", k).put("v", v).apply { if (t > 0) put("t", t); if (d > 0) put("d", d) }
    companion object {
        fun from(o: JSONObject?): Goal {
            if (o == null) return Goal()
            val k = o.optString("k", "free"); val v = o.optDouble("v", 0.0)
            return if ((k == "dist" || k == "time") && v > 0) Goal(k, v, o.optInt("t", 0), o.optDouble("d", 0.0)) else Goal()
        }
    }
}

fun num(v: Double): String = if (v % 1.0 == 0.0) v.toLong().toString() else String.format("%.2f", v).trimEnd('0').trimEnd('.')
fun minLabel(v: Int): String = if (v >= 60) "${v / 60}시간" + (if (v % 60 > 0) " ${v % 60}분" else "") else "${v}분"
fun dist(a: Double, b: Double, c: Double, d: Double): Double {
    val r = { x: Double -> x * Math.PI / 180 }
    val x = sin(r(c - a) / 2).let { it * it } + cos(r(a)) * cos(r(c)) * sin(r(d - b) / 2).let { it * it }
    return 2 * 6371000.0 * asin(sqrt(x))
}
// 00:00 / 1:00:00
fun fmtTime(ms: Long): String {
    val s = max(0L, ms / 1000); val h = s / 3600; val m = (s / 60) % 60; val ss = s % 60
    return if (h > 0) String.format("%d:%02d:%02d", h, m, ss) else String.format("%02d:%02d", m, ss)
}
// 5'40"  (1km에 걸린 ms)
fun fmtPace(msPerKm: Double?): String {
    if (msPerKm == null || msPerKm <= 0 || msPerKm.isNaN() || msPerKm > 3600000) return "-"
    val s = (msPerKm / 1000).roundToInt(); return "${s / 60}'${String.format("%02d", s % 60)}\""
}
fun fmtKm(m: Double): String = if (m < 10000) String.format("%.2f", m / 1000) else String.format("%.1f", m / 1000)
fun fmtDist(m: Double): String = if (m < 1000) "${(m / 10).roundToInt() * 10}m" else "${String.format("%.1f", m / 1000)}km"
// 목소리용: 1분 35초 / 1시간 5분 / 40초
fun sayDur(ms: Double): String {
    val s = max(1L, (ms / 1000).roundToLong()); val h = s / 3600; val m = (s / 60) % 60; val r = s % 60
    return if (h > 0) "${h}시간" + (if (m > 0) " ${m}분" else "") else if (m > 0) "${m}분" + (if (r > 0) " ${r}초" else "") else "${r}초"
}
fun sayKm(m: Double): String = if (m < 1000) "${max(10, (m / 10).roundToInt() * 10)}미터" else "${num(Math.round(m / 100) / 10.0)}킬로"

// 지금 예상: 거리 목표 → 완주 예상 시간(pred ms), 시간 목표 → 예상 거리(pred m). 목표치가 있으면 diff(+면 목표보다 좋음)
class Judge(val pred: Double, val diff: Double?, val near: Double, val need: Double, val cur: Double,
            val rem: Double = 0.0, val target: Double = 0.0, val tLeft: Double = 0.0, val remD: Double = 0.0)

object Run {
    var id: String? = null
    var startAt = 0L
    var name = ""
    val pts = ArrayList<Pt>()
    var walk = 0.0            // 달린 거리 m (차·끊긴 구간 뺌)
    var moving = 0L           // 움직인 시간 ms (멈춘 시간 뺌)
    val splits = ArrayList<Long>()
    var goal = Goal()
    var goalDone = false
    var manualPause = false
    private var brk = false   // 멈췄다 다시 달리면 그 사이는 거리에 안 넣어요
    var lastAcc = -1f
    var fixT = 0L   // 마지막으로 GPS 위치가 온 때(버린 점 포함)
    var gpsOn = false
    // 심박
    var hrEvT = 0L; var hrNoContact = false; var hrPerm = true   // 심박 센서 상태: 마지막으로 값이 온 때 · 손목에 안 닿음 · 권한
    var hr = 0; var hrT = 0L; var hrSum = 0L; var hrN = 0; var hrMax = 0
    // 심박 존 (2026-10-19, 사용자 '존투러닝 중요해'): 최대 심박(hrMaxSet)의 50~60% 존1 · 60~70% 존2 · 70~80% 존3 · 80~90% 존4 · 90%~ 존5
    var hrMaxSet = 170; var z2Alert = false
    val zoneMs = LongArray(5); private var zT = 0L; private var zLast = 0
    private var overSince = 0L; private var underSince = 0L; private var zSaid = 0L
    fun zoneOf(bpm: Int): Int { val f = bpm.toDouble() / hrMaxSet; return when { f < .6 -> 0; f < .7 -> 1; f < .8 -> 2; f < .9 -> 3; else -> 4 } }
    fun zoneLo(z: Int) = (hrMaxSet * (.5 + .1 * z)).roundToInt()   // z: 0~4 (존1~존5)
    // 걸음 (휴대폰의 걸음 수 센서. 처음 값을 0으로)
    private var stepBase = -1; private var stepOff = 0; var steps = 0
    private val stepS = ArrayDeque<Pair<Long, Int>>()
    private val spdS = ArrayDeque<Pair<Long, Float>>()   // GPS가 알려 준 속도(m/s), 최근 20초
    // 목소리·진동 (RunService가 채워요)
    var speak: (String) -> Unit = {}
    var speaking: () -> Boolean = { false }
    var buzz: (LongArray) -> Unit = {}
    var voice = true
    var saidAt = 0L
    private val coachSaid = HashMap<String, Int>()
    private var hold = 0L

    val running get() = id != null
    val lastT get() = pts.lastOrNull()?.t ?: startAt

    fun begin(now: Long, g: Goal, title: String) {
        id = "run_w" + java.lang.Long.toString(now, 36); startAt = now; name = title
        pts.clear(); splits.clear(); walk = 0.0; moving = 0L; goal = g; goalDone = false; manualPause = false; brk = false
        hr = 0; hrT = 0; hrSum = 0; hrN = 0; hrMax = 0; zoneMs.fill(0); zT = 0; series.clear(); lastSample = 0; stepIv.clear(); stepG.clear(); lastPk = 0; inPk = false; overSince = 0; underSince = 0; zSaid = 0; stepBase = -1; stepOff = 0; steps = 0; stepS.clear(); spdS.clear(); coachSaid.clear(); hold = 0; saidAt = 0
    }
    fun clear() { id = null; pts.clear(); splits.clear() }

    fun say(text: String) { if (!voice) return; saidAt = System.currentTimeMillis(); speak(text) }

    // ---------- 위치 ----------
    fun addPoint(lat: Double, lng: Double, acc: Float, alt: Double?, now: Long): Boolean {
        lastAcc = acc; gpsOn = true; fixT = now
        if (id == null || manualPause || acc > TRACK_MAX_ACC) return false
        val last = pts.lastOrNull()
        if (last != null && dist(last.lat, last.lng, lat, lng) < TRACK_MIN_M) return false
        if (last != null && !brk) {
            val dt = (now - last.t) / 1000.0; val d = dist(last.lat, last.lng, lat, lng); val v = if (dt > 0) d / dt else 0.0
            val gap = dt > 300 && d > 150   // 5분 넘게 끊겼다가 150m 넘게 떨어져 이어진 곳
            if (!gap && v <= CAR_MS) walk += d
            if (!gap && dt <= 60 && v >= 0.7 && v <= CAR_MS) moving += now - last.t
        }
        brk = false
        pts.add(Pt(lat, lng, now, alt))
        splitCheck(); goalCheck(); coachTick()
        return true
    }

    fun setPause(on: Boolean) {
        if (manualPause == on) return
        manualPause = on; if (on) brk = true
        say(if (on) "기록을 멈췄어요." else "다시 기록해요.")
    }

    // 현재 페이스: 최근에 움직인 30초 (멈춘 구간은 건너뛰고 2분 전까지)
    fun nowPace(now: Long): Double? {
        if (manualPause) return null
        return distPace(now) ?: speedPace(now)
    }
    private fun distPace(now: Long): Double? {
        val n = pts.size; if (n < 2) return null
        // 2026-10-23 걸을 때 안 나왔음: 15m마다 점이라 걸으면 12~15초마다 와서 '15초 지나면 멈춤'·'30초 안 50m'를 못 채웠음
        //   → 기다리는 시간은 지난 점 간격의 1.6배(15~40초), 50m가 찰 때까지 더 거슬러 봄(2분 안)
        val t1 = pts[n - 1].t; val gap0 = t1 - pts[n - 2].t
        if (now - t1 > maxOf(PAUSE_MS, minOf(40000L, (gap0 * 1.6).toLong()))) return null
        var d = 0.0; var t = 0L; var i = n - 1
        while (i > 0 && (t < 30000 || d < 50) && t1 - pts[i - 1].t <= 120000) {
            val dt = pts[i].t - pts[i - 1].t; val dd = dist(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng)
            if (dt > 0 && dd / (dt / 1000.0) >= 0.7) { d += dd; t += dt }
            i--
        }
        return if (t >= 15000 && d >= 50) t / (d / 1000) else null
    }
    // GPS 속도(도플러)로 셈한 페이스: 점이 15m마다라 걸으면 거리로는 자주 비어서 이걸로 메꿔요 (2026-10-24 사용자 '잠깐 나왔는데 다시 안 나와, 계속 걷는 중')
    fun onSpeed(v: Float, acc: Float, now: Long) {
        if (id == null || acc > TRACK_MAX_ACC) return
        spdS.addLast(now to v); while (spdS.isNotEmpty() && now - spdS.first().first > 20000) spdS.removeFirst()
    }
    private fun speedPace(now: Long): Double? {
        val r = spdS.filter { now - it.first <= 15000 }
        if (r.size < 3 || now - r.last().first > 5000) return null
        val v = r.map { it.second.toDouble() }.average()
        return if (v >= 0.7 && v <= CAR_MS) 1000000.0 / v else null
    }
    fun avgPace(): Double? = if (walk >= 50 && moving > 0) moving / (walk / 1000) else null
    // 달린 시간을 1초마다 흐르게 (마지막 점 뒤 12초까지만, 뒤로 줄지 않게)
    fun liveMoving(now: Long): Long {
        var v = moving
        if (!manualPause && pts.size > 1) { val gap = now - lastT; if (gap < 12000) v += gap }
        hold = max(hold, v); return hold
    }
    fun paused(now: Long) = manualPause || (pts.size > 1 && now - lastT > PAUSE_MS)

    // ---------- 심박·걸음 ----------
    fun onHr(bpm: Int, now: Long) {
        if (bpm < 30 || bpm > 240) return
        hr = bpm; hrT = now
        if (id != null && !paused(now)) {
            hrSum += bpm; hrN++; hrMax = max(hrMax, bpm)
            if (zT > 0) zoneMs[zLast] += min(now - zT, 10000L)
            zLast = zoneOf(bpm); zT = now
            if (z2Alert) z2Check(bpm, now)
        } else zT = 0
    }
    // 존2 지키기: 존2보다 20초 넘게 높으면, 5분 지난 뒤 40초 넘게 낮으면 진동 + 목소리(1분 반에 한 번까지)
    private fun z2Check(bpm: Int, now: Long) {
        val hi = zoneLo(2); val lo = zoneLo(1)
        if (bpm >= hi) { if (overSince == 0L) overSince = now } else overSince = 0
        if (bpm < lo) { if (underSince == 0L) underSince = now } else underSince = 0
        if (now - zSaid < 90000) return
        if (overSince > 0 && now - overSince > 20000) { zSaid = now; buzz(longArrayOf(0, 220, 140, 220)); say("심박 ${bpm}, 존2보다 높아요. 조금 천천히요.") }
        else if (underSince > 0 && now - underSince > 40000 && now - startAt > 300000) { zSaid = now; buzz(longArrayOf(0, 120)); say("존2보다 낮아요. 조금 더 빠르게 달려도 돼요.") }
    }
    fun hrNow(now: Long) = if (now - hrT < 10000) hr else 0
    fun hrAvg() = if (hrN > 0) (hrSum / hrN).toInt() else 0
    fun onSteps(total: Int, now: Long) {
        if (id == null) return
        if (stepBase < 0) stepBase = total
        steps = stepOff + max(0, total - stepBase)
        stepS.addLast(now to steps)
        while (stepS.size > 2 && now - stepS.first().first > 20000) stepS.removeFirst()
    }
    fun cadNow(now: Long): Int? {
        if (stepS.size < 2) return null
        val a = stepS.first(); val b = stepS.last()
        if (now - b.first > 4000 || b.first - a.first < 8000 || b.second - a.second < 8) return null
        return ((b.second - a.second) / ((b.first - a.first) / 60000.0)).roundToInt()
    }
    // ---------- 그래프용 기록: 10초마다 (시작부터 ms, 심박, 페이스 ms/km) ----------
    class Sample(val t: Long, val hr: Int, val pace: Double?, val cad: Int? = null, val reg: Double? = null, val g: Double? = null)
    val series = ArrayList<Sample>(); private var lastSample = 0L
    // 저장한 [초, 심박, 페이스, 케이던스, 고르기×10, 충격×100] → Sample (0은 없음)
    fun sampleOf(q: JSONArray): Sample { val pc = q.optLong(2); val c = q.optInt(3); val r = q.optInt(4); val g = q.optInt(5)
        return Sample(q.optLong(0) * 1000, q.optInt(1), if (pc > 0) pc.toDouble() else null, if (c > 0) c else null, if (r > 0) r / 10.0 else null, if (g > 0) g / 100.0 else null) }
    fun sampleTick(now: Long) {
        if (id == null || paused(now) || now - lastSample < 10000) return
        lastSample = now; series.add(Sample(now - startAt, hrNow(now), nowPace(now), cadNow(now), formReg(now), formImpact(now)))
    }

    // ---------- 달리기 자세 (2026-10-19): 손목 흔들림 센서로 짐작한 대략값 ----------
    // 흔들림 크기가 평소보다 3 m/s² 넘게 튀었다 내려오면 한 번 착지로 셈(0.25초 간격 이상) → 최근 40번의 간격 고르기(%)·충격(G)
    private var accBase = 9.81; private var pkMax = 0.0; private var inPk = false; private var pkT = 0L; private var lastPk = 0L
    private val stepIv = ArrayDeque<Long>(); private val stepG = ArrayDeque<Double>()
    fun onAccel(x: Float, y: Float, z: Float, now: Long) {
        if (id == null || paused(now)) { inPk = false; return }
        val m = sqrt((x * x + y * y + z * z).toDouble())
        accBase = accBase * .98 + m * .02
        if (!inPk && m > accBase + 3) { inPk = true; pkMax = m; pkT = now }
        else if (inPk) {
            if (m > pkMax) { pkMax = m; pkT = now }
            if (m < accBase + 1) {
                inPk = false
                if (pkT - lastPk >= 250) {
                    if (lastPk > 0 && pkT - lastPk < 1500) { stepIv.addLast(pkT - lastPk); if (stepIv.size > 40) stepIv.removeFirst() }
                    stepG.addLast(pkMax / 9.81); if (stepG.size > 40) stepG.removeFirst()
                    lastPk = pkT
                }
            }
        }
    }
    // 걸음 고르기: 착지 간격이 들쭉날쭉한 정도(%), 작을수록 고름
    fun formReg(now: Long): Double? {
        if (stepIv.size < 15 || now - lastPk > 10000) return null
        val a = stepIv.average(); val sd = sqrt(stepIv.sumOf { (it - a) * (it - a) } / stepIv.size); return sd / a * 100
    }
    fun formImpact(now: Long): Double? = if (stepG.size < 15 || now - lastPk > 10000) null else stepG.sorted()[stepG.size / 2]
    // 보폭(m) = 1분에 간 거리 ÷ 1분 걸음 수
    fun stride(now: Long): Double? { val p = nowPace(now) ?: return null; val c = cadNow(now) ?: return null; return if (c < 60) null else (60000.0 / p * 1000) / c }

    fun cadAvg(): Int? = if (steps > 20 && moving > 60000) (steps / (moving / 60000.0)).roundToInt() else null

    // ---------- 1km 구간 · 목표 ----------
    private fun splitCheck() {
        val km = floor(walk / 1000).toInt(); if (km <= splits.size) return
        val n = km - splits.size; val lap = max(1000L, (moving - splits.sum()) / n)
        repeat(n) { splits.add(lap) }
        buzz(longArrayOf(0, 250, 150, 250))
        val g = goal; val left = if (g.k == "dist") g.v - km else 0.0
        val hit = g.k == "dist" && left <= 0 && !goalDone
        if (hit) goalDone = true
        val remT = if (g.k == "time") g.v * 60000 - moving else 0.0
        val co = coachLine(km); val sec = lap / 1000
        say("${km}킬로미터. 이번 1킬로 ${sec / 60}분 ${sec % 60}초." + when {
            hit -> " 목표 ${g.say()} 달성! 수고했어요."
            left >= 1 -> " 목표까지 ${num(Math.round(left * 10) / 10.0)}킬로 남았어요."
            remT >= 60000 && !goalDone -> " 목표 시간까지 ${(remT / 60000).roundToInt()}분 남았어요."
            else -> ""
        } + co)
    }
    private fun goalCheck() {
        val g = goal; if (g.k == "free" || goalDone) return
        val hit = if (g.k == "dist") walk >= g.v * 1000 else moving >= g.v * 60000
        if (hit) { goalDone = true; buzz(longArrayOf(0, 600, 200, 600)); say("목표 ${g.say()} 달성! 수고했어요.") }
    }

    // ---------- 러닝 코치 ----------
    // 예상은 지금까지 평균 페이스와 지난 1km 페이스를 반씩 섞어서 (막 지친 게 바로 반영되게)
    private fun coachPace(): Double { val avg = moving / walk; return if (splits.isNotEmpty()) avg * 0.5 + splits.last() / 1000.0 * 0.5 else avg }   // 1m에 몇 ms
    fun judge(): Judge? {
        val g = goal; if (g.k == "free" || walk < 100 || moving < 30000) return null
        val p = coachPace()
        if (g.k == "dist") {
            val rem = g.v * 1000 - walk; val pred = moving + max(0.0, rem) * p; val T = g.t * 1000.0
            return Judge(pred, if (T > 0) T - pred else null, if (T > 0) max(10000.0, T * 0.02) else 0.0,
                if (T > 0 && rem > 0) (T - moving) / rem * 1000 else 0.0, p * 1000, rem = rem, target = T)
        }
        val tLeft = g.v * 60000 - moving; val pred = walk + max(0.0, tLeft) / p; val D = g.d * 1000; val remD = D - walk
        return Judge(pred, if (D > 0) pred - D else null, if (D > 0) max(50.0, D * 0.02) else 0.0,
            if (D > 0 && remD > 0 && tLeft > 0) tLeft / remD * 1000 else 0.0, p * 1000, target = D, tLeft = tLeft, remD = remD)
    }
    private fun coachLine(km: Int): String {
        val g = goal; if (goalDone || walk < 500 || moving < 60000) return ""
        val out = ArrayList<String>(); val J = judge()
        if (J != null && g.k == "dist" && J.rem > 0) {
            if (g.v >= 3 && km >= g.v / 2 && km - 1 < g.v / 2) out.add("절반을 넘었어요.")
            if (J.rem <= 1000) out.add("마지막 1킬로예요. 힘내세요!")
            val d = J.diff
            if (d == null) out.add("이 페이스면 ${sayDur(J.pred)}쯤 완주해요.")
            else if (J.target <= moving) out.add("목표 시간 ${sayDur(J.target)}은 지났어요. 끝까지 완주해 봐요.")
            else if (abs(d) <= J.near) out.add("이대로면 목표 시간에 딱 맞춰 들어와요. 지금 페이스를 지켜요.")
            else if (d > 0) out.add("이대로면 목표보다 ${sayDur(d)} 빨리 들어와요." + if (walk < g.v * 1000 / 3 && d > J.target * 0.05) " 초반이 빨라요. 조금 늦춰서 힘을 아껴 두세요." else " 좋아요, 이대로 가요.")
            else if (J.need < J.cur * (if (J.rem > 1000) 0.92 else 0.85)) {
                out.add("이대로면 목표보다 ${sayDur(-d)} 늦어요." + if (coachSaid.containsKey("hard")) "" else if (J.rem > 1000) " 이번엔 목표 시간이 어려워 보여요. 무리하지 말고 편한 페이스로 끝까지 가요." else " 이번엔 목표 시간이 어려워 보여요. 끝까지 완주해요.")
                coachSaid["hard"] = km
            } else out.add("이대로면 목표보다 ${sayDur(-d)} 늦어요. 남은 길을 1킬로 ${sayDur(J.need)} 페이스로 달리면 목표 안에 들어와요.")
        } else if (J != null && g.k == "time" && J.tLeft > 60000) {
            val d = J.diff
            if (d == null) out.add("이 페이스면 ${minLabel(g.v.toInt())} 동안 ${sayKm(J.pred)}쯤 달려요.")
            else if (J.remD <= 0) out.add("목표 거리 ${sayKm(J.target)}는 벌써 넘었어요. 남은 시간은 편하게 달려요.")
            else if (abs(d) <= J.near) out.add("이대로면 목표 거리에 딱 맞춰요. 지금 페이스를 지켜요.")
            else if (d > 0) out.add("이대로면 목표보다 ${sayKm(d)} 더 달려요. 좋아요, 이대로 가요.")
            else if (J.need < J.cur * (if (J.tLeft > 5 * 60000) 0.92 else 0.85)) {
                out.add("이대로면 목표보다 ${sayKm(-d)} 모자라요." + if (coachSaid.containsKey("hard")) "" else " 이번엔 목표 거리가 어려워 보여요. 무리하지 말고 편하게 끝까지 가요.")
                coachSaid["hard"] = km
            } else out.add("이대로면 목표보다 ${sayKm(-d)} 모자라요. 1킬로 ${sayDur(J.need)} 페이스로 달리면 목표에 닿아요.")
        }
        // 페이스가 처음 두 구간보다 8% 넘게 느려지면 (3km 안에 한 번)
        if (splits.size >= 3 && !coachSaid.containsKey("hard") && splits.last() > (splits[0] + splits[1]) / 2.0 * 1.08 && (coachSaid["fade"] ?: -99) <= km - 3) {
            coachSaid["fade"] = km; out.add("페이스가 처음보다 떨어졌어요. 호흡을 고르고 팔을 조금 더 힘차게 흔들어 보세요.")
        }
        val c = cadNow(System.currentTimeMillis())
        if (c != null && c < 160 && km >= 2 && (coachSaid["cad"] ?: -99) <= km - 3) { coachSaid["cad"] = km; out.add("케이던스가 낮아요. 보폭을 조금 줄이고 발을 더 자주 디뎌 보세요.") }
        return if (out.isEmpty()) "" else " " + out.joinToString(" ")
    }
    // 1km 사이 점검: 남은 500m, 남은 5분·1분 (다른 안내를 말하는 중이면 다음에)
    fun coachTick() {
        val g = goal; if (id == null || g.k == "free" || goalDone || !voice) return
        if (System.currentTimeMillis() - saidAt < 15000 || speaking()) return
        val J = judge() ?: return
        if (g.k == "dist" && g.v >= 1.5 && J.rem > 0 && J.rem <= 500 && !coachSaid.containsKey("m500")) {
            coachSaid["m500"] = 1; val d = J.diff
            say("500미터 남았어요." + if (d == null || J.target <= moving) " 조금만 더 힘내세요!" else if (d >= 0) " 이대로면 목표 시간 안에 들어와요. 조금만 더!" else " 목표까지 ${sayDur(-d)} 모자라요. 마지막 힘을 내 봐요!")
        } else if (g.k == "time" && g.v >= 15 && J.tLeft <= 5 * 60000 && J.tLeft > 4 * 60000 && !coachSaid.containsKey("m5")) {
            coachSaid["m5"] = 1; say("5분 남았어요." + if (g.d > 0 && J.remD > 0) " 목표 거리까지 ${sayKm(J.remD)} 남았어요." else "")
        } else if (g.k == "time" && J.tLeft <= 60000 && J.tLeft > 20000 && !coachSaid.containsKey("m1")) {
            coachSaid["m1"] = 1; say("1분 남았어요. 마지막까지 힘내세요!" + if (g.d > 0 && J.remD > 0) " 목표 거리까지 ${sayKm(J.remD)}." else "")
        }
    }
    fun startLine(): String {
        val g = goal; val tp = g.tgtPace()
        return "달리기를 시작합니다." + if (tp > 0) " 목표는 ${g.say()} " + (if (g.k == "dist") "${sayDur(g.t * 1000.0)} 완주" else "동안 ${sayKm(g.d * 1000)}") + ", 1킬로 ${sayDur(tp)} 페이스예요." else ""
    }

    // ---------- 저장 모양: Map Diary 백업 파일과 같은 키 (나중에 휴대폰으로 넘기기 쉽게) ----------
    fun toJson(): JSONObject {
        val id = id ?: ""
        val tr = JSONArray(); pts.forEach { p -> tr.put(JSONArray().put(round6(p.lat)).put(round6(p.lng)).put(p.t).apply { if (p.alt != null) put(p.alt.roundToInt()) }) }
        val data = JSONObject()
            .put("track:$id", tr.toString())
            .put("trackName:$id", JSONObject.quote(name))
            .put("walkMode:$id", "\"run\"")
            .put("walkSplits:$id", JSONArray(splits).toString())
            .put("walkSteps:$id", JSONObject().put("n", steps).toString())
            .put("walkHr:$id", JSONObject().put("avg", hrAvg()).put("max", hrMax).put("zone", JSONArray(zoneMs.toList())).put("hrMaxSet", hrMaxSet).toString())
        if (goal.k != "free") { data.put("walkGoal:$id", goal.toJson().toString()); data.put("walkGoalDone:$id", goalDone.toString()) }
        val sum = JSONObject().put("walk", walk).put("moving", moving).put("hrAvg", hrAvg()).put("hrMax", hrMax).put("steps", steps).put("cad", cadAvg() ?: 0).put("zone", JSONArray(zoneMs.toList())).put("hrMaxSet", hrMaxSet)
        return JSONObject().put("app", "MD Run Watch").put("v", 1).put("id", id).put("name", name).put("at", startAt).put("end", lastT)
            .put("goal", goal.toJson()).put("goalDone", goalDone).put("pause", manualPause).put("sum", sum).put("data", data)
            .put("series", JSONArray().apply { series.forEach { s -> put(JSONArray().put(s.t / 1000).put(s.hr).put(s.pace?.roundToLong() ?: 0).put(s.cad ?: 0).put(((s.reg ?: 0.0) * 10).roundToInt()).put(((s.g ?: 0.0) * 100).roundToInt())) } })
    }
    private fun round6(v: Double) = Math.round(v * 1e6) / 1e6
    // 기록 도우미가 꺼졌다 다시 켜졌을 때(시계가 앱을 정리한 경우) 이어서 기록해요
    fun restore(o: JSONObject) {
        val i = o.getString("id"); val data = o.getJSONObject("data")
        begin(o.getLong("at"), Goal.from(o.optJSONObject("goal")), o.optString("name"))
        id = i; goalDone = o.optBoolean("goalDone"); manualPause = o.optBoolean("pause"); brk = true
        val tr = JSONArray(data.optString("track:$i", "[]"))
        for (k in 0 until tr.length()) { val q = tr.getJSONArray(k); pts.add(Pt(q.getDouble(0), q.getDouble(1), q.getLong(2), if (q.length() > 3 && !q.isNull(3)) q.getDouble(3) else null)) }
        val sp = JSONArray(data.optString("walkSplits:$i", "[]")); for (k in 0 until sp.length()) splits.add(sp.getLong(k))
        val s = o.optJSONObject("sum"); if (s != null) { walk = s.optDouble("walk"); moving = s.optLong("moving"); hrMax = s.optInt("hrMax"); steps = s.optInt("steps"); stepOff = steps
            s.optJSONArray("zone")?.let { z -> for (k in 0 until minOf(5, z.length())) zoneMs[k] = z.optLong(k) } }
        o.optJSONArray("series")?.let { a -> for (k in 0 until a.length()) { val q = a.getJSONArray(k); series.add(sampleOf(q)) } }
    }
}
