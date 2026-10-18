package tech.goriberhisab.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.AlertDialog;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * window.GoriberHisabNative — what the web app can ask the phone to do.
 * The web app checks for it (assets/js/core/printer.js NativeTransport,
 * downloads, print views) and falls back to browser features without it.
 */
public class NativeBridge {

    private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static final int REQ_BT = 21;
    private static final int REQ_NOTIFY = 22;

    private final MainActivity activity;
    private final WebView web;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private BluetoothSocket socket;
    private String pendingPrint;
    private boolean pendingSelect;

    NativeBridge(MainActivity activity, WebView web) {
        this.activity = activity;
        this.web = web;
    }

    private SharedPreferences prefs() {
        return activity.getSharedPreferences("goriber_hisab", Context.MODE_PRIVATE);
    }

    /* ----------------------------------------------------------- App */

    @JavascriptInterface
    public boolean isApp() {
        return true;
    }

    @JavascriptInterface
    public String appVersion() {
        return BuildConfig.VERSION_NAME;
    }

    @JavascriptInterface
    public void reload() {
        activity.reloadApp();
    }

    @JavascriptInterface
    public void changeServer() {
        activity.askServer();
    }

    /* ------------------------------------------------------- Alerts */

    /** Show a notification in the phone's notification bar. */
    @JavascriptInterface
    public void notify(String title, String body, String link) {
        Alerts.show(activity, (int) (System.currentTimeMillis() & 0x7fffffff), title, body, link);
    }

    @JavascriptInterface
    public boolean notificationsAllowed() {
        return Alerts.allowed(activity)
                && (Build.VERSION.SDK_INT < 33 || activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED);
    }

    @JavascriptInterface
    public void askNotificationPermission() {
        Alerts.channel(activity);
        if (Build.VERSION.SDK_INT >= 33 && activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            activity.runOnUiThread(() -> activity.requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFY));
        }
    }

    /** The private link the background check uses; empty switches it off. */
    @JavascriptInterface
    public void setAlertFeed(String url) {
        Alerts.setFeed(activity, url);
        if (url != null && !url.isEmpty()) {
            askNotificationPermission();
        }
    }

    /** The web app already showed alerts up to this id. */
    @JavascriptInterface
    public void alertSeen(String id) {
        try {
            Alerts.seen(activity, Long.parseLong(id));
        } catch (NumberFormatException ignored) {
            // not a number
        }
    }

    /** A4/A5 invoices and statements through Android's print service (or "Save as PDF"). */
    @JavascriptInterface
    public void printPage() {
        activity.printPage();
    }

    /** Save a report / backup the web app generated (CSV, ZIP, JSON) to Downloads. */
    @JavascriptInterface
    public void saveFile(String name, String mime, String base64) {
        io.execute(() -> {
            String safe = name.replaceAll("[\\\\/:*?\"<>|]", "_");
            try {
                byte[] data = Base64.decode(base64, Base64.DEFAULT);
                String where;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.Downloads.DISPLAY_NAME, safe);
                    v.put(MediaStore.Downloads.MIME_TYPE, mime);
                    v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/GoriberHisab");
                    ContentResolver r = activity.getContentResolver();
                    Uri uri = r.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                    if (uri == null) {
                        throw new IOException("Could not create the file");
                    }
                    try (OutputStream out = r.openOutputStream(uri)) {
                        if (out == null) {
                            throw new IOException("Could not open the file");
                        }
                        out.write(data);
                    }
                    where = "Download/GoriberHisab/" + safe;
                } else {
                    File dir = activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                    File f = new File(dir, safe);
                    try (FileOutputStream out = new FileOutputStream(f)) {
                        out.write(data);
                    }
                    where = f.getAbsolutePath();
                }
                toast("Saved: " + where);
            } catch (Exception e) {
                toast("Could not save the file: " + e.getMessage());
            }
        });
    }

    /* ------------------------------------------------------- Printer */

    @JavascriptInterface
    public String printerName() {
        return prefs().getString("printer_name", "");
    }

    @JavascriptInterface
    public void selectPrinter() {
        if (!hasBluetoothPermission()) {
            pendingSelect = true;
            requestBluetoothPermission();
            return;
        }
        activity.runOnUiThread(this::showPrinterPicker);
    }

    /** Raw ESC/POS bytes (base64) to the chosen Bluetooth thermal printer. */
    @JavascriptInterface
    public void print(String base64) {
        if (!hasBluetoothPermission()) {
            pendingPrint = base64;
            requestBluetoothPermission();
            return;
        }
        if (prefs().getString("printer_address", "").isEmpty()) {
            pendingPrint = base64;
            activity.runOnUiThread(this::showPrinterPicker);
            return;
        }
        send(base64);
    }

    void onPermissionsResult(int requestCode, int[] results) {
        if (requestCode != REQ_BT) {
            return;
        }
        boolean ok = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
        if (!ok) {
            toast("Bluetooth permission is needed to print receipts.");
            pendingPrint = null;
            pendingSelect = false;
            return;
        }
        if (pendingSelect || prefs().getString("printer_address", "").isEmpty()) {
            pendingSelect = false;
            showPrinterPicker();
        } else if (pendingPrint != null) {
            String p = pendingPrint;
            pendingPrint = null;
            send(p);
        }
    }

    private boolean hasBluetoothPermission() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.S
                || activity.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
    }

    private void requestBluetoothPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            activity.runOnUiThread(() -> activity.requestPermissions(new String[]{Manifest.permission.BLUETOOTH_CONNECT}, REQ_BT));
        }
    }

    private BluetoothAdapter adapter() {
        BluetoothManager bm = (BluetoothManager) activity.getSystemService(Context.BLUETOOTH_SERVICE);
        return bm == null ? null : bm.getAdapter();
    }

    @SuppressLint("MissingPermission")
    private void showPrinterPicker() {
        BluetoothAdapter a = adapter();
        if (a == null) {
            toast("This phone has no Bluetooth.");
            return;
        }
        if (!a.isEnabled()) {
            toast("Turn on Bluetooth, pair the printer in phone settings, then try again.");
            return;
        }
        Set<BluetoothDevice> bonded = a.getBondedDevices();
        final List<BluetoothDevice> devices = new ArrayList<>(bonded);
        if (devices.isEmpty()) {
            toast("No paired printer. Pair your printer in Bluetooth settings first.");
            return;
        }
        String[] names = new String[devices.size()];
        for (int i = 0; i < devices.size(); i++) {
            String n = devices.get(i).getName();
            names[i] = (n == null ? "Printer" : n) + "\n" + devices.get(i).getAddress();
        }
        new AlertDialog.Builder(activity)
                .setTitle("Choose receipt printer")
                .setItems(names, (d, which) -> {
                    BluetoothDevice dev = devices.get(which);
                    String n = dev.getName() == null ? dev.getAddress() : dev.getName();
                    prefs().edit().putString("printer_address", dev.getAddress()).putString("printer_name", n).apply();
                    closeSocket();
                    toast("Printer: " + n);
                    if (pendingPrint != null) {
                        String p = pendingPrint;
                        pendingPrint = null;
                        send(p);
                    }
                })
                .setNegativeButton("Cancel", (d, w) -> pendingPrint = null)
                .show();
    }

    @SuppressLint("MissingPermission")
    private void send(String base64) {
        final byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
        io.execute(() -> {
            for (int attempt = 0; attempt < 2; attempt++) {
                try {
                    if (socket == null || !socket.isConnected()) {
                        BluetoothAdapter a = adapter();
                        if (a == null) {
                            throw new IOException("No Bluetooth");
                        }
                        if (!a.isEnabled()) {
                            throw new IOException("Bluetooth is off");
                        }
                        BluetoothDevice dev = a.getRemoteDevice(prefs().getString("printer_address", ""));
                        socket = connect(a, dev);
                    }
                    OutputStream out = socket.getOutputStream();
                    // Small chunks: cheap printers have tiny buffers.
                    for (int i = 0; i < bytes.length; i += 512) {
                        out.write(bytes, i, Math.min(512, bytes.length - i));
                        out.flush();
                        Thread.sleep(20);
                    }
                    return;
                } catch (Exception e) {
                    closeSocket();
                    if (attempt == 1) {
                        toast("প্রিন্টার পাওয়া যায়নি। প্রিন্টার চালু ও কাছে আছে কিনা দেখুন, ফোনের Bluetooth-এ পেয়ার করা আছে কিনা দেখুন।\nPrinter not reachable (" + e.getMessage() + ")");
                    }
                }
            }
        });
    }

    /**
     * Cheap thermal printers differ: try the standard serial channel, then the
     * "insecure" one, then channel 1 directly. Discovery is only stopped when
     * we may (Android 12+ needs a separate scan permission for that).
     */
    @SuppressLint("MissingPermission")
    private BluetoothSocket connect(BluetoothAdapter a, BluetoothDevice dev) throws IOException {
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S
                    || activity.checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED) {
                a.cancelDiscovery();
            }
        } catch (SecurityException ignored) {
            // Not allowed to touch discovery; connecting works without it.
        }
        IOException last = null;
        for (int way = 0; way < 3; way++) {
            BluetoothSocket s = null;
            try {
                if (way == 0) {
                    s = dev.createRfcommSocketToServiceRecord(SPP);
                } else if (way == 1) {
                    s = dev.createInsecureRfcommSocketToServiceRecord(SPP);
                } else {
                    s = (BluetoothSocket) dev.getClass().getMethod("createRfcommSocket", int.class).invoke(dev, 1);
                }
                if (s == null) {
                    continue;
                }
                s.connect();
                return s;
            } catch (IOException e) {
                last = e;
            } catch (SecurityException e) {
                last = new IOException("Bluetooth permission is missing. Allow \"Nearby devices\" for Goriber Hisab in phone settings.");
            } catch (Exception e) {
                last = new IOException(e.getMessage());
            }
            if (s != null) {
                try {
                    s.close();
                } catch (IOException ignored) {
                    // already closed
                }
            }
        }
        throw last != null ? last : new IOException("Could not connect");
    }

    private void closeSocket() {
        if (socket != null) {
            try {
                socket.close();
            } catch (IOException ignored) {
                // Already closed.
            }
            socket = null;
        }
    }

    void close() {
        closeSocket();
        io.shutdown();
    }

    private void toast(String msg) {
        activity.runOnUiThread(() -> Toast.makeText(activity, msg, Toast.LENGTH_LONG).show());
    }
}
