import os
import sys
import re
import asyncio
import io
import xml.etree.ElementTree as ET
from urllib.parse import quote_plus
import requests
import edge_tts
import yt_dlp
from flask import Flask, request, jsonify, Response
from flask_cors import CORS
from dotenv import load_dotenv

# Load configuration from .env in the parent directory
env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
load_dotenv(dotenv_path=env_path)

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}}, supports_credentials=True)

@app.before_request
def log_request_info():
    print(f"[LOG] {request.method} {request.path}", file=sys.stderr)

# ==================== Core Setup ====================

GEN_KEY = os.getenv("GEMINI_API_KEY", "")
GROQ_KEY = os.getenv("GROQ_API_KEY", "")

def local_answer(query: str) -> str:
    q = query.lower().strip()
    if "time" in q:
        from datetime import datetime
        return f"The current time is {datetime.now().strftime('%I:%M %p')}."
    if "date" in q or "day" in q or "today" in q:
        from datetime import datetime
        return f"Today is {datetime.now().strftime('%A, %d %B %Y')}."
    if "hello" in q or "hi" in q:
        return "Hello! I am online in local mode. You can ask for weather, news, music, or basic questions."
    return "I am running in local mode right now. Please set GEMINI_API_KEY in .env for full AI answers."

def get_engine_url(model_name="gemini-1.5-flash"):
    if not GEN_KEY:
        raise ValueError("GEMINI_API_KEY is not set in .env")
    return f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={GEN_KEY}"

def ask_groq(full_prompt: str):
    if not GROQ_KEY:
        return None, "GROQ_API_KEY not set"

    url = "https://api.groq.com/openai/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {GROQ_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": "llama-3.1-8b-instant",
        "temperature": 0.4,
        "max_tokens": 350,
        "messages": [
            {"role": "system", "content": "You are a helpful and concise personal companion. Reply in plain text only."},
            {"role": "user", "content": full_prompt},
        ],
    }

    try:
        r = requests.post(url, headers=headers, json=payload, timeout=15)
        if r.status_code != 200:
            body = ""
            try:
                body = r.text[:200]
            except Exception:
                body = ""
            return None, f"Groq API Error {r.status_code} {body}".strip()

        data = r.json()
        answer = (
            data.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
            .replace("*", "")
            .replace("#", "")
            .replace("`", "")
            .strip()
        )
        if answer:
            return answer, None
        return None, "Groq returned empty response"
    except Exception as e:
        return None, str(e)

@app.route("/api/ask", methods=["POST"])
def ask_ai():
    try:
        data = request.get_json(silent=True) or {}
        query = data.get("query", "").strip()
        if not query:
            return jsonify({"error": "No query provided"}), 400

        prompt_base = (
            "You are a helpful and concise personal companion. "
            "You can respond in English or Hindi as requested. "
            "Give clear, direct answers under 3 sentences. "
            "No formatting, no emojis. Plain text only."
        )
        full_prompt = f"{prompt_base}\nUser: {query}"
        
        provider_errors = []

        # 1) Try Gemini first (prefer user key from header)
        user_key = request.headers.get("X-Gemini-Key", "").strip()
        current_gen_key = user_key if user_key else GEN_KEY

        if current_gen_key:
            models = [
                "gemini-1.5-flash",
                "gemini-1.5-flash-8b",
                "gemini-2.0-flash-lite",
                "gemini-2.0-flash",
            ]
            for model in models:
                try:
                    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={current_gen_key}"
                    payload = {"contents": [{"parts": [{"text": full_prompt}]}]}
                    r = requests.post(url, json=payload, headers={'Content-Type': 'application/json'}, timeout=10)

                    if r.status_code == 429:
                        provider_errors.append("Gemini quota exceeded or busy")
                        continue

                    if r.status_code != 200:
                        body = ""
                        try:
                            body = r.text[:200]
                        except Exception:
                            body = ""
                        provider_errors.append(f"Gemini API Error {r.status_code} {body}".strip())
                        continue

                    res_data = r.json()
                    if "candidates" in res_data and len(res_data["candidates"]) > 0:
                        parts = res_data["candidates"][0].get("content", {}).get("parts", [])
                        if parts:
                            answer = parts[0].get("text", "").replace("*", "").replace("#", "").replace("`", "").strip()
                            return jsonify({"title": "Response", "answer": answer, "source": "gemini"})

                    provider_errors.append("Gemini returned no response parts")
                except Exception as e:
                    provider_errors.append(f"Gemini exception: {str(e)}")

        # 2) Fallback to Groq if key exists
        answer, groq_err = ask_groq(full_prompt)
        if answer:
            return jsonify({"title": "Response", "answer": answer, "source": "groq"})
        if groq_err:
            provider_errors.append(groq_err)

        # 3) Final local fallback
        combined_err = " | ".join(provider_errors) if provider_errors else "No AI provider configured"
        print(f"[WARN] AI providers unavailable, using local fallback: {combined_err}", file=sys.stderr)
        return jsonify({
            "title": "Response",
            "answer": local_answer(query),
            "source": "local_fallback",
            "note": combined_err,
        })
    except Exception as e:
        print(f"[ERR] ask_ai failed: {e}", file=sys.stderr)
        return jsonify({"error": "Internal Server Error"}), 500


# ==================== Speech ====================

@app.route("/api/tts", methods=["POST"])
def text_to_speech():
    try:
        data = request.get_json(silent=True) or {}
        text = data.get("text", "").strip()
        if not text:
            return jsonify({"error": "No text"}), 400

        # Clean text for TTS
        text = text.replace("*", "").replace("#", "").replace("\n", " ").strip()
        
        # Detect Hindi characters (Devanagari range)
        is_hindi = bool(re.search(r'[\u0900-\u097F]', text))
        voice = "hi-IN-SwaraNeural" if is_hindi else "en-US-AvaNeural"

        async def generate():
            communicate = edge_tts.Communicate(text, voice)
            audio_io = io.BytesIO()
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    audio_io.write(chunk["data"])
            return audio_io.getvalue()

        # Thread-safe event loop for TTS
        loop = asyncio.new_event_loop()
        try:
            audio_bytes = loop.run_until_complete(generate())
        finally:
            loop.close()

        if not audio_bytes:
            return jsonify({"error": "Failed to generate audio stream"}), 500

        return Response(audio_bytes, mimetype="audio/mpeg")
    except Exception as e:
        print(f"[ERR] tts failed: {e}", file=sys.stderr)
        return jsonify({"error": str(e)}), 500


# ==================== Music ====================

@app.route("/api/music", methods=["POST"])
def search_music():
    try:
        data = request.get_json(silent=True) or {}
        query = data.get("query", "").strip()
        if not query:
            return jsonify({"error": "No query provided"}), 400

        # Layer 1: yt-dlp search
        try:
            ydl_opts = {
                "format": "best", 
                "noplaylist": True, 
                "quiet": True, 
                "no_warnings": True, 
                "default_search": "ytsearch1",
                "nocheckcertificate": True,
                "geo_bypass": True,
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(f"ytsearch1:{query} official audio", download=False)
                if info and "entries" in info and info["entries"]:
                    entry = info["entries"][0]
                    return jsonify({
                        "title": entry.get("title", query),
                        "videoId": entry.get("id", ""),
                        "uploaderName": entry.get("uploader", "Unknown"),
                        "duration": entry.get("duration", 0),
                        "thumbnail": entry.get("thumbnail", ""),
                        "youtubeUrl": f"https://www.youtube.com/watch?v={entry.get('id', '')}",
                    })
        except Exception as e:
            print(f"[ERR] yt-dlp search failed: {e}", file=sys.stderr)

        # Layer 2: Piped API fallback
        fallback_instances = [
            'https://pipedapi.kavin.rocks',
            'https://pipedapi.adminforge.de',
            'https://api.piped.victr.me',
        ]
        for instance in fallback_instances:
            try:
                encoded_query = quote_plus(query)
                r = requests.get(f"{instance}/api/v1/search?q={encoded_query}&filter=music_songs", timeout=5)
                if r.status_code == 200:
                    res_data = r.json()
                    if res_data.get("items"):
                        item = res_data["items"][0]
                        v_id = item.get("url", "").replace("/watch?v=", "")
                        return jsonify({
                            "title": item.get("title", query),
                            "videoId": v_id,
                            "uploaderName": item.get("uploaderName", "Unknown"),
                            "duration": item.get("duration", 0),
                            "thumbnail": item.get("thumbnail", ""),
                            "youtubeUrl": f"https://www.youtube.com/watch?v={v_id}",
                        })
            except Exception:
                continue

        # Final fallback: Return search link but no videoId
        return jsonify({
            "title": query, 
            "videoId": "", 
            "uploaderName": "Unknown",
            "duration": 0,
            "thumbnail": "",
            "youtubeUrl": f"https://www.youtube.com/results?search_query={quote_plus(query)}"
        })
    except Exception as e:
        print(f"[ERR] music route failed: {e}", file=sys.stderr)
        return jsonify({"error": "Music search service unavailable"}), 500


# ==================== Health & System ====================

@app.route("/api/news", methods=["GET"])
def news():
    region = request.args.get("region", "india").strip().lower()
    if region == "india":
        feed_url = "https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en"
    else:
        feed_url = "https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en"

    try:
        r = requests.get(feed_url, timeout=7)
        if r.status_code != 200:
            return jsonify({"items": []}), 200

        root = ET.fromstring(r.content)
        items = []
        for item in root.findall(".//item")[:8]:
            title = item.findtext("title", "").strip()
            link = item.findtext("link", "").strip()
            if title and link:
                items.append({"title": title, "url": link, "score": 0})

        return jsonify({"items": items})
    except Exception as e:
        print(f"[ERR] news route failed: {e}", file=sys.stderr)
        return jsonify({"items": []}), 200

@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "active", "version": "1.1.0"})

if __name__ == "__main__":
    # Ensure port 5000 is used
    app.run(host="0.0.0.0", port=5000)
