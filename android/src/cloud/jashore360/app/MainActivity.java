package cloud.jashore360.app;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.GeolocationPermissions;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import org.json.JSONObject;

import java.io.InputStream;

/**
 * Jashore360 is a web app; this activity is a thin, fast WebView shell around it.
 * The site URL comes from assets/config.json (written by the server installer),
 * falling back to R.string.app_url.
 */
public class MainActivity extends Activity {
    private static final int REQ_FILE = 1;
    private static final int REQ_LOCATION = 2;

    private WebView web;
    private ProgressBar bar;
    private View offline;
    private String home;
    private String host;
    private ValueCallback<Uri[]> fileCallback;
    private GeolocationPermissions.Callback geoCallback;
    private String geoOrigin;
    private boolean shown;
    private boolean failed;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        home = readUrl();
        host = Uri.parse(home).getHost();

        FrameLayout root = new FrameLayout(this);
        web = new WebView(this);
        web.setVisibility(View.INVISIBLE);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));

        bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100);
        bar.setIndeterminate(false);
        bar.setProgressTintList(android.content.res.ColorStateList.valueOf(Color.parseColor("#0e9f6e")));
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(-1, dp(3));
        lp.gravity = Gravity.TOP;
        root.addView(bar, lp);

        offline = buildOffline();
        offline.setVisibility(View.GONE);
        root.addView(offline, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);

        setupWeb();
        if (state != null) web.restoreState(state);
        Uri link = getIntent().getData();
        if (state == null || web.getUrl() == null) web.loadUrl(link != null && isOwn(link) ? link.toString() : home);
    }

    private void setupWeb() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setGeolocationEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setAllowFileAccess(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUserAgentString(s.getUserAgentString() + " Jashore360App/" + versionCode());
        CookieManager.getInstance().setAcceptCookie(true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                Uri u = Uri.parse(url);
                if (isOwn(u) && !u.getPath().startsWith("/download/")) return false;
                openExternal(u);
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (failed) return;
                if (!shown) { shown = true; web.setVisibility(View.VISIBLE); }
                CookieManager.getInstance().flush();
            }

            // Only called for main-frame failures.
            @Override
            public void onReceivedError(WebView view, int code, String description, String failingUrl) {
                failed = true;
                offline.setVisibility(View.VISIBLE);
                web.setVisibility(View.INVISIBLE);
                shown = false;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int p) {
                bar.setProgress(p);
                bar.setVisibility(p >= 100 ? View.GONE : View.VISIBLE);
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                try {
                    startActivityForResult(params.createIntent(), REQ_FILE);
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback cb) {
                if (Build.VERSION.SDK_INT < 23 || checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                        || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                    cb.invoke(origin, true, false);
                    return;
                }
                geoOrigin = origin;
                geoCallback = cb;
                requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOCATION);
            }
        });

        web.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String ua, String disposition, String mime, long length) {
                openExternal(Uri.parse(url));
            }
        });
    }

    private View buildOffline() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setPadding(dp(32), dp(32), dp(32), dp(32));
        box.setBackgroundColor(Color.parseColor("#0f1b2d"));
        box.setClickable(true);

        TextView title = new TextView(this);
        title.setText(R.string.offline_title);
        title.setTextColor(Color.WHITE);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        title.setGravity(Gravity.CENTER);
        box.addView(title);

        TextView body = new TextView(this);
        body.setText(R.string.offline_body);
        body.setTextColor(Color.parseColor("#b5bfd0"));
        body.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        body.setGravity(Gravity.CENTER);
        body.setPadding(0, dp(10), 0, dp(24));
        box.addView(body);

        Button retry = new Button(this);
        retry.setText(R.string.retry);
        retry.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                failed = false;
                offline.setVisibility(View.GONE);
                String url = web.getUrl();
                web.loadUrl(url == null || url.startsWith("data:") ? home : url);
            }
        });
        box.addView(retry, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        Button call = new Button(this);
        call.setText(R.string.call_999);
        call.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                openExternal(Uri.parse("tel:999"));
            }
        });
        box.addView(call, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return box;
    }

    private boolean isOwn(Uri u) {
        String scheme = u.getScheme();
        return ("https".equals(scheme) || "http".equals(scheme)) && host != null && host.equalsIgnoreCase(u.getHost());
    }

    private void openExternal(Uri u) {
        Intent i;
        String scheme = u.getScheme() == null ? "" : u.getScheme();
        if (scheme.equals("tel")) i = new Intent(Intent.ACTION_DIAL, u);
        else if (scheme.equals("intent")) {
            try {
                i = Intent.parseUri(u.toString(), Intent.URI_INTENT_SCHEME);
                i.addCategory(Intent.CATEGORY_BROWSABLE);
                i.setComponent(null);
                i.setSelector(null);
            } catch (Exception e) {
                return;
            }
        } else i = new Intent(Intent.ACTION_VIEW, u);
        try {
            startActivity(i);
        } catch (ActivityNotFoundException ignored) {
        }
    }

    private String readUrl() {
        try {
            InputStream in = getAssets().open("config.json");
            byte[] buf = new byte[in.available()];
            int n = in.read(buf);
            in.close();
            String url = new JSONObject(new String(buf, 0, Math.max(n, 0), "UTF-8")).optString("url", "");
            if (url.startsWith("https://") || url.startsWith("http://")) return url;
        } catch (Exception ignored) {
        }
        return getString(R.string.app_url);
    }

    private int versionCode() {
        try {
            PackageInfo p = getPackageManager().getPackageInfo(getPackageName(), 0);
            return p.versionCode;
        } catch (Exception e) {
            return 0;
        }
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    @Override
    protected void onActivityResult(int req, int result, Intent data) {
        if (req == REQ_FILE) {
            if (fileCallback != null) fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            fileCallback = null;
            return;
        }
        super.onActivityResult(req, result, data);
    }

    @Override
    public void onRequestPermissionsResult(int req, String[] perms, int[] results) {
        if (req == REQ_LOCATION && geoCallback != null) {
            boolean ok = false;
            for (int r : results) ok |= r == PackageManager.PERMISSION_GRANTED;
            geoCallback.invoke(geoOrigin, ok, false);
            geoCallback = null;
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        Uri link = intent.getData();
        if (link != null && isOwn(link)) web.loadUrl(link.toString());
    }

    @Override
    public void onBackPressed() {
        if (offline.getVisibility() == View.VISIBLE) { finish(); return; }
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onPause() {
        super.onPause();
        web.onPause();
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }
}
