package io.github.gilbertgo.mdrun

import android.content.Context
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.security.SecureRandom
import java.util.zip.Deflater
import java.util.zip.DeflaterOutputStream
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import java.io.File
import kotlin.concurrent.thread

// 휴대폰으로 보내기 (2026-10-19, 사용자 '와치로는 간단하게, 폰으로는 상세하게'):
// 연결 코드(단어 4글자, 휴대폰 MPD 모임방 코드와 같은 낱말)로 휴대폰 index.html의 roomOf와 똑같이 방 번호·열쇠를 만들고,
// 끝낸 기록을 압축(deflate) → 잠금(AES-GCM) → Firestore rooms/{방번호}/w/{기록ID}에 {enc, z:1}로 올려요.
// 휴대폰 '내 MPD → ⌚ 시계 기록 받기'에 같은 코드를 적으면 받아서 자세히 보여 줘요
object Link {
    private val A = "빠른 느린 푸른 맑은 밝은 붉은 하얀 노란 파란 빨간 착한 예쁜 고운 귀한 기쁜 신난 멋진 작은 높은 낮은 깊은 넓은 짧은 굵은 둥근 곧은 굳센 날쌘 젊은 어린 여린 강한 순한 선한 참한 바른 웃는 나는 뛰는 걷는 노는 자는 먹는 보는 부는 타는 뜨는 피는 크는 오는 가는 도는 사는 쉬는 흐린 더운 추운 초록 보라 분홍 황금 은빛 금빛 아기 꼬마 새싹 봄날 여름 가을 겨울 첫눈 달밤 하늘 바다 숲속 들꽃 꽃잎 반짝 방긋 살랑 소복 몽글 동글 말랑 폭신 보송 뽀송 꼬물 졸졸 솔솔 훨훨 둥실 반달 보름 새벽 아침 저녁 한낮 행복 용감 씩씩 느긋 든든 튼튼 싱싱 향긋 달콤 새콤 고소 짭짤 따끈 시원 포근 상냥 다정 산뜻 깜찍 늠름 성실 활발 명랑 조용 차분 심심 신비 까만 검은".split(" ")
    private val B = "나무 바다 하늘 구름 바람 햇살 달빛 별빛 이슬 노을 단풍 은행 벚꽃 매화 장미 국화 백합 연꽃 동백 목련 수국 갈대 억새 솔잎 바위 계곡 폭포 호수 연못 샘물 등대 항구 모래 파도 갯벌 물결 돌담 언덕 들판 초원 숲길 정자 쉼터 다리 나루 우물 장독 기와 초가 토끼 사슴 여우 수달 황새 백로 참새 제비 까치 딱새 고래 거북 해마 조개 소라 꽃게 문어 연어 송어 붕어 잉어 메기 나비 꿀벌 판다 펭귄 기린 사자 표범 늑대 하마 낙타 오리 거위 백조 공작 번개 안개 서리 눈꽃 봄비 샛별 은하 피리 장구 풍경 팽이 구슬 딱지 공기 그네 시소 소풍 김밥 호떡 군밤 감자 호박 수박 참외 딸기 포도 사과 자두 앵두 머루 다래 호두 밤톨 대추 곶감 유자 레몬 망고 체리 키위 자몽 녹차 홍차 우유 쿠키 사탕 젤리 식빵 만두 국수 라면 떡국 약과 송편 가방 모자 신발 우산 연필 공책 편지 엽서 사진 지도 등불 촛불 텐트 배낭 기차 버스 돛배 요트 풍선 달님 해님 별님 방울 종이 거울 시계 열쇠 상자 화분 꽃밭 텃밭 산책 여행 모험 탐험 보물 왕관 날개 깃털 꼬리 노래 웃음 미소 꿈길 꽃길 산길 물길 들길 하루 한밤 오늘 내일 소원 행운 희망 사랑 우정 친구 가족 이웃 마을 동네 골목 시장 광장 공원 정원 온천 고개 능선 산장 약수 계단 벤치 그늘 햇빛 거미 개미 매미 여치 반디 버들 자작 알밤".split(" ")
    private const val FS = "https://firestore.googleapis.com/v1/projects/map-photo-diary/databases/(default)/documents"
    private const val KEY = "AIzaSyAnozbPVYILJa4mjC6xYjiYl3RF9S1ohLc"
    private fun prefs(c: Context) = c.getSharedPreferences("mdrun", Context.MODE_PRIVATE)
    fun on(c: Context) = prefs(c).getBoolean("linkOn", false)
    fun code(c: Context) = prefs(c).getString("linkCode", "") ?: ""
    var status = ""; @Volatile var busy = false

    fun enable(c: Context, v: Boolean) {
        val e = prefs(c).edit().putBoolean("linkOn", v)
        if (v && code(c).isEmpty()) { val r = SecureRandom(); e.putString("linkCode", A[r.nextInt(A.size)] + B[r.nextInt(B.size)]) }
        e.apply(); if (v) pushAll(c)
    }

    // PBKDF2-HMAC-SHA256 (휴대폰 crypto.subtle과 같은 값)
    private fun pbkdf2(pw: ByteArray, salt: ByteArray, iter: Int, bytes: Int): ByteArray {
        val mac = Mac.getInstance("HmacSHA256"); mac.init(SecretKeySpec(pw, "HmacSHA256"))
        mac.update(salt); mac.update(byteArrayOf(0, 0, 0, 1)); var u = mac.doFinal(); val t = u.copyOf()
        for (i in 1 until iter) { u = mac.doFinal(u); for (k in t.indices) t[k] = (t[k].toInt() xor u[k].toInt()).toByte() }
        return t.copyOf(bytes)
    }
    // 방 번호·열쇠는 오래 걸려서(각 15만 번) 코드마다 한 번만 만들어 둬요
    private fun room(c: Context): Pair<String, ByteArray> {
        val code = code(c); val p = prefs(c)
        if (p.getString("linkFor", "") == code) { val rid = p.getString("linkRid", "") ?: ""; val k = p.getString("linkKey", "") ?: ""
            if (rid.isNotEmpty() && k.isNotEmpty()) return rid to Base64.decode(k, Base64.NO_WRAP) }
        val pw = code.toByteArray(Charsets.UTF_8)
        val rid = pbkdf2(pw, "mapdiary-room-id-v2".toByteArray(), 150000, 8).joinToString("") { String.format("%02x", it) }
        val key = pbkdf2(pw, "mapdiary-room-v1:$rid".toByteArray(), 150000, 16)
        p.edit().putString("linkFor", code).putString("linkRid", rid).putString("linkKey", Base64.encodeToString(key, Base64.NO_WRAP)).apply()
        return rid to key
    }
    private fun seal(key: ByteArray, plain: ByteArray): String {
        val iv = ByteArray(12).also { SecureRandom().nextBytes(it) }
        val ci = Cipher.getInstance("AES/GCM/NoPadding"); ci.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
        return Base64.encodeToString(iv + ci.doFinal(plain), Base64.NO_WRAP)
    }
    private fun deflate(b: ByteArray): ByteArray { val o = ByteArrayOutputStream(); DeflaterOutputStream(o, Deflater(9)).use { it.write(b) }; return o.toByteArray() }

    // 아직 안 보낸 기록을 모두 보내요(바뀐 기록도 다시). 인터넷이 안 되면 다음에
    fun pushAll(c: Context, done: (() -> Unit)? = null) {
        if (!on(c) || busy) return; busy = true
        val app = c.applicationContext
        thread {
            var n = 0; var fail = 0
            try {
                status = "보내는 중…"
                val (rid, key) = room(app)
                val sent = prefs(app).getStringSet("linkSent", emptySet())!!.toMutableSet()
                for (o in Store.list(app)) {
                    val id = o.optString("id"); val sig = "$id:" + o.toString().length
                    if (id.isEmpty() || sig in sent) continue
                    var rec = o; var d = ""
                    for (tryN in 0 until 4) {   // 너무 크면(규칙상 20만 자) 길 점을 절반씩 줄여요
                        d = JSONObject().put("enc", seal(key, deflate(rec.toString().toByteArray(Charsets.UTF_8)))).put("z", 1).toString()
                        if (d.length < 190000) break
                        rec = JSONObject(rec.toString()); val data = rec.getJSONObject("data"); val tk = "track:$id"
                        val a = JSONArray(data.optString(tk, "[]")); val b = JSONArray(); for (k in 0 until a.length()) if (k % 2 == 0 || k == a.length() - 1) b.put(a.get(k)); data.put(tk, b.toString())
                    }
                    if (d.length >= 190000) { fail++; continue }
                    val body = JSONObject().put("writes", JSONArray().put(JSONObject().put("update", JSONObject()
                        .put("name", "projects/map-photo-diary/databases/(default)/documents/rooms/$rid/w/$id")
                        .put("fields", JSONObject().put("d", JSONObject().put("stringValue", d)).put("t", JSONObject().put("integerValue", System.currentTimeMillis().toString())))))).toString()
                    val code = Updater.postJson(app, "$FS:commit?key=$KEY", body)
                    if (code == 200) { sent.removeAll { it.startsWith("$id:") }; sent.add(sig); n++ } else fail++
                }
                prefs(app).edit().putStringSet("linkSent", sent).apply()
                status = if (fail > 0) "보내지 못한 기록 ${fail}개 · 와이파이 확인" else if (n > 0) "기록 ${n}개를 보냈어요" else "모두 보냈어요"
            } catch (e: Exception) { status = "보내지 못했어요 · 인터넷 확인" }
            finally { busy = false; Updater.releaseNet(app); done?.let { android.os.Handler(android.os.Looper.getMainLooper()).post(it) } }
        }
    }
    // 바탕 사진 (2026-10-19 사용자 '시계에도 바탕 사진 바꾸게'): 시계엔 사진첩이 없어서 휴대폰 러닝 첫 화면 '바탕 사진 바꾸기'에서 고른 사진을
    // 휴대폰이 같은 연결 코드 열쇠로 잠가 rooms/{방번호}/x/bg={enc}(기본 사진이면 {none:1})에 올려요. 시작 화면을 열 때 바뀌었으면 받아 files/bg.jpg에 둬요
    private fun bgFile(c: Context) = File(c.filesDir, "bg.jpg")
    fun hero(c: Context): Bitmap? = try { bgFile(c).takeIf { it.exists() }?.let { BitmapFactory.decodeFile(it.path) } ?: BitmapFactory.decodeResource(c.resources, R.drawable.run_hero) }
        catch (e: Exception) { null }
    @Volatile private var bgBusy = false
    fun pullBg(c: Context, changed: () -> Unit) {
        if (!on(c) || bgBusy) return; bgBusy = true
        val app = c.applicationContext
        thread {
            var ch = false
            try {
                val (rid, key) = room(app)
                val (code, txt) = Updater.getText(app, "$FS/rooms/$rid/x/bg?key=$KEY")
                val f = bgFile(app)
                if (code == 404 && f.exists()) { f.delete(); prefs(app).edit().putString("bgT", "").apply(); ch = true }
                if (code == 200) {
                    val fields = JSONObject(txt).getJSONObject("fields"); val t = fields.optJSONObject("t")?.optString("integerValue") ?: ""
                    if (t != prefs(app).getString("bgT", "")) {
                        val d = JSONObject(fields.getJSONObject("d").getString("stringValue"))
                        if (d.has("enc")) {
                            val u = Base64.decode(d.getString("enc"), Base64.DEFAULT)
                            val ci = Cipher.getInstance("AES/GCM/NoPadding"); ci.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, u, 0, 12))
                            val img = ci.doFinal(u, 12, u.size - 12)
                            if (BitmapFactory.decodeByteArray(img, 0, img.size) != null) { File(app.filesDir, "bg.part").apply { writeBytes(img); renameTo(f) } }
                        } else f.delete()
                        prefs(app).edit().putString("bgT", t).apply(); ch = true
                    }
                }
            } catch (e: Exception) {}
            finally { bgBusy = false; Updater.releaseNet(app); if (ch) android.os.Handler(android.os.Looper.getMainLooper()).post(changed) }
        }
    }
    fun hasBg(c: Context) = bgFile(c).exists()
    // 기본 사진으로: 받은 사진만 지워요(휴대폰이 새 사진을 보내면 다시 받아요)
    fun clearBg(c: Context) { bgFile(c).delete() }
    fun forceBg(c: Context, changed: () -> Unit) { prefs(c).edit().putString("bgT", "").apply(); pullBg(c, changed) }
    fun sent(c: Context, id: String) = prefs(c).getStringSet("linkSent", emptySet())!!.any { it.startsWith("$id:") }
}
