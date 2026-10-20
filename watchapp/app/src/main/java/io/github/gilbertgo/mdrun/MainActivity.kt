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
            if (i != null) { upd = i
                // 새 판은 판마다 한 번 저절로 '새 판이 있어요' 창을 띄워요(2026-10-19 사용자가 다른 앱의 업데이트 창을 보여 주며 '이런 화면')
                val p = getSharedPreferences("mdrun", MODE_PRIVATE)
                if (atStart && Run.id == null) { if (p.getLong("updAsk", 0) != i.code) { p.edit().putLong("updAsk", i.code).apply(); showUpdate(i) } else showStart() } }
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
        val install = { if (u0 != null) showUpdate(u0) }
        val hv = HomeView(this, HomeView.Act({ showSetup() }, { showGoal() }, if (u0 != null) install else null, { showGuide() })).apply {
            guideOn = Cadence.kind != Cadence.OFF; guideTxt = if (guideOn) "♩ ${Cadence.spm}" else "♩ 끔"
            week = weekSum(); goal = g; updName = u0?.name ?: ""; gpsAcc = Run.lastAcc }
        gpsText = null
        val tgt = when (g.k) { "dist" -> row("완주 목표 시간", if (g.t > 0) g.tgtLabel() else "정하지 않음") { showTarget() }
            "time" -> row("목표 거리", if (g.d > 0) g.tgtLabel() else "정하지 않음") { showTarget() }
            else -> null }
        val wg = listOf(10, 15, 20, 30, 40, 50, 60, 80)
        // 설정은 묶음으로 (2026-10-19 사용자 '첫 화면 구성이 이상해, 체계가 없어'): 오늘 달리기 · 심박 존 · 기록 · 앱
        val sections = listOf(
            // 2026-10-20 휴대폰 ⚙ 설정과 같이 '화면' 묶음: 바탕 사진은 휴대폰에서 골라 보내요(시계엔 사진첩이 없어서)
            "화면" to listOf(row("바탕 사진", if (Link.hasBg(this)) "휴대폰에서 고른 사진" else "기본 사진") { showBg() }),
            "오늘 달리기" to listOfNotNull(
                row("목표", g.label()) { showGoal() }, tgt,
                row("케이던스 가이드", if (Cadence.kind == Cadence.OFF) "끔" else "${Cadence.label()} · ${Cadence.spm}") { showGuide() },
                row("목소리 코치", if (Run.voice) "켬" else "끔") { Run.voice = !Run.voice; Store.setVoice(this, Run.voice); showStart() }),
            "심박 존" to listOf(
                row("최대 심박 · 존2 ${Run.zoneLo(1)}~${Run.zoneLo(2) - 1}", "${Run.hrMaxSet}") { showHrMax() },
                row("존2 지키기 알림", if (Run.z2Alert) "켬" else "끔") { Run.z2Alert = !Run.z2Alert; Store.setZ2Alert(this, Run.z2Alert); showStart() }),
            "기록" to listOf(
                row("지난 기록", "${Store.list(this).size}개") { showHistory() },
                row("주간 목표", "${Store.weekGoal(this)}km") { val cur = Store.weekGoal(this); Store.setWeekGoal(this, wg[(wg.indexOf(cur) + 1) % wg.size]); showStart() },
                row("휴대폰으로 보내기", "저절로 · 블루투스") { showPhone() }),
            "앱" to listOfNotNull(
                if (u0 != null) row("새 판이 있어요", "${u0.name} 설치하기") { install() } else null,
                row("판 ${Updater.currentName(this)}", "새 판 확인") { checkNow(true) }))
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding((13 * u).toInt(), (2 * u).toInt(), (13 * u).toInt(), (24 * u).toInt())
            sections.forEachIndexed { i, (title, rs) ->
                addView(tv(title, 13f, RunView.CORAL, true).apply { gravity = Gravity.START; setPadding((3 * u).toInt(), 0, 0, 0) }, lp(if (i == 0) 2f else 7f))
                rs.forEach { addView(it, lp(1.6f)) } } }
        val all = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; addView(hv, LinearLayout.LayoutParams(-1, -2)); addView(col) }
        show(ScrollView(this).apply { isVerticalScrollBarEnabled = false; addView(all); isFocusable = true; isFocusableInTouchMode = true; post { requestFocus() } }); atStart = true; home = hv
        startGpsPreview()
        // 새 판은 시작 화면을 처음 열 때 한 번 알아봐요(달리는 중엔 안 봐요)
        if (!updChecked) { updChecked = true; checkNow(false) }
        Wear.pushAll(this)   // 휴대폰으로 저절로(블루투스): 못 보낸 기록이 있으면 보내요
        Link.pushAll(this)   // 예전 연결 코드 방식(켜 둔 경우만)
        Link.pullBg(this) { home?.reloadPhoto() }   // 휴대폰에서 바탕 사진을 바꿨으면 받아요
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

    // ▶ 러닝 시작 → 목표 세팅 네 장(거리 · 시간 · 케이던스 비프 · 출발) → 3·2·1
    private fun showSetup() { show(SetupView(this, { countdown() }, { showStart() }).apply { isFocusable = true }) }

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

    // 새 판이 있어요: 선물 그림 · 무엇이 새로워졌는지 · 지금 → 새 판 · [업데이트](받는 중… %) · 나중에
    private fun showUpdate(info: Updater.Info) {
        val status = tv("", 12f, RunView.BLUE, true)
        val go = btn("업데이트", RunView.CORAL, RunView.INK) {}
        go.setOnClickListener {
            if (Updater.busy) return@setOnClickListener
            go.text = "받는 중… 0%"
            Updater.install(this, info, { m -> status.text = m }) { pc ->
                go.text = when { pc < 0 -> "다시 받기"; pc >= 100 -> "설치 확인 창을 기다려요"; else -> "받는 중… $pc%" } }
            if (!Updater.busy) go.text = "업데이트"   // 설치 허용이 꺼져 있어 설정을 연 경우
        }
        show(page(GiftView(this), tv("새 판이 있어요", 19f, Color.WHITE, true),
            tv(info.notes.ifEmpty { "더 좋아진 새 판이에요" }, 13f, Color.parseColor("#C9D1DB")),
            tv("지금 ${Updater.currentName(this)} → 새 ${info.name}", 13f, RunView.MUTED, true),
            go, status,
            tv("나중에", 14f, RunView.MUTED, true).apply { setPadding(0, (3 * u).toInt(), 0, (3 * u).toInt()); setOnClickListener { showStart() } }))
    }
    // 선물 상자 그림(산호 선)
    private class GiftView(c: android.content.Context) : View(c) {
        private val p = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply { style = android.graphics.Paint.Style.STROKE; color = RunView.CORAL; strokeCap = android.graphics.Paint.Cap.ROUND; strokeJoin = android.graphics.Paint.Join.ROUND }
        override fun onMeasure(w: Int, h: Int) { val s = (resources.displayMetrics.widthPixels * .2f).toInt(); setMeasuredDimension(MeasureSpec.getSize(w), s) }
        override fun onDraw(cv: android.graphics.Canvas) {
            val s = height.toFloat(); val cx = width / 2f; val u = s / 20f; p.strokeWidth = 1.6f * u
            cv.drawRoundRect(android.graphics.RectF(cx - 7 * u, 8 * u, cx + 7 * u, 18 * u), u, u, p)          // 상자
            cv.drawRoundRect(android.graphics.RectF(cx - 8.5f * u, 5 * u, cx + 8.5f * u, 8.5f * u), u, u, p)  // 뚜껑
            cv.drawLine(cx, 5 * u, cx, 18 * u, p)                                                            // 끈
            val path = android.graphics.Path().apply { moveTo(cx, 5 * u); cubicTo(cx - 2 * u, 1 * u, cx - 6 * u, 2 * u, cx - 4 * u, 4.6f * u); close()
                moveTo(cx, 5 * u); cubicTo(cx + 2 * u, 1 * u, cx + 6 * u, 2 * u, cx + 4 * u, 4.6f * u); close() }
            cv.drawPath(path, p)                                                                             // 리본
        }
    }

    // 케이던스 가이드 정하기 (2026-10-19 사용자 '가이드 케이던스도 설정할 수 있게, 중요하니 앞쪽으로'):
    // 방식(끔·소리·진동·소리+진동) · 빠르기(−5 −1 +1 +5, 120~220) · 미리 듣기 · 내 평균 케이던스로 추천
    private fun showGuide() {
        val big = tv("", 30f, Color.WHITE, true); val sub = tv("1분에 걸음 수", 12f, RunView.MUTED)
        val kinds = listOf(Cadence.OFF, Cadence.SOUND, Cadence.VIB, Cadence.BOTH)
        val kBtns = kinds.map { k -> btn(Cadence.label(k), RunView.SURF) { Cadence.set(this, k); showGuide() } }
        kBtns.forEachIndexed { i, b -> val on = kinds[i] == Cadence.kind
            (b.background as GradientDrawable).setColor(if (on) RunView.CORAL else RunView.SURF); b.setTextColor(if (on) RunView.INK else Color.WHITE) }
        fun draw() { big.text = "${Cadence.spm}" }
        draw()
        val w = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { setMargins((1.2f * u).toInt(), 0, (1.2f * u).toInt(), 0) }
        fun pm(d: Int) = btn(if (d > 0) "+$d" else "−${-d}", RunView.SURF) { Cadence.setSpm(this, Cadence.spm + d); draw() }
        val r1 = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER
            listOf(-5, -1, 1, 5).forEach { addView(pm(it), LinearLayout.LayoutParams(w)) } }
        fun two(a: View, b: View) = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; addView(a, LinearLayout.LayoutParams(w)); addView(b, LinearLayout.LayoutParams(w)) }
        // 지난 기록 평균 케이던스(최근 5번)로 추천: 지금보다 5 높게(한 번에 5~10%보다 많이 올리지 않게)
        val cads = Store.list(this).take(5).mapNotNull { it.optJSONObject("sum")?.optInt("cad")?.takeIf { c -> c > 100 } }
        val avg = if (cads.isNotEmpty()) cads.average().roundToInt() else 0
        val rec = if (avg > 0) ((minOf(maxOf(avg + 5, 160), 185) + 2) / 5 * 5) else 0
        val views = listOfNotNull(
            tv("케이던스 가이드", 15f, RunView.CORAL, true), big, sub, r1,
            btn("▶ 미리 듣기", RunView.SURF, RunView.CORAL) { Cadence.preview(this) },
            tv("방식", 13f, RunView.MUTED, true), two(kBtns[0], kBtns[1]), two(kBtns[2], kBtns[3]),
            if (rec > 0) btn("추천 ${rec}으로 (내 평균 $avg)", RunView.SURF) { Cadence.setSpm(this, rec); draw() } else null,
            tv("달릴 때 이 박자에 발을 맞추면 케이던스가 올라 보폭이 줄고 무릎 부담이 줄어요. 보통 170~180이 좋고, 지금 평균보다 5 정도만 높여 시작하세요.", 12f, Color.WHITE),
            btn("다 됐어요", RunView.CORAL, RunView.INK) { showStart() })
        show(page(*views.toTypedArray()))
    }

    // 휴대폰으로 보내기 (2026-10-20 '저절로 연결'): 코드 없이 블루투스로. 휴대폰에 MPD Run 앱이 있어야 받아요
    private fun showPhone() {
        val st = tv("휴대폰을 찾는 중…", 12f, RunView.BLUE, true)
        val views = arrayListOf<View>(tv("휴대폰으로 보내기", 15f, RunView.CORAL, true),
            tv("달리기를 끝내면 시계와 이어진 휴대폰으로 저절로 보내요. 코드는 필요 없어요.", 13f, Color.WHITE), st,
            btn("지금 보내기", RunView.CORAL, RunView.INK) { st.text = "보내는 중…"; Wear.pushAll(this) { st.text = Wear.status } },
            btn("돌아가기", RunView.SURF) { showStart() },
            btn("예전 방식(연결 코드)", RunView.SURF, RunView.MUTED) { showLink() })
        show(page(*views.toTypedArray()))
        Wear.phoneReady(this) { ok -> st.text = when (ok) { true -> "휴대폰과 이어져 있어요 ✓"; false -> "휴대폰에 'MPD Run' 앱을 깔아 주세요 (받는 앱)"; else -> "휴대폰을 찾지 못했어요" } }
    }
    // 휴대폰으로 보내기: 연결 코드를 보여 주고 켜고 꺼요
    // 바탕 사진 (2026-10-20 사용자 '방금 한 거 시계 앱에도'): 휴대폰 MPD ⚙ 설정 → 러닝 첫 화면 사진에서 고르면 시계로 와요
    private fun showBg() {
        val st = tv(if (Link.hasBg(this)) "지금: 휴대폰에서 고른 사진" else "지금: 기본 사진", 12f, RunView.BLUE, true)
        val views = arrayListOf<View>(tv("바탕 사진", 15f, RunView.CORAL, true),
            tv("휴대폰 MPD 맨 위 ⚙ 설정 → '러닝 첫 화면 사진'에서 고르면 이 시계에도 같이 바뀌어요.", 13f, Color.WHITE), st)
        if (Link.on(this)) views.add(btn("지금 받기", RunView.CORAL, RunView.INK) { st.text = "받는 중…"; Link.forceBg(this) { st.text = if (Link.hasBg(this)) "받았어요" else "기본 사진이에요" }
            android.os.Handler(mainLooper).postDelayed({ if (st.text == "받는 중…") st.text = "새 사진이 없어요" }, 15000) })
        else views.add(tv("먼저 '휴대폰으로 보내기'를 켜고 휴대폰에 연결 코드를 적어 주세요.", 12f, RunView.MUTED))
        if (Link.hasBg(this)) views.add(btn("기본 사진으로", RunView.SURF) { Link.clearBg(this); showBg() })
        views.add(btn("돌아가기", RunView.SURF) { showStart() })
        show(page(*views.toTypedArray()))
    }
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
    // 최대 심박 정하기 (2026-10-19 사용자 '개인이 고를 수 있게, 어떤 값인지 설명도'):
    // 세 가지 방법 — 직접 맞추기(±) · 나이로(220−나이 / 208−0.7×나이) · 내 기록에서 가장 높았던 심박. 아래에 뜻 설명과 존 표
    private fun showHrMax(start: Int = Run.hrMaxSet) {
        var v = start
        var age = Store.age(this)
        val big = tv("", 30f, Color.WHITE, true)
        val zones = tv("", 13f, Color.WHITE)
        val names = arrayOf("회복", "유산소", "템포", "역치", "최대")
        fun draw() {
            big.text = "$v"
            zones.text = (0 until 5).joinToString("\n") { z -> val lo = (v * (.5 + .1 * z)).roundToInt(); val hi = (v * (.6 + .1 * z)).roundToInt() - 1
                "존${z + 1} ${names[z]}  " + if (z == 4) "$lo~" else "$lo~$hi" }
        }
        draw()
        fun pm(d: Int) = btn(if (d > 0) "+$d" else "−${-d}", RunView.SURF) { v = (v + d).coerceIn(120, 220); draw() }
        val w = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { setMargins((1.2f * u).toInt(), 0, (1.2f * u).toInt(), 0) }
        val r1 = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER
            addView(pm(-5), w); addView(pm(-1), LinearLayout.LayoutParams(w)); addView(pm(1), LinearLayout.LayoutParams(w)); addView(pm(5), LinearLayout.LayoutParams(w)) }
        // 나이로 정하기
        val ageTv = tv("", 15f, Color.WHITE, true)
        val f1 = btn("", RunView.SURF) { v = 220 - age; draw() }; val f2 = btn("", RunView.SURF) { v = (208 - 0.7 * age).roundToInt(); draw() }
        fun drawAge() { ageTv.text = "나이 ${age}세"; f1.text = "220 − 나이 = ${220 - age}"; f2.text = "208 − 0.7×나이 = ${(208 - 0.7 * age).roundToInt()}" }
        drawAge()
        fun am(d: Int) = btn(if (d > 0) "+$d" else "−${-d}", RunView.SURF) { age = (age + d).coerceIn(10, 90); Store.setAge(this, age); drawAge() }
        val r2 = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER
            addView(am(-1), LinearLayout.LayoutParams(w)); addView(am(1), LinearLayout.LayoutParams(w)) }
        // 내 기록에서 가장 높았던 심박
        val best = Store.list(this).maxOfOrNull { it.optJSONObject("sum")?.optInt("hrMax") ?: 0 } ?: 0
        val fromRec = if (best >= 130) btn("내 기록 최고 심박 $best", RunView.SURF) { v = best; draw() } else null
        val views = listOfNotNull(
            tv("최대 심박", 15f, RunView.CORAL, true), big, r1,
            btn("이걸로 정하기", RunView.CORAL, RunView.INK) { Run.hrMaxSet = v; Store.setHrMaxSet(this, v); showStart() },
            zones,
            tv("최대 심박이란?", 14f, RunView.CORAL, true),
            tv("있는 힘껏 달릴 때 심장이 1분에 뛸 수 있는 가장 많은 횟수예요. 심박 존은 이 숫자를 기준으로 나눠요(존2 = 60~70%). 사람마다 달라서 맞게 정할수록 존이 정확해져요.", 13f, Color.WHITE),
            tv("나이로 정하기", 14f, RunView.CORAL, true),
            ageTv, r2, f1, f2,
            tv("나이 공식은 사람에 따라 10 넘게 틀릴 수 있어요. 208 − 0.7×나이가 조금 더 맞는 편이에요.", 12f, RunView.MUTED),
            if (fromRec != null) tv("내 기록에서", 14f, RunView.CORAL, true) else null, fromRec,
            if (fromRec != null) tv("전력으로 달린 적이 있다면 기록에서 본 가장 높은 심박이 가장 정확해요. 공식보다 높으면 그 값을 쓰세요.", 12f, RunView.MUTED) else null,
            btn("돌아가기", RunView.SURF, RunView.MUTED) { showStart() })
        show(page(*views.toTypedArray()))
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
        // 2026-10-19 사용자 '달리기 시작 단추를 누르면 3 2 1 0~~~': 누르자마자 3·2·1(짧은 '삐' 880Hz)과 진동, 그리고 길게 '삐~'(1320Hz 1초)와 함께 시작.
        // 목소리 안내(목표 말하기)는 시작한 뒤에 해요
        listOf(3, 2, 1).forEachIndexed { k, n -> h.postDelayed({ if (!dead) { num.textSize = 70f; num.text = "$n"; beep(880, 180); Run.buzz(longArrayOf(0, 120)) } }, 300L + k * 1000L) }
        h.postDelayed({ if (!dead) { num.text = "GO"; beep(1320, 1000); Run.buzz(longArrayOf(0, 700)) } }, 3300L)
        h.postDelayed({ go() }, 3900L)
    }
    // 짧은 소리 하나 (미디어 소리로, 시계가 진동 모드여도 들리게)
    private fun beep(hz: Int, ms: Int) {
        Thread {
            try {
                val rate = 22050; val n = rate * ms / 1000; val pcm = ShortArray(n)
                for (i in 0 until n) { val env = minOf(1.0, i / 200.0, (n - i) / 400.0); pcm[i] = (Math.sin(2 * Math.PI * hz * i / rate) * env * 30000).toInt().toShort() }
                val t = android.media.AudioTrack.Builder()
                    .setAudioAttributes(android.media.AudioAttributes.Builder().setUsage(android.media.AudioAttributes.USAGE_MEDIA).setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
                    .setAudioFormat(android.media.AudioFormat.Builder().setEncoding(android.media.AudioFormat.ENCODING_PCM_16BIT).setSampleRate(rate).setChannelMask(android.media.AudioFormat.CHANNEL_OUT_MONO).build())
                    .setBufferSizeInBytes(n * 2).setTransferMode(android.media.AudioTrack.MODE_STATIC).build()
                t.write(pcm, 0, n); t.play(); Thread.sleep(ms + 150L); t.release()
            } catch (e: Exception) {}
        }.start()
    }
    private fun begin() {
        val c = Calendar.getInstance()
        Run.begin(System.currentTimeMillis(), Store.goal(this), "${c.get(Calendar.MONTH) + 1}월 ${c.get(Calendar.DAY_OF_MONTH)}일 러닝")
        Store.saveCurrent(this)
        showRun()
        h.postDelayed({ Run.say(Run.startLine()) }, 1200)   // 목표 말하기는 시작한 뒤에
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
        Wear.pushAll(this); Link.pushAll(this)
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
