"""Arabic normalisation shared by the content-verification scripts."""
import re

_TASHKEEL = re.compile('[ؐ-ًؚ-ٰٟۖ-ۭ࣓-ࣿـ]')
_MAP = str.maketrans({'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ى': 'ي', 'ة': 'ه', 'ؤ': 'و', 'ئ': 'ي', 'ۡ': '', 'ۥ': '', 'ۦ': ''})
_NONLETTER = re.compile('[^ء-ي ]+')


def norm(s: str) -> str:
    s = _TASHKEEL.sub('', s).translate(_MAP)
    s = _NONLETTER.sub(' ', s)
    s = s.replace('الله', 'الله')
    return re.sub(r'\s+', ' ', s).strip()
