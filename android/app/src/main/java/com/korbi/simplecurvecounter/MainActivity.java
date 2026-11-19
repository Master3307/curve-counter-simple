package com.korbi.simplecurvecounter;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.korbi.simplecurvecounter.tracking.RecorderPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RecorderPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
