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
import kotlin.math.roundToInt

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
        Run.voice = Store.voice(this); Cadence.load(this); Run.hrMaxSet = Store.hrMaxSet(this); Run.z2Alert = Store.z2Alert(this)
        // 화면이 어두워져도(앰비언트) 이 앱을 그대로 보여 줘요
        attachAmbient(this, { runView?.let { it.ambient = true; it.invalidate() } }, { runView?.invalidate() }, { runView?.let { it.ambient = false; it.invalidate() } })
        if (PERMS.any { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }) requestPermissions(PERMS, 1)
        // 기록 중이면(앱이 정리됐다 다시 켜진 경우 포함) 바로 달리는 화면으로
        if (Run.id == null) Store.loadCurrent(this)?.let { try { Run.restore(it) } catch (e: Exception) {} }
        if (Run.id != null) { RunService.warm(this); showRun() } else showStart()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (Run.id == null && atStart) startGpsPreview()
    }

    override fun onDestroy() { stopGpsPreview(); super.onDestroy() }
    // 시계는 앱을 닫지 않고 두는 일이 많아서, 시작 화면으로 돌아올 때마다(1분에 한 번까지) 새 판을 다시 알아봐요
    private var lastCheck = 0L
    override fun onResume() { super.onResume(); if (atStart && Run.id == null && System.currentTimeMillis() - lastCheck > 60000) checkNow(false) }
    private fun checkNow(say: Boolean) {
        lastCheck = System.currentTimeMillis()
        if (say) android.widget.Toast.makeText(this, "새 판을 알아보는 중…", android.widget.Toast.LENGTH_SHORT).show()
        Updater.check(this) { i ->
            if (i != null) { upd = i; if (atStart && Run.id == null) showStart() }
            if (say) android.widget.Toast.makeText(this, if (i != null) "새 판 ${i.name}이 있어요. 맨 위 '설치하기'를 눌러 주세요" else if (Updater.lastErr.isNotEmpty()) "알아보지 못했어요 · 인터넷 연결을 확인해 주세요 (${Updater.lastErr})" else "지금이 가장 새 판이에요", android.widget.Toast.LENGTH_LONG).show()
        }
    }

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
            addView(tv(label, 12f, RunView.MUTED).apply { gravity = Gravity.START })
            addView(tv(value, 15f, Color.WHITE, true).apply { gravity = Gravity.START; maxLines = 1 }) }
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
    private fun show(v: View) { runView = null; home = null; atStart = false; root.removeAllViews(); root.addView(v) }

    // ---------- 시작 화면 ----------
    // 첫 장은 그림 화면(HomeView: 이번 주 링·▶ 시작), 용두로 내리면 설정 줄
    private var home: HomeView? = null
    private fun weekSum(): HomeView.Week {
        val c = Calendar.getInstance().apply { set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
            add(Calendar.DAY_OF_MONTH, -((get(Calendar.DAY_OF_WEEK) + 5) % 7)) }   // 이번 주 월요일 0시
        val mon = c.timeInMillis; val days = BooleanArray(7); var km = 0.0; var n = 0
        for (o in Store.list(this)) { val at = o.optLong("at"); if (at < mon) continue
            val d = ((at - mon) / 86400000L).toInt(); if (d in 0..6) days[d] = true
            km += (o.optJSONObject("sum")?.optDouble("walk", 0.0) ?: 0.0) / 1000; n++ }
        return HomeView.Week(km, n, days, Store.weekGoal(this))
    }
    private fun showStart() {
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val g = Store.goal(this)
        val u0 = upd
        val install = { if (u0 != null) Updater.install(this, u0) { m -> android.widget.Toast.makeText(this, m, android.widget.Toast.LENGTH_LONG).show() } }
        val hv = HomeView(this, HomeView.Act({ countdown() }, { showGoal() }, if (u0 != null) install else null)).apply {
            week = weekSum(); goal = g; updName = u0?.name ?: ""; gpsAcc = Run.lastAcc }
        gpsText = null
        val tgt = when (g.k) { "dist" -> row("완주 목표 시간", if (g.t > 0) g.tgtLabel() else "정하지 않음") { showTarget() }
            "time" -> row("목표 거리", if (g.d > 0) g.tgtLabel() else "정하지 않음") { showTarget() }
            else -> null }
        val wg = listOf(10, 15, 20, 30, 40, 50, 60, 80)
        val rows = listOfNotNull(
            if (u0 != null) row("새 판이 있어요", "${u0.name} 설치하기") { install() } else null,
            row("목표", g.label()) { showGoal() }, tgt,
            row("목소리 코치", if (Run.voice) "켬" else "끔") { Run.voice = !Run.voice; Store.setVoice(this, Run.voice); showStart() },
            row("휴대폰으로 보내기", if (Link.on(this)) "켬 · ${Link.code(this)}" else "끔") { showLink() },
            row("최대 심박 · 존2 ${Run.zoneLo(1)}~${Run.zoneLo(2) - 1}", "${Run.hrMaxSet}") { showHrMax() },
            row("존2 지키기 알림", if (Run.z2Alert) "켬" else "끔") { Run.z2Alert = !Run.z2Alert; Store.setZ2Alert(this, Run.z2Alert); showStart() },
            row("케이던스 가이드", if (Cadence.kind == Cadence.OFF) "끔" else "${Cadence.label()} · ${Cadence.spm}") { Cadence.set(this, (Cadence.kind + 1) % 4); showStart() },
            if (Cadence.kind != Cadence.OFF) row("가이드 빠르기 (1분에 걸음)", "${Cadence.spm}") { Cadence.setSpm(this, if (Cadence.spm >= 200) 150 else Cadence.spm + 5); showStart() } else null,
            row("주간 목표", "${Store.weekGoal(this)}km") { val cur = Store.weekGoal(this); Store.setWeekGoal(this, wg[(wg.indexOf(cur) + 1) % wg.size]); showStart() },
            row("지난 기록", "${Store.list(this).size}개") { showHistory() },
            tv("판 ${Updater.currentName(this)} · 새 판 확인", 12f, RunView.MUTED).apply { setPadding(0, (2 * u).toInt(), 0, (2 * u).toInt()); setOnClickListener { checkNow(true) } })
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL; setPadding((13 * u).toInt(), (4 * u).toInt(), (13 * u).toInt(), (24 * u).toInt())
            rows.forEach { addView(it, lp()) } }
        val all = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; addView(hv, LinearLayout.LayoutParams(-1, -2)); addView(col) }
        show(ScrollView(this).apply { isVerticalScrollBarEnabled = false; addView(all); isFocusable = true; isFocusableInTouchMode = true; post { requestFocus() } }); atStart = true; home = hv
        startGpsPreview()
        // 새 판은 시작 화면을 처음 열 때 한 번 알아봐요(달리는 중엔 안 봐요)
        if (!updChecked) { updChecked = true; checkNow(false) }
        Link.pushAll(this)   // 못 보낸 기록이 있으면 보내요
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
        home?.let { it.gpsAcc = a; it.invalidate() }
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
        val big = tv("", 28f, Color.WHITE, true); val sub = tv("", 13f, RunView.GREEN)
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

    // 휴대폰으로 보내기: 연결 코드를 보여 주고 켜고 꺼요
    private fun showLink() {
        val on = Link.on(this)
        val st = tv(Link.status, 12f, RunView.BLUE, true)
        val views = if (!on) listOf(tv("휴대폰으로 보내기", 15f, RunView.CORAL, true),
            tv("달린 기록을 휴대폰 MPD로 보내 자세히 봐요. 기록은 잠가서 보내요.", 13f, Color.WHITE),
            btn("켜기", RunView.CORAL, RunView.INK) { Link.enable(this, true); showLink() },
            btn("돌아가기", RunView.SURF) { showStart() })
        else listOf(tv("연결 코드", 13f, RunView.MUTED, true), tv(Link.code(this), 30f, Color.WHITE, true),
            tv("휴대폰 MPD → 내 MPD → '⌚ 시계 기록 받기'에 이 코드를 적어 주세요", 13f, Color.WHITE), st,
            btn("지금 보내기", RunView.CORAL, RunView.INK) { st.text = "보내는 중…"; Link.pushAll(this) { st.text = Link.status } },
            btn("돌아가기", RunView.SURF) { showStart() },
            btn("끄기", RunView.SURF, RunView.MUTED) { Link.enable(this, false); showStart() })
        show(page(*views.toTypedArray()))
    }

    // 최대 심박 정하기: 존을 나누는 기준. 모르면 '220 − 나이'
    private fun showHrMax() {
        var v = Run.hrMaxSet
        val big = tv("", 30f, Color.WHITE, true); val sub = tv("", 13f, RunView.BLUE, true)
        fun draw() { big.text = "$v"; sub.text = "존2 ${(v * .6).roundToInt()}~${(v * .7).roundToInt() - 1}" }
        draw()
        fun pm(d: Int) = btn(if (d > 0) "+$d" else "−${-d}", RunView.SURF) { v = (v + d).coerceIn(120, 220); draw() }
        val r1 = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER
            val w = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { setMargins((1.2f * u).toInt(), 0, (1.2f * u).toInt(), 0) }
            addView(pm(-5), w); addView(pm(-1), w); addView(pm(1), w); addView(pm(5), w) }
        show(page(tv("최대 심박", 15f, RunView.CORAL, true), big, sub, r1,
            tv("모르면 220 − 나이 (예: 55세 → 165)", 12f, RunView.MUTED),
            btn("이걸로 정하기", RunView.CORAL, RunView.INK) { Run.hrMaxSet = v; Store.setHrMaxSet(this, v); showStart() }))
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
        Link.pushAll(this)
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
                addView(tv("${c.get(Calendar.MONTH) + 1}/${c.get(Calendar.DAY_OF_MONTH)} " + (if (o.optBoolean("goalDone")) "· 목표 달성" else ""), 13f, RunView.MUTED))
                addView(tv(summaryLine(o), 13f, Color.WHITE, true))
                setOnClickListener { showDetail(o.optString("id"), false) } }
        }
        show(page(tv("지난 기록", 13f, RunView.ORANGE, true), *(if (items.isEmpty()) listOf(tv("아직 기록이 없어요", 12f, RunView.MUTED)) else items).toTypedArray(),
            btn("처음으로", RunView.SURF) { showStart() }))
    }
    // 달린 기록 자세히 보기: 분석 화면(ReportView) + 아래 단추
    private fun showDetail(id: String, justDone: Boolean) {
        val o = Store.get(this, id) ?: return showHistory()
        var armed = false
        val btns = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding((13 * u).toInt(), 0, (13 * u).toInt(), (24 * u).toInt())
            addView(btn(if (justDone) "처음으로" else "목록으로", RunView.CORAL, RunView.INK) { if (justDone) showStart() else showHistory() }, lp())
            addView(btn("이 기록 지우기", RunView.SURF, RunView.MUTED) {}.apply {
                setOnClickListener { if (!armed) { armed = true; text = "한 번 더 누르면 지워요" } else { Store.delete(this@MainActivity, id); showHistory() } } }, lp()) }
        val all = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL
            addView(ReportView(this@MainActivity, Report(o), justDone), LinearLayout.LayoutParams(-1, -2)); addView(btns) }
        show(ScrollView(this).apply { isVerticalScrollBarEnabled = false; addView(all); isFocusable = true; isFocusableInTouchMode = true; post { requestFocus() } })
    }
}
