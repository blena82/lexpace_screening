"""LexPace adaptive screening pipeline.

Student -> adaptive screening games -> LLM question generation (backend only)
-> deterministic answer evaluation (LLM only scores written expression)
-> feature extraction -> trained ML classifier (pluggable) -> screening results.

The LLM never classifies students. Classification lives behind classifier.py.
"""
