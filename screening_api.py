"""The screening API for the Streamlit app: the same router as the standalone village app
(screening/router.py), called inside this Python process instead of over HTTP.

Kept out of streamlit_app.py on purpose: `streamlit run` treats an entry script that creates a
FastAPI app as a web app to serve, not as a Streamlit script.
"""

import asyncio
import threading

import httpx
from fastapi import FastAPI

from screening.router import create_router

_api = FastAPI(title="LexPace Village")
_api.include_router(create_router())

# One event loop for the whole server, so written-expression scoring keeps running between requests.
_loop = asyncio.new_event_loop()
threading.Thread(target=_loop.run_forever, daemon=True, name="lexpace-screening").start()
_client = httpx.AsyncClient(transport=httpx.ASGITransport(app=_api, raise_app_exceptions=False),
                            base_url="http://village")


def call(method: str, path: str, body) -> dict:
    """One request to /api/screening/... -> {"status": HTTP status, "body": JSON reply}."""
    if not path.startswith("/api/screening/"):
        return {"status": 404, "body": {"detail": "Unknown API path"}}
    try:
        res = asyncio.run_coroutine_threadsafe(_client.request(method, path, json=body), _loop).result(timeout=180)
        return {"status": res.status_code, "body": res.json()}
    except Exception as e:  # the page shows its "could not reach LexPace" screen
        return {"status": 502, "body": {"detail": type(e).__name__}}
