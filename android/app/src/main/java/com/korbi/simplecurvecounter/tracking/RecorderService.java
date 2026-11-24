package com.korbi.simplecurvecounter.tracking;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.location.Location;
import android.location.altitude.AltitudeConverter;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import com.korbi.simplecurvecounter.MainActivity;
import com.korbi.simplecurvecounter.R;

import java.io.IOException;

/**
 * Foreground service (type location) that records GPS fixes into the {@link FixLog} while a
 * ride is armed or running, with the screen off and the app in the background.
 *
 * - START_STICKY: if the system kills it, it comes back and continues the same session.
 * - Partial wake lock only while recording.
 * - GPS straight from LocationManager (works without Google Play services, Doppler speed and
 *   Doppler course).
 * - Gyroscope + gravity ("invisible compass", plan 1.7): the turn rate around the gravity axis
 *   is the vehicle's yaw rate no matter how the phone lies (mount, flat on the dash, pocket).
 *   Its bias is learned in the background whenever the vehicle stands still. Each fix gets the
 *   turn since the previous fix and the averaged gravity direction (phone tilt).
 * - Energy modes: "max" (GPS 1 s, sensors ~50 Hz), "balanced" (GPS 1 s, sensors ~15 Hz),
 *   "saver" (GPS 2 s, no extra sensors).
 * - Notification: text from the web layer (counts, speed); a second, non-ongoing copy is
 *   posted for smart watches (Wear OS doesn't show ongoing notifications).
 */
public class RecorderService extends Service implements LocationListener, SensorEventListener {
    private static final String TAG = "RecorderService";
    static final String ACTION_START = "com.korbi.simplecurvecounter.START";
    static final String EXTRA_SESSION = "sessionId";
    static final String EXTRA_POWER = "power";
    static final String EXTRA_WATCH = "watch";
    private static final String CHANNEL = "ride";
    private static final String CHANNEL_WATCH = "watch";
    private static final String GROUP = "ride";
    private static final int NOTIFICATION_ID = 1;
    private static final int WATCH_ID = 2;

    private static volatile RecorderService running;
    private static volatile String title;
    private static volatile String text;
    private static volatile String power = "balanced";
    private static volatile boolean watch = true;

    private PowerManager.WakeLock wakeLock;
    /** location + sensor callbacks run here: writing + height conversion must not block the UI */
    private HandlerThread gpsThread;
    private AltitudeConverter altitudeConverter;
    private boolean recording;

    // gyro / gravity state (only touched on gpsThread)
    private final float[] gravity = new float[3];
    private boolean haveGravity;
    private long lastGyroNs;
    /** degrees turned since the last fix, + = right */
    private double yawSinceFix;
    private boolean haveYaw;
    /** gyro bias around the gravity axis, rad/s, learned while standing still */
    private double bias;
    private boolean standing;
    private final double[] gSum = new double[3];
    private int gCount;

    // -------------------------------------------------------------------------------------------
    // called by the plugin

    /** Starts a new session (or keeps the current one when sessionId is null). */
    static void start(Context c, String sessionId, String powerMode, boolean showOnWatch) {
        Intent i = new Intent(c, RecorderService.class).setAction(ACTION_START);
        if (sessionId != null) i.putExtra(EXTRA_SESSION, sessionId);
        if (powerMode != null) i.putExtra(EXTRA_POWER, powerMode);
        i.putExtra(EXTRA_WATCH, showOnWatch);
        ContextCompat.startForegroundService(c, i);
    }

    static void stop(Context c) {
        FixLog.get(c).clear();
        RecorderService s = running;
        if (s != null) s.shutdown();
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        nm.cancel(WATCH_ID);
    }

    static boolean isRunning() {
        return running != null && running.recording;
    }

    static void notify(Context c, String newTitle, String newText) {
        title = newTitle;
        text = newText;
        RecorderService s = running;
        if (s != null && s.recording) {
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            nm.notify(NOTIFICATION_ID, s.buildNotification());
            if (watch) nm.notify(WATCH_ID, s.buildWatchNotification());
            else nm.cancel(WATCH_ID);
        }
    }

    // -------------------------------------------------------------------------------------------
    // service

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        running = this;
        FixLog log = FixLog.get(this);
        String newSession = intent != null ? intent.getStringExtra(EXTRA_SESSION) : null;
        if (intent != null && intent.hasExtra(EXTRA_POWER)) power = intent.getStringExtra(EXTRA_POWER);
        if (intent != null && intent.hasExtra(EXTRA_WATCH)) watch = intent.getBooleanExtra(EXTRA_WATCH, true);
        if (newSession != null && !newSession.equals(log.sessionId())) {
            try {
                log.start(newSession);
            } catch (IOException e) {
                Log.e(TAG, "could not start session", e);
            }
        }
        // intent == null → restarted by the system after it killed us: continue the session
        if (log.sessionId() == null) {
            shutdown();
            return START_NOT_STICKY;
        }
        if (!recording) begin();
        return recording ? START_STICKY : START_NOT_STICKY;
    }

    @SuppressLint("WakelockTimeout")
    private void begin() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, buildNotification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            } else {
                startForeground(NOTIFICATION_ID, buildNotification());
            }
        } catch (Exception e) {
            // e.g. Android 12+ refuses a location service started from the background.
            // The log stays; the app restarts recording the next time it is opened.
            Log.e(TAG, "startForeground refused", e);
            stopSelf();
            return;
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            Log.w(TAG, "no location permission");
            shutdown();
            return;
        }
        LocationManager lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        long interval = "saver".equals(power) ? 2000 : 1000;
        try {
            gpsThread = new HandlerThread("gps");
            gpsThread.start();
            lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, interval, 0f, this, gpsThread.getLooper());
        } catch (Exception e) {
            Log.e(TAG, "GPS not available", e);
            shutdown();
            return;
        }
        startSensors();
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "CurveCounterSimple:ride");
        wakeLock.setReferenceCounted(false);
        wakeLock.acquire();
        recording = true;
    }

    private void startSensors() {
        if ("saver".equals(power)) return;
        SensorManager sm = (SensorManager) getSystemService(Context.SENSOR_SERVICE);
        if (sm == null) return;
        Sensor gyro = sm.getDefaultSensor(Sensor.TYPE_GYROSCOPE);
        Sensor grav = sm.getDefaultSensor(Sensor.TYPE_GRAVITY);
        if (grav == null) grav = sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
        if (gyro == null || grav == null) return;
        int periodUs = "max".equals(power) ? 20_000 : 66_000;
        // batching (maxReportLatency) lets the sensor hub collect samples while the CPU sleeps
        int latencyUs = 1_000_000;
        Handler h = new Handler(gpsThread.getLooper());
        sm.registerListener(this, gyro, periodUs, latencyUs, h);
        sm.registerListener(this, grav, periodUs, latencyUs, h);
    }

    private void stopSensors() {
        SensorManager sm = (SensorManager) getSystemService(Context.SENSOR_SERVICE);
        if (sm != null) sm.unregisterListener(this);
    }

    private void shutdown() {
        if (recording) {
            LocationManager lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
            lm.removeUpdates(this);
            stopSensors();
        }
        quitGpsThread();
        recording = false;
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE);
        else stopForeground(true);
        stopSelf();
        if (running == this) running = null;
    }

    @Override
    public void onDestroy() {
        if (recording) {
            ((LocationManager) getSystemService(Context.LOCATION_SERVICE)).removeUpdates(this);
            stopSensors();
            recording = false;
        }
        quitGpsThread();
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        if (running == this) running = null;
        super.onDestroy();
    }

    private void quitGpsThread() {
        if (gpsThread != null) gpsThread.quitSafely();
        gpsThread = null;
    }

    // -------------------------------------------------------------------------------------------
    // sensors

    @Override
    public void onSensorChanged(SensorEvent e) {
        int type = e.sensor.getType();
        if (type == Sensor.TYPE_GRAVITY || type == Sensor.TYPE_ACCELEROMETER) {
            // accelerometer fallback: low-pass to get gravity
            float k = type == Sensor.TYPE_GRAVITY ? 1f : 0.1f;
            for (int i = 0; i < 3; i++) gravity[i] = haveGravity ? gravity[i] + k * (e.values[i] - gravity[i]) : e.values[i];
            haveGravity = true;
            double n = Math.sqrt(gravity[0] * gravity[0] + gravity[1] * gravity[1] + gravity[2] * gravity[2]);
            if (n > 1) {
                for (int i = 0; i < 3; i++) gSum[i] += gravity[i] / n;
                gCount++;
            }
            return;
        }
        if (type != Sensor.TYPE_GYROSCOPE || !haveGravity) return;
        long ns = e.timestamp;
        if (lastGyroNs == 0) {
            lastGyroNs = ns;
            return;
        }
        double dt = (ns - lastGyroNs) / 1e9;
        lastGyroNs = ns;
        if (dt <= 0 || dt > 0.5) return;
        double n = Math.sqrt(gravity[0] * gravity[0] + gravity[1] * gravity[1] + gravity[2] * gravity[2]);
        if (n < 1) return;
        // rotation around the "up" axis (gravity sensor points up); counter-clockwise = left
        double up = (e.values[0] * gravity[0] + e.values[1] * gravity[1] + e.values[2] * gravity[2]) / n;
        if (standing) {
            // background calibration: whatever it "turns" while standing is bias
            bias += 0.02 * (up - bias);
            return;
        }
        yawSinceFix += -Math.toDegrees((up - bias) * dt);
        haveYaw = true;
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {}

    // -------------------------------------------------------------------------------------------
    // GPS

    @Override
    public void onLocationChanged(@NonNull Location location) {
        standing = location.hasSpeed() && location.getSpeed() < 0.3f;
        double bearing = location.hasBearing() && location.hasSpeed() && location.getSpeed() > 1.5f ? location.getBearing() : Double.NaN;
        double yaw = haveYaw ? yawSinceFix : Double.NaN;
        double[] g = null;
        if (gCount > 0) {
            g = new double[] {gSum[0] / gCount, gSum[1] / gCount, gSum[2] / gCount};
            double n = Math.sqrt(g[0] * g[0] + g[1] * g[1] + g[2] * g[2]);
            if (n > 0) for (int i = 0; i < 3; i++) g[i] /= n;
        }
        yawSinceFix = 0;
        haveYaw = false;
        gSum[0] = gSum[1] = gSum[2] = 0;
        gCount = 0;
        FixLog.get(this).append(location, seaLevelAltitude(location), bearing, yaw, g);
    }

    /**
     * Height above sea level. getAltitude() is above the WGS84 ellipsoid (up to ~50 m off in
     * Europe); Android 14+ can convert it (AltitudeConverter, offline geoid model).
     */
    private double seaLevelAltitude(Location l) {
        if (!l.hasAltitude()) return Double.NaN;
        if (Build.VERSION.SDK_INT >= 34) {
            try {
                if (!l.hasMslAltitude()) {
                    if (altitudeConverter == null) altitudeConverter = new AltitudeConverter();
                    altitudeConverter.addMslAltitudeToLocation(this, l);
                }
                if (l.hasMslAltitude()) return l.getMslAltitudeMeters();
            } catch (Exception e) {
                Log.w(TAG, "MSL conversion failed", e);
            }
        }
        return l.getAltitude();
    }

    // older Android versions call these; nothing to do
    @Override
    public void onStatusChanged(String provider, int status, Bundle extras) {}

    @Override
    public void onProviderEnabled(@NonNull String provider) {}

    @Override
    public void onProviderDisabled(@NonNull String provider) {}

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // -------------------------------------------------------------------------------------------
    // notifications

    private void channels() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        if (nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, getString(R.string.notification_channel), NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        if (nm.getNotificationChannel(CHANNEL_WATCH) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_WATCH, getString(R.string.notification_channel_watch), NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            ch.setSound(null, null);
            ch.enableVibration(false);
            nm.createNotificationChannel(ch);
        }
    }

    private PendingIntent openApp() {
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private Notification buildNotification() {
        channels();
        String t = title != null ? title : getString(R.string.app_name);
        String x = text != null ? text : getString(R.string.notification_recording);
        return new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_curve)
            .setColor(0xFFF2A922)
            .setContentTitle(t)
            .setContentText(x)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(x))
            .setContentIntent(openApp())
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setLocalOnly(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_NAVIGATION)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build();
    }

    /**
     * Copy for smart watches: Wear OS only bridges notifications that are not ongoing. Big
     * text, no actions that need the phone; tapping it on the watch offers "Open on phone".
     */
    private Notification buildWatchNotification() {
        channels();
        String t = title != null ? title : getString(R.string.app_name);
        String x = text != null ? text : getString(R.string.notification_recording);
        return new NotificationCompat.Builder(this, CHANNEL_WATCH)
            .setSmallIcon(R.drawable.ic_stat_curve)
            .setColor(0xFFF2A922)
            .setContentTitle(t)
            .setContentText(x)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(x).setBigContentTitle(t))
            .setContentIntent(openApp())
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setAutoCancel(false)
            .setLocalOnly(false)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .extend(new NotificationCompat.WearableExtender().setHintContentIntentLaunchesActivity(true))
            .build();
    }
}
