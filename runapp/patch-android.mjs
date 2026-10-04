// npx cap add android 뒤에: 앱 아이콘, 판 번호(깃허브 실행 번호), 알림 채널 이름을 넣어요
import { readFileSync, writeFileSync, copyFileSync, readdirSync, rmSync, existsSync } from 'node:fs';

const res = 'android/app/src/main/res', app = process.env.MD_APP || 'run';
// md(전체 Map Diary)는 icons/에 그림이 없어서 저장소 맨 위 icon-512.png·splash.png를 써요
// 앱 아이콘(시안 A안, 2026-10-01): Map Diary 아이콘 + 모서리 배지. icons/{run,pgolf}.png (원본 svg도 같은 곳)
const ICON = existsSync(`icons/${app}.png`) ? `icons/${app}.png` : '../icon-512.png', SPLASH = existsSync(`icons/${app}-splash.png`) ? `icons/${app}-splash.png` : 'splash.png';
for (const d of readdirSync(res).filter(d => d.startsWith('mipmap-'))) {
  if (d.startsWith('mipmap-anydpi')) { rmSync(`${res}/${d}`, { recursive: true, force: true }); continue; }   // 모양 아이콘(xml) 대신 우리 그림(png)을 쓰게
  for (const f of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png']) if (existsSync(`${res}/${d}/${f}`)) copyFileSync(ICON, `${res}/${d}/${f}`);
}
// 시작 화면(스플래시): Capacitor 그림 대신 종이 색 바탕 + 우리 아이콘
for (const d of readdirSync(res).filter(d => d.startsWith('drawable')))
  if (existsSync(`${res}/${d}/splash.png`)) copyFileSync(SPLASH, `${res}/${d}/splash.png`);
const n = Number(process.env.RUN_NUMBER || 1);
// 서명: 저장소의 runapp/debug.keystore로 꼭 서명해요. (예전엔 ~/.android에 두었는데 GitHub에선 쓰이지 않아 판마다 열쇠가 달라져
// '앱이 설치되지 않음'이 났어요, 2026-10-01) 늘 같은 열쇠라야 새 판을 덮어 설치할 수 있어요
const SIGN = `\n    signingConfigs {\n        debug {\n            storeFile file('../../debug.keystore')\n            storePassword 'android'\n            keyAlias 'androiddebugkey'\n            keyPassword 'android'\n        }\n    }\n    buildTypes {\n        debug {\n            signingConfig signingConfigs.debug\n        }\n    }\n`;
const g = 'android/app/build.gradle';
writeFileSync(g, readFileSync(g, 'utf8').replace(/versionCode \d+/, `versionCode ${n}`).replace(/versionName "[^"]*"/, `versionName "0.1.${n}"`).replace(/\nandroid \{\n/, m => m + SIGN));
if (!readFileSync(g, 'utf8').includes("storeFile file('../../debug.keystore')")) throw new Error('서명 설정을 못 넣었어요');
const s = `${res}/values/strings.xml`;
let x = readFileSync(s, 'utf8');
if (!x.includes('capacitor_background_geolocation_notification_channel_name'))
  x = x.replace('</resources>', `    <string name="capacitor_background_geolocation_notification_channel_name">${JSON.parse(readFileSync('apps.json', 'utf8'))[app].channel || '길 기록'}</string>\n</resources>`);
writeFileSync(s, x);
console.log('android 손질 끝 · 판 번호', n);

// 앱 고정(MdPin): 화면 잠금 중 홈·최근 앱 버튼을 막는 작은 자바 플러그인을 넣고 MainActivity에 등록해요
const appId = JSON.parse(readFileSync('capacitor.config.json', 'utf8')).appId, jdir = 'android/app/src/main/java/' + appId.replace(/\./g, '/');
writeFileSync(`${jdir}/MdPinPlugin.java`, `package ${appId};

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "MdPin")
public class MdPinPlugin extends Plugin {
    @PluginMethod
    public void start(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try { getActivity().startLockTask(); call.resolve(); } catch (Exception e) { call.reject(String.valueOf(e.getMessage())); }
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try { getActivity().stopLockTask(); } catch (Exception e) { }
            call.resolve();
        });
    }
}
`);
// MdApp: ① 새 화면(웹에서 받은 index.html)으로 바꾸기 setWeb ② 앱끼리 기록 넘기기 syncPut/syncDel(내 기록 내놓기)·syncList/syncRead(다른 앱 기록 읽기)
writeFileSync(`${jdir}/MdAppPlugin.java`, `package ${appId};

import android.app.Activity;
import android.database.Cursor;
import android.net.Uri;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "MdApp")
public class MdAppPlugin extends Plugin {
    static boolean okId(String id) { return id != null && id.matches("[A-Za-z0-9_]{1,40}"); }

    File dir() { File d = new File(getContext().getFilesDir(), "mdsync"); d.mkdirs(); return d; }

    // 화면 파일 자리를 바꾸고(다음에 켤 때도 그대로) 바로 다시 열어요. 새 판(APK)을 깔면 Capacitor가 알아서 앱 속 화면으로 되돌려요
    @PluginMethod
    public void setWeb(PluginCall call) {
        String p = call.getString("path");
        if (p == null) { call.reject("no path"); return; }
        getContext().getSharedPreferences("CapWebViewSettings", Activity.MODE_PRIVATE).edit().putString("serverBasePath", p).commit();
        call.resolve();
        getActivity().runOnUiThread(() -> bridge.setServerBasePath(p));
    }

    @PluginMethod
    public void syncPut(PluginCall call) {
        String id = call.getString("id"), data = call.getString("data");
        if (!okId(id) || data == null) { call.reject("bad"); return; }
        try {
            File tmp = new File(dir(), id + ".tmp");
            try (OutputStream o = new FileOutputStream(tmp)) { o.write(data.getBytes(StandardCharsets.UTF_8)); }
            if (!tmp.renameTo(new File(dir(), id + ".json"))) throw new IOException("rename");
            call.resolve();
        } catch (Exception e) { call.reject(String.valueOf(e.getMessage())); }
    }

    @PluginMethod
    public void syncDel(PluginCall call) {
        String id = call.getString("id");
        if (okId(id)) new File(dir(), id + ".json").delete();
        call.resolve();
    }

    @PluginMethod
    public void syncList(PluginCall call) {
        JSArray items = new JSArray();
        try {
            JSArray apps = call.getArray("apps");
            for (int i = 0; apps != null && i < apps.length(); i++) {
                String app = apps.getString(i);
                try (Cursor c = getContext().getContentResolver().query(Uri.parse("content://" + app + ".mdsync/list"), null, null, null, null)) {
                    if (c == null) continue;
                    while (c.moveToNext()) { JSObject o = new JSObject(); o.put("app", app); o.put("id", c.getString(0)); o.put("mtime", c.getLong(1)); items.put(o); }
                } catch (Exception e) { }   // 그 앱이 없거나 옛 판이면 건너뛰어요
            }
        } catch (Exception e) { }
        JSObject r = new JSObject(); r.put("items", items); call.resolve(r);
    }

    @PluginMethod
    public void syncRead(PluginCall call) {
        String app = call.getString("app"), id = call.getString("id");
        if (!okId(id) || app == null || !app.matches("[a-z0-9.]+")) { call.reject("bad"); return; }
        try (InputStream in = getContext().getContentResolver().openInputStream(Uri.parse("content://" + app + ".mdsync/" + id))) {
            ByteArrayOutputStream b = new ByteArrayOutputStream(); byte[] buf = new byte[65536]; int n;
            while ((n = in.read(buf)) > 0) b.write(buf, 0, n);
            JSObject r = new JSObject(); r.put("data", new String(b.toByteArray(), StandardCharsets.UTF_8)); call.resolve(r);
        } catch (Exception e) { call.reject(String.valueOf(e.getMessage())); }
    }
}
`);
// 내 기록을 같은 열쇠로 서명한 앱(Map Diary)에게만 내놓는 창구 (signature 권한)
writeFileSync(`${jdir}/MdSyncProvider.java`, `package ${appId};

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import java.io.File;
import java.io.FileNotFoundException;

public class MdSyncProvider extends ContentProvider {
    File dir() { return new File(getContext().getFilesDir(), "mdsync"); }
    @Override public boolean onCreate() { return true; }
    @Override public Cursor query(Uri u, String[] p, String s, String[] a, String o) {
        MatrixCursor c = new MatrixCursor(new String[] { "id", "mtime", "size" });
        File[] fs = dir().listFiles();
        if (fs != null) for (File f : fs) { String n = f.getName(); if (n.endsWith(".json")) c.addRow(new Object[] { n.substring(0, n.length() - 5), f.lastModified(), f.length() }); }
        return c;
    }
    @Override public ParcelFileDescriptor openFile(Uri u, String mode) throws FileNotFoundException {
        String id = u.getLastPathSegment();
        if (id == null || !id.matches("[A-Za-z0-9_]{1,40}") || !"r".equals(mode)) throw new FileNotFoundException();
        return ParcelFileDescriptor.open(new File(dir(), id + ".json"), ParcelFileDescriptor.MODE_READ_ONLY);
    }
    @Override public String getType(Uri u) { return "application/json"; }
    @Override public Uri insert(Uri u, ContentValues v) { return null; }
    @Override public int delete(Uri u, String s, String[] a) { return 0; }
    @Override public int update(Uri u, ContentValues v, String s, String[] a) { return 0; }
}
`);
writeFileSync(`${jdir}/MainActivity.java`, `package ${appId};

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MdPinPlugin.class);
        registerPlugin(MdAppPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
`);
// AndroidManifest: 같은 열쇠 앱끼리만 쓰는 권한 + 기록 창구(provider) + 다른 MD 앱을 볼 수 있게(queries)
const mf = 'android/app/src/main/AndroidManifest.xml', PERM = 'io.github.gilbertgo.mapdiary.SYNC';
let m = readFileSync(mf, 'utf8');
if (!m.includes('</application>') || !m.includes('</manifest>')) throw new Error('AndroidManifest 모양이 달라요');
m = m.replace('</application>', `    <provider android:name="${appId}.MdSyncProvider" android:authorities="${appId}.mdsync" android:exported="true" android:readPermission="${PERM}" />\n    </application>`)
  .replace('</manifest>', `    <permission android:name="${PERM}" android:protectionLevel="signature" />\n    <uses-permission android:name="${PERM}" />\n    <queries>\n${Object.values(JSON.parse(readFileSync('apps.json', 'utf8'))).map(a => `        <package android:name="${a.appId}" />`).join('\n')}\n    </queries>\n</manifest>`);
writeFileSync(mf, m);
console.log('앱 고정·화면 바꾸기·기록 넘기기 플러그인 넣음 ·', jdir);
