#!/usr/bin/env python3
"""
Build the offline hadith library from the open fawazahmed0/hadith-api data
(Arabic original + Bangla translation, with grades for the Sunan books).

Output
  assets/hadith/<book>-<chapter>.htxt   one file per chapter; one hadith per line:
                                        number \x1f grade \x1f arabic \x1f bangla
  src/hadith/books.json                 books → chapters (Bangla/English names, counts)
  src/hadith/files.ts                   static require() map so Metro bundles every chapter

Numbering is the internationally used one (Bukhari: Fath al-Bari; Muslim:
Fuad Abdul-Baqi; Sunan: as in the edition). Grades are Shaykh al-Albani's
where the edition has them.

Usage: python3 -I scripts/build-hadith.py <hadith-src-dir>
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from hadith_chapters_bn import BN  # noqa: E402

SRC = sys.argv[1]
ROOT = os.path.dirname(HERE)
OUT_ASSETS = os.path.join(ROOT, 'assets', 'hadith')
OUT_SRC = os.path.join(ROOT, 'src', 'hadith')

BOOKS = [
    ('bukhari', 'সহীহ বুখারী', 'Sahih al-Bukhari', 'صحيح البخاري', 'ইমাম বুখারী (রহ.)'),
    ('muslim', 'সহীহ মুসলিম', 'Sahih Muslim', 'صحيح مسلم', 'ইমাম মুসলিম (রহ.)'),
    ('abudawud', 'সুনান আবু দাউদ', 'Sunan Abi Dawud', 'سنن أبي داود', 'ইমাম আবু দাউদ (রহ.)'),
    ('tirmidhi', 'জামে তিরমিযী', "Jami' at-Tirmidhi", 'جامع الترمذي', 'ইমাম তিরমিযী (রহ.)'),
    ('nasai', 'সুনান নাসাঈ', "Sunan an-Nasa'i", 'سنن النسائي', 'ইমাম নাসাঈ (রহ.)'),
    ('ibnmajah', 'সুনান ইবনু মাজাহ', 'Sunan Ibn Majah', 'سنن ابن ماجه', 'ইমাম ইবনু মাজাহ (রহ.)'),
    ('malik', 'মুওয়াত্তা মালিক', "Muwatta' Malik", 'موطأ مالك', 'ইমাম মালিক (রহ.)'),
    ('nawawi', 'চল্লিশ হাদীস', 'Forty Hadith of an-Nawawi', 'الأربعون النووية', 'ইমাম নববী (রহ.)'),
]


def core(t):
    t = t.strip()
    t = re.sub(r'\s*\((Kitab|kitab)[^)]*\)', '', t)
    t = re.sub(r'^(The )?(Book|Chapters)( Of| of| on| On| Pertaining to| Concerning| Regarding)?\s+(the |The )?', '', t)
    t = re.sub(r'^Chapters\s+', '', t)
    return t.strip().rstrip(':').strip()


def grade(b, h):
    if b in ('bukhari', 'muslim'):
        return 'S'
    for g in h.get('grades', []):
        if g.get('name') != 'Al-Albani':
            continue
        x = g['grade'].lower()
        if 'mawdu' in x or 'fabricat' in x:
            return 'M'
        if any(k in x for k in ('daif', "da'if", 'weak', 'munkar', 'shadh')):
            return 'D'
        if x.startswith('hasan sahih'):
            return 'HS'
        if x.startswith('sahih'):
            return 'S'
        if x.startswith('hasan'):
            return 'H'
    return ''


def clean(s):
    s = s.replace('\x1f', ' ').replace('\r', ' ').replace('\n', ' ')
    s = re.sub(r'\s+', ' ', s).strip()
    return re.sub(r'^[।.,\s\-–]+', '', s)


def main():
    os.makedirs(OUT_ASSETS, exist_ok=True)
    os.makedirs(OUT_SRC, exist_ok=True)
    for f in os.listdir(OUT_ASSETS):
        if f.endswith('.htxt'):
            os.remove(os.path.join(OUT_ASSETS, f))
    books_out, files = [], []
    total = 0
    for b, bn, en, ar, author in BOOKS:
        ara = json.load(open(os.path.join(SRC, f'ara-{b}.json'), encoding='utf-8'))
        ben = json.load(open(os.path.join(SRC, f'ben-{b}.json'), encoding='utf-8'))
        bn_by_num = {h['hadithnumber']: h for h in ben['hadiths']}
        sections = ara['metadata']['sections']
        details = ara['metadata'].get('section_details', {})
        # chapter "0" without a real name holds narrations the edition did not file;
        # put them in the chapter whose number range contains them
        starts = sorted((v['hadithnumber_first'], k) for k, v in details.items() if k != '0' and v.get('hadithnumber_first'))
        orphan_bucket = '0' if sections.get('0', '').strip() else None
        chapters = {}
        dropped = 0
        for h in ara['hadiths']:
            t_ar = clean(h['text'])
            t_bn = clean(bn_by_num.get(h['hadithnumber'], {}).get('text', ''))
            if not t_ar and not t_bn:
                continue
            sec = str(h['reference']['book'])
            if b == 'muslim':
                if not h.get('arabicnumber'):
                    dropped += 1  # no standard (Abdul-Baqi) number — would be misleading
                    continue
                num = str(h['arabicnumber'])
            else:
                num = str(h['hadithnumber'])
            if sec == '0' and orphan_bucket is None:
                n = h['hadithnumber']
                cand = [k for first, k in starts if first <= n]
                if not cand:
                    dropped += 1
                    continue
                sec = cand[-1]
            chapters.setdefault(sec, []).append(f"{num}\x1f{grade(b, h)}\x1f{t_ar}\x1f{t_bn}")
        for rows in chapters.values():
            rows.sort(key=lambda r: float(r.split('\x1f', 1)[0]))
        if dropped:
            print(f'  {b}: left out {dropped} narrations without a standard number')
        secs = []
        for sec in sorted(chapters, key=lambda x: int(x)):
            rows = chapters[sec]
            name_en = sections.get(sec, '').strip() or ('Introduction' if sec == '0' else f'Chapter {sec}')
            c = core(name_en)
            name_bn = BN.get(c) or ('ভূমিকা' if sec == '0' else None)
            if name_bn is None:
                raise SystemExit(f'no Bangla name for {b} chapter {sec}: {c!r}')
            key = f'{b}-{sec}'
            with open(os.path.join(OUT_ASSETS, f'{key}.htxt'), 'w', encoding='utf-8') as f:
                f.write('\n'.join(rows))
            files.append(key)
            first, last = rows[0].split('\x1f', 1)[0], rows[-1].split('\x1f', 1)[0]
            secs.append({'n': int(sec), 'bn': name_bn, 'en': name_en, 'count': len(rows), 'first': first, 'last': last})
            total += len(rows)
        books_out.append({'id': b, 'bn': bn, 'en': en, 'ar': ar, 'author': author, 'count': sum(s['count'] for s in secs), 'chapters': secs})
        print(f'{b:10s} {sum(s["count"] for s in secs):6d} hadith  {len(secs):3d} chapters')
    json.dump(books_out, open(os.path.join(OUT_SRC, 'books.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    lines = [
        '// Generated by scripts/build-hadith.py — do not edit.',
        '/* eslint-disable @typescript-eslint/no-require-imports */',
        'export const CHAPTER_FILES: Record<string, number> = {',
    ]
    lines += [f"  '{k}': require('../../assets/hadith/{k}.htxt')," for k in files]
    lines += ['};', '']
    open(os.path.join(OUT_SRC, 'files.ts'), 'w', encoding='utf-8').write('\n'.join(lines))
    size = sum(os.path.getsize(os.path.join(OUT_ASSETS, f)) for f in os.listdir(OUT_ASSETS))
    print(f'{total} hadith in {len(files)} chapter files, {size / 1e6:.1f} MB')


main()
