import requests
import json

BASE_URL = "http://127.0.0.1:5000"

def test_ask():
    print("Testing /api/ask...")
    try:
        r = requests.post(f"{BASE_URL}/api/ask", json={"query": "Hello"}, timeout=15)
        print(f"Status: {r.status_code}")
        print(f"Response: {r.text}")
    except Exception as e:
        print(f"Error: {e}")

def test_tts():
    print("\nTesting /api/tts...")
    try:
        r = requests.post(f"{BASE_URL}/api/tts", json={"text": "Hello, I am Nova."}, timeout=15)
        print(f"Status: {r.status_code}")
        print(f"Content-Type: {r.headers.get('Content-Type')}")
        if r.status_code == 200:
            with open("test_tts.mp3", "wb") as f:
                f.write(r.content)
            print("TTS audio saved to test_tts.mp3")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    test_ask()
    test_tts()
