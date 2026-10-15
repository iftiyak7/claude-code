package tech.goriberhisab.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Message;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.ServiceWorkerController;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.Toast;

/**
 * Goriber Hisab for Android: a full-screen WebView around the web app with
 * the native extras a shop needs — Bluetooth receipt printing, A4/A5 printing,
 * saving reports, camera barcode scanning, file uploads and working offline
 * (the web app caches itself and queues sales while there is no internet).
 */
public class MainActivity extends Activity {

    private static final int REQ_FILE = 11;
    private static final int REQ_PERMS = 12;
    private static final String PREFS = "goriber_hisab";

    private WebView web;
    private ProgressBar bar;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest pendingPermission;
    private NativeBridge bridge;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().getDecorView().setBackgroundColor(Color.parseColor("#0B1A2E"));

        FrameLayout root = new FrameLayout(this);
        web = new WebView(this);
        bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        bar.setIndeterminate(false);
        bar.setMax(100);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        FrameLayout.LayoutParams barParams = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 8);
        root.addView(bar, barParams);
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setSupportMultipleWindows(false); // window.open() loads in this view
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setTextZoom(100);
        s.setUserAgentString(s.getUserAgentString() + " GoriberHisabApp/" + BuildConfig.VERSION_NAME);
        s.setCacheMode(isOnline() ? WebSettings.LOAD_DEFAULT : WebSettings.LOAD_CACHE_ELSE_NETWORK);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            ServiceWorkerController.getInstance().getServiceWorkerWebSettings().setAllowContentAccess(true);
        }
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        bridge = new NativeBridge(this, web);
        web.addJavascriptInterface(bridge, "GoriberHisabNative");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme() == null ? "" : uri.getScheme();
                String host = uri.getHost() == null ? "" : uri.getHost();
                Uri home = Uri.parse(appUrl());
                boolean sameSite = ("http".equals(scheme) || "https".equals(scheme)) && host.equalsIgnoreCase(home.getHost());
                if (sameSite) {
                    return false;
                }
                // WhatsApp, phone calls, SMS, maps, courier tracking pages…
                openExternal(uri);
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                bar.setVisibility(View.GONE);
                CookieManager.getInstance().flush();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    showOffline();
                }
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int progress) {
                bar.setVisibility(progress < 100 ? View.VISIBLE : View.GONE);
                bar.setProgress(progress);
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) {
                    fileCallback.onReceiveValue(null);
                }
                fileCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), REQ_FILE);
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                // Camera for the barcode scanner.
                runOnUiThread(() -> {
                    if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                        request.grant(request.getResources());
                    } else {
                        pendingPermission = request;
                        requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_PERMS);
                    }
                });
            }

            @Override
            public boolean onCreateWindow(WebView view, boolean dialog, boolean userGesture, Message resultMsg) {
                return false;
            }
        });

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState);
        } else {
            String start = appUrl();
            Uri data = getIntent().getData();
            if (data != null && data.getHost() != null && data.getHost().equalsIgnoreCase(Uri.parse(start).getHost())) {
                start = data.toString();
            }
            web.loadUrl(start);
        }
    }

    String appUrl() {
        SharedPreferences p = getSharedPreferences(PREFS, MODE_PRIVATE);
        return p.getString("url", BuildConfig.APP_URL);
    }

    void setAppUrl(String url) {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString("url", url).apply();
    }

    private boolean isOnline() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) {
            return true;
        }
        NetworkInfo info = cm.getActiveNetworkInfo();
        return info != null && info.isConnected();
    }

    private void showOffline() {
        String html = "<html><head><meta name='viewport' content='width=device-width,initial-scale=1'>"
                + "<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b1a2e;color:#e6eef7;font-family:sans-serif;text-align:center;padding:24px;box-sizing:border-box}"
                + "button{margin:8px;padding:14px 22px;border:0;border-radius:12px;font-size:16px;font-weight:bold}"
                + ".p{background:#16a34a;color:#fff}.s{background:#1c3150;color:#cfe0ee}</style></head><body><div>"
                + "<h2>ইন্টারনেট সংযোগ নেই</h2><p>No internet connection.<br>Connect and try again. Sales you already started offline are safe on this phone.</p>"
                + "<button class='p' onclick='GoriberHisabNative.reload()'>আবার চেষ্টা করুন / Retry</button><br>"
                + "<button class='s' onclick='GoriberHisabNative.changeServer()'>সার্ভার ঠিকানা / Server address</button>"
                + "</div></body></html>";
        web.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
    }

    void reloadApp() {
        runOnUiThread(() -> {
            web.getSettings().setCacheMode(isOnline() ? WebSettings.LOAD_DEFAULT : WebSettings.LOAD_CACHE_ELSE_NETWORK);
            web.loadUrl(appUrl());
        });
    }

    void askServer() {
        runOnUiThread(() -> {
            EditText input = new EditText(this);
            input.setText(appUrl());
            input.setSingleLine(true);
            new AlertDialog.Builder(this)
                    .setTitle("Server address")
                    .setMessage("Your Goriber Hisab website, for example https://goriberhisab.tech/app/")
                    .setView(input)
                    .setPositiveButton("Save", (d, w) -> {
                        String url = input.getText().toString().trim();
                        if (url.startsWith("https://") || url.startsWith("http://")) {
                            setAppUrl(url);
                            reloadApp();
                        } else {
                            Toast.makeText(this, "Start the address with https://", Toast.LENGTH_LONG).show();
                        }
                    })
                    .setNegativeButton("Cancel", null)
                    .show();
        });
    }

    void printPage() {
        runOnUiThread(() -> {
            PrintManager pm = (PrintManager) getSystemService(Context.PRINT_SERVICE);
            if (pm == null) {
                return;
            }
            String title = web.getTitle() == null ? "Goriber Hisab" : web.getTitle();
            PrintDocumentAdapter adapter = web.createPrintDocumentAdapter(title);
            pm.print(title, adapter, new PrintAttributes.Builder().build());
        });
    }

    private void openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "No app can open this link.", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILE && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCallback = null;
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == REQ_PERMS && pendingPermission != null) {
            if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) {
                pendingPermission.grant(pendingPermission.getResources());
            } else {
                pendingPermission.deny();
            }
            pendingPermission = null;
        }
        bridge.onPermissionsResult(requestCode, results);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        Uri data = intent.getData();
        if (data != null) {
            web.loadUrl(data.toString());
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        bridge.close();
        web.destroy();
        super.onDestroy();
    }
}
