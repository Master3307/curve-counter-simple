package com.korbi.simplecurvecounter.tracking;

import android.Manifest;
import android.app.Activity;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.app.ActivityManager;
import android.hardware.Sensor;
import android.hardware.SensorManager;
import android.location.LocationManager;
import android.provider.Settings;

import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.List;

/**
 * The "Is everything OK?" check (plan 1.6): real permission states, and one button per problem
 * that opens exactly the right page (vendor pages tried in order, then safe fallbacks).
 */
@CapacitorPlugin(name = "Setup")
public class SetupPlugin extends Plugin {
    private static final int REQ_BACKGROUND = 4711;

    private boolean granted(String p) {
        return ContextCompat.checkSelfPermission(getContext(), p) == PackageManager.PERMISSION_GRANTED;
    }

    @PluginMethod
    public void check(PluginCall call) {
        Context c = getContext();
        boolean fine = granted(Manifest.permission.ACCESS_FINE_LOCATION);
        boolean coarse = granted(Manifest.permission.ACCESS_COARSE_LOCATION);
        boolean background = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ? (fine || coarse) : granted(Manifest.permission.ACCESS_BACKGROUND_LOCATION);
        PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
        JSObject r = new JSObject();
        r.put("location", fine || coarse);
        r.put("precise", fine);
        r.put("background", background);
        r.put("notifications", NotificationManagerCompat.from(c).areNotificationsEnabled());
        r.put("battery", pm != null && pm.isIgnoringBatteryOptimizations(c.getPackageName()));
        r.put("manufacturer", Build.MANUFACTURER);
        // GPS switched off in the quick settings: nothing can be recorded at all
        LocationManager lm = (LocationManager) c.getSystemService(Context.LOCATION_SERVICE);
        boolean locOn = lm != null && (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? lm.isLocationEnabled() : lm.isProviderEnabled(LocationManager.GPS_PROVIDER));
        r.put("locationOn", locOn);
        r.put("powerSave", pm != null && pm.isPowerSaveMode());
        // "Background usage: Restricted" (Android 9+) stops the app even with everything else right
        ActivityManager am = (ActivityManager) c.getSystemService(Context.ACTIVITY_SERVICE);
        r.put("backgroundRestricted", Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && am != null && am.isBackgroundRestricted());
        SensorManager sm = (SensorManager) c.getSystemService(Context.SENSOR_SERVICE);
        r.put("gyro", sm != null && sm.getDefaultSensor(Sensor.TYPE_GYROSCOPE) != null);
        call.resolve(r);
    }

    @PluginMethod
    public void open(PluginCall call) {
        String key = call.getString("key", "appSettings");
        Activity a = getActivity();
        String pkg = getContext().getPackageName();
        Uri pkgUri = Uri.parse("package:" + pkg);
        List<Intent> tries = new ArrayList<>();
        switch (key) {
            case "locationAlways":
                // Android 11+: asking for background location jumps straight to the page with
                // "Allow all the time"; Android 10 shows the dialog.
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && granted(Manifest.permission.ACCESS_FINE_LOCATION)
                        && !granted(Manifest.permission.ACCESS_BACKGROUND_LOCATION)) {
                    ActivityCompat.requestPermissions(a, new String[] {Manifest.permission.ACCESS_BACKGROUND_LOCATION}, REQ_BACKGROUND);
                    resolve(call, true);
                    return;
                }
                break;
            case "locationServices":
                tries.add(new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS));
                break;
            case "powerSave":
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP_MR1) tries.add(new Intent(Settings.ACTION_BATTERY_SAVER_SETTINGS));
                break;
            case "notifications":
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    tries.add(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, pkg));
                }
                break;
            case "batteryUnrestricted":
                tries.add(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, pkgUri));
                tries.add(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
                break;
            case "xiaomiAutostart":
                tries.add(component("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"));
                break;
            case "huaweiAppLaunch":
                tries.add(component("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"));
                tries.add(component("com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity"));
                break;
            case "honorAppLaunch":
                tries.add(component("com.hihonor.systemmanager", "com.hihonor.systemmanager.startupmgr.ui.StartupNormalAppListActivity"));
                tries.add(component("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"));
                break;
            case "oppoAutostart":
                tries.add(component("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"));
                tries.add(component("com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity"));
                tries.add(component("com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity"));
                break;
            case "vivoBackground":
                tries.add(component("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"));
                tries.add(component("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager"));
                break;
            case "samsungNeverSleeping":
                tries.add(component("com.samsung.android.lool", "com.samsung.android.sm.battery.ui.BatteryActivity"));
                tries.add(component("com.samsung.android.sm", "com.samsung.android.sm.battery.ui.BatteryActivity"));
                break;
            default:
                break;
        }
        // everything falls back to the app's own settings page
        tries.add(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkgUri));
        for (Intent i : tries) {
            try {
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                a.startActivity(i);
                resolve(call, true);
                return;
            } catch (Exception ignored) {
                // page does not exist on this phone → next one
            }
        }
        resolve(call, false);
    }

    private static Intent component(String pkg, String cls) {
        return new Intent().setComponent(new ComponentName(pkg, cls));
    }

    private static void resolve(PluginCall call, boolean opened) {
        JSObject r = new JSObject();
        r.put("opened", opened);
        call.resolve(r);
    }
}
