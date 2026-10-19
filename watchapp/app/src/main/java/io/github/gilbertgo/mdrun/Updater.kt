package io.github.gilbertgo.mdrun

import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.widget.Toast
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

// 앱 안에서 새 판 받기 (2026-10-19): Wear Installer 없이 시계 혼자 업데이트해요.
// GitHub Releases 'watch'의 설명 글 '판 0.1.N'에서 N(= versionCode)을 읽어 지금 판보다 크면
// MPD_run_watch.apk(없으면 예전 이름 MDRunWatch.apk)를 받아 PackageInstaller로 깔아요(같은 서명이라 기록 그대로). 처음 한 번은 '이 앱에서 설치 허용'을 켜야 해요.
object Updater {
    class Info(val code: Long, val name: String, val url: String)
    private const val API = "https://api.github.com/repos/GilbertGo/mapdiary/releases/tags/watch"
    private val main = Handler(Looper.getMainLooper())
    var busy = false

    fun current(c: Context): Long = try {
        val pi = c.packageManager.getPackageInfo(c.packageName, 0)
        if (Build.VERSION.SDK_INT >= 28) pi.longVersionCode else @Suppress("DEPRECATION") pi.versionCode.toLong()
    } catch (e: Exception) { 0L }
    fun currentName(c: Context): String = try { c.packageManager.getPackageInfo(c.packageName, 0).versionName ?: "" } catch (e: Exception) { "" }

    var lastErr = ""   // 마지막으로 알아볼 때 안 된 까닭(판 번호를 누르면 보여 줘요)
    // 새 판이 있으면 Info, 없거나 인터넷이 안 되면 null (화면 쓰레드로 돌려줘요)
    fun check(c: Context, cb: (Info?) -> Unit) {
        val cur = current(c)
        thread {
            val info = try {
                val conn = URL(API).openConnection() as HttpURLConnection
                conn.connectTimeout = 8000; conn.readTimeout = 8000; conn.setRequestProperty("Accept", "application/vnd.github+json")
                conn.setRequestProperty("User-Agent", "MPD-Run-Watch")
                if (conn.responseCode != 200) throw Exception("GitHub " + conn.responseCode)
                val o = JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
                lastErr = ""
                val m = Regex("0\\.1\\.(\\d+)").find(o.optString("body"))
                val assets = o.optJSONArray("assets"); var url = ""
                if (assets != null) for (i in 0 until assets.length()) { val a = assets.getJSONObject(i); val n = a.optString("name")
                    if (n == "MPD_run_watch.apk" || (url.isEmpty() && n.endsWith(".apk"))) url = a.optString("browser_download_url") }
                val code = m?.groupValues?.get(1)?.toLongOrNull() ?: 0L
                if (code > cur && url.isNotEmpty()) Info(code, "0.1.$code", url) else null
            } catch (e: Exception) { lastErr = (e.javaClass.simpleName + " " + (e.message ?: "")).take(80); null }
            if (info != null) lastErr = ""
            main.post { cb(info) }
        }
    }

    // 받아서 깔기. 설치 허용이 꺼져 있으면 설정 화면을 열어 줘요
    fun install(a: Activity, info: Info, say: (String) -> Unit) {
        if (busy) return
        if (!a.packageManager.canRequestPackageInstalls()) {
            say("'이 앱에서 설치 허용'을 켠 뒤 다시 눌러 주세요")
            try { a.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + a.packageName))) }
            catch (e: Exception) { say("설정 → 앱 → MPD Run → '알 수 없는 앱 설치'를 켜 주세요") }
            return
        }
        busy = true; say("새 판 ${info.name} 받는 중…")
        thread {
            try {
                val pi = a.packageManager.packageInstaller
                val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply { setAppPackageName(a.packageName) }
                val id = pi.createSession(params)
                pi.openSession(id).use { s ->
                    val conn = URL(info.url).openConnection() as HttpURLConnection
                    conn.connectTimeout = 15000; conn.readTimeout = 30000; conn.instanceFollowRedirects = true
                    s.openWrite("MPD_run_watch.apk", 0, -1).use { out -> conn.inputStream.use { it.copyTo(out) }; s.fsync(out) }
                    val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
                    val pend = PendingIntent.getBroadcast(a, id, Intent(a, UpdateReceiver::class.java), flags)
                    s.commit(pend.intentSender)
                }
                main.post { say("설치 확인 창이 뜨면 '업데이트'를 눌러 주세요") }
            } catch (e: Exception) {
                main.post { say("새 판을 못 받았어요. 와이파이를 확인해 주세요") }
            } finally { busy = false }
        }
    }
}

// 설치가 '사용자 확인'을 기다리면 확인 창을 띄우고, 실패하면 알려 줘요
class UpdateReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        when (i.getIntExtra(PackageInstaller.EXTRA_STATUS, -999)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                val confirm: Intent? = if (Build.VERSION.SDK_INT >= 33) i.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java) else @Suppress("DEPRECATION") i.getParcelableExtra(Intent.EXTRA_INTENT)
                confirm?.let { it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); try { c.startActivity(it) } catch (e: Exception) {} }
            }
            PackageInstaller.STATUS_SUCCESS -> {}
            else -> Toast.makeText(c, "업데이트가 안 됐어요: " + (i.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: ""), Toast.LENGTH_LONG).show()
        }
    }
}
