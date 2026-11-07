package io.github.gilbertgo.mdrun

import android.content.Context
import org.json.JSONArray
import java.io.File
import java.net.URLEncoder
import kotlin.concurrent.thread
import kotlin.math.*

// 등산 도우미 (2026-11-07 '등산앱 조사 → 1~4 다 만들어', 휴대폰 index.html과 같은 셈)
// ① 산 정상 자료: OpenStreetMap natural=peak(이름 있는 것)를 0.2° 칸마다 받아 files/peaks/{칸}.json에 90일 둠(산속에서 인터넷이 끊겨도 씀)
// ② 해 지는 시각 ③ 국가지점번호(UTM-K 100km 칸 가~사 + 10m 단위 4자리씩)
data class Peak(val n: String, val lat: Double, val lng: Double, val ele: Int)

object Peaks {
    @Volatile var app: Context? = null
    private val mem = HashMap<String, List<Peak>>()
    private val busy = HashSet<String>(); private val failAt = HashMap<String, Long>()
    fun key(lat: Double, lng: Double) = "${floor(lat * 5).toInt()}_${floor(lng * 5).toInt()}"
    private fun file(c: Context, k: String) = File(File(c.filesDir, "peaks").apply { mkdirs() }, "$k.json")

    // 가진 게 있으면 바로, 없으면 받으러 보내고 null
    fun cached(lat: Double, lng: Double): List<Peak>? {
        val c = app ?: return null; val k = key(lat, lng)
        synchronized(mem) { mem[k]?.let { return it } }
        val f = file(c, k)
        if (f.exists() && System.currentTimeMillis() - f.lastModified() < 90L * 86400000) {
            val l = parse(f.readText()); synchronized(mem) { mem[k] = l }; return l }
        fetch(c, k)
        return if (f.exists()) parse(f.readText()) else null
    }
    private fun parse(s: String): List<Peak> = try { val a = JSONArray(s); (0 until a.length()).map { i -> val q = a.getJSONArray(i); Peak(q.getString(0), q.getDouble(1), q.getDouble(2), q.optInt(3)) } } catch (e: Exception) { emptyList() }
    private fun fetch(c: Context, k: String) {
        synchronized(busy) { if (k in busy || System.currentTimeMillis() - (failAt[k] ?: 0) < 120000) return; busy.add(k) }
        thread {
            try {
                val (a, b) = k.split("_").map { it.toInt() }; val s = a / 5.0; val w = b / 5.0
                val q = "[out:json][timeout:25];node[\"natural\"=\"peak\"][\"name\"]($s,$w,${s + .2},${w + .2});out body;"
                val (code, txt) = Updater.getText(c, "https://overpass-api.de/api/interpreter?data=" + URLEncoder.encode(q, "UTF-8"))
                if (code != 200) throw Exception("overpass $code")
                val els = org.json.JSONObject(txt).optJSONArray("elements") ?: JSONArray(); val out = JSONArray()
                for (i in 0 until els.length()) { val o = els.getJSONObject(i); val t = o.optJSONObject("tags") ?: continue
                    val n = t.optString("name:ko").ifEmpty { t.optString("name") }.take(30); if (n.isEmpty()) continue
                    out.put(JSONArray().put(n).put(o.getDouble("lat")).put(o.getDouble("lon")).put(t.optString("ele").takeWhile { it.isDigit() }.toIntOrNull() ?: 0)) }
                file(c, k).writeText(out.toString()); synchronized(mem) { mem[k] = parse(out.toString()) }
            } catch (e: Exception) { synchronized(busy) { failAt[k] = System.currentTimeMillis() } }
            finally { synchronized(busy) { busy.remove(k) }; Updater.releaseNet(c) }
        }
    }

    // 해 지는 시각(ms), 없으면 null (일출·일몰 공식, 1분 안팎)
    fun sunset(lat: Double, lng: Double, ts: Long = System.currentTimeMillis()): Long? {
        val r = PI / 180; val J = ts / 864e5 + 2440587.5; val n = Math.round(J - 2451545 + lng / 360).toDouble()
        val js = n - lng / 360; val M = (357.5291 + 0.98560028 * js) % 360; val mr = M * r
        val C = 1.9148 * sin(mr) + 0.02 * sin(2 * mr) + 0.0003 * sin(3 * mr); val lam = ((M + C + 180 + 102.9372) % 360) * r
        val jt = 2451545 + js + 0.0053 * sin(mr) - 0.0069 * sin(2 * lam); val sd = sin(lam) * sin(23.4397 * r); val cd = cos(asin(sd))
        val cw = (sin(-0.833 * r) - sin(lat * r) * sd) / (cos(lat * r) * cd); if (cw > 1 || cw < -1) return null
        return ((jt + acos(cw) / r / 360 - 2440587.5) * 864e5).toLong()
    }

    // 국가지점번호 '다사 5390 5203' (한국 밖이면 "")
    fun kgrid(lat: Double, lng: Double): String {
        val a = 6378137.0; val f = 1 / 298.257222101; val e2 = f * (2 - f); val ep2 = e2 / (1 - e2); val k0 = 0.9996; val r = PI / 180
        val ph = lat * r; val ph0 = 38 * r
        fun mf(q: Double) = a * ((1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2.pow(3) / 256) * q - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2.pow(3) / 1024) * sin(2 * q) + (15 * e2 * e2 / 256 + 45 * e2.pow(3) / 1024) * sin(4 * q) - (35 * e2.pow(3) / 3072) * sin(6 * q))
        val N = a / sqrt(1 - e2 * sin(ph).pow(2)); val T = tan(ph).pow(2); val C = ep2 * cos(ph).pow(2); val A = (lng - 127.5) * r * cos(ph)
        val x = 1000000 + k0 * N * (A + (1 - T + C) * A.pow(3) / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A.pow(5) / 120)
        val y = 2000000 + k0 * (mf(ph) - mf(ph0) + N * tan(ph) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A.pow(4) / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A.pow(6) / 720))
        val L = "가나다라마바사"; val cx = floor((x - 700000) / 100000).toInt(); val cy = floor((y - 1300000) / 100000).toInt()
        if (cx !in 0..6 || cy !in 0..6) return ""
        fun q(v: Double) = String.format("%04d", floor((v % 100000) / 10).toInt())
        return "${L[cx]}${L[cy]} ${q(x)} ${q(y)}"
    }
}
