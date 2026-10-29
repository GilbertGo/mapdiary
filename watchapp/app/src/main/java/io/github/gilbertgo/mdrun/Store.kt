package io.github.gilbertgo.mdrun

import android.content.Context
import org.json.JSONObject
import java.io.File

// 기록은 시계 안 앱 폴더에 기록마다 파일 하나(runs/{ID}.json, Map Diary 백업 파일과 같은 키).
// 달리는 중에는 current.json에 자주 남겨 두고, 앱이 꺼졌다 켜져도 이어서 기록해요.
object Store {
    private fun dir(c: Context) = File(c.filesDir, "runs").apply { mkdirs() }
    private fun cur(c: Context) = File(c.filesDir, "current.json")
    // 설정 (목표·목소리)
    private fun prefs(c: Context) = c.getSharedPreferences("mdrun", Context.MODE_PRIVATE)
    // 운동 종류(러닝/등산)와 목표는 종류마다 따로 (등산 목표는 'goalHike')
    fun sport(c: Context) = if (prefs(c).getString("sport", "run") == "hike") "hike" else "run"
    fun setSport(c: Context, s: String) = prefs(c).edit().putString("sport", s).apply()
    private fun goalKey(c: Context) = if (sport(c) == "hike") "goalHike" else "goal"
    fun goal(c: Context): Goal = try { Goal.from(JSONObject(prefs(c).getString(goalKey(c), "{}") ?: "{}")) } catch (e: Exception) { Goal() }
    fun setGoal(c: Context, g: Goal) = prefs(c).edit().putString(goalKey(c), g.toJson().toString()).apply()
    fun voice(c: Context) = prefs(c).getBoolean("voice", true)
    fun setVoice(c: Context, on: Boolean) = prefs(c).edit().putBoolean("voice", on).apply()
    fun weekGoal(c: Context) = prefs(c).getInt("weekGoal", 20)
    fun setWeekGoal(c: Context, km: Int) = prefs(c).edit().putInt("weekGoal", km).apply()
    fun age(c: Context) = prefs(c).getInt("age", 50)
    fun setAge(c: Context, v: Int) = prefs(c).edit().putInt("age", v).apply()
    fun hrMaxSet(c: Context) = prefs(c).getInt("hrMaxSet", 170)
    fun setHrMaxSet(c: Context, v: Int) = prefs(c).edit().putInt("hrMaxSet", v).apply()
    fun z2Alert(c: Context) = prefs(c).getBoolean("z2Alert", false)
    fun setZ2Alert(c: Context, on: Boolean) = prefs(c).edit().putBoolean("z2Alert", on).apply()
    fun cadKind(c: Context) = prefs(c).getInt("cadKind", 0)
    fun cadSpm(c: Context) = prefs(c).getInt("cadSpm", 180)
    fun cadLast(c: Context) = prefs(c).getInt("cadLast", 1)
    fun setCad(c: Context, k: Int, spm: Int, last: Int) = prefs(c).edit().putInt("cadKind", k).putInt("cadSpm", spm).putInt("cadLast", last).apply()
    fun page(c: Context) = prefs(c).getInt("page", 0)
    fun setPage(c: Context, p: Int) = prefs(c).edit().putInt("page", p).apply()

    private fun write(f: File, text: String) { val tmp = File(f.path + ".part"); tmp.writeText(text); tmp.renameTo(f) }
    fun saveCurrent(c: Context) { if (Run.id != null) try { write(cur(c), Run.toJson().toString()) } catch (e: Exception) {} }
    fun loadCurrent(c: Context): JSONObject? = try { if (cur(c).exists()) JSONObject(cur(c).readText()) else null } catch (e: Exception) { null }
    fun clearCurrent(c: Context) { cur(c).delete() }
    // 끝내기: 점이 2개 넘으면 남기고, 아니면 버려요
    fun finish(c: Context): String? {
        val id = Run.id ?: return null
        val keep = Run.pts.size >= 2
        if (keep) write(File(dir(c), "$id.json"), Run.toJson().toString())
        clearCurrent(c); Run.clear()
        return if (keep) id else null
    }
    fun list(c: Context): List<JSONObject> = (dir(c).listFiles() ?: emptyArray()).filter { it.name.endsWith(".json") }
        .mapNotNull { try { JSONObject(it.readText()) } catch (e: Exception) { null } }.sortedByDescending { it.optLong("at") }
    fun get(c: Context, id: String): JSONObject? = try { JSONObject(File(dir(c), "$id.json").readText()) } catch (e: Exception) { null }
    fun delete(c: Context, id: String) { File(dir(c), "$id.json").delete() }
    // 끝낸 기록 고쳐 쓰기(운동 뒤 심박 회복을 넣을 때)
    fun put(c: Context, o: JSONObject) { val id = o.optString("id"); val f = File(dir(c), "$id.json"); if (id.isNotEmpty() && f.exists()) try { write(f, o.toString()) } catch (e: Exception) {} }
}
