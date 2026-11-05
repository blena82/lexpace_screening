# LexPace Village (Streamlit)

The Village of Seven Skills games only, as a Streamlit app.

Run locally:

    pip install -r requirements.txt     # Python 3.12 recommended
    streamlit run streamlit_app.py      # open http://localhost:8501/

Deploy on Streamlit Community Cloud (share.streamlit.io):

1. Push this folder to a GitHub repository (this folder is the repository root).
2. Create app -> pick the repository, branch `main`, main file `streamlit_app.py`.
3. Advanced settings -> Python version **3.12** (the trained model needs it; it can only be chosen at deploy time).
4. Optional, in Advanced settings -> Secrets, for generated questions and writing scores:

       ANTHROPIC_API_KEY = "..."        # or GEMINI_API_KEY = "..."

   Without a key the screening uses the validated starter items.

How it fits together:

- `streamlit_app.py`: the Streamlit app. It shows the village and answers its requests.
- `screening_api.py`, `screening/`, `models/`: the screening backend (same code as the standalone village app), run inside the Streamlit process.
- `village/`: the game pages (same files as the standalone village app). `streamlit-bridge.js` sends their `/api/screening` requests to the Streamlit app instead of over HTTP.
