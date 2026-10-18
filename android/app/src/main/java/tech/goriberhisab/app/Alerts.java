package tech.goriberhisab.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;

/**
 * Low-stock alerts in the phone's notification bar. The web app hands over a
 * private link (setFeed); AlertJob checks it about every 15 minutes, also while
 * the app is closed, and the web app reports what it already showed (seen) so
 * nothing rings twice.
 */
final class Alerts {

    static final String CHANNEL = "stock_alerts";
    private static final int JOB_ID = 4101;
    private static final String PREFS = "goriber_hisab";

    private Alerts() {
    }

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static void setFeed(Context c, String url) {
        prefs(c).edit().putString("alert_feed", url == null ? "" : url).apply();
        JobScheduler js = (JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (js == null) {
            return;
        }
        if (url == null || url.isEmpty()) {
            js.cancel(JOB_ID);
            return;
        }
        JobInfo.Builder b = new JobInfo.Builder(JOB_ID, new ComponentName(c, AlertJob.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPersisted(true)
                .setPeriodic(15 * 60 * 1000L);
        js.schedule(b.build());
    }

    static void seen(Context c, long id) {
        SharedPreferences p = prefs(c);
        if (id > p.getLong("alert_last", 0)) {
            p.edit().putLong("alert_last", id).apply();
        }
    }

    static void channel(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CHANNEL) != null) {
            return;
        }
        NotificationChannel ch = new NotificationChannel(CHANNEL, "স্টক অ্যালার্ট (Low stock)", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("পণ্যের স্টক কমে গেলে জানাবে");
        ch.enableVibration(true);
        ch.setVibrationPattern(new long[]{0, 180, 90, 180});
        ch.enableLights(true);
        ch.setLightColor(Color.parseColor("#F59E0B"));
        nm.createNotificationChannel(ch);
    }

    static boolean allowed(Context c) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        return nm != null && (Build.VERSION.SDK_INT < Build.VERSION_CODES.N || nm.areNotificationsEnabled());
    }

    /** Show one alert; tapping it opens the app on {@code link} (e.g. /products/12). */
    static void show(Context c, int id, String title, String body, String link) {
        channel(c);
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) {
            return;
        }
        String base = prefs(c).getString("url", BuildConfig.APP_URL);
        Intent open = new Intent(c, MainActivity.class)
                .setAction(Intent.ACTION_VIEW)
                .setData(Uri.parse(base + (link == null || link.isEmpty() ? "" : "#" + link)))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent pi = PendingIntent.getActivity(c, id, open, flags);
        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(c, CHANNEL)
                : new Notification.Builder(c).setPriority(Notification.PRIORITY_HIGH).setDefaults(Notification.DEFAULT_ALL);
        b.setSmallIcon(R.drawable.ic_notify)
                .setColor(Color.parseColor("#0F766E"))
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setContentIntent(pi)
                .setAutoCancel(true)
                .setCategory(Notification.CATEGORY_REMINDER)
                .setWhen(System.currentTimeMillis())
                .setShowWhen(true);
        try {
            nm.notify(id, b.build());
        } catch (SecurityException e) {
            // Notifications not allowed (Android 13+ permission refused).
        }
    }
}
