package com.autobot;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.ValueCallback;
import android.widget.Toast;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;

public class MainActivity extends Activity {

    private WebView webView;
    private String autobotScript;

    // ── 目标 PWA 地址，按需修改 ──
    private static final String TARGET_URL = "https://pwa.aifantasy.com/";

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        // 预加载 JS 脚本
        autobotScript = loadAsset("autobot.js");

        webView = findViewById(R.id.webview);
        setupWebView();
        webView.loadUrl(TARGET_URL);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void setupWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);          // localStorage / sessionStorage
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUserAgentString(settings.getUserAgentString() + " AutoBot/1.0");

        // Cookie 持久化（登录态保持）
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        webView.setWebChromeClient(new WebChromeClient());

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                // 每次页面加载完毕后自动注入脚本
                injectScript();
            }
        });
    }

    /**
     * 把 autobot.js 注入到当前 WebView 页面
     */
    private void injectScript() {
        if (autobotScript == null || autobotScript.isEmpty()) {
            Toast.makeText(this, "autobot.js 加载失败", Toast.LENGTH_SHORT).show();
            return;
        }

        // 避免重复注入
        String guard = "(function() {" +
            "if (window.__AUTOBOT_INJECTED__) return 'already';" +
            "window.__AUTOBOT_INJECTED__ = true;" +
            "return 'inject';" +
            "})()";

        webView.evaluateJavascript(guard, value -> {
            if ("\"inject\"".equals(value)) {
                webView.evaluateJavascript(autobotScript, null);
                android.util.Log.d("AutoBot", "Script injected into: " + webView.getUrl());
            } else {
                android.util.Log.d("AutoBot", "Script already injected, skipping");
            }
        });
    }

    /**
     * 从 assets 目录读取文件内容
     */
    private String loadAsset(String filename) {
        try {
            InputStream is = getAssets().open(filename);
            BufferedReader reader = new BufferedReader(new InputStreamReader(is));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                sb.append(line).append('\n');
            }
            reader.close();
            return sb.toString();
        } catch (Exception e) {
            android.util.Log.e("AutoBot", "Failed to load " + filename, e);
            return "";
        }
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
