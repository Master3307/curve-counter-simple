package com.korbi.simplecurvecounter;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.korbi.simplecurvecounter.tracking.InboxPlugin;
import com.korbi.simplecurvecounter.tracking.RecorderPlugin;
import com.korbi.simplecurvecounter.tracking.SetupPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RecorderPlugin.class);
        registerPlugin(InboxPlugin.class);
        registerPlugin(SetupPlugin.class);
        super.onCreate(savedInstanceState);
        InboxPlugin.handle(this, getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        InboxPlugin.handle(this, intent);
    }
}
