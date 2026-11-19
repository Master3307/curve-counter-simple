package com.korbi.simplecurvecounter.tracking;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Web ↔ native bridge for the recorder. Contract: src/tracking/plugin.ts (RecorderPlugin).
 * Permissions are requested by the web layer (@capacitor/geolocation) before start().
 */
@CapacitorPlugin(name = "Recorder")
public class RecorderPlugin extends Plugin {
    private final Runnable onFix = () -> notifyListeners("fix", null);

    @Override
    public void load() {
        FixLog.get(getContext()).addListener(onFix);
    }

    @Override
    protected void handleOnDestroy() {
        FixLog.get(getContext()).removeListener(onFix);
    }

    @PluginMethod
    public void start(PluginCall call) {
        String id = call.getString("sessionId");
        if (id == null || id.isEmpty()) {
            call.reject("sessionId missing");
            return;
        }
        try {
            RecorderService.start(getContext(), id);
            call.resolve();
        } catch (Exception e) {
            call.reject("could not start recording", e);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        RecorderService.stop(getContext());
        call.resolve();
    }

    @PluginMethod
    public void read(PluginCall call) {
        int from = call.getInt("from", 0);
        int limit = call.getInt("limit", 2000);
        JSObject res = new JSObject();
        res.put("fixes", FixLog.get(getContext()).read(from, limit));
        call.resolve(res);
    }

    /**
     * Also restarts recording if a session exists but the service is gone (e.g. the system
     * refused to restart it in the background): the app is in the foreground now, so it may.
     */
    @PluginMethod
    public void status(PluginCall call) {
        FixLog log = FixLog.get(getContext());
        String id = log.sessionId();
        if (id != null && !RecorderService.isRunning()) {
            try {
                RecorderService.start(getContext(), null);
            } catch (Exception ignored) {
            }
        }
        JSObject res = new JSObject();
        res.put("sessionId", id);
        res.put("count", log.count());
        call.resolve(res);
    }

    @PluginMethod
    public void updateNotification(PluginCall call) {
        RecorderService.notify(getContext(), call.getString("title"), call.getString("text"));
        call.resolve();
    }
}
