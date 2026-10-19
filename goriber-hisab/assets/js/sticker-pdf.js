/*
 * Parcel stickers → PDF download (templates/label.php). Each sticker is
 * drawn with html2canvas (so Bangla text looks exactly as on screen) and
 * becomes one PDF page of the sticker's own size. Inside the Android app the
 * file goes to Downloads through the native bridge.
 */
/* global html2canvas */
(function () {
  'use strict';

  function bytes(str) {
    var out = new Uint8Array(str.length);
    for (var i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 255;
    return out;
  }

  function dataUrlBytes(url) {
    var bin = atob(url.slice(url.indexOf(',') + 1));
    return bytes(bin);
  }

  /** Minimal PDF: one JPEG per page, page size in mm. */
  function buildPdf(pages) {
    var parts = [];
    var offsets = [];
    var length = 0;
    function push(chunk) {
      var b = typeof chunk === 'string' ? bytes(chunk) : chunk;
      parts.push(b);
      length += b.length;
    }
    function obj(n, body, stream) {
      offsets[n] = length;
      push(n + ' 0 obj\n' + body);
      if (stream) { push('\nstream\n'); push(stream); push('\nendstream'); }
      push('\nendobj\n');
    }
    var pt = function (mm) { return (mm * 72 / 25.4).toFixed(2); };
    push('%PDF-1.4\n%âãÏÓ\n');
    var kids = [];
    pages.forEach(function (p, i) { kids.push((3 + i * 3) + ' 0 R'); });
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + pages.length + ' >>');
    pages.forEach(function (p, i) {
      var page = 3 + i * 3;
      var w = pt(p.wmm);
      var h = pt(p.hmm);
      var content = 'q ' + w + ' 0 0 ' + h + ' 0 0 cm /Im0 Do Q';
      obj(page, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + w + ' ' + h + '] /Resources << /XObject << /Im0 ' + (page + 2) + ' 0 R >> >> /Contents ' + (page + 1) + ' 0 R >>');
      obj(page + 1, '<< /Length ' + content.length + ' >>', bytes(content));
      obj(page + 2, '<< /Type /XObject /Subtype /Image /Width ' + p.w + ' /Height ' + p.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + p.jpeg.length + ' >>', p.jpeg);
    });
    var count = 3 + pages.length * 3;
    var xref = length;
    var table = 'xref\n0 ' + count + '\n0000000000 65535 f \n';
    for (var n = 1; n < count; n++) table += String(offsets[n]).padStart(10, '0') + ' 00000 n \n';
    push(table + 'trailer\n<< /Size ' + count + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
    var out = new Uint8Array(length);
    var at = 0;
    parts.forEach(function (b) { out.set(b, at); at += b.length; });
    return out;
  }

  function save(name, data) {
    var native = window.GoriberHisabNative;
    if (native && native.saveFile) {
      var bin = '';
      for (var i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode.apply(null, data.subarray(i, i + 0x8000));
      native.saveFile(name, 'application/pdf', btoa(bin));
      return;
    }
    var url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  window.ghDownloadPdf = function (name, btn) {
    var labels = Array.prototype.slice.call(document.querySelectorAll('.lbl'));
    if (!labels.length || typeof html2canvas !== 'function') return;
    var label = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '…'; }
    var pxPerMm = 96 / 25.4;
    var pages = [];
    var next = function (i) {
      if (i >= labels.length) {
        save(name, buildPdf(pages));
        if (btn) { btn.disabled = false; btn.textContent = label; }
        return;
      }
      var el = labels[i];
      var box = el.getBoundingClientRect();
      html2canvas(el, { scale: 3, backgroundColor: '#ffffff', useCORS: true, logging: false }).then(function (canvas) {
        pages.push({ w: canvas.width, h: canvas.height, wmm: box.width / pxPerMm, hmm: box.height / pxPerMm, jpeg: dataUrlBytes(canvas.toDataURL('image/jpeg', 0.92)) });
        next(i + 1);
      }, function () { next(i + 1); });
    };
    next(0);
  };
}());
