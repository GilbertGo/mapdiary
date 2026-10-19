package io.github.gilbertgo.mdrun

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import java.util.Calendar
import kotlin.math.min

// 시계 화면: 시작(목표 고르기) → 3·2·1 → 달리는 중(RunView) → 끝(저장) / 지난 기록
class MainActivity : ComponentActivity() {
    private lateinit var root: FrameLayout
    private val h = Handler(Looper.getMainLooper())
    private var runView: RunView? = null
    private var gpsText: TextView? = null
    private var upd: Updater.Info? = null; private var updChecked = false; private var atStart = false
    private var lm: LocationManager? = null
    private val gpsL = object : LocationListener {
        override fun onLocationChanged(l: Location) { Run.lastAcc = l.accuracy; Run.gpsOn = true; drawGps() }
        @Deprecated("old API") override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
        override fun onProviderEnabled(provider: String) {}
        override fun onProviderDisabled(provider: String) {}
    }
    private val PERMS = arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.BODY_SENSORS) +
        (if (Build.VERSION.SDK_INT >= 29) arrayOf(Manifest.permission.ACTIVITY_RECOGNITION) else emptyArray()) +
        (if (Build.VERSION.SDK_INT >= 33) arrayOf(Manifest.permission.POST_NOTIFICATIONS) else emptyArray())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        setContentView(root)
        Run.voice = Store.voice(this)
        // 화면이 어두워져도(앰비언트) 이 앱을 그대로 보여 줘요
        attachAmbient(this, { runView?.let { it.ambient = true; it.invalidate() } }, { runView?.invalidate() }, { runView?.let { it.ambient = false; it.invalidate() } })
        if (PERMS.any { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }) requestPermissions(PERMS, 1)
        // 기록 중이면(앱이 정리됐다 다시 켜진 경우 포함) 바로 달리는 화면으로
        if (Run.id == null) Store.loadCurrent(this)?.let { try { Run.restore(it) } catch (e: Exception) {} }
        if (Run.id != null) { RunService.warm(this); showRun() } else showStart()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (Run.id == null && gpsText != null) startGpsPreview()
    }

    override fun onDestroy() { stopGpsPreview(); super.onDestroy() }

    // ---------- 작은 도우미 ----------
    private val u get() = min(resources.displayMetrics.widthPixels, resources.displayMetrics.heightPixels) / 100f
    private fun tv(s: String, size: Float, color: Int = Color.WHITE, bold: Boolean = false) = TextView(this).apply {
        text = s; textSize = size; setTextColor(color); gravity = Gravity.CENTER; if (bold) typeface = Typeface.DEFAULT_BOLD
    }
    private fun btn(s: String, bg: Int, fg: Int = Color.WHITE, onClick: () -> Unit) = tv(s, 15f, fg, true).apply {
        background = GradientDrawable().apply { cornerRadius = 40 * u; setColor(bg) }
        setPadding((4 * u).toInt(), (3.2f * u).toInt(), (4 * u).toInt(), (3.2f * u).toInt())
        setOnClickListener { onClick() }
    }
    // 두 줄 단추: 위에 작은 회색 이름, 아래 흰 굵은 값, 오른쪽 ›
    private fun row(label: String, value: String, onClick: () -> Unit) = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        background = GradientDrawable().apply { cornerRadius = 40 * u; setColor(RunView.SURF) }
        setPadding((6 * u).toInt(), (2.4f * u).toInt(), (4 * u).toInt(), (2.4f * u).toInt())
        val col = LinearLayout(this@MainActivity).apply { orientation = LinearLayout.VERTICAL
            addView(tv(label, 10f, RunView.MUTED).apply { gravity = Gravity.START })
            addView(tv(value, 14f, Color.WHITE, true).apply { gravity = Gravity.START; maxLines = 1 }) }
        addView(col, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        addView(tv("›", 18f, RunView.MUTED))
        setOnClickListener { onClick() }
    }
    private fun lp(top: Float = 2f) = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = (top * u).toInt() }
    // 둥근 화면이라 위아래·옆에 여백을 두고, 용두(돌리는 버튼)로도 내려가게 해요
    private fun page(vararg views: View): ScrollView {
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL; setPadding((13 * u).toInt(), (14 * u).toInt(), (13 * u).toInt(), (24 * u).toInt()) }
        views.forEach { col.addView(it, lp()) }
        return ScrollView(this).apply { isVerticalScrollBarEnabled = false; addView(col); isFocusable = true; isFocusableInTouchMode = true; post { requestFocus() } }
    }
    private fun show(v: View) { runView = null; atStart = false; root.removeAllViews(); root.addView(v) }

    // ---------- 시작 화면 ----------
    private fun showStart() {
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val g = Store.goal(this)
        gpsText = tv("GPS 찾는 중…", 12f, RunView.MUTED)
        val tgt = when (g.k) { "dist" -> row("완주 목표 시간", if (g.t > 0) g.tgtLabel() else "정하지 않음") { showTarget() }
            "time" -> row("목표 거리", if (g.d > 0) g.tgtLabel() else "정하지 않음") { showTarget() }
            else -> null }
        val u0 = upd
        val views = listOfNotNull(
            tv("MPD Run", 15f, RunView.CORAL, true), gpsText,
            if (u0 != null) row("새 판이 있어요", "${u0.name} 설치하기") { Updater.install(this, u0) { m -> android.widget.Toast.makeText(this, m, android.widget.Toast.LENGTH_LONG).show() } } else null,
            row("목표", g.label()) { showGoal() }, tgt,
            if (g.tgtPace() > 0) tv("1km ${fmtPace(g.tgtPace())} 페이스", 11f, RunView.BLUE, true) else null,
            row("목소리 코치", if (Run.voice) "켬" else "끔") { Run.voice = !Run.voice; Store.setVoice(this, Run.voice); showStart() },
            btn("시작", RunView.CORAL, RunView.INK) { countdown() }.apply { textSize = 22f; setPadding(0, (4.6f * u).toInt(), 0, (4.6f * u).toInt()) },
            tv("지난 기록 ›", 13f, RunView.MUTED, true).apply { setPadding(0, (2 * u).toInt(), 0, (2 * u).toInt()); setOnClickListener { showHistory() } },
            tv("판 ${Updater.currentName(this)}", 9f, RunView.MUTED))
        show(page(*views.toTypedArray())); atStart = true
        startGpsPreview()
        // 새 판은 시작 화면을 처음 열 때 한 번 알아봐요(달리는 중엔 안 봐요)
        if (!updChecked) { updChecked = true; Updater.check(this) { i -> if (i != null) { upd = i; if (atStart && Run.id == null) showStart() } } }
    }
    private fun startGpsPreview() {
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) { gpsText?.text = "위치 권한을 허용해 주세요"; return }
        lm = lm ?: getSystemService(LOCATION_SERVICE) as LocationManager
        try { lm?.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 0f, gpsL, Looper.getMainLooper()) } catch (e: Exception) {}
        drawGps()
    }
    private fun stopGpsPreview() { try { lm?.removeUpdates(gpsL) } catch (e: Exception) {} }
    private fun drawGps() {
        val a = Run.lastAcc
        gpsText?.text = if (a < 0) "GPS 찾는 중 · 하늘이 트인 곳에서" else if (a <= 20) "● GPS 준비됐어요 · ${a.toInt()}m" else "● GPS 잡는 중 · ${a.toInt()}m"
        gpsText?.setTextColor(if (a in 0f..20f) RunView.BLUE else RunView.MUTED)
    }

    // 목표 고르기
    private fun showGoal() {
        val opts = listOf(Goal(), Goal("dist", 3.0), Goal("dist", 5.0), Goal("dist", 10.0), Goal("dist", 21.0975), Goal("dist", 42.195),
            Goal("time", 20.0), Goal("time", 30.0), Goal("time", 45.0), Goal("time", 60.0), Goal("time", 90.0))
        val cur = Store.goal(this)
        show(page(tv("목표", 15f, RunView.CORAL, true), *opts.map { g ->
            val on = g.k == cur.k && g.v == cur.v
            btn(g.label(), if (on) RunView.CORAL else RunView.SURF, if (on) RunView.INK else Color.WHITE) { Store.setGoal(this, g); showStart() } }.toTypedArray()))
    }
    // 완주 목표 시간(거리 목표) / 목표 거리(시간 목표): − + 로 정해요
    private fun showTarget() {
        val g = Store.goal(this)
        val isD = g.k == "dist"
        // 처음 값: 1km 6분 페이스쯤
        var vt = if (g.t > 0) g.t else (g.v * 360).toInt() / 60 * 60
        var vd = if (g.d > 0) g.d else Math.round(g.v / 6 * 2) / 2.0
        val big = tv("", 28f, Color.WHITE, true); val sub = tv("", 11f, RunView.GREEN)
        fun draw() {
            if (isD) { big.text = fmtTime(vt * 1000L); sub.text = "1km ${fmtPace(vt * 1000.0 / g.v)}" }
            else { big.text = "${num(vd)}km"; sub.text = "1km ${fmtPace(g.v * 60000 / vd)}" }
        }
        draw()
        val step = if (g.v >= 21) 300 else 60
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER
            val w = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { setMargins((1.5f * u).toInt(), 0, (1.5f * u).toInt(), 0) }
            addView(btn("−", RunView.SURF) { if (isD) vt = maxOf(60, vt - step) else vd = maxOf(0.5, vd - 0.5); draw() }, w)
            addView(btn("+", RunView.SURF) { if (isD) vt += step else vd += 0.5; draw() }, w) }
        show(page(tv(if (isD) "${g.label()} 완주 목표" else "${g.label()} 목표 거리", 12f, RunView.ORANGE, true), big, sub, row,
            btn("이걸로 정하기", RunView.CORAL, RunView.INK) {
                Store.setGoal(this, if (isD) g.copy(t = vt) else g.copy(d = vd)); showStart() },
            btn("정하지 않음", RunView.SURF, RunView.MUTED) { Store.setGoal(this, g.copy(t = 0, d = 0.0)); showStart() }))
    }

    // ---------- 3 · 2 · 1 ----------
    private fun countdown() {
        stopGpsPreview()
        RunService.warm(this)   // GPS·목소리를 미리 켜요
        Run.goal = Store.goal(this)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val num = tv("", 60f, RunView.ORANGE, true)
        val box = FrameLayout(this).apply { addView(num, FrameLayout.LayoutParams(-1, -1)) }
        var dead = false
        val go = { if (!dead) { dead = true; h.removeCallbacksAndMessages(null); begin() } }
        box.setOnClickListener { go() }
        show(box)
        num.text = "준비"; num.textSize = 26f
        val tone = try { ToneGenerator(AudioManager.STREAM_MUSIC, 80) } catch (e: Exception) { null }
        h.postDelayed({ if (!dead) Run.say(Run.startLine()) }, 400)
        val wait = if (Run.voice) (if (Run.goal.tgtPace() > 0) 7000L else 2500L) else 600L
        listOf(3, 2, 1).forEachIndexed { k, n -> h.postDelayed({ if (!dead) { num.textSize = 60f; num.text = "$n"; tone?.startTone(ToneGenerator.TONE_PROP_BEEP, 180); Run.buzz(longArrayOf(0, 120)) } }, wait + k * 1000L) }
        h.postDelayed({ if (!dead) { num.text = "GO"; tone?.startTone(ToneGenerator.TONE_PROP_BEEP2, 700); Run.buzz(longArrayOf(0, 400)) } }, wait + 3000L)
        h.postDelayed({ go(); tone?.release() }, wait + 3700L)
    }
    private fun begin() {
        val c = Calendar.getInstance()
        Run.begin(System.currentTimeMillis(), Store.goal(this), "${c.get(Calendar.MONTH) + 1}월 ${c.get(Calendar.DAY_OF_MONTH)}일 러닝")
        Store.saveCurrent(this)
        showRun()
    }

    // ---------- 달리는 중 ----------
    private fun showRun() {
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val v = RunView(this) { finishRun() }
        show(v); runView = v
    }
    private fun finishRun() {
        val id = Store.finish(this)
        RunService.stop(this)
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        if (id == null) { show(page(tv("거리가 거의 없어서 저장하지 않았어요", 13f), btn("처음으로", RunView.CORAL, RunView.INK) { showStart() })); return }
        showDetail(id, true)
    }

    // ---------- 지난 기록 ----------
    private fun summaryLine(o: org.json.JSONObject): String {
        val s = o.optJSONObject("sum") ?: org.json.JSONObject(); val walk = s.optDouble("walk", 0.0); val mv = s.optLong("moving")
        return "${fmtDist(walk)} · ${fmtTime(mv)} · ${fmtPace(if (walk > 50) mv / (walk / 1000) else null)}"
    }
    private fun showHistory() {
        stopGpsPreview()
        val list = Store.list(this)
        val items = list.map { o ->
            val c = Calendar.getInstance().apply { timeInMillis = o.optLong("at") }
            LinearLayout(this).apply { orientation = LinearLayout.VERTICAL
                background = GradientDrawable().apply { cornerRadius = 6 * u; setColor(RunView.SURF) }
                setPadding((4 * u).toInt(), (2.5f * u).toInt(), (4 * u).toInt(), (2.5f * u).toInt())
                addView(tv("${c.get(Calendar.MONTH) + 1}/${c.get(Calendar.DAY_OF_MONTH)} " + (if (o.optBoolean("goalDone")) "· 목표 달성" else ""), 11f, RunView.MUTED))
                addView(tv(summaryLine(o), 13f, Color.WHITE, true))
                setOnClickListener { showDetail(o.optString("id"), false) } }
        }
        show(page(tv("지난 기록", 13f, RunView.ORANGE, true), *(if (items.isEmpty()) listOf(tv("아직 기록이 없어요", 12f, RunView.MUTED)) else items).toTypedArray(),
            btn("처음으로", RunView.SURF) { showStart() }))
    }
    private fun showDetail(id: String, justDone: Boolean) {
        val o = Store.get(this, id) ?: return showHistory()
        val s = o.optJSONObject("sum") ?: org.json.JSONObject(); val walk = s.optDouble("walk", 0.0); val mv = s.optLong("moving")
        val g = Goal.from(o.optJSONObject("goal"))
        val sp = org.json.JSONArray(o.optJSONObject("data")?.optString("walkSplits:$id", "[]") ?: "[]")
        val lines = ArrayList<View>()
        if (justDone) lines.add(tv("저장했어요!", 13f, RunView.GREEN, true))
        lines.add(tv(o.optString("name"), 12f, RunView.MUTED))
        lines.add(tv("${fmtKm(walk)} km", 26f, Color.WHITE, true))
        lines.add(tv("${fmtTime(mv)} · 평균 ${fmtPace(if (walk > 50) mv / (walk / 1000) else null)}", 13f, Color.WHITE, true))
        if (s.optInt("hrAvg") > 0) lines.add(tv("♥ 평균 ${s.optInt("hrAvg")} · 최고 ${s.optInt("hrMax")}", 12f, RunView.RED))
        if (s.optInt("cad") > 0) lines.add(tv("케이던스 ${s.optInt("cad")} · ${s.optInt("steps")}걸음", 11f, RunView.MUTED))
        if (g.k != "free") lines.add(tv("목표 ${g.label()}${if (g.tgtLabel().isNotEmpty()) " · " + g.tgtLabel() else ""} → ${if (o.optBoolean("goalDone")) "달성" else "못 미침"}", 11f, if (o.optBoolean("goalDone")) RunView.GREEN else RunView.ORANGE))
        for (k in 0 until sp.length()) lines.add(tv("${k + 1}km  ${fmtPace(sp.getLong(k).toDouble())}", 12f, Color.WHITE))
        var armed = false
        lines.add(btn(if (justDone) "처음으로" else "목록으로", RunView.CORAL, RunView.INK) { if (justDone) showStart() else showHistory() })
        lines.add(btn("이 기록 지우기", RunView.SURF, RunView.MUTED) {}.apply {
            setOnClickListener { if (!armed) { armed = true; text = "한 번 더 누르면 지워요" } else { Store.delete(this@MainActivity, id); showHistory() } } })
        show(page(*lines.toTypedArray()))
    }
}
