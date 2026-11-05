"""Starter items, taken unchanged from lexpace_games_timed_en.html / _ar.html.

Used (1) as the fallback when the LLM is off, fails or returns an invalid item, and
(2) as format examples in the generation prompts. Difficulty: 1 easy, 2 medium, 3 hard.
"""

BANK = {
    "en": {
        "lexical": [
            {"stimulus": "marn", "is_real_word": False, "difficulty": 1},
            {"stimulus": "garden", "is_real_word": True, "difficulty": 1},
            {"stimulus": "brone", "is_real_word": False, "difficulty": 2},
            {"stimulus": "cautious", "is_real_word": True, "difficulty": 2},
            {"stimulus": "intermittent", "is_real_word": True, "difficulty": 3},
            {"stimulus": "transplication", "is_real_word": False, "difficulty": 3},
        ],
        "sound": [
            {"word": "mip", "remove": "m", "position": "initial", "options": ["ip", "mi", "pi"], "correct_index": 0,
             "distractor_types": ["correct", "wrong_sound_removed", "other"], "difficulty": 1},
            {"word": "sog", "remove": "g", "position": "final", "options": ["og", "so", "sg"], "correct_index": 1,
             "distractor_types": ["wrong_sound_removed", "correct", "wrong_sound_removed"], "difficulty": 2},
            {"word": "plim", "remove": "l", "position": "medial", "options": ["pim", "lim", "plm"], "correct_index": 0,
             "distractor_types": ["correct", "wrong_sound_removed", "wrong_sound_removed"], "difficulty": 3},
        ],
        "spelling": [
            {"word": "island", "spoken": "island", "difficulty": 1},
            {"word": "receipt", "spoken": "receipt", "difficulty": 2},
            {"word": "rhythm", "spoken": "rhythm", "difficulty": 3},
        ],
        "writing": [
            {"prompt": "Your university is planning a new student study space. Explain what it should include and why (3–5 sentences).",
             "difficulty": 2},
        ],
        "comprehension": [
            {"passage": "A university library introduced a quiet study area after students reported difficulty concentrating in crowded spaces. The new area included individual desks, adjustable lighting, and signs asking visitors to silence their devices. During the first month, staff noticed that the space was popular in the afternoons. However, some students preferred group study rooms because they needed to discuss assignments. The library decided to keep both types of spaces available and gather feedback before making further changes.",
             "questions": [
                 {"question": "Why was the quiet area introduced?", "options": ["To replace group rooms", "To help students concentrate", "To store more books"], "correct_index": 1},
                 {"question": "When was the area especially popular?", "options": ["In the afternoons", "Late at night", "Early mornings"], "correct_index": 0},
                 {"question": "What did the library decide?", "options": ["Close the quiet area", "Ban group study", "Keep both types of spaces"], "correct_index": 2},
                 {"question": "Why did some students prefer group rooms?", "options": ["They needed to discuss assignments", "They wanted brighter lights", "They disliked the library"], "correct_index": 0},
             ],
             "difficulty": 2},
        ],
        "reasoning": [
            {"question": "A notebook costs 7 AED. How much do 3 notebooks cost?", "expression": "7*3", "answer_kind": "number",
             "options": ["10 AED", "21 AED", "24 AED"], "correct_index": 1, "difficulty": 1},
            {"question": "A class has 24 students. They form equal groups of 6. How many groups?", "expression": "24/6", "answer_kind": "number",
             "options": ["4", "6", "18"], "correct_index": 0, "difficulty": 2},
            {"question": "A bus leaves at 9:20 and arrives 45 minutes later. When does it arrive?", "expression": "9*60+20+45", "answer_kind": "time",
             "options": ["9:55", "10:05", "10:15"], "correct_index": 1, "difficulty": 3},
        ],
    },
    "ar": {
        "lexical": [
            {"stimulus": "قَلَم", "is_real_word": True, "difficulty": 1},
            {"stimulus": "مَرْتَب", "is_real_word": True, "difficulty": 1},
            {"stimulus": "شَمْرَف", "is_real_word": False, "difficulty": 2},
            {"stimulus": "مُسْتَشْفَى", "is_real_word": True, "difficulty": 2},
            {"stimulus": "اِسْتِقْلال", "is_real_word": True, "difficulty": 3},
            {"stimulus": "مُسْتَفْرِقَة", "is_real_word": False, "difficulty": 3},
        ],
        "sound": [
            {"word": "بَاب", "remove": "ب", "position": "initial", "options": ["آب", "با", "باب"], "correct_index": 0,
             "distractor_types": ["correct", "wrong_sound_removed", "no_change"], "difficulty": 1},
            {"word": "نُور", "remove": "ر", "position": "final", "options": ["رون", "نُو", "نور"], "correct_index": 1,
             "distractor_types": ["other", "correct", "no_change"], "difficulty": 2},
            {"word": "سَلْم", "remove": "ل", "position": "medial", "options": ["سَم", "لَم", "سَل"], "correct_index": 0,
             "distractor_types": ["correct", "wrong_sound_removed", "wrong_sound_removed"], "difficulty": 3},
        ],
        "spelling": [
            {"word": "مدرسة", "spoken": "مَدْرَسَة", "difficulty": 1},
            {"word": "مسؤول", "spoken": "مَسْؤُول", "difficulty": 2},
            {"word": "استثناء", "spoken": "اِسْتِثْنَاء", "difficulty": 3},
        ],
        "writing": [
            {"prompt": "تخطط الجامعة لإنشاء مساحة جديدة للدراسة. اشرح ما الذي ينبغي أن تتضمنه ولماذا، في ٣ إلى ٥ جمل.",
             "difficulty": 2},
        ],
        "comprehension": [
            {"passage": "افتتحت مكتبة الجامعة مساحة جديدة للدراسة الهادئة بعدما أشار عدد من الطلاب إلى صعوبة التركيز في الأماكن المزدحمة. وُضعت في المساحة مكاتب فردية وإضاءة قابلة للتعديل، كما طُلب من الزوار إغلاق أصوات هواتفهم. خلال الشهر الأول، لاحظ العاملون أن المكان يزدحم بعد الظهر. ومع ذلك، فضّل بعض الطلاب غرف الدراسة الجماعية لأنهم يحتاجون إلى مناقشة المشروعات مع زملائهم. لذلك قررت إدارة المكتبة الإبقاء على النوعين من المساحات، وجمع آراء الطلاب قبل إجراء أي تغييرات أخرى.",
             "questions": [
                 {"question": "لماذا افتُتحت مساحة الدراسة الهادئة؟", "options": ["لتخزين المزيد من الكتب", "لمساعدة الطلاب على التركيز", "لإغلاق الغرف الجماعية"], "correct_index": 1},
                 {"question": "متى كان المكان أكثر ازدحامًا؟", "options": ["بعد الظهر", "في الصباح الباكر", "في وقت متأخر من الليل"], "correct_index": 0},
                 {"question": "لماذا فضّل بعض الطلاب الغرف الجماعية؟", "options": ["لأنهم يريدون إضاءة أقوى", "لأنهم يناقشون المشروعات مع زملائهم", "لأنهم لا يحبون المكتبة"], "correct_index": 1},
                 {"question": "ماذا قررت إدارة المكتبة؟", "options": ["إغلاق المساحة الهادئة", "منع الدراسة الجماعية", "الإبقاء على النوعين من المساحات"], "correct_index": 2},
             ],
             "difficulty": 2},
        ],
        "reasoning": [
            {"question": "سعر الدفتر ٧ دراهم. كم ثمن ٣ دفاتر؟", "expression": "7*3", "answer_kind": "number",
             "options": ["١٠ دراهم", "٢١ درهمًا", "٢٤ درهمًا"], "correct_index": 1, "difficulty": 1},
            {"question": "في الفصل ٢٤ طالبًا. إذا قُسّموا إلى مجموعات من ٦، فكم مجموعة؟", "expression": "24/6", "answer_kind": "number",
             "options": ["٤", "٦", "١٨"], "correct_index": 0, "difficulty": 2},
            {"question": "انطلقت الحافلة الساعة ٩:٢٠ ووصلت بعد ٤٥ دقيقة. متى وصلت؟", "expression": "9*60+20+45", "answer_kind": "time",
             "options": ["٩:٥٥", "١٠:٠٥", "١٠:١٥"], "correct_index": 1, "difficulty": 3},
        ],
    },
}
