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
        const val CH = "run"
        var alive = false
        fun warm(c: Context) { val i = Intent(c, RunService::class.java).setAction(ACTION_WARM); if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i) else c.startService(i) }
        fun stop(c: Context) { c.startService(Intent(c, RunService::class.java).setAction(ACTION_STOP)) }
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
        if (intent?.action == ACTION_STOP) { shutdown(); return START_NOT_STICKY }
        goForeground(); listen()
        return START_STICKY
    }

    private fun granted(p: String) = checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED

    private fun goForeground() {
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) nm?.createNotificationChannel(NotificationChannel(CH, "러닝 기록", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE)
        val n = (if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CH) else Notification.Builder(this))
            .setContentTitle("MD Run 기록 중").setContentText("누르면 기록 화면으로 돌아가요")
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
        if (granted(Manifest.permission.ACCESS_FINE_LOCATION)) try { lm?.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 0f, this, Looper.getMainLooper()) } catch (e: Exception) {}
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
            h.postDelayed(this, 1000)
        }
    }

    override fun onLocationChanged(l: Location) {
        if (l.hasSpeed()) Run.onSpeed(l.speed, if (l.hasAccuracy()) l.accuracy else 99f, System.currentTimeMillis())
        val added = Run.addPoint(l.latitude, l.longitude, if (l.hasAccuracy()) l.accuracy else 99f, if (l.hasAltitude()) l.altitude else null, System.currentTimeMillis())
        if (added && Run.pts.size % 10 == 0) Store.saveCurrent(this)
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

    private fun shutdown() {
        listening = false; h.removeCallbacks(tick); Cadence.stop()
        try { lm?.removeUpdates(this) } catch (e: Exception) {}
        sm?.unregisterListener(this)
        try { wake?.release() } catch (e: Exception) {}
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
