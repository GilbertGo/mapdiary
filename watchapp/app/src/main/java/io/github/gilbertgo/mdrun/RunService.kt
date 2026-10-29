package io.github.gilbertgo.mdrun

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.speech.tts.TextToSpeech
import java.util.Locale

// 기록 도우미: 화면이 꺼져도 GPS·심박·걸음을 받아 Run에 넣어요 (알림 'MD Run 기록 중')
// ACTION_WARM: 시작 화면·출발 신호 동안 GPS와 목소리를 미리 켜 둬요 / ACTION_STOP: 모두 끔
class RunService : Service(), LocationListener, SensorEventListener, TextToSpeech.OnInitListener {
    companion object {
        const val ACTION_WARM = "warm"
        const val ACTION_STOP = "stop"
        const val ACTION_RECOVER = "recover"   // 끝낸 뒤 2분: 심박만 재요(운동 뒤 심박 회복)
        const val CH = "run"
        var alive = false
        fun warm(c: Context) { val i = Intent(c, RunService::class.java).setAction(ACTION_WARM); if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i) else c.startService(i) }
        fun stop(c: Context) { c.startService(Intent(c, RunService::class.java).setAction(ACTION_STOP)) }
        fun recover(c: Context) { c.startService(Intent(c, RunService::class.java).setAction(ACTION_RECOVER)) }
    }
    private var tts: TextToSpeech? = null
    private var ttsOk = false
    private val pending = ArrayList<String>()
    private var lm: LocationManager? = null
    private var sm: SensorManager? = null
    private var wake: PowerManager.WakeLock? = null
    private val h = Handler(Looper.getMainLooper())
    private var listening = false
    private var lastSave = 0L

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate(); alive = true
        tts = TextToSpeech(this, this)
        Run.speak = { text -> if (ttsOk) tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "md") else pending.add(text) }
        Run.speaking = { tts?.isSpeaking == true }
        Run.buzz = { p -> vibrate(p) }
        Run.voice = Store.voice(this); Cadence.load(this); Run.hrMaxSet = Store.hrMaxSet(this); Run.z2Alert = Store.z2Alert(this)
        // 앱이 정리됐다가 다시 켜진 경우: 하던 기록을 이어서
        if (Run.id == null) Store.loadCurrent(this)?.let { try { Run.restore(it) } catch (e: Exception) {} }
    }

    override fun onInit(status: Int) {
        if (status == TextToSpeech.SUCCESS) { tts?.language = Locale.KOREAN; ttsOk = true; pending.lastOrNull()?.let { Run.speak(it) }; pending.clear() }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) { if (recovering) recFinish(); shutdown(); return START_NOT_STICKY }
        if (intent?.action == ACTION_RECOVER) { if (listening && Recover.id != null) startRecover() else shutdown(); return START_NOT_STICKY }
        // 심박 회복을 재는 중에 새 기록을 시작하면: 잰 데까지 남기고 GPS·센서를 다시 다 켜요
        if (recovering) { recFinish(); quiet(); listening = false }
        goForeground(); listen()
        return START_STICKY
    }

    private fun granted(p: String) = checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED

    private fun goForeground(title: String = if (recovering) "운동 뒤 심박 재는 중" else "MPD Run 기록 중", sub: String = if (recovering) "2분 동안 심박이 얼마나 내려가는지 봐요" else "누르면 기록 화면으로 돌아가요") {
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) nm?.createNotificationChannel(NotificationChannel(CH, "러닝 기록", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE)
        val n = (if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CH) else Notification.Builder(this))
            .setContentTitle(title).setContentText(sub)
            .setSmallIcon(R.drawable.ic_run).setOngoing(true).setContentIntent(open).setCategory(Notification.CATEGORY_WORKOUT).build()
        if (Build.VERSION.SDK_INT >= 29) {
            // 위치는 꼭, 심박·걸음 권한이 있으면 '건강'도 (권한 없이 건강을 넣으면 안드로이드가 막아요)
            var type = ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
            if (Build.VERSION.SDK_INT >= 34 && (granted(Manifest.permission.BODY_SENSORS) || granted(Manifest.permission.ACTIVITY_RECOGNITION))) type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH
            startForeground(1, n, type)
        } else startForeground(1, n)
    }

    private fun listen() {
        if (listening) return
        listening = true
        wake = (getSystemService(POWER_SERVICE) as PowerManager).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "mdrun:run").apply { acquire(6 * 3600 * 1000L) }
        lm = getSystemService(LOCATION_SERVICE) as LocationManager
        // 2026-10-24: 시계가 화면이 어두워지면 위치를 모아 한꺼번에 보내(묶음) 'GPS 신호가 끊겼어요'·페이스 '--'가 났음
        //   → 안드로이드 12+는 '모아 보내기 금지'(maxUpdateDelay 0)·정확도 높게로 1초마다 바로 받기
        if (granted(Manifest.permission.ACCESS_FINE_LOCATION)) try {
            if (Build.VERSION.SDK_INT >= 31) lm?.requestLocationUpdates(LocationManager.GPS_PROVIDER,
                android.location.LocationRequest.Builder(1000L).setQuality(android.location.LocationRequest.QUALITY_HIGH_ACCURACY)
                    .setMinUpdateIntervalMillis(1000L).setMaxUpdateDelayMillis(0L).build(), mainExecutor, this)
            else lm?.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 0f, this, Looper.getMainLooper())
        } catch (e: Exception) {}
        sm = getSystemService(SENSOR_SERVICE) as SensorManager
        hrListen()
        if (Build.VERSION.SDK_INT < 29 || granted(Manifest.permission.ACTIVITY_RECOGNITION)) sm?.getDefaultSensor(Sensor.TYPE_STEP_COUNTER)?.let { sm?.registerListener(this, it, SensorManager.SENSOR_DELAY_NORMAL) }
        sm?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)?.let { sm?.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME) }
        h.post(tick)
        Cadence.start(this)
    }

    // 심박 센서 켜기. 30초 넘게 아무 값도 안 오면 다시 켜요(화면이 꺼질 때 멈추는 시계가 있어서)
    private var hrReg = 0L
    private fun hrListen() {
        Run.hrPerm = granted(Manifest.permission.BODY_SENSORS)
        if (!Run.hrPerm) return
        val s = sm?.getDefaultSensor(Sensor.TYPE_HEART_RATE) ?: return
        sm?.unregisterListener(this, s); sm?.registerListener(this, s, SensorManager.SENSOR_DELAY_NORMAL); hrReg = System.currentTimeMillis()
    }

    // 1초마다: 시간 목표의 남은 5분·1분 안내, 기록 중이면 30초마다 저장
    private val tick = object : Runnable {
        override fun run() {
            if (!listening) return
            Run.coachTick(); Run.sampleTick(System.currentTimeMillis())
            val now = System.currentTimeMillis()
            if (Run.id != null && now - lastSave > 30000) { lastSave = now; Store.saveCurrent(this@RunService) }
            if (now - maxOf(Run.hrEvT, hrReg) > 30000) { if (Run.hrPerm || granted(Manifest.permission.BODY_SENSORS)) goForeground(); hrListen() }
            if (recovering) recTick(now)
            h.postDelayed(this, 1000)
        }
    }

    override fun onLocationChanged(l: Location) {
        // 시각은 받은 때가 아니라 GPS가 잰 때(l.time): 묶음으로 한꺼번에 와도 점마다 제 시각이라 거리·페이스가 맞아요
        val now = System.currentTimeMillis()
        val t = if (l.time in (now - 120000)..now) l.time else now
        if (l.hasSpeed()) Run.onSpeed(l.speed, if (l.hasAccuracy()) l.accuracy else 99f, t)
        val added = Run.addPoint(l.latitude, l.longitude, if (l.hasAccuracy()) l.accuracy else 99f, if (l.hasAltitude()) l.altitude else null, t)
        Run.fixT = now
        geoidCheck(l)
        if (added && Run.pts.size % 10 == 0) Store.saveCurrent(this)
    }
    // 지도 화면의 '해발 고도'용: GPS 높이(타원체) − 해발을 한 번 셈. 땅 모양 자료를 읽느라 느려서 따로 돌려요(안드로이드 14+, 3번까지)
    @Volatile private var geoBusy = false; private var geoTry = 0
    private fun geoidCheck(l: Location) {
        if (Build.VERSION.SDK_INT < 34 || Run.geoid != null || geoBusy || geoTry >= 3 || !l.hasAltitude()) return
        geoBusy = true; geoTry++
        val c = Location(l)
        Thread {
            try {
                android.location.altitude.AltitudeConverter().addMslAltitudeToLocation(this, c)
                if (c.hasMslAltitude()) { val g = c.altitude - c.mslAltitudeMeters; h.post { Run.geoid = g } }
            } catch (e: Exception) {}
            geoBusy = false
        }.start()
    }
    @Deprecated("old API") override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
    override fun onProviderEnabled(provider: String) {}
    override fun onProviderDisabled(provider: String) { Run.gpsOn = false }

    override fun onSensorChanged(e: SensorEvent) {
        val now = System.currentTimeMillis()
        when (e.sensor.type) {
            // 2026-10-23: '흔들림(UNRELIABLE)' 값도 받아요(달리면 자주 이렇게 와서 심박이 통째로 비었음). 손목에 안 닿음만 버림
            Sensor.TYPE_HEART_RATE -> { Run.hrEvT = now; Run.hrNoContact = e.accuracy == SensorManager.SENSOR_STATUS_NO_CONTACT || e.values[0] <= 0f
                if (!Run.hrNoContact) Run.onHr(e.values[0].toInt(), now) }
            Sensor.TYPE_STEP_COUNTER -> Run.onSteps(e.values[0].toInt(), now)
            Sensor.TYPE_ACCELEROMETER -> Run.onAccel(e.values[0], e.values[1], e.values[2], now)
        }
    }
    override fun onAccuracyChanged(s: Sensor?, a: Int) {}

    private fun vibrate(p: LongArray) {
        try {
            val v = if (Build.VERSION.SDK_INT >= 31) (getSystemService(VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator else @Suppress("DEPRECATION") (getSystemService(VIBRATOR_SERVICE) as Vibrator)
            v.vibrate(VibrationEffect.createWaveform(p, -1))
        } catch (e: Exception) {}
    }

    // ---------- 운동 뒤 심박 회복: 끝낸 뒤 2분 동안 심박만 ----------
    private var recovering = false
    private fun startRecover() {
        recovering = true
        try { lm?.removeUpdates(this) } catch (e: Exception) {}
        sm?.getDefaultSensor(Sensor.TYPE_STEP_COUNTER)?.let { sm?.unregisterListener(this, it) }
        sm?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)?.let { sm?.unregisterListener(this, it) }
        Cadence.stop()
        goForeground()
    }
    private fun recTick(now: Long) {
        val el = now - Recover.t0; val hr = Run.hrNow(now)
        if (Recover.end == 0 && hr > 0 && el < 20000) Recover.end = hr
        if (Recover.h1 == 0 && hr > 0 && el in 60000..90000) Recover.h1 = hr
        if (Recover.h2 == 0 && hr > 0 && el in 120000..150000) Recover.h2 = hr
        if (Recover.h2 > 0 || el > 150000) { recFinish(); shutdown() }
    }
    // 잰 값을 기록 파일에 넣고(1분 값이 있을 때만) 휴대폰으로 다시 보내요
    private fun recFinish() {
        recovering = false; val id = Recover.id ?: return
        val e = Recover.end; val a = Recover.h1; val b = Recover.h2
        if (e > 0 && a > 0) Store.get(this, id)?.let { o ->
            o.optJSONObject("sum")?.put("hrEnd", e)?.put("hr1", a)?.put("hr2", b)
            Store.put(this, o)
            val app = applicationContext
            Wear.pushAll(app); Link.pushAll(app)
            Handler(Looper.getMainLooper()).postDelayed({ Wear.pushAll(app) }, 20000)   // 끝낼 때 보내던 게 아직이면 한 번 더
            val d = e - a
            Run.say("운동 뒤 심박, 1분에 ${d} 내려갔어요." + if (d >= 20) " 회복이 빨라요. 좋아요." else if (d < 12) " 회복이 느린 편이에요. 오늘은 푹 쉬어요." else "")
        }
        Recover.done = true
    }
    private fun quiet() {
        h.removeCallbacks(tick); Cadence.stop()
        try { lm?.removeUpdates(this) } catch (e: Exception) {}
        sm?.unregisterListener(this)
        try { wake?.release() } catch (e: Exception) {}
    }

    private fun shutdown() {
        listening = false; recovering = false; quiet()
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE) else @Suppress("DEPRECATION") stopForeground(true)
        stopSelf()
    }

    override fun onDestroy() {
        if (Run.id != null) Store.saveCurrent(this)
        if (listening) shutdown()
        // 마지막 말(목표 달성 등)이 끝날 시간은 줘요
        val t = tts; h.postDelayed({ t?.shutdown() }, 4000)
        alive = false; super.onDestroy()
    }
}
