"""LexPace Village on Streamlit: the Village of Seven Skills games only.

- village/           the game pages (the same files as the standalone village app), shown as one component
- screening/         adaptive EN/AR screening (item generation, evaluation, features, classifier)
- screening_api.py   answers the pages' /api/screening requests in this Python process

There is no separate web server: requests and replies travel through the component
(see village/streamlit-bridge.js).
"""

import os
from pathlib import Path

import streamlit as st
import streamlit.components.v1 as components

HERE = Path(__file__).resolve().parent

st.set_page_config(page_title="LexPace | Village of Seven Skills", page_icon="🏡", layout="wide")

# Streamlit secrets (ANTHROPIC_API_KEY or GEMINI_API_KEY) -> environment, where screening.config reads them.
try:
    for name, value in st.secrets.items():
        if isinstance(value, str):
            os.environ.setdefault(name, value)
except Exception:  # no secrets file: the screening uses the validated starter items
    pass

import screening_api  # noqa: E402  (after the secrets: screening.config reads the environment on import)

village = components.declare_component("lexpace_village", path=str(HERE / "village"))

# The village fills the page.
st.html("""<style>
header[data-testid="stHeader"],[data-testid="stToolbar"],[data-testid="stDecoration"],footer{display:none}
[data-testid="stAppViewContainer"],[data-testid="stMain"]{background:#dce9dc;overflow:hidden}
[data-testid="stMainBlockContainer"]{padding:0;max-width:none}
[data-testid="stVerticalBlock"]{gap:0}
iframe{display:block;width:100%;height:100vh;height:100dvh}
</style>""")

# The component's value is the list of requests the games are still waiting on. Each is answered once;
# a reply is dropped when the page no longer lists its request.
outbox = (st.session_state.get("village") or {}).get("outbox", [])
replies = st.session_state.setdefault("replies", {})
for req in outbox:
    if req["id"] not in replies:
        replies[req["id"]] = screening_api.call(req.get("method", "POST"), req["path"], req.get("body"))
for done in set(replies) - {req["id"] for req in outbox}:
    del replies[done]

village(replies=replies, key="village", default=None)
