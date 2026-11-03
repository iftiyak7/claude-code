package cloud.jashore360.app;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkInfo;
import android.net.NetworkRequest;
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
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.HashSet;
import java.util.Set;

/**
 * Jashore360 is a web app; this activity is a thin, fast WebView shell around it.
 * The site URL comes from assets/config.json (written by the server installer),
 * falling back to R.string.app_url.
 */
public class MainActivity extends Activity {
    private static final int REQ_FILE = 1;
    private static final int REQ_LOCATION = 2;
    private static final String PREFS = "jashore360";

    private WebView web;
    private ProgressBar bar;
    private View offline;
    private String home;
    private String host;
    private final Set<String> hosts = new HashSet<String>();   // the site's own domains (current one plus older ones)
    private ValueCallback<Uri[]> fileCallback;
    private GeolocationPermissions.Callback geoCallback;
    private String geoOrigin;
    private boolean shown;
    private boolean failed;
    private volatile boolean forceOffline;   // the server could not be reached although the phone has a network
    private volatile boolean syncing;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        home = readUrl();
        host = Uri.parse(home).getHost();
        if (host != null) addHost(host);

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
        if (offline()) web.getSettings().setCacheMode(WebSettings.LOAD_CACHE_ELSE_NETWORK);   // photos seen before still show
        watchNetwork();
        if (state != null) web.restoreState(state);
        Uri link = getIntent().getData();
        if (finishGoogleSignIn(link)) return;
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
                if (isOwn(u) && u.getPath() != null && u.getPath().startsWith("/api/auth/google/start")) {
                    startGoogleSignIn(u);
                    return true;
                }
                if (isOwn(u) && !u.getPath().startsWith("/download/")) return false;
                openExternal(u);
                return true;
            }

            // Without internet the app runs from its own copy (see the "offline copy" part below).
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (!"GET".equals(req.getMethod()) || !isOwn(u) || !offline()) return null;
                return localResponse(localPath(u.getPath()));
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (failed) return;
                if (!offline()) syncCopy();
                if (!shown) { shown = true; web.setVisibility(View.VISIBLE); }
                CookieManager.getInstance().flush();
            }

            // Only called for main-frame failures.
            @Override
            public void onReceivedError(WebView view, int code, String description, String failingUrl) {
                if (!forceOffline && hasLocal("app.html")) {          // the site is unreachable: open the copy on the phone instead
                    forceOffline = true;
                    web.getSettings().setCacheMode(WebSettings.LOAD_CACHE_ELSE_NETWORK);
                    view.loadUrl(home);
                    return;
                }
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
                forceOffline = false;
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

    /*
     * Google does not allow signing in inside a WebView, so sign-in runs in the phone's browser. A random secret is kept here;
     * the server only learns its SHA-256, and when the browser sends us back a one-time code we redeem it together with the
     * secret. Another app that catches the jashore360:// link cannot use the code without the secret.
     */
    private void startGoogleSignIn(Uri start) {
        byte[] raw = new byte[32];
        new SecureRandom().nextBytes(raw);
        String secret = hex(raw);
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString("gsecret", secret).apply();
        openExternal(start.buildUpon().appendQueryParameter("app", sha256(secret)).build());
    }

    private boolean finishGoogleSignIn(Uri link) {
        if (link == null || !"jashore360".equals(link.getScheme()) || !"auth".equals(link.getHost())) return false;
        String code = link.getQueryParameter("code");
        String secret = getSharedPreferences(PREFS, MODE_PRIVATE).getString("gsecret", null);
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().remove("gsecret").apply();
        Uri base = Uri.parse(home);
        if (code == null || secret == null) {
            web.loadUrl(home);
            return true;
        }
        web.loadUrl(base.getScheme() + "://" + base.getAuthority() + "/api/auth/google/finish?code=" + Uri.encode(code) + "&s=" + secret);
        return true;
    }

    private static String sha256(String s) {
        try {
            return hex(MessageDigest.getInstance("SHA-256").digest(s.getBytes("UTF-8")));
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    private static String hex(byte[] b) {
        StringBuilder sb = new StringBuilder();
        for (byte x : b) sb.append(String.format("%02x", x & 0xff));
        return sb.toString();
    }

    /* ---------------- offline copy ----------------
     * The APK carries the app's files and a snapshot of the data (assets/www, added when the server builds the APK).
     * Whenever the app is online it fetches the list of files with their SHA-256 (/api/shell), downloads only the changed
     * ones and the current data into files/www, and checks every download against its fingerprint. Without internet, the
     * page, its scripts and /api/bootstrap are answered from files/www, else from the copy in the APK. Online, everything
     * comes straight from the site, so new features show up at once.
     */
    private boolean offline() {
        if (forceOffline) return true;
        ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        NetworkInfo n = cm == null ? null : cm.getActiveNetworkInfo();
        return n == null || !n.isConnected();
    }

    private void watchNetwork() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        if (cm == null) return;
        try {
            cm.registerNetworkCallback(new NetworkRequest.Builder().build(), new ConnectivityManager.NetworkCallback() {
                @Override
                public void onAvailable(Network network) {
                    forceOffline = false;
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() { web.getSettings().setCacheMode(WebSettings.LOAD_DEFAULT); }
                    });
                }
            });
        } catch (RuntimeException ignored) {
        }
    }

    static String localPath(String path) {
        if (path == null || path.contains("..")) return null;
        if (path.equals("/") || path.equals("/app") || path.startsWith("/app/")) return "app.html";
        if (path.equals("/api/bootstrap")) return "api/bootstrap.json";
        String p = path.substring(1);
        if (p.equals("app.css") || p.equals("i18n.js") || p.equals("icons.js") || p.equals("icon.svg") || p.equals("manifest.webmanifest")) return p;
        if (p.startsWith("js/") && p.endsWith(".js") && p.indexOf('/', 3) < 0) return p;
        return null;
    }

    private File localFile(String p) {
        return new File(new File(getFilesDir(), "www"), p);
    }

    private boolean hasLocal(String p) {
        if (localFile(p).isFile()) return true;
        try {
            getAssets().open("www/" + p).close();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private WebResourceResponse localResponse(String p) {
        if (p == null) return null;
        InputStream in = null;
        try {
            File f = localFile(p);
            in = f.isFile() ? new FileInputStream(f) : getAssets().open("www/" + p);
        } catch (Exception e) {
            return null;
        }
        String type = p.endsWith(".html") ? "text/html" : p.endsWith(".css") ? "text/css" : p.endsWith(".js") ? "application/javascript"
                : p.endsWith(".svg") ? "image/svg+xml" : p.endsWith(".webmanifest") ? "application/manifest+json" : "application/json";
        return new WebResourceResponse(type, "utf-8", in);
    }

    private void syncCopy() {
        final long now = System.currentTimeMillis();
        if (syncing || now - getSharedPreferences(PREFS, MODE_PRIVATE).getLong("synced", 0) < 10 * 60 * 1000) return;
        syncing = true;
        final Uri base = Uri.parse(home);
        final String origin = base.getScheme() + "://" + base.getAuthority();
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    JSONObject known = readJson(localFile(".manifest.json"));
                    JSONObject next = new JSONObject();
                    JSONArray files = new JSONObject(new String(fetch(origin + "/api/shell"), "UTF-8")).getJSONArray("files");
                    for (int i = 0; i < files.length(); i++) {
                        JSONObject f = files.getJSONObject(i);
                        String p = f.getString("path"), sha = f.getString("sha256");
                        if (localPath("/" + p) == null && !p.equals("app.html")) continue;      // only the app's own files
                        if (!sha.equals(known.optString(p)) || !localFile(p).isFile()) {
                            byte[] data = fetch(origin + "/" + p);
                            if (!sha.equals(hex(MessageDigest.getInstance("SHA-256").digest(data)))) continue;   // damaged download
                            write(localFile(p), data);
                        }
                        next.put(p, sha);
                    }
                    byte[] boot = fetch(origin + "/api/bootstrap");
                    new JSONObject(new String(boot, "UTF-8"));                                  // only valid data replaces the old
                    write(localFile("api/bootstrap.json"), boot);
                    write(localFile(".manifest.json"), next.toString().getBytes("UTF-8"));
                    getSharedPreferences(PREFS, MODE_PRIVATE).edit().putLong("synced", now).apply();
                } catch (Exception ignored) {
                } finally {
                    syncing = false;
                }
            }
        }).start();
    }

    private static byte[] fetch(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(10000);
        c.setReadTimeout(20000);
        try {
            if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
            InputStream in = c.getInputStream();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
            return out.toByteArray();
        } finally {
            c.disconnect();
        }
    }

    private static void write(File f, byte[] data) throws Exception {
        f.getParentFile().mkdirs();
        File tmp = new File(f.getPath() + ".part");
        FileOutputStream out = new FileOutputStream(tmp);
        try {
            out.write(data);
        } finally {
            out.close();
        }
        if (!tmp.renameTo(f)) throw new Exception("rename");
    }

    private static JSONObject readJson(File f) {
        try {
            FileInputStream in = new FileInputStream(f);
            byte[] b = new byte[(int) f.length()];
            int n = in.read(b);
            in.close();
            return new JSONObject(new String(b, 0, Math.max(n, 0), "UTF-8"));
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private boolean isOwn(Uri u) {
        String scheme = u.getScheme();
        String h = u.getHost();
        return ("https".equals(scheme) || "http".equals(scheme)) && h != null && hosts.contains(h.toLowerCase());
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
            JSONObject cfg = new JSONObject(new String(buf, 0, Math.max(n, 0), "UTF-8"));
            org.json.JSONArray extra = cfg.optJSONArray("hosts");
            for (int i = 0; extra != null && i < extra.length(); i++) addHost(extra.optString(i, ""));
            String url = cfg.optString("url", "");
            if (url.startsWith("https://") || url.startsWith("http://")) return url;
        } catch (Exception ignored) {
        }
        return getString(R.string.app_url);
    }

    private void addHost(String h) {
        h = h.trim().toLowerCase();
        if (h.length() == 0) return;
        if (h.startsWith("www.")) h = h.substring(4);
        hosts.add(h);
        hosts.add("www." + h);
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
        if (finishGoogleSignIn(link)) return;
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
        forceOffline = false;
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }
}
