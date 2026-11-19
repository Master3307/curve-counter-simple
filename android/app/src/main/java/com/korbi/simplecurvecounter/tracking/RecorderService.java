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
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.Looper;
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
 * - GPS straight from LocationManager (works without Google Play services, Doppler speed).
 *   TODO(plan 1.7): FusedLocationProvider PRIORITY_HIGH_ACCURACY where available, compare.
 * - The notification text comes from the web layer (counts, speed) via {@link #notify}.
 *   TODO(plan 1.5): native curve detection, so counts update while the WebView sleeps.
 */
public class RecorderService extends Service implements LocationListener {
    private static final String TAG = "RecorderService";
    static final String ACTION_START = "com.korbi.simplecurvecounter.START";
    static final String EXTRA_SESSION = "sessionId";
    private static final String CHANNEL = "ride";
    private static final int NOTIFICATION_ID = 1;
    private static final long INTERVAL_MS = 1000;

    private static volatile RecorderService running;
    private static volatile String title;
    private static volatile String text;

    private PowerManager.WakeLock wakeLock;
    private boolean recording;

    // -------------------------------------------------------------------------------------------
    // called by the plugin

    /** Starts a new session (or keeps the current one when sessionId is null). */
    static void start(Context c, String sessionId) {
        Intent i = new Intent(c, RecorderService.class).setAction(ACTION_START);
        if (sessionId != null) i.putExtra(EXTRA_SESSION, sessionId);
        ContextCompat.startForegroundService(c, i);
    }

    static void stop(Context c) {
        FixLog.get(c).clear();
        RecorderService s = running;
        if (s != null) s.shutdown();
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
        }
    }

    // -------------------------------------------------------------------------------------------
    // service

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        running = this;
        FixLog log = FixLog.get(this);
        String newSession = intent != null ? intent.getStringExtra(EXTRA_SESSION) : null;
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
        try {
            lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, INTERVAL_MS, 0f, this, Looper.getMainLooper());
        } catch (Exception e) {
            Log.e(TAG, "GPS not available", e);
            shutdown();
            return;
        }
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SimpleCurveCounter:ride");
        wakeLock.setReferenceCounted(false);
        wakeLock.acquire();
        recording = true;
    }

    private void shutdown() {
        if (recording) {
            LocationManager lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
            lm.removeUpdates(this);
        }
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
            recording = false;
        }
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        if (running == this) running = null;
        super.onDestroy();
    }

    @Override
    public void onLocationChanged(@NonNull Location location) {
        FixLog.get(this).append(location);
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
    // notification

    private Notification buildNotification() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, getString(R.string.notification_channel), NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_curve)
            .setContentTitle(title != null ? title : getString(R.string.app_name))
            .setContentText(text != null ? text : getString(R.string.notification_recording))
            .setContentIntent(pi)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_NAVIGATION)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build();
    }
}
