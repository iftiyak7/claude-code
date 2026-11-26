# Hadith — sources

Built by `scripts/build-hadith.py` from the open **fawazahmed0/hadith-api**
dataset (Arabic original + Bangla translation): Sahih al-Bukhari, Sahih
Muslim, Sunan Abi Dawud, Jami' at-Tirmidhi, Sunan an-Nasa'i, Sunan Ibn Majah,
Muwatta' Malik and an-Nawawi's Forty. The dataset does not name the Bangla
translators.

* Numbering: Bukhari — Fath al-Bari; Muslim — Fuad Abdul-Baqi (narrations
  without an Abdul-Baqi number are left out); others as in the edition.
* Grades: Shaykh al-Albani where the edition provides them.
* Chapter names in Bangla: `scripts/hadith_chapters_bn.py`.

The adhkar in `src/adhkar/adhkar.json` are produced by `scripts/build-adhkar.py`,
which checks each Arabic text against the cited hadith in these books and
refuses weak (da'if) narrations. The 99 Names (`src/names/names.json`) are read
from the text of Jami' at-Tirmidhi 3507 by `scripts/build-names.py`.
