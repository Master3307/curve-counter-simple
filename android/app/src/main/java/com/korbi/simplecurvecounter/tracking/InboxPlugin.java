package com.korbi.simplecurvecounter.tracking;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;

/**
 * Files opened with / shared to the app ("Open with Simple Curve Counter", plan 1.12 B).
 * MainActivity hands every incoming intent to {@link #handle}; the web layer takes the files
 * with take() (also after a cold start) and imports them like picked files.
 */
@CapacitorPlugin(name = "Inbox")
public class InboxPlugin extends Plugin {
    private static final String TAG = "Inbox";
    private static final int MAX_BYTES = 50 * 1024 * 1024;
    private static final ArrayList<JSObject> pending = new ArrayList<>();
    private static InboxPlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    /** Called by MainActivity for the launch intent and every new intent. */
    public static void handle(android.content.Context ctx, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        ArrayList<Uri> uris = new ArrayList<>();
        String action = intent.getAction();
        if (Intent.ACTION_VIEW.equals(action) && intent.getData() != null) {
            uris.add(intent.getData());
        } else if (Intent.ACTION_SEND.equals(action)) {
            Uri u = Build.VERSION.SDK_INT >= 33 ? intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class) : intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (u != null) uris.add(u);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> list = Build.VERSION.SDK_INT >= 33
                ? intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri.class)
                : intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (list != null) uris.addAll(list);
        }
        if (uris.isEmpty()) return;
        ContentResolver cr = ctx.getContentResolver();
        synchronized (pending) {
            for (Uri u : uris) {
                JSObject f = read(cr, u);
                if (f != null) pending.add(f);
            }
        }
        InboxPlugin p = instance;
        if (p != null) p.notifyListeners("files", new JSObject());
    }

    private static JSObject read(ContentResolver cr, Uri uri) {
        String name = "ride";
        try (Cursor c = cr.query(uri, new String[] {OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst() && !c.isNull(0)) name = c.getString(0);
        } catch (Exception ignored) {
        }
        try (InputStream in = cr.openInputStream(uri)) {
            if (in == null) return null;
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                if (out.size() > MAX_BYTES) return null;
            }
            JSObject f = new JSObject();
            f.put("name", name);
            byte[] bytes = out.toByteArray();
            // base64 so zipped files (KMZ) survive; "text" stays for older web code
            f.put("data", android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP));
            f.put("text", new String(bytes, StandardCharsets.UTF_8));
            return f;
        } catch (Exception e) {
            Log.w(TAG, "could not read " + uri, e);
            return null;
        }
    }

    @PluginMethod
    public void take(PluginCall call) {
        JSArray arr = new JSArray();
        synchronized (pending) {
            for (JSObject f : pending) arr.put(f);
            pending.clear();
        }
        JSObject res = new JSObject();
        res.put("files", arr);
        call.resolve(res);
    }
}
