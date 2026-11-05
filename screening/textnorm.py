"""Text helpers shared by validation and evaluation (English + Arabic)."""

import re

ARABIC_DIACRITICS = re.compile(r"[ً-ٰٟـ]")  # harakat, superscript alef, tatweel
EN_WORD = re.compile(r"^[a-z]{2,16}$")
AR_WORD = re.compile(r"^[ء-يً-ٰٟٱ-ۓ]{2,16}$")
EASTERN_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")
WESTERN_TO_EASTERN = str.maketrans("0123456789", "٠١٢٣٤٥٦٧٨٩")


def norm_word(word: str, lang: str) -> str:
    """Spelling-level normalisation: lower case (en); no diacritics, plain alef (ar)."""
    w = word.strip()
    if lang == "ar":
        w = ARABIC_DIACRITICS.sub("", w)
        w = w.replace("آ", "ا").replace("أ", "ا").replace("إ", "ا").replace("ٱ", "ا")
        return w
    return w.lower()


def is_word(word: str, lang: str) -> bool:
    """One word of the language's own letters (also keeps quotes and markup out of the page)."""
    return bool((AR_WORD if lang == "ar" else EN_WORD).match(word.strip()))


def to_western_digits(text: str) -> str:
    return text.translate(EASTERN_DIGITS)


def localise_digits(text: str, lang: str) -> str:
    return text.translate(WESTERN_TO_EASTERN) if lang == "ar" else text


def norm_text(text: str) -> str:
    """For repetition checks: case/space/diacritic-insensitive."""
    t = ARABIC_DIACRITICS.sub("", to_western_digits(text)).lower()
    return re.sub(r"\W+", " ", t).strip()


def edit_ops(target: str, answer: str) -> dict:
    """Damerau-Levenshtein alignment counts between the target and the typed answer."""
    a, b = target, answer
    n, m = len(a), len(b)
    d = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        d[i][0] = i
    for j in range(m + 1):
        d[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
            if i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]:
                d[i][j] = min(d[i][j], d[i - 2][j - 2] + 1)
    ops = {"omissions": 0, "insertions": 0, "substitutions": 0, "transpositions": 0}
    i, j = n, m
    while i > 0 or j > 0:
        if i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1] and d[i][j] == d[i - 2][j - 2] + 1:
            ops["transpositions"] += 1
            i, j = i - 2, j - 2
        elif i > 0 and j > 0 and d[i][j] == d[i - 1][j - 1] + (a[i - 1] != b[j - 1]):
            ops["substitutions"] += a[i - 1] != b[j - 1]
            i, j = i - 1, j - 1
        elif i > 0 and d[i][j] == d[i - 1][j] + 1:
            ops["omissions"] += 1
            i -= 1
        else:
            ops["insertions"] += 1
            j -= 1
    ops["distance"] = d[n][m]
    return ops
