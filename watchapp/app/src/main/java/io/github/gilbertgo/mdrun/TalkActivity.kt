package io.github.gilbertgo.mdrun

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.view.Gravity
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// 🎙 시계로 대화 기록 (2026-11-15 사용자 '내가 나눈 대화도 자동으로 기록 되게해' → 늘 듣기는 법·배터리 까닭으로 안 함 → '와치 써'):
// 시계 앱 목록의 'MPD 대화'(또는 MPD Run 설정 '대화 기록')를 누르면 바로 받아 적기 시작 → '그만'을 누르면 시계에 저장하고
// 휴대폰으로 보내요(Wear.pushTalks, 기록과 같은 블루투스 길 /mpd/run/talk_w{시각}). 휴대폰 MPD가 받아 정리해서 그 시간 MPD에 붙여요.
// 받아 적기는 시계의 음성 인식(SpeechRecognizer, ko-KR)을 한 마디씩 이어서 켜요. 시계에 음성 인식이 없으면 그렇게 알려요.
// 듣는 동안 화면을 켜 둬요(꺼지면 시계가 마이크를 끊어요). 받아 적는 중인 말은 talkDraft에 바로 남겨 앱이 꺼져도 이어서.
class TalkActivity : ComponentActivity() {
    private val h = Handler(Looper.getMainLooper())
    private var sr: SpeechRecognizer? = null
    private var on = false
    private var errN = 0
    private var interim = ""
    private var segs = JSONArray()
    private lateinit var stTv: TextView
    private lateinit var btn: TextView
    private lateinit var txt: TextView
    private lateinit var scroll: ScrollView
    private val u get() = resources.displayMetrics.widthPixels / 100f
    private fun prefs() = getSharedPreferences("mdrun", Context.MODE_PRIVATE)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        segs = try { JSONArray(prefs().getString("talkDraft", "[]")) } catch (e: Exception) { JSONArray() }
        stTv = tv("", 12f, Color.parseColor("#B8C4D0"))
        btn = tv("", 16f, Color.WHITE, true).apply {
            setPadding(0, (4 * u).toInt(), 0, (4 * u).toInt())
            setOnClickListener { if (on) stop() else start() }
        }
        txt = tv("", 13f, Color.WHITE).apply { gravity = Gravity.START }
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding((12 * u).toInt(), (10 * u).toInt(), (12 * u).toInt(), (26 * u).toInt())
            addView(tv("🎙 대화 기록", 15f, RunView.CORAL, true))
            addView(stTv, lp(2f)); addView(btn, lp(4f)); addView(txt, lp(4f))
            addView(tv("같이 있는 사람에게 알리고 써 주세요 · 정리는 휴대폰 MPD에서", 10f, Color.parseColor("#8090A0")), lp(5f))
        }
        scroll = ScrollView(this).apply { isVerticalScrollBarEnabled = false; setBackgroundColor(Color.BLACK); addView(col); isFocusable = true; isFocusableInTouchMode = true; post { requestFocus() } }
        setContentView(scroll)
        draw()
        if (!SpeechRecognizer.isRecognitionAvailable(this)) { stTv.text = "이 시계에서는 음성 인식을 쓸 수 없어요\n(구글 음성 인식이 없거나 꺼져 있어요)"; btn.isEnabled = false; return }
        start()   // 누르고 들어왔으니 바로 듣기
    }

    private fun tv(s: String, size: Float, color: Int, bold: Boolean = false) = TextView(this).apply {
        text = s; setTextColor(color); textSize = size; gravity = Gravity.CENTER; if (bold) typeface = Typeface.DEFAULT_BOLD
    }
    private fun lp(top: Float) = LinearLayout.LayoutParams(-1, -2).apply { topMargin = (top * u).toInt() }

    private fun draw() {
        btn.text = if (on) "■ 그만 · 보내기" else if (segs.length() > 0) "🎙 이어서 듣기" else "🎙 듣기 시작"
        btn.background = GradientDrawable().apply { cornerRadius = 40 * u; setColor(if (on) Color.parseColor("#3A4654") else RunView.CORAL) }
        if (on && stTv.text.isEmpty()) stTv.text = "🔴 듣고 있어요"
        val sb = StringBuilder(); var last = 0L; val f = SimpleDateFormat("HH:mm", Locale.KOREA)
        for (i in 0 until segs.length()) { val o = segs.optJSONObject(i) ?: continue; val t = o.optLong("t")
            if (i == 0 || t - last > 8000) sb.append(if (i == 0) "" else "\n").append("[").append(f.format(Date(t))).append("] ")
            sb.append(o.optString("x")).append(' '); last = t }
        if (interim.isNotEmpty()) sb.append(interim)
        txt.text = if (sb.isEmpty()) (if (on) "말하면 여기에 적혀요" else "") else sb
        if (on) scroll.post { scroll.fullScroll(ScrollView.FOCUS_DOWN) }
    }

    private fun start() {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 31); return
        }
        on = true; errN = 0; stTv.text = "🔴 듣고 있어요"
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        buzz(40); draw(); listen()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 31) { if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) start() else stTv.text = "마이크를 허용해야 들을 수 있어요\n(설정 → 애플리케이션 → MPD Run → 권한)" }
    }

    private fun listen() {
        if (!on) return
        try { sr?.destroy() } catch (e: Exception) {}
        val r = SpeechRecognizer.createSpeechRecognizer(this); sr = r
        r.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(p: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(v: Float) {}
            override fun onBufferReceived(b: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onEvent(t: Int, p: Bundle?) {}
            override fun onPartialResults(b: Bundle?) { interim = b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: ""; draw() }
            override fun onResults(b: Bundle?) {
                val x = b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim().orEmpty()
                interim = ""; errN = 0
                if (x.isNotEmpty()) { segs.put(JSONObject().put("t", System.currentTimeMillis()).put("x", x)); prefs().edit().putString("talkDraft", segs.toString()).apply() }
                draw(); if (on) h.postDelayed({ listen() }, 200)   // 한 마디 끝 → 바로 다음 마디
            }
            override fun onError(e: Int) {
                interim = ""
                if (!on) return
                if (e == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) { stop(); stTv.text = "마이크를 허용해 주세요"; return }
                errN++
                // 조용해서 못 들은 것(말 없음)은 그냥 다시. 인터넷·서버 오류가 이어지면 알려 주고 계속 다시 해 봐요
                if (e == SpeechRecognizer.ERROR_NETWORK || e == SpeechRecognizer.ERROR_NETWORK_TIMEOUT || e == SpeechRecognizer.ERROR_SERVER) { if (errN >= 3) stTv.text = "인터넷이 안 돼요 · 휴대폰과 연결을 확인해 주세요" }
                else if (e != SpeechRecognizer.ERROR_NO_MATCH && e != SpeechRecognizer.ERROR_SPEECH_TIMEOUT && e != SpeechRecognizer.ERROR_RECOGNIZER_BUSY && errN >= 5) stTv.text = "음성 인식이 자꾸 멈춰요 (오류 $e)"
                h.postDelayed({ listen() }, if (e == SpeechRecognizer.ERROR_RECOGNIZER_BUSY) 800L else if (errN > 5) 1500L else 300L)
            }
        })
        val it = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ko-KR"); putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, packageName)
        }
        try { r.startListening(it) } catch (e: Exception) { h.postDelayed({ listen() }, 1000) }
    }

    // 그만: 시계에 talks/talk_w{첫 말 시각}.json으로 저장하고 휴대폰으로 보내요
    private fun stop() {
        on = false; interim = ""; h.removeCallbacksAndMessages(null)
        try { sr?.stopListening(); sr?.destroy() } catch (e: Exception) {}; sr = null
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        if (segs.length() > 0) {
            val t0 = segs.getJSONObject(0).optLong("t"); val t1 = segs.getJSONObject(segs.length() - 1).optLong("t")
            val id = "talk_w$t0"
            val o = JSONObject().put("app", "mapdiary").put("v", 1).put("at", System.currentTimeMillis()).put("ls", JSONObject()).put("photos", JSONArray())
                .put("talk", JSONObject().put("t0", t0).put("t1", t1).put("segs", segs))
            try { File(filesDir, "talks").apply { mkdirs() }.let { File(it, "$id.json").writeText(o.toString()) } } catch (e: Exception) {}
            segs = JSONArray(); prefs().edit().remove("talkDraft").apply()
            stTv.text = "저장했어요 · 휴대폰으로 보내는 중…"; buzz(80)
            Wear.pushTalks(this) { stTv.text = Wear.talkStatus }
        } else stTv.text = "받아 적은 말이 없어요"
        draw()
    }

    private fun buzz(ms: Long) { try { (getSystemService(Context.VIBRATOR_SERVICE) as Vibrator).vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE)) } catch (e: Exception) {} }

    override fun onDestroy() { if (on) { on = false; try { sr?.destroy() } catch (e: Exception) {} }; h.removeCallbacksAndMessages(null); super.onDestroy() }   // 받아 적은 말은 talkDraft에 남아 다음에 이어서
}
