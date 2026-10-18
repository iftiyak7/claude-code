package tech.goriberhisab.app;

import android.app.job.JobParameters;
import android.app.job.JobService;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/** Background check for new low-stock alerts (scheduled by Alerts.setFeed). */
public class AlertJob extends JobService {

    private Thread worker;

    @Override
    public boolean onStartJob(JobParameters params) {
        worker = new Thread(() -> {
            check();
            jobFinished(params, false);
        });
        worker.start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        if (worker != null) {
            worker.interrupt();
        }
        return true;
    }

    private void check() {
        SharedPreferences p = Alerts.prefs(this);
        String feed = p.getString("alert_feed", "");
        if (feed.isEmpty()) {
            return;
        }
        long after = p.getLong("alert_last", 0);
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(feed + (feed.contains("?") ? "&" : "?") + "after=" + after).openConnection();
            c.setConnectTimeout(15000);
            c.setReadTimeout(20000);
            c.setRequestProperty("Accept", "application/json");
            c.setRequestProperty("Cache-Control", "no-cache");
            int code = c.getResponseCode();
            if (code == 401 || code == 403) {
                Alerts.setFeed(this, ""); // logged out or removed from the shop
                return;
            }
            if (code != 200) {
                return;
            }
            JSONObject res = new JSONObject(read(c.getInputStream()));
            JSONArray items = res.optJSONArray("items");
            long last = res.optLong("last_id", after);
            if (items != null) {
                for (int i = 0; i < items.length(); i++) {
                    JSONObject a = items.getJSONObject(i);
                    Alerts.show(this, a.optInt("id"), a.optString("title"), a.optString("body"), a.optString("link"));
                }
            }
            Alerts.seen(this, last);
        } catch (Exception e) {
            // No internet or server busy: try again next time.
        } finally {
            if (c != null) {
                c.disconnect();
            }
        }
    }

    private static String read(InputStream in) throws java.io.IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) {
            out.write(buf, 0, n);
        }
        return out.toString("UTF-8");
    }
}
