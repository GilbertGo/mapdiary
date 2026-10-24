package io.github.gilbertgo.mdrun

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.ln
import kotlin.math.tan

// 지도 조각(OpenStreetMap 256px): 본 조각만 받아 files/tiles에 남겨 두고 다시 씀 (휴대폰 mdTileLayer와 같은 생각, 넓게 미리 받기는 안 함)
// 받는 건 한 줄씩(쓰레드 하나), 못 받으면 1분 뒤 다시. 다 받으면 onReady로 화면을 다시 그려요
object Tiles {
    private val mem = object : LinkedHashMap<String, Bitmap>(40, .75f, true) {
        override fun removeEldestEntry(e: MutableMap.MutableEntry<String, Bitmap>) = size > 30
    }
    private val busy = HashSet<String>(); private val failT = HashMap<String, Long>()
    private val pool = Executors.newSingleThreadExecutor()
    var onReady: (() -> Unit)? = null
    @Volatile var lastFail = 0L; @Volatile var lastOk = 0L

    // 위도·경도 → 그 확대(z)의 세계 픽셀 좌표(조각 하나 256)
    fun px(lng: Double, z: Int) = (lng + 180) / 360 * 256 * (1 shl z)
    fun py(lat: Double, z: Int): Double { val r = Math.toRadians(lat); return (1 - ln(tan(r) + 1 / cos(r)) / PI) / 2 * 256 * (1 shl z) }

    // 있으면 바로, 없으면 null을 주고 받기 시작
    fun get(c: Context, z: Int, x: Int, y: Int): Bitmap? {
        val n = 1 shl z; if (y < 0 || y >= n) return null
        val xx = ((x % n) + n) % n; val key = "$z/$xx/$y"
        synchronized(this) { mem[key]?.let { return it }; if (key in busy) return null
            if (System.currentTimeMillis() - (failT[key] ?: 0L) < 60000) return null; busy.add(key) }
        pool.execute {
            var bmp: Bitmap? = null
            val f = File(c.filesDir, "tiles/$key.png")
            try {
                if (f.exists() && System.currentTimeMillis() - f.lastModified() < 30L * 86400000) bmp = BitmapFactory.decodeFile(f.path)
                if (bmp == null) {
                    val conn = URL("https://tile.openstreetmap.org/$key.png").openConnection() as HttpURLConnection
                    conn.connectTimeout = 15000; conn.readTimeout = 15000
                    conn.setRequestProperty("User-Agent", "MPD-Run-Watch/0.1 (+https://gilbertgo.github.io/mapdiary/)")
                    try {
                        if (conn.responseCode == 200) { val b = conn.inputStream.use { it.readBytes() }
                            bmp = BitmapFactory.decodeByteArray(b, 0, b.size)
                            if (bmp != null) { f.parentFile?.mkdirs(); f.writeBytes(b); lastOk = System.currentTimeMillis() } }
                    } finally { conn.disconnect() }
                }
            } catch (e: Exception) {}
            // 인터넷이 없으면 오래된 조각이라도
            if (bmp == null && f.exists()) bmp = try { BitmapFactory.decodeFile(f.path) } catch (e: Exception) { null }
            synchronized(this) { busy.remove(key); if (bmp != null) mem[key] = bmp!! else { failT[key] = System.currentTimeMillis(); lastFail = System.currentTimeMillis() } }
            if (bmp != null) onReady?.invoke()
        }
        return null
    }
}
