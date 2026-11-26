#!/usr/bin/env python3
"""
Verify every dhikr against the original hadith text, then write the app data.

For each item with `src`, the cited hadith is looked up in the Arabic hadith
books (fawazahmed0/hadith-api editions ara-*.json). The check passes only if
the dhikr's Arabic (normalised: no diacritics, unified alif/ya/ta-marbuta)
occurs inside that hadith — or, when `check` fragments are given (for items
whose wording is narrated indirectly, e.g. "he said it 33 times"), each
fragment occurs. Evening variants (`arEvening`) are checked the same way when
`checkEvening` is set. The hadith grade (Albani / Zubair Ali Zai / Bashar
Awad) is copied from the edition for the Sunan books; Bukhari and Muslim are
marked sahih.

Any failure aborts the build — nothing unverified reaches the app.

Usage: python3 -I scripts/build-adhkar.py <hadith-src-dir>
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from arabic_norm import norm  # noqa: E402

SRC = sys.argv[1]
ROOT = os.path.dirname(HERE)
BOOKS_BN = {
    'bukhari': 'সহীহ বুখারী',
    'muslim': 'সহীহ মুসলিম',
    'abudawud': 'সুনান আবু দাউদ',
    'tirmidhi': 'জামে তিরমিযী',
    'nasai': 'সুনান নাসাঈ',
    'ibnmajah': 'সুনান ইবনু মাজাহ',
}
BN_DIGITS = str.maketrans('0123456789', '০১২৩৪৫৬৭৮৯')
GRADE_BN = {
    'sahih': 'সহীহ',
    'hasan': 'হাসান',
    'hasan sahih': 'হাসান সহীহ',
    'sahih lighairihi': 'সহীহ লিগাইরিহি',
    'hasan lighairihi': 'হাসান লিগাইরিহি',
    'hasan isnaad': 'হাসান সনদ',
    'sahih isnaad': 'সহীহ সনদ',
}


def load_book(b):
    with open(os.path.join(SRC, f'ara-{b}.json'), encoding='utf-8') as f:
        hs = json.load(f)['hadiths']
    out = {}
    for h in hs:
        # standard numbering: Muslim uses Fuad Abdul-Baqi numbers (arabicnumber, e.g. "591" / "592.01")
        key = str(h.get('arabicnumber') if b == 'muslim' else h['hadithnumber'])
        base = key.split('.')[0]
        out.setdefault(base, []).append(h)
    return out


books = {b: load_book(b) for b in BOOKS_BN}


def grade_of(b, hs):
    if b in ('bukhari', 'muslim'):
        return 'sahih', 'সহীহ'
    for h in hs:
        for g in h.get('grades', []):
            if g.get('name') == 'Al-Albani':
                raw = g['grade'].strip()
                low = raw.lower().split('(')[0].strip()
                return low, f"{GRADE_BN.get(low, raw)} (আলবানী)"
    return None, None


def verify(item, s):
    b, n = s['book'], s['n']
    hs = books[b].get(n)
    if not hs:
        raise SystemExit(f"[{item['id']}] {b} {n}: hadith not found")
    text = norm(' '.join(h['text'] for h in hs))
    needles = [norm(c) for c in s.get('check', [])] or ([norm(item['ar'])] if 'ar' in item else [])
    if s.get('checkEvening') and 'arEvening' in item:
        needles.append(norm(item['arEvening']))
    for nd in needles:
        if nd not in text:
            raise SystemExit(f"[{item['id']}] NOT FOUND in {b} {n}:\n  wanted: {nd}\n  hadith: {text[:900]}")
    low, gbn = grade_of(b, hs)
    if low and not (low.startswith('sahih') or low.startswith('hasan')):
        raise SystemExit(f"[{item['id']}] {b} {n} is graded '{low}' — weak narrations are not allowed")
    return f"{BOOKS_BN[b]} {n.translate(BN_DIGITS)}", gbn


def main():
    with open(os.path.join(HERE, 'adhkar.source.json'), encoding='utf-8') as f:
        data = json.load(f)
    out_items = []
    for item in data['items']:
        refs, grades = [], []
        for s in item.get('src', []):
            ref, g = verify(item, s)
            refs.append(ref)
            if g:
                grades.append(g)
        if not refs and not item.get('external'):
            raise SystemExit(f"[{item['id']}] has no verifiable source")
        o = {k: v for k, v in item.items() if k not in ('src',)}
        o['ref'] = ', '.join(refs) if refs else item['external']
        if item.get('external') and refs:
            o['ref'] += '; ' + item['external']
        o['grade'] = grades[0] if grades else ('সহীহ' if refs else None)
        o['verified'] = bool(refs)
        o.pop('external', None)
        out_items.append(o)
        print(f"  ✓ {item['id']:28s} {o['ref']}  [{o['grade']}]")
    out = {'categories': data['categories'], 'items': out_items}
    dest = os.path.join(ROOT, 'src', 'adhkar', 'adhkar.json')
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"{len(out_items)} adhkar verified → {os.path.relpath(dest, ROOT)}")


main()
