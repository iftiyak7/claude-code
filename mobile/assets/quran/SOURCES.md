# Qur'an data — sources

All Qur'an text in this folder is bundled in the app (no downloads) and built by
`scripts/build-quran-data.py`, which checks every edition against the KFGQPC
Hafs count (6236 ayat, per-surah counts) before writing anything.

| File | Content | Source |
|---|---|---|
| hafs.qtxt | Madani mushaf, Hafs, 604 pages with line numbers | King Fahd Glorious Qur'an Printing Complex (KFGQPC), hafsData v18 |
| warsh.qtxt / qaloon.qtxt | Warsh & Qaloon riwayat with their own pages | KFGQPC warshData / QaloonData v10 |
| indopak.qtxt | Nastaleeq (IndoPak) script | KFGQPC Nastaleeq text |
| tajweed.qtxt | Colour tajweed annotations (Hafs) | Quran.com `text_uthmani_tajweed` |
| bn-zakaria.qtxt | Bangla — Dr. Abu Bakr Muhammad Zakaria | KFGQPC edition |
| bn-muhiuddin.qtxt | Bangla — Muhiuddin Khan | Tanzil translations |

Fonts (`assets/fonts`): KFGQPC Hafs / Warsh / Qaloon fonts (KFGQPC),
Noorehira IndoPak, Scheherazade New (SIL OFL, licence alongside).
The Qur'an text must be reproduced verbatim — do not edit these files by hand.
