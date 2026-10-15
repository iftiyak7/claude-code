package tech.goriberhisab.app;

import android.content.Context;
import android.content.res.AssetManager;
import android.net.Uri;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Makes the app open instantly and work without internet:
 *
 *  - App files (JavaScript, styles, Bangla text, icons) come from inside the
 *    APK instead of the website, as long as the website runs the same
 *    version. A newer website is always used as is.
 *  - The app page itself is saved after each visit and shown straight away
 *    next time, then quietly refreshed in the background. It is tied to the
 *    login session, so another person's login never sees it.
 *
 * Data (sales, stock, reports) always comes from the server; the web app
 * keeps its own offline copy of what was viewed.
 */
final class LocalWeb {

    private static final Pattern VERSION = Pattern.compile("\"version\":\"([^\"]+)\"");
    private static final String ASSETS = "/goriber-hisab/assets/";

    private final Context context;
    private final AssetManager assets;
    private final File shellDir;
    private final ExecutorService bg = Executors.newSingleThreadExecutor();
    private volatile String serverVersion;
    private String userAgent = "";

    LocalWeb(Context context) {
        this.context = context;
        this.assets = context.getAssets();
        this.shellDir = new File(context.getFilesDir(), "shell");
        //noinspection ResultOfMethodCallIgnored
        shellDir.mkdirs();
        this.serverVersion = context.getSharedPreferences("goriber_hisab", Context.MODE_PRIVATE).getString("server_version", "");
    }

    void setUserAgent(String ua) {
        userAgent = ua == null ? "" : ua;
    }

    /** Called on a background thread for every request the page makes. */
    WebResourceResponse intercept(WebResourceRequest req, String appUrl) {
        if (!"GET".equalsIgnoreCase(req.getMethod())) {
            return null;
        }
        Uri uri = req.getUrl();
        Uri home = Uri.parse(appUrl);
        if (uri.getHost() == null || !uri.getHost().equalsIgnoreCase(home.getHost())) {
            return null;
        }
        String path = uri.getPath() == null ? "" : uri.getPath();
        int at = path.indexOf(ASSETS);
        if (at >= 0) {
            return asset(uri, path.substring(at + ASSETS.length()));
        }
        if (req.isForMainFrame() && isShell(uri, home)) {
            return shell(uri.toString());
        }
        return null;
    }

    /* ------------------------------------------------------------ App files */

    private WebResourceResponse asset(Uri uri, String rel) {
        if (rel.isEmpty() || rel.contains("..") || rel.startsWith("app/")) {
            return null;
        }
        String v = uri.getQueryParameter("v");
        boolean same = v != null ? v.equals(BuildConfig.WEB_VERSION) : BuildConfig.WEB_VERSION.equals(serverVersion);
        if (!same) {
            // The website runs another version: use its files, ours only as an offline fallback.
            WebResourceResponse net = fetch(uri.toString(), mime(rel));
            if (net != null) {
                return net;
            }
        }
        try {
            InputStream in = assets.open("web/" + rel);
            Map<String, String> h = new HashMap<>();
            h.put("Cache-Control", "no-cache");
            h.put("Access-Control-Allow-Origin", "*");
            return new WebResourceResponse(mime(rel), mime(rel).startsWith("image/") ? null : "utf-8", 200, "OK", h, in);
        } catch (IOException e) {
            return null; // not bundled: let the WebView fetch it
        }
    }

    private static String mime(String rel) {
        String n = rel.toLowerCase(Locale.ROOT);
        if (n.endsWith(".js") || n.endsWith(".mjs")) return "text/javascript";
        if (n.endsWith(".css")) return "text/css";
        if (n.endsWith(".json")) return "application/json";
        if (n.endsWith(".svg")) return "image/svg+xml";
        if (n.endsWith(".png")) return "image/png";
        if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
        if (n.endsWith(".webp")) return "image/webp";
        if (n.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }

    /** Plain network GET with the WebView's cookies (no redirects). */
    private WebResourceResponse fetch(String url, String mime) {
        try {
            HttpURLConnection c = open(url);
            if (c.getResponseCode() != 200) {
                c.disconnect();
                return null;
            }
            byte[] body = read(c.getInputStream());
            c.disconnect();
            return new WebResourceResponse(mime, "utf-8", new ByteArrayInputStream(body));
        } catch (IOException e) {
            return null;
        }
    }

    private HttpURLConnection open(String url) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setInstanceFollowRedirects(false);
        c.setConnectTimeout(8000);
        c.setReadTimeout(15000);
        String cookies = CookieManager.getInstance().getCookie(url);
        if (cookies != null) {
            c.setRequestProperty("Cookie", cookies);
        }
        c.setRequestProperty("User-Agent", userAgent);
        c.setRequestProperty("Accept-Language", Locale.getDefault().toLanguageTag());
        return c;
    }

    private static byte[] read(InputStream in) throws IOException {
        try (InputStream i = in; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[16384];
            int n;
            while ((n = i.read(buf)) > 0) {
                out.write(buf, 0, n);
            }
            return out.toByteArray();
        }
    }

    /* --------------------------------------------------------------- Shell */

    private static boolean isShell(Uri uri, Uri home) {
        String a = trim(uri.getPath());
        String b = trim(home.getPath());
        if (!a.equals(b)) {
            return false;
        }
        String q = uri.getQuery();
        String hq = home.getQuery();
        return q == null || q.isEmpty() || q.equals(hq);
    }

    private static String trim(String p) {
        if (p == null) return "";
        return p.endsWith("/") ? p.substring(0, p.length() - 1) : p;
    }

    /** The signed-in session this device has, or "" when logged out. */
    private static String session(String url) {
        String cookies = CookieManager.getInstance().getCookie(url);
        if (cookies == null) return "";
        for (String part : cookies.split(";")) {
            String p = part.trim();
            if (p.startsWith("wordpress_logged_in_")) {
                return p;
            }
        }
        return "";
    }

    private static String hash(String s) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8));
            StringBuilder b = new StringBuilder();
            for (int i = 0; i < 12; i++) {
                b.append(String.format("%02x", d[i]));
            }
            return b.toString();
        } catch (Exception e) {
            return Integer.toHexString(s.hashCode());
        }
    }

    private WebResourceResponse shell(String url) {
        String session = session(url);
        if (session.isEmpty()) {
            forgetShell();
            return null; // logged out: the website shows its login page
        }
        File file = new File(shellDir, hash(session + "|" + url) + ".html");
        if (file.exists()) {
            try {
                byte[] body = read(new FileInputStream(file));
                rememberVersion(new String(body, StandardCharsets.UTF_8));
                bg.execute(() -> refreshShell(url, file));
                return html(body);
            } catch (IOException ignored) {
                // fall through to the network
            }
        }
        byte[] fresh = refreshShell(url, file);
        return fresh == null ? null : html(fresh);
    }

    /** Download the app page and save it. Returns null when it could not (offline, logged out). */
    private byte[] refreshShell(String url, File file) {
        try {
            HttpURLConnection c = open(url);
            c.setRequestProperty("Accept", "text/html");
            int code = c.getResponseCode();
            if (code != 200) {
                c.disconnect();
                if (code >= 300 && code < 500) {
                    forgetShell(); // session ended: next launch goes to the login page
                }
                return null;
            }
            byte[] body = read(c.getInputStream());
            c.disconnect();
            String text = new String(body, StandardCharsets.UTF_8);
            if (!text.contains("window.BZL")) {
                return null;
            }
            rememberVersion(text);
            forgetShell();
            File tmp = new File(file.getPath() + ".tmp");
            try (FileOutputStream out = new FileOutputStream(tmp)) {
                out.write(body);
            }
            //noinspection ResultOfMethodCallIgnored
            tmp.renameTo(file);
            return body;
        } catch (IOException e) {
            return null;
        }
    }

    private void rememberVersion(String html) {
        Matcher m = VERSION.matcher(html);
        if (m.find()) {
            String v = m.group(1);
            if (!v.equals(serverVersion)) {
                serverVersion = v;
                context.getSharedPreferences("goriber_hisab", Context.MODE_PRIVATE).edit().putString("server_version", v).apply();
            }
        }
    }

    void forgetShell() {
        File[] files = shellDir.listFiles();
        if (files != null) {
            for (File f : files) {
                //noinspection ResultOfMethodCallIgnored
                f.delete();
            }
        }
    }

    private static WebResourceResponse html(byte[] body) {
        Map<String, String> h = new HashMap<>();
        h.put("Cache-Control", "no-store");
        return new WebResourceResponse("text/html", "utf-8", 200, "OK", h, new ByteArrayInputStream(body));
    }

    void close() {
        bg.shutdown();
    }
}
