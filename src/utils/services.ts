// ==================== CORE SERVICES ====================

export const Sounds = {
  ping: () => playSound('ping'),
  success: () => playSound('success'),
  error: () => playSound('error'),
  wake: () => playSound('wake'),
  sleep: () => playSound('sleep'),
  tap: () => playSound('tap'),
};

function playSound(name: string) {
  const audio = new Audio(`/sounds/${name}.mp3`);
  audio.volume = 0.4;
  audio.play().catch(() => {
    // Silent fail if sound file is missing - common in dev
    console.warn(`Sound not found: ${name}`);
  });
}

// ==================== WEATHER ====================

export interface WeatherData {
  city: string;
  temperature: number;
  condition: string;
  low: number;
  high: number;
  humidity: number;
  windSpeed: number;
  feelsLike: number;
}

export async function getWeather(city: string): Promise<WeatherData> {
  try {
    const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`);
    if (!res.ok) throw new Error('Weather service unavailable');
    const data = await res.json();
    const current = data.current_condition[0];
    const weather = data.weather[0];

    return {
      city: data.nearest_area[0].areaName[0].value,
      temperature: parseInt(current.temp_C),
      condition: current.weatherDesc[0].value,
      low: parseInt(weather.mintemp_C),
      high: parseInt(weather.maxtemp_C),
      humidity: parseInt(current.humidity),
      windSpeed: parseInt(current.windspeedKmph),
      feelsLike: parseInt(current.FeelsLikeC),
    };
  } catch (err) {
    console.error('Weather fetch failed, using fallback:', err);
    return {
      city: city,
      temperature: 20,
      condition: 'Clear',
      low: 15,
      high: 25,
      humidity: 50,
      windSpeed: 10,
      feelsLike: 20,
    };
  }
}

// ==================== JOKES ====================

export interface JokeData {
  type: 'single' | 'twopart';
  joke?: string;
  setup?: string;
  delivery?: string;
}

export async function getJoke(): Promise<JokeData> {
  try {
    const res = await fetch('https://v2.jokeapi.dev/joke/Any?safe-mode');
    return await res.json();
  } catch {
    return { type: 'single', joke: "I'm afraid I don't have any jokes right now." };
  }
}

// ==================== NEWS ====================

export interface NewsItem {
  title: string;
  url: string;
  score: number;
}

export async function getNews(region: 'global' | 'india' = 'india'): Promise<NewsItem[]> {
  // Prefer backend (it can aggregate RSS without browser CORS issues)
  try {
    const backendRes = await fetchFromBackend(`/api/news?region=${region}`);
    if (backendRes.ok) {
      const data = await backendRes.json();
      if (Array.isArray(data.items)) {
        return data.items.map((item: any) => ({
          title: item.title || 'Untitled',
          url: item.url || '#',
          score: item.score || 0,
        }));
      }
    }
  } catch {
    // fall through to public fallback
  }

  try {
    const res = await fetch('https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=5');
    const data = await res.json();
    return data.hits.map((h: any) => ({
      title: h.title,
      url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      score: h.points || 0,
    }));
  } catch {
    return [];
  }
}

// ==================== RESPONSE ENGINE ====================

export interface ServiceResponse {
  title: string;
  answer: string;
  source?: string;
}

function extractLocation(text: string, hints: string[]): string | null {
  const lower = text.toLowerCase();
  for (const hint of hints) {
    const idx = lower.indexOf(hint);
    if (idx >= 0) {
      const value = text.slice(idx + hint.length).trim();
      if (value) return value.replace(/[?.!,]+$/g, '');
    }
  }
  return null;
}

export async function getWorldTime(place: string): Promise<{ place: string; localTime: string }> {
  try {
    const res = await fetch(`https://wttr.in/${encodeURIComponent(place)}?format=j1`);
    if (!res.ok) throw new Error('Time service unavailable');
    const data = await res.json();
    const localObsDateTime = data?.current_condition?.[0]?.localObsDateTime;
    const placeName = data?.nearest_area?.[0]?.areaName?.[0]?.value || place;
    if (localObsDateTime) {
      return { place: placeName, localTime: localObsDateTime };
    }
  } catch {
    // fallback below
  }

  return {
    place,
    localTime: new Date().toLocaleString(),
  };
}

const RESPONSES: Record<string, string> = {
  hello: "Hello! How can I help you today?",
  hi: 'Hi there! What can I do for you?',
  hey: 'Hey! I am listening. What do you need?',
  'how are you': 'I am doing well, thank you for asking. How can I assist you?',
  'what is your name': "I am Someone's Assistant, your personal companion.",
  'who are you': "I am Someone's Assistant, here to help you with things like weather, news, music, and answering your questions.",
  'thank you': 'You are welcome! Let me know if you need anything else.',
  thanks: 'Happy to help! Anything else?',
  goodbye: 'Goodbye! I will be here when you need me.',
  bye: 'See you later! Just wake me up whenever you need.',
  'what can you do': 'I can tell you the weather, share the latest news, tell jokes, play music, answer questions, and show you the time.',
  'good morning': 'Good morning! I hope you have a great day ahead.',
  'good night': 'Good night! Rest well.',
  'good evening': 'Good evening! How can I assist you tonight?',
};

function checkLocal(text: string): string | null {
  const lower = text.toLowerCase().trim();
  for (const [key, val] of Object.entries(RESPONSES)) {
    if (lower === key || lower.includes(key)) return val;
  }
  return null;
}

function checkMath(text: string): string | null {
  const patterns = /(?:what(?:'s| is)|calculate|compute|solve)\s+([\d\s+\-*/().^%]+)/i;
  const match = text.match(patterns);
  if (match) {
    try {
      const expr = match[1].replace(/\^/g, '**');
      const res = Function('"use strict"; return (' + expr + ')')();
      if (typeof res === 'number' && isFinite(res)) return `The result is ${res}`;
    } catch { return null; }
  }
  return null;
}

const API_BASES = ['https://someone-s-voice-assistant.onrender.com', 'http://127.0.0.1:5000', 'http://localhost:5000'];

export function getStoredApiKey(): string | null {
  return localStorage.getItem('gemini_api_key');
}

async function fetchFromBackend(path: string, init?: RequestInit): Promise<Response> {
  const apiKey = getStoredApiKey();
  const headers = new Headers(init?.headers || {});
  if (apiKey) {
    headers.set('X-Gemini-Key', apiKey);
  }

  let lastError: unknown = null;
  for (const base of API_BASES) {
    try {
      const res = await fetch(`${base}${path}`, {
        ...init,
        headers,
      });
      if (res.ok) return res;
      // Keep non-2xx response to surface backend errors if reachable.
      if (res.status >= 400 && res.status < 500) return res;
      lastError = new Error(`Backend status ${res.status}`);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error('Backend unreachable');
}

export async function checkBackendHealth(): Promise<boolean> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetchFromBackend('/api/health', { method: 'GET', signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function fetchRemote(query: string): Promise<ServiceResponse> {
  try {
    const res = await fetchFromBackend('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });

    if (!res.ok) throw new Error(`Server error: ${res.status}`);

    const data = await res.json();
    if (data.error) throw new Error(data.error);

    return {
      title: data.title || "Response",
      answer: data.answer,
    };
  } catch (e: any) {
    throw e;
  }
}

export async function askAI(query: string): Promise<ServiceResponse> {
  const q = query.toLowerCase();

  // Real-time intents without AI dependency.
  if (q.includes('india') && (q.includes('news') || q.includes('headline'))) {
    const indiaNews = await getNews('india');
    if (indiaNews.length > 0) {
      const top = indiaNews.slice(0, 3).map((n, i) => `${i + 1}. ${n.title}`).join(' ');
      return { title: 'India News', answer: `Top India headlines: ${top}` };
    }
    return { title: 'India News', answer: 'I could not fetch India headlines right now.' };
  }

  if ((q.includes('weather') || q.includes('temperature')) && !q.includes('whether')) {
    const location = extractLocation(query, ['weather in', 'temperature in']) || 'Ahmedabad';
    const w = await getWeather(location);
    return {
      title: 'Weather',
      answer: `In ${w.city}, it is ${w.temperature} degrees with ${w.condition}. Feels like ${w.feelsLike} degrees.`,
    };
  }

  if (q.includes('time in')) {
    const location = extractLocation(query, ['time in']) || 'your location';
    const t = await getWorldTime(location);
    return {
      title: 'World Time',
      answer: `Current local time in ${t.place} is ${t.localTime}.`,
    };
  }

  const local = checkLocal(query);
  if (local) return { title: "Response", answer: local };

  const math = checkMath(query);
  if (math) return { title: 'Calculator', answer: math };

  const lower = query.toLowerCase();
  if (lower.includes('what day') || lower.includes('what date') || lower.includes('today')) {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    return { title: 'Date', answer: `Today is ${dateStr}.` };
  }

  try {
    return await fetchRemote(query);
  } catch (err: any) {
    console.error('Remote fetch failed:', err);
    return {
      title: "Response",
      answer: "I could not reach cloud AI right now, but I am still available for weather, world time, India news, music, and basic questions.",
    };
  }
}

// ==================== MUSIC ====================

export interface MusicResult {
  title: string;
  videoId: string;
  uploaderName: string;
  duration: number;
  thumbnail: string;
  youtubeUrl: string;
}

export async function searchMusic(query: string): Promise<MusicResult> {
  try {
    const res = await fetchFromBackend('/api/music', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    if (res.ok) {
      const data = await res.json();
      return {
        title: data.title || query,
        videoId: data.videoId || '',
        uploaderName: data.uploaderName || 'Unknown',
        duration: data.duration || 0,
        thumbnail: data.thumbnail || '',
        youtubeUrl: data.youtubeUrl || `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
      };
    }
  } catch (err) {
    console.error('Music search failed:', err);
  }

  return { title: query, videoId: '', uploaderName: '', duration: 0, thumbnail: '', youtubeUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}` };
}

// ==================== SPEECH ====================

let currentAudio: HTMLAudioElement | null = null;
let preferredVoice: SpeechSynthesisVoice | null = null;

function pickPreferredVoice(): SpeechSynthesisVoice | null {
  if (!window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;

  const rankedMatchers = [
    /google us english/i,
    /microsoft aria/i,
    /microsoft jenny/i,
    /en-us.*neural/i,
    /english.*natural/i,
  ];

  for (const matcher of rankedMatchers) {
    const match = voices.find(v => matcher.test(v.name) && /en/i.test(v.lang));
    if (match) return match;
  }

  return voices.find(v => /^en(-|_)/i.test(v.lang)) || voices[0] || null;
}

if (typeof window !== 'undefined' && window.speechSynthesis) {
  preferredVoice = pickPreferredVoice();
  window.speechSynthesis.onvoiceschanged = () => {
    preferredVoice = pickPreferredVoice();
  };
}

export function speak(text: string, onEnd?: () => void): void {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  if (!text) return;

  const cleanText = text.replace(/[*#`]/g, '').trim();

  // Prefer free local/browser natural voices (faster, no quota, no TTS API failures).
  if (window.speechSynthesis) {
    fallbackSpeak(cleanText, onEnd);
    return;
  }

  // If browser speech is unavailable, try backend TTS.
  fetchFromBackend('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: cleanText }),
  })
    .then(res => res.ok ? res.blob() : Promise.reject())
    .then(blob => {
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      currentAudio = audio;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        currentAudio = null;
        if (onEnd) onEnd();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        currentAudio = null;
        if (onEnd) onEnd();
      };
      audio.play().catch(() => {
        if (onEnd) onEnd();
      });
    })
    .catch(() => {
      if (onEnd) onEnd();
    });
}

function fallbackSpeak(text: string, onEnd?: () => void): void {
  const u = new SpeechSynthesisUtterance(text);
  if (!preferredVoice) preferredVoice = pickPreferredVoice();
  if (preferredVoice) u.voice = preferredVoice;
  u.rate = 0.92;
  u.pitch = 1.02;
  if (onEnd) u.onend = onEnd;
  window.speechSynthesis.speak(u);
}
