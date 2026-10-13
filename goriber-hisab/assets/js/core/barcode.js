/**
 * Code 128 (subset B) barcode as an SVG element — same encoding as the
 * PHP Support\Barcode used on printed invoices.
 */
const P = ['212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111', '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412', '211214', '211232', '2331112'];
const NS = 'http://www.w3.org/2000/svg';

export function code128(text) {
  const clean = String(text).replace(/[^\x20-\x7e]/g, '');
  const codes = [104];
  let sum = 104;
  [...clean].forEach((ch, i) => { const c = ch.charCodeAt(0) - 32; codes.push(c); sum += c * (i + 1); });
  codes.push(sum % 103, 106);
  return codes;
}

export function barcodeSvg(text, height = 50) {
  const svg = document.createElementNS(NS, 'svg');
  const codes = code128(text);
  let x = 10;
  const g = document.createElementNS(NS, 'g');
  for (const code of codes) {
    [...P[code]].forEach((w, j) => {
      if (j % 2 === 0) {
        const r = document.createElementNS(NS, 'rect');
        r.setAttribute('x', x); r.setAttribute('y', 0); r.setAttribute('width', w); r.setAttribute('height', height);
        g.append(r);
      }
      x += Number(w);
    });
  }
  svg.setAttribute('viewBox', `0 0 ${x + 10} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', clean(text));
  svg.append(g);
  return svg;
}

const clean = (s) => String(s).replace(/[^\x20-\x7e]/g, '');
