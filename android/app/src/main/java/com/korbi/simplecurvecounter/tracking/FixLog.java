package com.korbi.simplecurvecounter.tracking;

import android.content.Context;
import android.location.Location;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileReader;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * The fix log of the running session: every GPS fix is appended to a file right away
 * (Rule 1: never lose a ride). Kept in memory as well so the WebView can read it fast.
 *
 * Files (app-private): recorder/session  = session id (exists while a session is recorded)
 *                      recorder/fixes.csv = one line per fix:
 *                        t,lat,lon,speed,accuracy,alt,bearing,yaw,gx,gy,gz
 *                        (empty when unknown; alt = height above sea level where available;
 *                        bearing = Doppler course; yaw = gyro turn since the previous fix,
 *                        degrees, + = right; g = gravity direction in phone coordinates)
 *
 * TODO(milestone 2b): Room/SQLite with ride, curve and fix tables (plan 1.5), raw fixes kept
 * after the ride for re-analysis.
 */
public final class FixLog {
    private static final String TAG = "FixLog";
    /** fsync every N fixes: survives a dead battery, not only an app kill */
    private static final int SYNC_EVERY = 10;
    private static FixLog instance;

    private final File sessionFile;
    private final File fixesFile;
    private final ArrayList<double[]> fixes = new ArrayList<>();
    private final CopyOnWriteArrayList<Runnable> listeners = new CopyOnWriteArrayList<>();
    private String sessionId;
    private FileOutputStream out;
    private int unsynced;

    public static synchronized FixLog get(Context context) {
        if (instance == null) instance = new FixLog(context.getApplicationContext());
        return instance;
    }

    private FixLog(Context context) {
        File dir = new File(context.getFilesDir(), "recorder");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        sessionFile = new File(dir, "session");
        fixesFile = new File(dir, "fixes.csv");
        load();
    }

    /** After an app kill / reboot: pick the session up again from disk. */
    private void load() {
        if (!sessionFile.exists()) return;
        try (BufferedReader r = new BufferedReader(new FileReader(sessionFile))) {
            String id = r.readLine();
            sessionId = id != null && !id.trim().isEmpty() ? id.trim() : null;
        } catch (IOException e) {
            Log.w(TAG, "session file unreadable", e);
        }
        if (sessionId == null || !fixesFile.exists()) return;
        try (BufferedReader r = new BufferedReader(new FileReader(fixesFile))) {
            String line;
            while ((line = r.readLine()) != null) {
                double[] f = parse(line);
                if (f != null) fixes.add(f); // a half-written last line (crash) is skipped
            }
        } catch (IOException e) {
            Log.w(TAG, "fix log unreadable", e);
        }
    }

    private static double[] parse(String line) {
        String[] p = line.split(",", -1);
        // 5 fields = v0.2 (no height), 6 = v0.9 (no sensors), 11 = v1.0
        if (p.length < 5 || p.length > 11) return null;
        try {
            double[] f = new double[11];
            for (int i = 0; i < 11; i++) {
                if (i < 3 || i == 4) f[i] = Double.parseDouble(p[i]);
                else f[i] = i >= p.length || p[i].isEmpty() ? Double.NaN : Double.parseDouble(p[i]);
            }
            return f;
        } catch (NumberFormatException e) {
            return null;
        }
    }

    public synchronized String sessionId() {
        return sessionId;
    }

    public synchronized int count() {
        return fixes.size();
    }

    /** New session: the previous log is dropped. */
    public synchronized void start(String id) throws IOException {
        closeOut();
        fixes.clear();
        //noinspection ResultOfMethodCallIgnored
        fixesFile.delete();
        File tmp = new File(sessionFile.getPath() + ".tmp");
        try (FileOutputStream o = new FileOutputStream(tmp)) {
            o.write(id.getBytes(StandardCharsets.UTF_8));
            o.getFD().sync();
        }
        if (!tmp.renameTo(sessionFile)) throw new IOException("could not write session file");
        sessionId = id;
    }

    public synchronized void clear() {
        closeOut();
        fixes.clear();
        sessionId = null;
        //noinspection ResultOfMethodCallIgnored
        fixesFile.delete();
        //noinspection ResultOfMethodCallIgnored
        sessionFile.delete();
    }

    private static String n(double v) {
        // Double.toString always uses '.', independent of the phone's language
        return Double.isNaN(v) ? "" : Double.toString(v);
    }

    /**
     * @param alt     height above sea level, NaN when unknown
     * @param bearing Doppler course, NaN when unknown
     * @param yaw     gyro turn since the previous fix (deg, + = right), NaN when unknown
     * @param g       gravity direction (unit vector, phone coordinates), null when unknown
     */
    public void append(Location l, double alt, double bearing, double yaw, double[] g) {
        synchronized (this) {
            if (sessionId == null) return;
            double speed = l.hasSpeed() ? l.getSpeed() : Double.NaN;
            double acc = l.hasAccuracy() ? l.getAccuracy() : 99;
            double gx = g != null ? g[0] : Double.NaN;
            double gy = g != null ? g[1] : Double.NaN;
            double gz = g != null ? g[2] : Double.NaN;
            double[] f = {l.getTime(), l.getLatitude(), l.getLongitude(), speed, acc, alt, bearing, yaw, gx, gy, gz};
            fixes.add(f);
            String line = (long) f[0] + "," + f[1] + "," + f[2] + "," + n(speed) + "," + acc + "," + n(alt) + "," + n(bearing) + ","
                + n(yaw) + "," + n(gx) + "," + n(gy) + "," + n(gz) + "\n";
            try {
                if (out == null) out = new FileOutputStream(fixesFile, true);
                out.write(line.getBytes(StandardCharsets.UTF_8));
                out.flush();
                if (++unsynced >= SYNC_EVERY) {
                    out.getFD().sync();
                    unsynced = 0;
                }
            } catch (IOException e) {
                Log.e(TAG, "could not write fix", e);
                closeOut();
            }
        }
        for (Runnable l2 : listeners) l2.run();
    }

    public synchronized JSArray read(int from, int limit) {
        JSArray arr = new JSArray();
        int end = Math.min(fixes.size(), Math.max(0, from) + Math.max(0, limit));
        for (int i = Math.max(0, from); i < end; i++) {
            double[] f = fixes.get(i);
            JSObject o = new JSObject();
            o.put("t", (long) f[0]);
            o.put("lat", f[1]);
            o.put("lon", f[2]);
            if (Double.isNaN(f[3])) o.put("speed", JSONObject.NULL);
            else o.put("speed", f[3]);
            o.put("accuracy", f[4]);
            if (Double.isNaN(f[5])) o.put("alt", JSONObject.NULL);
            else o.put("alt", f[5]);
            if (!Double.isNaN(f[6])) o.put("bearing", f[6]);
            if (!Double.isNaN(f[7])) o.put("yaw", f[7]);
            if (!Double.isNaN(f[8]) && !Double.isNaN(f[9]) && !Double.isNaN(f[10])) {
                try {
                    o.put("g", new JSArray(new double[] {f[8], f[9], f[10]}));
                } catch (org.json.JSONException ignored) {
                    // not a number (can't happen: checked above)
                }
            }
            arr.put(o);
        }
        return arr;
    }

    public void addListener(Runnable r) {
        listeners.add(r);
    }

    public void removeListener(Runnable r) {
        listeners.remove(r);
    }

    private void closeOut() {
        if (out == null) return;
        try {
            out.getFD().sync();
            out.close();
        } catch (IOException ignored) {
        }
        out = null;
        unsynced = 0;
    }
}
