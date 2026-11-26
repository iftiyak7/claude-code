#!/usr/bin/env python3
"""
Build the 99 Names of Allah from the Arabic of Jami' at-Tirmidhi 3507 (the
list is read from the hadith text itself, not typed by hand) and pair each
with its Bangla pronunciation and meaning. The normalised Arabic of every
entry below must match the name at that position in the hadith, so a
misaligned or misspelled entry stops the build.

Usage: python3 -I scripts/build-names.py <hadith-src-dir>
"""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from arabic_norm import norm  # noqa: E402

# (normalised arabic, Bangla pronunciation, Bangla meaning, English meaning)
NAMES = [
 ("الله","আল্লাহ","আল্লাহ — একমাত্র সত্য ইলাহের নিজস্ব নাম","Allah — the proper name of God"),
 ("الرحمن","আর-রাহমান","পরম দয়াময়","The Most Gracious"),
 ("الرحيم","আর-রাহীম","পরম দয়ালু","The Most Merciful"),
 ("الملك","আল-মালিক","প্রকৃত অধিপতি, সম্রাট","The King"),
 ("القدوس","আল-কুদ্দূস","অতি পবিত্র, সকল ত্রুটিমুক্ত","The Most Holy"),
 ("السلام","আস-সালাম","শান্তিদাতা, সকল দোষ থেকে মুক্ত","The Source of Peace"),
 ("المومن","আল-মু'মিন","নিরাপত্তাদাতা, সত্য প্রতিপাদনকারী","The Giver of Security"),
 ("المهيمن","আল-মুহাইমিন","রক্ষণাবেক্ষণকারী, তত্ত্বাবধায়ক","The Guardian"),
 ("العزيز","আল-আযীয","মহা পরাক্রমশালী","The Almighty"),
 ("الجبار","আল-জাব্বার","প্রবল, ক্ষতিপূরণকারী","The Compeller"),
 ("المتكبر","আল-মুতাকাব্বির","সর্বশ্রেষ্ঠ মহিমার অধিকারী","The Supreme in Greatness"),
 ("الخالق","আল-খালিক","সৃষ্টিকর্তা","The Creator"),
 ("البارى","আল-বারী","উদ্ভাবনকারী","The Originator"),
 ("المصور","আল-মুসাওয়ির","আকৃতিদানকারী","The Fashioner"),
 ("الغفار","আল-গাফফার","বারবার ক্ষমাকারী","The Ever-Forgiving"),
 ("القهار","আল-কাহহার","সর্বজয়ী, সবকিছুর উপর প্রবল","The Subduer"),
 ("الوهاب","আল-ওয়াহহাব","মহাদাতা","The Bestower"),
 ("الرزاق","আর-রাযযাক","রিযিকদাতা","The Provider"),
 ("الفتاح","আল-ফাত্তাহ","উন্মুক্তকারী, মীমাংসাকারী","The Opener, the Judge"),
 ("العليم","আল-‘আলীম","সর্বজ্ঞ","The All-Knowing"),
 ("القابض","আল-কাবিদ","সংকোচনকারী","The Withholder"),
 ("الباسط","আল-বাসিত","প্রসারণকারী","The Extender"),
 ("الخافض","আল-খাফিদ","অবনতকারী","The Abaser"),
 ("الرافع","আর-রাফি‘","উন্নতকারী","The Exalter"),
 ("المعز","আল-মু‘ইয","সম্মানদাতা","The Giver of Honour"),
 ("المذل","আল-মুযিল্ল","অপমানদাতা","The Giver of Dishonour"),
 ("السميع","আস-সামী‘","সর্বশ্রোতা","The All-Hearing"),
 ("البصير","আল-বাসীর","সর্বদ্রষ্টা","The All-Seeing"),
 ("الحكم","আল-হাকাম","মীমাংসাকারী বিচারক","The Judge"),
 ("العدل","আল-‘আদল","ন্যায়পরায়ণ","The Just"),
 ("اللطيف","আল-লাতীফ","সূক্ষ্মদর্শী, অতি কোমল","The Subtle, the Gentle"),
 ("الخبير","আল-খাবীর","সব বিষয়ে অবগত","The All-Aware"),
 ("الحليم","আল-হালীম","পরম সহনশীল","The Forbearing"),
 ("العظيم","আল-‘আযীম","মহান","The Magnificent"),
 ("الغفور","আল-গাফূর","পরম ক্ষমাশীল","The All-Forgiving"),
 ("الشكور","আশ-শাকূর","গুণগ্রাহী, অল্প আমলেও বেশি প্রতিদানদাতা","The Appreciative"),
 ("العلي","আল-‘আলিইয়্যু","সর্বোচ্চ","The Most High"),
 ("الكبير","আল-কাবীর","সর্বশ্রেষ্ঠ, মহান","The Most Great"),
 ("الحفيظ","আল-হাফীয","সংরক্ষণকারী","The Preserver"),
 ("المقيت","আল-মুকীত","খাদ্যদাতা, সবকিছুর রক্ষক","The Sustainer"),
 ("الحسيب","আল-হাসীব","হিসাব গ্রহণকারী, যথেষ্ট","The Reckoner"),
 ("الجليل","আল-জালীল","মহিমান্বিত","The Majestic"),
 ("الكريم","আল-কারীম","মহানুভব, অতি দানশীল","The Generous"),
 ("الرقيب","আর-রাকীব","সদা পর্যবেক্ষক","The Watchful"),
 ("المجيب","আল-মুজীব","ডাকে সাড়াদানকারী","The Responder"),
 ("الواسع","আল-ওয়াসি‘","সর্বব্যাপী, প্রাচুর্যময়","The All-Encompassing"),
 ("الحكيم","আল-হাকীম","প্রজ্ঞাময়","The All-Wise"),
 ("الودود","আল-ওয়াদূদ","প্রেমময়","The Loving"),
 ("المجيد","আল-মাজীদ","গৌরবময়","The Glorious"),
 ("الباعث","আল-বা‘ইস","পুনরুত্থানকারী","The Resurrector"),
 ("الشهيد","আশ-শাহীদ","সর্বসাক্ষী","The Witness"),
 ("الحق","আল-হাক্ক","পরম সত্য","The Truth"),
 ("الوكيل","আল-ওয়াকীল","কর্মবিধায়ক, ভরসাস্থল","The Trustee"),
 ("القوي","আল-কাউইয়্যু","মহা শক্তিমান","The All-Strong"),
 ("المتين","আল-মাতীন","দৃঢ়, অটল শক্তির অধিকারী","The Firm"),
 ("الولي","আল-ওয়ালিইয়্যু","অভিভাবক, বন্ধু","The Protecting Friend"),
 ("الحميد","আল-হামীদ","প্রশংসিত","The Praiseworthy"),
 ("المحصي","আল-মুহসী","সবকিছুর হিসাব রক্ষক","The Accounter"),
 ("المبدي","আল-মুবদি","প্রথমবার সৃষ্টিকারী","The Originator of all"),
 ("المعيد","আল-মু‘ঈদ","পুনরায় সৃষ্টিকারী","The Restorer"),
 ("المحيي","আল-মুহয়ী","জীবনদাতা","The Giver of Life"),
 ("المميت","আল-মুমীত","মৃত্যুদাতা","The Bringer of Death"),
 ("الحي","আল-হাইয়্যু","চিরঞ্জীব","The Ever-Living"),
 ("القيوم","আল-কাইয়্যূম","চিরস্থায়ী, সবকিছুর ধারক","The Self-Subsisting"),
 ("الواجد","আল-ওয়াজিদ","অভাবমুক্ত, সবকিছু প্রাপ্ত","The Finder"),
 ("الماجد","আল-মাজিদ","মর্যাদাবান","The Noble"),
 ("الواحد","আল-ওয়াহিদ","এক ও অদ্বিতীয়","The One"),
 ("الصمد","আস-সামাদ","অমুখাপেক্ষী, সবাই যাঁর মুখাপেক্ষী","The Eternal Refuge"),
 ("القادر","আল-কাদির","সর্বশক্তিমান","The All-Capable"),
 ("المقتدر","আল-মুকতাদির","পূর্ণ ক্ষমতার অধিকারী","The All-Powerful"),
 ("المقدم","আল-মুকাদ্দিম","অগ্রবর্তীকারী","The Expediter"),
 ("الموخر","আল-মুআখখির","পশ্চাদবর্তীকারী","The Delayer"),
 ("الاول","আল-আওয়াল","সর্বপ্রথম, যাঁর শুরু নেই","The First"),
 ("الاخر","আল-আখির","সর্বশেষ, যাঁর শেষ নেই","The Last"),
 ("الظاهر","আয-যাহির","প্রকাশ্য, সবার উপরে","The Manifest"),
 ("الباطن","আল-বাতিন","গোপন, সবকিছুর নিকটে","The Hidden"),
 ("الوالي","আল-ওয়ালী","কর্তৃত্বের অধিকারী","The Governor"),
 ("المتعالي","আল-মুতা‘আলী","সর্বোচ্চ মর্যাদাবান","The Most Exalted"),
 ("البر","আল-বার্র","পরম কল্যাণকারী","The Source of Goodness"),
 ("التواب","আত-তাওয়াব","তওবা কবুলকারী","The Accepter of Repentance"),
 ("المنتقم","আল-মুনতাকিম","প্রতিশোধ গ্রহণকারী (অপরাধীদের থেকে)","The Avenger"),
 ("العفو","আল-‘আফুউ","ক্ষমাকারী, গুনাহ মুছে দেন","The Pardoner"),
 ("الرءوف","আর-রাঊফ","পরম স্নেহশীল","The Most Kind"),
 ("مالك الملك","মালিকুল মুলক","সমগ্র রাজত্বের মালিক","Owner of All Sovereignty"),
 ("ذو الجلال والاكرام","যুল-জালালি ওয়াল-ইকরাম","মহিমা ও সম্মানের অধিকারী","Lord of Majesty and Honour"),
 ("المقسط","আল-মুকসিত","ন্যায়বিচারক","The Equitable"),
 ("الجامع","আল-জামি‘","একত্রকারী","The Gatherer"),
 ("الغني","আল-গানিইয়্যু","অভাবমুক্ত, ধনী","The Self-Sufficient"),
 ("المغني","আল-মুগনী","অভাবমোচনকারী","The Enricher"),
 ("المانع","আল-মানি‘","প্রতিরোধকারী","The Preventer"),
 ("الضار","আদ-দার্র","(তাঁর হুকুমেই) ক্ষতি পৌঁছে","The Distresser"),
 ("النافع","আন-নাফি‘","কল্যাণকারী","The Benefactor"),
 ("النور","আন-নূর","আলো","The Light"),
 ("الهادي","আল-হাদী","পথপ্রদর্শক","The Guide"),
 ("البديع","আল-বাদী‘","অভিনব স্রষ্টা","The Incomparable Originator"),
 ("الباقي","আল-বাকী","চিরস্থায়ী","The Everlasting"),
 ("الوارث","আল-ওয়ারিস","সবকিছুর উত্তরাধিকারী","The Inheritor"),
 ("الرشيد","আর-রাশীদ","সঠিক পথের দিশারী","The Guide to the Right Path"),
 ("الصبور","আস-সাবূর","পরম ধৈর্যশীল","The Patient"),
]

def main():
    src = sys.argv[1]
    hs = json.load(open(os.path.join(src, 'ara-tirmidhi.json'), encoding='utf-8'))['hadiths']
    h = next(x for x in hs if x['hadithnumber'] == 3507)
    text = h['text']
    allw = text.split()
    # the list starts "هو الله الذي لا إله إلا هو الرحمن ..." — Allah is the first name
    a = next(i for i, w in enumerate(allw) if norm(w) == 'الرحمن')
    allah = next(i for i in range(a - 1, -1, -1) if norm(allw[i]) == 'الله')
    b = next(i for i, w in enumerate(allw) if norm(w) == 'الصبور')
    words = [allw[allah]] + allw[a:b + 1]
    # join the two multi-word names
    names, i = [], 0
    while i < len(words):
        w = words[i]
        if norm(w) == 'مالك':
            names.append(' '.join(words[i:i + 2])); i += 2
        elif norm(w) == 'ذو':
            names.append(' '.join(words[i:i + 3])); i += 3
        else:
            names.append(w); i += 1
    assert len(names) == 99, len(names)
    assert len(NAMES) == 99, len(NAMES)
    out = []
    for k, (ar, (key, pron, bn, en)) in enumerate(zip(names, NAMES), 1):
        if norm(ar) != norm(key):
            raise SystemExit(f'#{k}: hadith has {norm(ar)!r} but entry is {norm(key)!r}')
        out.append({'n': k, 'ar': ar, 'pron': pron, 'bn': bn, 'en': en})
    dest = os.path.join(os.path.dirname(HERE), 'src', 'names', 'names.json')
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    json.dump(out, open(dest, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f'99 names verified against Tirmidhi 3507 → {dest}')

main()
