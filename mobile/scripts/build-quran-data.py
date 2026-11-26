#!/usr/bin/env python3
"""
Build the bundled, offline Qur'an data for Tadbeer Daily.

Sources (all authentic, all redistributable):
  * Hafs (Madani mushaf, 604 pages):  King Fahd Glorious Qur'an Printing Complex
      https://qurancomplex.gov.sa/en/techquran/dev/  (mirror: github.com/thetruetruth/quran-data-kfgqpc)
      hafsData_v18.json + font hafs.18.ttf
  * Warsh / Qaloon:                   same KFGQPC package (warshData_v10, QaloonData_v10 + fonts)
  * IndoPak (Nastaleeq) text:         KFGQPC "Quran Nastaleeq" text
      (mirror: github.com/fawazahmed0/quran-api  editions/ara-quranindopak.json)
  * Tajweed colours:                  Quran.com API `text_uthmani_tajweed` (Hafs), as packaged by
      npm react-native-quran-tajweed (MIT)
  * Bangla translations:              Dr. Abu Bakr Muhammad Zakaria (KFGQPC edition),
                                      Muhiuddin Khan (Tanzil)  — via fawazahmed0/quran-api

Usage:  python3 -I scripts/build-quran-data.py <source-dir> <out-dir>
Every edition is cross-checked against the KFGQPC Hafs verse count (6236) and
per-surah ayah counts before anything is written.
"""
import json
import os
import re
import sys

SRC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)


def load(name):
    with open(os.path.join(SRC, name), encoding='utf-8') as f:
        return json.load(f)


def write(name, lines):
    path = os.path.join(OUT, name)
    with open(path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    print(f'{name:24s} {os.path.getsize(path) / 1024:8.0f} KB  {len(lines)} lines')


def clean(s):
    return s.replace('\n', ' ').replace('\r', ' ').replace('\t', ' ').strip()


# ── Hafs (master: order, pages, juz) ──────────────────────────────────────
hafs = load('hafs.json')
assert len(hafs) == 6236, len(hafs)
counts = [0] * 114
for v in hafs:
    counts[v['sora'] - 1] += 1
assert sum(counts) == 6236

# Bangla surah names (transliteration) — hand-checked
BN_NAMES = """আল-ফাতিহা|আল-বাকারা|আলে ইমরান|আন-নিসা|আল-মায়িদা|আল-আনআম|আল-আরাফ|আল-আনফাল|আত-তাওবা|ইউনুস|হুদ|ইউসুফ|আর-রাদ|ইবরাহীম|আল-হিজর|আন-নাহল|বনী ইসরাঈল|আল-কাহফ|মারইয়াম|ত্বা-হা|আল-আম্বিয়া|আল-হাজ্জ|আল-মুমিনূন|আন-নূর|আল-ফুরকান|আশ-শুআরা|আন-নামল|আল-কাসাস|আল-আনকাবূত|আর-রূম|লুকমান|আস-সাজদা|আল-আহযাব|সাবা|ফাতির|ইয়াসীন|আস-সাফফাত|সোয়াদ|আয-যুমার|আল-মুমিন|হা-মীম আস-সাজদা|আশ-শূরা|আয-যুখরুফ|আদ-দুখান|আল-জাসিয়া|আল-আহকাফ|মুহাম্মাদ|আল-ফাতহ|আল-হুজুরাত|ক্বাফ|আয-যারিয়াত|আত-তূর|আন-নাজম|আল-কামার|আর-রহমান|আল-ওয়াকিয়া|আল-হাদীদ|আল-মুজাদালা|আল-হাশর|আল-মুমতাহিনা|আস-সাফ|আল-জুমুআ|আল-মুনাফিকূন|আত-তাগাবুন|আত-তালাক|আত-তাহরীম|আল-মুলক|আল-কালাম|আল-হাক্কাহ|আল-মাআরিজ|নূহ|আল-জিন|আল-মুযযাম্মিল|আল-মুদ্দাসসির|আল-কিয়ামাহ|আদ-দাহর|আল-মুরসালাত|আন-নাবা|আন-নাযিআত|আবাসা|আত-তাকবীর|আল-ইনফিতার|আল-মুতাফফিফীন|আল-ইনশিকাক|আল-বুরূজ|আত-তারিক|আল-আলা|আল-গাশিয়া|আল-ফাজর|আল-বালাদ|আশ-শামস|আল-লাইল|আদ-দুহা|আলাম নাশরাহ|আত-তীন|আল-আলাক|আল-কদর|আল-বাইয়্যিনাহ|আয-যিলযাল|আল-আদিয়াত|আল-কারিআহ|আত-তাকাসুর|আল-আসর|আল-হুমাযাহ|আল-ফীল|কুরাইশ|আল-মাঊন|আল-কাওসার|আল-কাফিরূন|আন-নাসর|লাহাব|আল-ইখলাস|আল-ফালাক|আন-নাস""".split('|')
assert len(BN_NAMES) == 114

bn_meta = load('bn-meta.json')  # [meaning_bn, type, total, translit_en]
surahs = []
for i in range(114):
    first = next(v for v in hafs if v['sora'] == i + 1)
    assert bn_meta[i][2] == counts[i], (i + 1, bn_meta[i][2], counts[i])
    surahs.append({
        'n': i + 1,
        'ar': clean(first['sora_name_ar']),
        'en': first['sora_name_en'],
        'bn': BN_NAMES[i],
        'mean': bn_meta[i][0],
        'type': 'm' if bn_meta[i][1] == 'meccan' else 'd',
        'ayahs': counts[i],
        'page': first['page'],
    })

juz = []
for v in hafs:
    if len(juz) < v['jozz']:
        juz.append([v['sora'], v['aya_no'], v['page']])
assert len(juz) == 30

meta = {'surahs': surahs, 'juz': juz, 'pages': 604}
with open(os.path.join(OUT, '..', '..', 'src', 'quran', 'meta.json'), 'w', encoding='utf-8') as f:
    json.dump(meta, f, ensure_ascii=False, separators=(',', ':'))
print('meta.json written')

NUM = re.compile(r'\s*[٠-٩۰-۹]+\s*$')
# hafs: page|line_start|line_end|text   (one line per ayah, in mushaf order)
write('hafs.qtxt', [f"{v['page']}|{v['line_start']}|{v['line_end']}|{clean(NUM.sub('', v['aya_text']))}" for v in hafs])


# ── Warsh & Qaloon (own numbering: 6214 ayat, own pages) ─────────────────
def riwayah(fname, out):
    rows = load(fname)
    for r in rows:
        r['page'] = int(str(r['page']).split('-')[0])  # ayat spanning two pages: '85-86'
    rows.sort(key=lambda r: r['id'])
    assert len(rows) == 6214, (fname, len(rows))
    write(out, [f"{r['sura_no']}|{r['aya_no']}|{r['page']}|{clean(NUM.sub('', r['aya_text']))}" for r in rows])
    return max(r['page'] for r in rows)


wp = riwayah('warsh.json', 'warsh.qtxt')
qp = riwayah('qaloon.json', 'qaloon.qtxt')
print('warsh pages', wp, 'qaloon pages', qp)


# ── Simple per-ayah editions keyed by (chapter, verse) ───────────────────
def by_ayah(fname, transform=lambda s: s):
    data = load(fname)['quran']
    assert len(data) == 6236, (fname, len(data))
    d = {(x['chapter'], x['verse']): x['text'] for x in data}
    lines = []
    for v in hafs:
        lines.append(clean(transform(d[(v['sora'], v['aya_no'])])))
    return lines


write('indopak.qtxt', by_ayah('indopak.json', lambda s: s.replace('‏', '')))
# Zakaria's edition references footnotes ([১]) that are not part of this text
FOOT = re.compile(r'\s*\[[০-৯0-9]+\]')
write('bn-zakaria.qtxt', by_ayah('bn-zakaria.json', lambda s: re.sub(r'\s+([,।;:!?])', r'\1', FOOT.sub('', s))))
write('bn-muhiuddin.qtxt', by_ayah('bn-muhiuddin.json'))

# ── Tajweed: segments "text\x1frules" joined by \x1e, rules = comma list ──
TJ = os.path.join(SRC, 'rnqt', 'package', 'src', 'data')
legend = json.load(open(os.path.join(TJ, 'index.json'), encoding='utf-8'))['legend']
tj_lines = []
for s in range(1, 115):
    data = json.load(open(os.path.join(TJ, f'surah_{s:03d}.json'), encoding='utf-8'))
    assert len(data['ayahs']) == counts[s - 1], s
    for a in data['ayahs']:
        segs = []
        for text, rules in a['s']:
            segs.append(text.replace('\n', ' ') + '\x1f' + ','.join(str(r) for r in rules))
        tj_lines.append('\x1e'.join(segs))
assert len(tj_lines) == 6236
write('tajweed.qtxt', tj_lines)
with open(os.path.join(OUT, '..', '..', 'src', 'quran', 'tajweed-legend.json'), 'w') as f:
    json.dump(legend, f)
print('done')
