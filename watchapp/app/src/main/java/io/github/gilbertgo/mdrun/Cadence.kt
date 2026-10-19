package io.github.gilbertgo.mdrun

import android.content.Context
import android.media.AudioAttributes
import android.media.SoundPool
import android.os.Build
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.sin

// 케이던스 가이드 (2026-10-19, 사용자 '시계 앱에 케이던스 가이드 음 넣어'): 1분에 spm번 짧은 '뚝'(1500Hz, 휴대폰 웹과 같은 소리) 또는 톡 진동.
// 기록 도우미(RunService)가 켜고 끄며, 화면이 꺼져도 울려요. 달리는 중이고 멈춤이 아닐 때만, 목소리 안내 중엔 쉬어요.
// 박자는 처음 시각에서 n번째 박자 시각을 셈해 기다려서(밀리지 않게) 울려요
object Cadence {
    const val OFF = 0; const val SOUND = 1; const val VIB = 2; const val BOTH = 3
    var kind = OFF           // 0 끔 · 1 소리 · 2 진동 · 3 소리+진동
    var spm = 180
    var last = SOUND         // 켤 때 쓸 방식(달리는 중 '켬/끔'용)
    fun label(k: Int = kind) = when (k) { SOUND -> "소리"; VIB -> "진동"; BOTH -> "소리+진동"; else -> "끔" }
    fun load(c: Context) { kind = Store.cadKind(c); spm = Store.cadSpm(c); last = Store.cadLast(c) }
    fun set(c: Context, k: Int) { kind = k; if (k != OFF) last = k; Store.setCad(c, kind, spm, last) }
    fun setSpm(c: Context, v: Int) { spm = v.coerceIn(120, 220); Store.setCad(c, kind, spm, last) }

    @Volatile private var on = false
    private var th: Thread? = null
    private var pool: SoundPool? = null; private var sid = 0

    fun start(c: Context) {
        if (on) return; on = true
        val app = c.applicationContext
        pool = SoundPool.Builder().setMaxStreams(2).setAudioAttributes(AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()).build()
        try { sid = pool!!.load(clickFile(app).path, 1) } catch (e: Exception) {}
        val vib = try { if (Build.VERSION.SDK_INT >= 31) (app.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
            else @Suppress("DEPRECATION") (app.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator) } catch (e: Exception) { null }
        th = Thread {
            var t0 = 0L; var n = 0L; var curSpm = 0
            while (on) {
                val now = System.currentTimeMillis()
                val go = kind != OFF && Run.running && !Run.paused(now)
                if (!go) { t0 = 0; try { Thread.sleep(250) } catch (e: InterruptedException) {}; continue }
                if (t0 == 0L || curSpm != spm) { curSpm = spm; t0 = SystemClock.elapsedRealtime() + 150; n = 0 }
                val at = t0 + n * 60000L / curSpm; n++
                val wait = at - SystemClock.elapsedRealtime()
                if (wait > 0) try { Thread.sleep(wait) } catch (e: InterruptedException) {}
                else if (wait < -200) { t0 = 0; continue }   // 많이 밀렸으면 새로 맞춰요
                if (!on || Run.speaking()) continue
                val k = kind
                if (k == SOUND || k == BOTH) pool?.play(sid, 0.9f, 0.9f, 1, 0, 1f)
                if ((k == VIB || k == BOTH) && vib != null) try { vib.vibrate(VibrationEffect.createOneShot(18, 200)) } catch (e: Exception) {}
            }
        }.apply { isDaemon = true; name = "cadence"; priority = Thread.MAX_PRIORITY; start() }
    }
    fun stop() { on = false; th?.interrupt(); th = null; pool?.release(); pool = null }

    // 짧은 '뚝' 소리 파일(0.05초 1500Hz, 빨리 사라지게)을 한 번 만들어 둬요
    private fun clickFile(c: Context): File {
        val f = File(c.cacheDir, "click1500.wav"); if (f.exists() && f.length() > 44) return f
        val rate = 44100; val n = rate * 50 / 1000
        val pcm = ByteBuffer.allocate(n * 2).order(ByteOrder.LITTLE_ENDIAN)
        for (i in 0 until n) { val t = i.toDouble() / rate; val env = (if (i < 40) i / 40.0 else 1.0) * exp(-t * 90)
            pcm.putShort((sin(2 * PI * 1500 * t) * env * 30000).toInt().toShort()) }
        val h = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
        h.put("RIFF".toByteArray()).putInt(36 + n * 2).put("WAVE".toByteArray()).put("fmt ".toByteArray()).putInt(16).putShort(1).putShort(1)
            .putInt(rate).putInt(rate * 2).putShort(2).putShort(16).put("data".toByteArray()).putInt(n * 2)
        FileOutputStream(f).use { it.write(h.array()); it.write(pcm.array()) }
        return f
    }
}
