package io.github.gilbertgo.mdrun

import android.content.Context
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.Asset
import com.google.android.gms.wearable.CapabilityClient
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.TimeUnit
import java.util.zip.GZIPOutputStream
import kotlin.concurrent.thread

// 휴대폰으로 저절로 보내기 (2026-10-20 사용자 '와치에 러닝 데이터 폰으로 보내기 어렵다' → '저절로 연결' 고름):
// 코드 없이 시계와 휴대폰을 잇는 블루투스(Wearable Data Layer)로 끝낸 기록을 보내요.
// 받는 쪽은 휴대폰 'MPD Run' 앱(시계와 같은 이름 io.github.gilbertgo.mdrun·같은 서명이라야 받을 수 있어요).
// 휴대폰 MPD Run이 기록 파일(mdsync, 백업 파일과 같은 모양)로 두면 휴대폰 MPD 앱이 켤 때 저절로 가져가요.
// 휴대폰이 멀리 있어도 시계에 쌓아 뒀다가 다시 이어지면 보내져요
object Wear {
    private fun prefs(c: Context) = c.getSharedPreferences("mdrun", Context.MODE_PRIVATE)
    @Volatile var status = ""; @Volatile private var busy = false

    // 휴대폰 MPD가 읽는 모양: {app:'mapdiary', ls:{'track:ID': …}, photos:[]} + 시계 분석용 walkHr·walkSeries
    fun syncJson(o: JSONObject): String {
        val id = o.getString("id"); val data = o.optJSONObject("data") ?: JSONObject(); val ls = JSONObject()
        val it = data.keys(); while (it.hasNext()) { val k = it.next(); val v = data.opt(k); if (v is String) ls.put(k, v) }
        val s = o.optJSONObject("sum") ?: JSONObject()
        ls.put("walkHr:$id", JSONObject().put("avg", s.optInt("hrAvg")).put("max", s.optInt("hrMax")).put("zone", s.optJSONArray("zone") ?: JSONArray())
            .put("hrMaxSet", s.optInt("hrMaxSet", 170)).put("cad", s.optInt("cad")).put("steps", s.optInt("steps")).put("moving", s.optLong("moving"))
            .put("walk", s.optDouble("walk", 0.0)).put("watch", 1).toString())
        o.optJSONArray("series")?.let { ls.put("walkSeries:$id", it.toString()) }
        return JSONObject().put("app", "mapdiary").put("v", 1).put("at", System.currentTimeMillis()).put("ls", ls).put("photos", JSONArray()).toString()
    }
    private fun gzip(s: String): ByteArray { val b = ByteArrayOutputStream(); GZIPOutputStream(b).use { it.write(s.toByteArray(Charsets.UTF_8)) }; return b.toByteArray() }

    // 아직 안 보낸(또는 바뀐) 기록을 모두 시계 안 우편함에 넣어요. 휴대폰과 이어지면 블루투스로 건너가요
    fun pushAll(c: Context, done: (() -> Unit)? = null) {
        if (busy) return; busy = true
        val app = c.applicationContext
        thread {
            var n = 0
            try {
                val dc = Wearable.getDataClient(app)
                val sent = prefs(app).getStringSet("wearSent", emptySet())!!.toMutableSet()
                for (o in Store.list(app)) {
                    val id = o.optString("id"); val sig = "$id:" + o.toString().length
                    if (!id.matches(Regex("[A-Za-z0-9_]{1,40}")) || sig in sent) continue
                    val req = PutDataMapRequest.create("/mpd/run/$id").apply { dataMap.putAsset("d", Asset.createFromBytes(gzip(syncJson(o)))); dataMap.putLong("t", System.currentTimeMillis()) }
                        .asPutDataRequest().setUrgent()
                    Tasks.await(dc.putDataItem(req), 20, TimeUnit.SECONDS)
                    sent.removeAll { it.startsWith("$id:") }; sent.add(sig); n++
                }
                prefs(app).edit().putStringSet("wearSent", sent).apply()
                status = if (n > 0) "기록 ${n}개를 휴대폰으로 보냈어요" else "모두 보냈어요"
            } catch (e: Exception) { status = "보내지 못했어요 · 휴대폰과 연결을 확인해 주세요" }
            finally { busy = false; done?.let { android.os.Handler(android.os.Looper.getMainLooper()).post(it) } }
        }
    }
    fun sent(c: Context, id: String) = prefs(c).getStringSet("wearSent", emptySet())!!.any { it.startsWith("$id:") }

    // 휴대폰에 받는 앱(MPD Run)이 있고 지금 이어져 있는지: true/false, 알 수 없으면 null
    fun phoneReady(c: Context, cb: (Boolean?) -> Unit) {
        val app = c.applicationContext
        thread {
            val r: Boolean? = try { Tasks.await(Wearable.getCapabilityClient(app).getCapability("mpd_phone", CapabilityClient.FILTER_REACHABLE), 10, TimeUnit.SECONDS).nodes.isNotEmpty() }
                catch (e: Exception) { null }
            android.os.Handler(android.os.Looper.getMainLooper()).post { cb(r) }
        }
    }
}
