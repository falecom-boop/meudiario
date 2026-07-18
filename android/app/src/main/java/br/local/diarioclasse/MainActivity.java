package br.local.diarioclasse;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(SyncFolderPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
