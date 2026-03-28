import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { 
  Sounds, 
  getWeather, 
  getJoke, 
  getNews, 
  askAI, 
  searchMusic, 
  checkBackendHealth,
  speak,
  getStoredApiKey,
  type WeatherData,
  type NewsItem
} from './utils/services';

// ==================== TYPES ====================
type AppMode = 'standby' | 'listening' | 'processing' | 'responding';

interface ResponseData {
  type: 'weather' | 'joke' | 'news' | 'music' | 'ai' | 'time' | 'error';
  title: string;
  content: string;
  data?: any;
}

const WAKE_WORD = "assistant";

function Icon({
  label,
  size = 16,
  className = '',
}: {
  label: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-md border border-white/15 text-white/70 ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(8, Math.floor(size * 0.45)) }}
      aria-hidden="true"
    >
      {label}
    </span>
  );
}

const History = (props: { size?: number; className?: string }) => <Icon label="H" {...props} />;
const X = (props: { size?: number; className?: string }) => <Icon label="X" {...props} />;
const ExternalLink = (props: { size?: number; className?: string }) => <Icon label="↗" {...props} />;
const Music2 = (props: { size?: number; className?: string }) => <Icon label="M" {...props} />;
const CloudRain = (props: { size?: number; className?: string }) => <Icon label="W" {...props} />;
const Terminal = (props: { size?: number; className?: string }) => <Icon label=">" {...props} />;
const Cpu = (props: { size?: number; className?: string }) => <Icon label="C" {...props} />;
const Radio = (props: { size?: number; className?: string }) => <Icon label="N" {...props} />;
const Sparkles = (props: { size?: number; className?: string }) => <Icon label="A" {...props} />;

export default function App() {
  const [mode, setMode] = useState<AppMode>('standby');
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState<ResponseData | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [backendOnline, setBackendOnline] = useState(false);
  const [micStatus, setMicStatus] = useState<'unknown' | 'ready' | 'blocked' | 'unsupported'>('unknown');
  const [wakeEnabled, setWakeEnabled] = useState(true);
  const [weather, setLocalWeather] = useState<WeatherData | null>(null);
  const [showSetup, setShowSetup] = useState(false);

  const recognitionRef = useRef<any>(null);
  const wakeWordRecognitionRef = useRef<any>(null);
  const isSpeakingRef = useRef(false);
  const modeRef = useRef<AppMode>('standby');
  const wakeWordCooldownRef = useRef(false);
  const lastWakeTickRef = useRef(Date.now());

  const queueStandby = useCallback((delayMs = 700) => {
    window.setTimeout(() => {
      if (modeRef.current === 'responding' || modeRef.current === 'processing') {
        setMode('standby');
      }
    }, delayMs);
  }, []);

  const continueConversation = useCallback((delayMs = 240) => {
    window.setTimeout(() => {
      setResponse(null);
      if (modeRef.current !== 'processing') {
        Sounds.wake();
        setMode('listening');
      }
    }, delayMs);
  }, []);

  /** After music: keep the player mounted; only return to standby for wake word (no overlay teardown). */
  const afterMusicKeepPlaying = useCallback(() => {
    window.setTimeout(() => {
      setMode('standby');
    }, 400);
  }, []);

  // Update clock
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // check setup
  useEffect(() => {
    if (!getStoredApiKey()) {
      setShowSetup(true);
    }
  }, []);

  const handleSetupComplete = (key: string) => {
    localStorage.setItem('gemini_api_key', key);
    setShowSetup(false);
  };

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  // ==================== WAKE WORD DETECTION ====================
  const initWakeWordDetector = useCallback(() => {
    if (!wakeEnabled) return;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setMicStatus('unsupported');
      return;
    }

    const detector = new SpeechRecognition();
    detector.continuous = true;
    detector.interimResults = true;
    detector.lang = 'en-US';

    detector.onresult = (event: any) => {
      // Iterate from the last processed result to the latest available.
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const text = event.results[i][0].transcript.toLowerCase();
        
        if (
          text.includes(WAKE_WORD) &&
          modeRef.current === 'standby' &&
          !isSpeakingRef.current &&
          !wakeWordCooldownRef.current
        ) {
          lastWakeTickRef.current = Date.now();
          wakeWordCooldownRef.current = true;
          setTimeout(() => {
            wakeWordCooldownRef.current = false;
          }, 1500);
          
          setMode('listening');
          Sounds.ping();
          try {
            detector.stop(); 
          } catch (e) {}
          break; // Stop checking once wake word is triggered
        }
      }
    };

    detector.onend = () => {
      // Small delay before restart to avoid browser rapid-restart issues.
      if (modeRef.current === 'standby' && wakeEnabled) {
        window.setTimeout(() => {
          try {
            detector.start();
          } catch (e) {}
        }, 300);
      }
    };

    wakeWordRecognitionRef.current = detector;
    try {
      detector.start();
    } catch {
      // Ignore startup race if recognition is already running.
    }
  }, [wakeEnabled]);

  useEffect(() => {
    initWakeWordDetector();
    return () => wakeWordRecognitionRef.current?.stop();
  }, [initWakeWordDetector]);

  useEffect(() => {
    const probeServices = async () => {
      const up = await checkBackendHealth();
      setBackendOnline(up);
      // Fetch initial weather for widget
      try {
        const w = await getWeather('Ahmedabad');
        setLocalWeather(w);
      } catch (e) {
        console.error('Initial weather fetch failed', e);
      }
    };
    probeServices();
    const timer = window.setInterval(probeServices, 15000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const detectMic = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setMicStatus('unsupported');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
        setMicStatus('ready');
      } catch {
        setMicStatus('blocked');
      }
    };
    detectMic();
  }, []);

  // ==================== COMMAND PROCESSING ====================
  const startListening = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    setMode('listening');
    Sounds.wake();
    setTranscript('');
    setResponse(null);

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;

    recognition.onresult = (event: any) => {
      const text = event.results[0][0].transcript;
      setTranscript(text);
      processCommand(text);
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      Sounds.sleep();
      if (modeRef.current === 'listening') setMode('standby');
    };

    recognition.onerror = () => {
      recognitionRef.current = null;
      setMode('standby');
    };

    try {
      recognition.start();
    } catch {
      setMode('standby');
    }
    recognitionRef.current = recognition;
  };

  const processCommand = async (text: string) => {
    setMode('processing');
    const lower = text.toLowerCase();

    try {
      // 1. MUSIC
      if (lower.includes('play') || lower.includes('song')) {
        const query = extractMusicQuery(text);
        const musicData = await searchMusic(query);
        const title = musicData.title || query;
        setResponse({ type: 'music', title, content: `Playing ${title}`, data: musicData });
        setMode('responding');
        // Do not speak or call continueConversation here — that would clear the overlay and destroy the iframe.
        Sounds.success();
        afterMusicKeepPlaying();
        return;
      }

      // 2. WEATHER
      if (lower.includes('weather') || lower.includes('temperature')) {
        const locationMatch = lower.match(/(?:weather|temperature)\s+in\s+(.+)/);
        const requestedLocation = locationMatch?.[1]?.replace(/[?.!,]+$/g, '').trim();
        const weather = await getWeather(requestedLocation || 'auto');
        setResponse({ type: 'weather', title: 'Weather', content: `Current temperature is ${weather.temperature} degrees.`, data: weather });
        isSpeakingRef.current = true;
        speak(`It's currently ${weather.temperature} degrees in ${weather.city}.`, () => {
          isSpeakingRef.current = false;
          continueConversation();
        });
        setMode('responding');
        return;
      }

      // 3. NEWS
      if (lower.includes('news') || lower.includes('headlines')) {
        const indiaMode = lower.includes('india') || lower.includes('indian');
        const news = await getNews(indiaMode ? 'india' : 'global');
        setResponse({
          type: 'news',
          title: indiaMode ? 'India Headlines' : 'Top Stories',
          content: indiaMode ? 'Here are the latest headlines from India.' : 'Here are the latest headlines.',
          data: news
        });
        const firstHeadline = news[0]?.title;
        isSpeakingRef.current = true;
        speak(firstHeadline ? `Top headline: ${firstHeadline}` : "I couldn't fetch headlines right now.", () => {
          isSpeakingRef.current = false;
          continueConversation();
        });
        setMode('responding');
        return;
      }

      // 4. JOKE
      if (lower.includes('joke')) {
        const joke = await getJoke();
        const content = joke.type === 'twopart' 
          ? `${joke.setup || ''} ... ${joke.delivery || ''}` 
          : (joke.joke || "I'm afraid I don't have a joke right now.");
        setResponse({ type: 'joke', title: 'Joke', content });
        isSpeakingRef.current = true;
        speak(content, () => {
          isSpeakingRef.current = false;
          continueConversation();
        });
        setMode('responding');
        return;
      }

      // 5. TIME
      if (lower.includes('time') || lower.includes('clock')) {
        const timeStr = new Date().toLocaleTimeString();
        setResponse({ type: 'time', title: 'Time', content: `The current time is ${timeStr}` });
        isSpeakingRef.current = true;
        speak(`The time is ${timeStr}.`, () => {
          isSpeakingRef.current = false;
          continueConversation();
        });
        setMode('responding');
        return;
      }

      // 6. DEFAULT AI
      const aiResponse = await askAI(text);
      setResponse({ type: 'ai', title: 'Response', content: aiResponse.answer });
      isSpeakingRef.current = true;
      speak(aiResponse.answer, () => {
        isSpeakingRef.current = false;
        continueConversation();
      });
      setMode('responding');

    } catch (err) {
      setResponse({ type: 'error', title: 'Error', content: 'Something went wrong.' });
      setMode('responding');
      queueStandby(1200);
    }
  };

  useEffect(() => {
    if (mode === 'listening' && !recognitionRef.current) {
      startListening();
    }
  }, [mode]);

  useEffect(() => {
    if (mode === 'standby' && wakeWordRecognitionRef.current) {
      try {
        wakeWordRecognitionRef.current.start();
      } catch {
        // Safe no-op if already running.
      }
    }
  }, [mode]);

  // Auto self-heal: restart wake detector if idle too long in standby.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!wakeEnabled) return;
      if (modeRef.current !== 'standby') return;
      const idleMs = Date.now() - lastWakeTickRef.current;
      if (idleMs < 35000) return;

      try {
        wakeWordRecognitionRef.current?.stop();
      } catch {
        // Safe no-op.
      }
      wakeWordRecognitionRef.current = null;
      window.setTimeout(() => initWakeWordDetector(), 180);
      lastWakeTickRef.current = Date.now();
    }, 8000);

    return () => window.clearInterval(timer);
  }, [wakeEnabled, initWakeWordDetector]);

  return (
    <div className="flex flex-col min-h-screen bg-black text-white px-4 py-6 sm:px-6 sm:py-8 font-sans select-none overflow-hidden relative">
      {showSetup && <SetupScreen onComplete={handleSetupComplete} />}
      <BackgroundElements />

      {/* Top Header & Clock Widget */}
      <div className="relative z-10 flex flex-col items-center pt-4 sm:pt-8 w-full">
        <ClockWeatherWidget time={currentTime} weather={weather} />
      </div>

      {/* Main Orb */}
      <div className="relative z-10 flex flex-col items-center justify-center gap-8 sm:gap-10 flex-1">
        <div 
          onClick={() => mode === 'standby' && setMode('listening')}
          className={`relative group ${mode === 'standby' ? 'cursor-pointer' : ''}`}
        >
          <Orb mode={mode} />
        </div>

        {/* Status & Transcript */}
        <div className="flex flex-col items-center gap-3 max-w-2xl text-center px-2">
          <div className={`text-[10px] sm:text-xs tracking-[0.2em] sm:tracking-[0.3em] uppercase transition-all duration-500 ${
            mode === 'listening' ? 'text-white' : 
            mode === 'processing' ? 'text-indigo-400' :
            'text-white/20'
          }`}>
            {mode === 'standby' ? `Listening for "${WAKE_WORD}"` : mode}
          </div>

          <div className="flex flex-wrap justify-center gap-2 text-[10px] uppercase tracking-[0.12em]">
            <StatusPill
              label={backendOnline ? 'backend online' : 'backend offline'}
              tone={backendOnline ? 'ok' : 'bad'}
            />
            <StatusPill
              label={
                micStatus === 'ready'
                  ? 'mic ready'
                  : micStatus === 'blocked'
                    ? 'mic blocked'
                    : micStatus === 'unsupported'
                      ? 'mic unsupported'
                      : 'mic checking'
              }
              tone={micStatus === 'ready' ? 'ok' : micStatus === 'unknown' ? 'warn' : 'bad'}
            />
            <StatusPill label={wakeEnabled ? 'wake on' : 'wake off'} tone={wakeEnabled ? 'ok' : 'warn'} />
          </div>
          
          {transcript && (
            <div className="text-base sm:text-lg text-white/60 font-light animate-fade-in italic break-words w-full px-4 max-w-lg mx-auto">
              "{transcript}"
            </div>
          )}

          <div className="flex flex-wrap justify-center gap-2 mt-2">
            <QuickChip icon={<CloudRain size={13} />} label="Weather" onClick={() => processCommand('weather now')} />
            <QuickChip icon={<Radio size={13} />} label="News" onClick={() => processCommand('latest news')} />
            <QuickChip icon={<Music2 size={13} />} label="Music" onClick={() => processCommand('play relaxing music')} />
            <QuickChip icon={<Sparkles size={13} />} label="Ask AI" onClick={() => processCommand('tell me something useful')} />
            <QuickChip
              icon={<Terminal size={13} />}
              label={wakeEnabled ? 'Wake Off' : 'Wake On'}
              onClick={() => {
                const next = !wakeEnabled;
                setWakeEnabled(next);
                if (!next) {
                  wakeWordRecognitionRef.current?.stop();
                } else {
                  initWakeWordDetector();
                }
              }}
            />
            <QuickChip
              icon={<Cpu size={13} />}
              label="Recover"
              onClick={() => {
                recognitionRef.current?.stop();
                wakeWordRecognitionRef.current?.stop();
                recognitionRef.current = null;
                wakeWordRecognitionRef.current = null;
                lastWakeTickRef.current = Date.now();
                setMode('standby');
                if (wakeEnabled) {
                  window.setTimeout(() => initWakeWordDetector(), 200);
                }
              }}
            />
          </div>
        </div>
      </div>

      {/* Response Display */}
      {response && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 backdrop-blur-3xl z-20 animate-fade-in p-4 sm:p-8">
          <div className="max-w-2xl w-full flex flex-col items-center">
            <ResponseCard response={response} onClose={() => { setResponse(null); setMode('standby'); }} />
          </div>
        </div>
      )}

      {/* Footer Branding */}
      <div className="relative z-10 pb-2 flex flex-col items-center gap-2">
        <div className="flex items-center gap-6 text-white/5">
          <Cpu size={16} />
          <Terminal size={16} />
          <CloudRain size={16} />
        </div>
        <div className="text-[9px] tracking-[0.3em] sm:tracking-[0.4em] text-white/10 uppercase text-center">
          © Someone's Assistant
        </div>
      </div>

      {/* Controls */}
      <div className="fixed bottom-4 right-4 sm:bottom-8 sm:right-8 z-30">
        <button 
          onClick={() => { setResponse(null); setMode('standby'); window.speechSynthesis.cancel(); isSpeakingRef.current = false; }}
          className="p-3 sm:p-4 rounded-full bg-white/5 border border-white/10 text-white/20 hover:text-white/60 hover:bg-white/10 transition-all"
        >
          <X size={20} />
        </button>
      </div>
    </div>
  );
}

function extractMusicQuery(text: string): string {
  const cleaned = text
    .toLowerCase()
    .replace(/\b(alexa|please|can you|could you)\b/g, ' ')
    .replace(/\b(play|song|music|on youtube)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned || 'top songs';
}

function Orb({ mode }: { mode: AppMode }) {
  const isListening = mode === 'listening';
  const isProcessing = mode === 'processing';

  return (
    <div className="relative w-64 h-64 flex items-center justify-center">
      {/* Outer Glows */}
      <div className={`absolute inset-0 rounded-full blur-[80px] transition-all duration-1000 ${
        isListening ? 'bg-white/10 scale-125' : 
        isProcessing ? 'bg-indigo-500/10 scale-110' : 
        'bg-white/5 opacity-50'
      }`} />
      
      {/* Orb Infinity Layers */}
      <div className={`relative w-48 h-48 rounded-full flex items-center justify-center transition-all duration-700
        ${isListening ? 'scale-110 shadow-[0_0_100px_rgba(255,255,255,0.1)]' : 'shadow-[0_0_50px_rgba(0,0,0,0.5)]'}
      `}>
        {/* Layer 1: Background */}
        <div className="absolute inset-0 rounded-full bg-black border border-white/5" />
        
        {/* Layer 2: Gradient Flow */}
        <div className="absolute inset-2 rounded-full opacity-40 animate-orb-infinity" 
             style={{ background: 'linear-gradient(45deg, transparent, rgba(255,255,255,0.1), transparent)' }} />
        
        {/* Layer 3: Inner Core */}
        <div className={`w-36 h-36 rounded-full glass-card flex items-center justify-center relative overflow-hidden
          ${isListening ? 'animate-breathe' : ''}
        `}>
          <div className="absolute inset-0 bg-radial-gradient from-white/5 to-transparent opacity-20" />
          
          {/* Visualizers handle */}
          {isListening && (
            <div className="flex gap-2 h-10 items-center justify-center">
              {[0, 1, 2, 3, 4, 5].map(i => (
                <div 
                  key={i} 
                  className="w-1 bg-white/60 rounded-full animate-waveBar shadow-[0_0_10px_rgba(255,255,255,0.3)]" 
                  style={{ animationDelay: `${i * 0.15}s`, height: '8px' }} 
                />
              ))}
            </div>
          )}
          
          {isProcessing && (
            <div className="relative w-12 h-12">
               <div className="absolute inset-0 border-t-2 border-white/40 rounded-full animate-spin" />
               <div className="absolute inset-2 border-b-2 border-white/20 rounded-full animate-spin" style={{ animationDirection: 'reverse' }} />
            </div>
          )}
          
          {!isListening && !isProcessing && (
            <div className="w-1.5 h-1.5 rounded-full bg-white/20 animate-pulse" />
          )}
        </div>
      </div>
    </div>
  );
}

function ClockWeatherWidget({ time, weather }: { time: Date, weather: WeatherData | null }) {
  const hours = time.getHours().toString().padStart(2, '0');
  const minutes = time.getMinutes().toString().padStart(2, '0');
  const seconds = time.getSeconds().toString().padStart(2, '0');

  return (
    <div className="flex flex-col items-center animate-fade-in-up w-full max-w-lg mx-auto">
      <div className="glass-card-premium p-8 sm:p-12 w-full flex flex-col items-center gap-8 relative overflow-hidden group">
        {/* Abstract Glow Background */}
        <div className="absolute -top-24 -left-24 w-64 h-64 bg-indigo-500/10 blur-[100px] rounded-full group-hover:bg-indigo-500/20 transition-all duration-1000" />
        <div className="absolute -bottom-24 -right-24 w-64 h-64 bg-purple-500/10 blur-[100px] rounded-full group-hover:bg-purple-500/20 transition-all duration-1000" />

          <div className="flex flex-col items-center relative z-10 w-full">
            <div className="flex items-baseline gap-1 justify-center w-full">
               <div className="text-6xl min-[400px]:text-7xl sm:text-9xl font-thin tracking-tighter tabular-nums text-white text-glow-premium leading-none flex overflow-hidden h-[1.1em]">
                  {hours.split('').map((d, i) => (
                    <span key={`h-${i}-${d}`} className="animate-kinetic inline-block">{d}</span>
                  ))}
                  <span className="opacity-20 mx-1">:</span>
                  {minutes.split('').map((d, i) => (
                    <span key={`m-${i}-${d}`} className="animate-kinetic inline-block" style={{ animationDelay: `${0.1 + i * 0.05}s` }}>{d}</span>
                  ))}
               </div>
               <div className="text-xl sm:text-3xl font-light text-white/20 tabular-nums ml-2 mb-2 shrink-0">
                 {seconds}
               </div>
            </div>
          
          <div className="text-xs sm:text-sm tracking-[0.4em] uppercase text-white/30 mt-4 font-light">
            {time.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
          </div>
        </div>

        {weather && (
          <div className="w-full flex items-center justify-between mt-4 px-4 py-6 rounded-[2rem] bg-white/[0.03] border border-white/[0.05] relative z-10">
            <div className="flex flex-col gap-1">
              <span className="text-3xl font-light text-white/90">{weather.temperature}°</span>
              <span className="text-[9px] uppercase tracking-[0.2em] text-white/20">Ahmedabad</span>
            </div>
            
            <div className="flex flex-col items-center gap-1">
              <span className="text-sm font-light text-white/70 capitalize">{weather.condition}</span>
              <div className="flex gap-1.5">
                {[...Array(3)].map((_, i) => (
                   <div key={i} className="w-1 h-1 rounded-full bg-indigo-400/40 animate-pulse" style={{ animationDelay: `${i * 0.2}s` }} />
                ))}
              </div>
            </div>

            <div className="flex flex-col items-end gap-1">
              <span className="text-sm font-light text-white/70">{weather.humidity}%</span>
              <span className="text-[9px] uppercase tracking-[0.2em] text-white/20">Humidity</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ResponseCard({ response, onClose }: { response: ResponseData, onClose: () => void }) {
  return (
    <div className="w-full bg-white/[0.03] border border-white/[0.08] rounded-3xl sm:rounded-[2.5rem] p-5 sm:p-12 backdrop-blur-2xl animate-slide-up flex flex-col gap-5 sm:gap-6 relative group overflow-hidden max-h-[88vh] overflow-y-auto">
      {/* Corner Decor */}
      <div className="absolute top-6 left-6 text-white/5"><Terminal size={14} /></div>
      
      <div className="text-[10px] tracking-[0.3em] sm:tracking-[0.4em] text-white/20 uppercase font-medium">
        {response.title}
      </div>

      <div className="text-lg sm:text-2xl font-light text-white/90 leading-tight break-words">
        {response.content}
      </div>

      {response.type === 'weather' && response.data && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 sm:gap-6 mt-2">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-white/20">Feels</span>
            <span className="text-white/60">{response.data.feelsLike}°C</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-white/20">Wind</span>
            <span className="text-white/60">{response.data.windSpeed}km/h</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-white/20">Humidity</span>
            <span className="text-white/60">{response.data.humidity}%</span>
          </div>
        </div>
      )}

      {response.type === 'news' && Array.isArray(response.data) && response.data.length > 0 && (
        <div className="mt-2 space-y-3">
          {response.data.slice(0, 5).map((item: NewsItem, idx: number) => (
            <a
              key={`${item.url}-${idx}`}
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-start gap-3 p-3 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 transition-colors"
            >
              <span className="text-xs text-white/30 pt-0.5">{idx + 1}.</span>
              <span className="text-sm text-white/80 leading-snug line-clamp-2">{item.title}</span>
            </a>
          ))}
        </div>
      )}

      {response.type === 'music' && response.data && (
        <div className="mt-2 space-y-4 w-full">
          <div className="p-6 sm:p-10 rounded-3xl bg-white/5 border border-white/5 flex flex-col items-center text-center gap-8 relative overflow-hidden group/music">
            {/* Animated Vinyl Record */}
            <div className="relative w-48 h-48 sm:w-56 sm:h-56">
               <div className="absolute inset-0 rounded-full bg-black shadow-2xl animate-[spin_3s_linear_infinite]" style={{ background: 'radial-gradient(circle, #222 0%, #111 40%, #000 50%, #111 60%, #222 70%, #000 100%)' }}>
                 <div className="absolute inset-0 rounded-full border border-white/5 opacity-50" style={{ background: 'repeating-radial-gradient(circle, transparent 0, transparent 2px, rgba(255,255,255,0.03) 3px)' }} />
               </div>
               <div className="absolute inset-[32%] rounded-full overflow-hidden border-4 border-black/50 shadow-inner z-10">
                 <img 
                   src={response.data.thumbnail || 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=400&h=400&fit=crop'} 
                   alt={response.data.title}
                   className="w-full h-full object-cover animate-pulse"
                 />
               </div>
               <div className="absolute top-1/2 left-1/2 w-4 h-4 bg-white/10 rounded-full -translate-x-1/2 -translate-y-1/2 z-20 border border-white/20" />
            </div>

            <div className="flex-1 min-w-0 z-10">
               <div className="text-2xl font-light text-white mb-2 line-clamp-1">{response.data.title}</div>
               <div className="text-xs text-indigo-400 tracking-[0.3em] uppercase font-medium">{response.data.uploaderName}</div>
            </div>

            {/* Hidden Player for Audio */}
            {response.data.videoId && (
              <div className="absolute opacity-0 pointer-events-none">
                <iframe
                  width="1"
                  height="1"
                  src={`https://www.youtube.com/embed/${response.data.videoId}?autoplay=1&mute=0`}
                  title="YouTube video player"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                />
              </div>
            )}

            <div className="flex items-center gap-4 z-10">
              <a href={response.data.youtubeUrl} target="_blank" rel="noreferrer" className="glass-pill hover:bg-white/10 transition-all flex items-center gap-2 text-[10px] uppercase tracking-widest">
                 Watch on YouTube <ExternalLink size={10} />
              </a>
            </div>

            {/* Background Glow */}
            <div className="absolute -bottom-24 -right-24 w-64 h-64 bg-indigo-500/10 blur-[100px] rounded-full" />
          </div>
        </div>
      )}

      <button 
        onClick={onClose}
        className="mt-4 sm:mt-8 flex items-center justify-center gap-2 group-hover:gap-4 transition-all text-[10px] uppercase tracking-[0.25em] sm:tracking-[0.3em] text-white/20 hover:text-white"
      >
        Dismiss Interface <History size={12} />
      </button>
    </div>
  );
}

function QuickChip({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs text-white/70 bg-white/5 border border-white/10 hover:bg-white/10 hover:text-white transition-colors"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function StatusPill({ label, tone }: { label: string; tone: 'ok' | 'warn' | 'bad' }) {
  const toneClass =
    tone === 'ok'
      ? 'text-emerald-300/90 border-emerald-300/30 bg-emerald-400/10'
      : tone === 'warn'
        ? 'text-amber-200/90 border-amber-200/30 bg-amber-300/10'
        : 'text-rose-200/90 border-rose-200/30 bg-rose-300/10';

  return (
    <span className={`px-2.5 py-1 rounded-full border ${toneClass}`}>
      {label}
    </span>
  );
}

function BackgroundElements() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <div className="absolute inset-0 mesh-background opacity-40" />
      <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-blue-500/10 blur-[150px] rounded-full animate-breathe" />
      <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-purple-500/10 blur-[150px] rounded-full animate-breathe" style={{ animationDelay: '2s' }} />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[length:60px_60px] opacity-10" />
    </div>
  );
}

function SetupScreen({ onComplete }: { onComplete: (key: string) => void }) {
  const [key, setKey] = useState('');
  
  return (
    <div className="fixed inset-0 z-[100] bg-black flex items-center justify-center p-6 sm:p-12 overflow-hidden">
      <BackgroundElements />
      <div className="max-w-md w-full glass-card p-8 sm:p-12 flex flex-col gap-8 animate-slide-up relative z-10">
        <div className="flex flex-col gap-2">
          <div className="text-[10px] tracking-[0.4em] uppercase text-indigo-400 font-medium">Initialization</div>
          <h1 className="text-3xl font-light tracking-tight text-white">Welcome, Commander.</h1>
          <p className="text-sm text-white/40 leading-relaxed">To enable AI-powered answers and advanced features, please provide your Gemini API key.</p>
        </div>

        <div className="flex flex-col gap-4">
          <div className="relative group">
            <input 
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Enter your API Key..."
              className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-sm text-white focus:outline-none focus:border-indigo-500/50 transition-all placeholder:text-white/10"
            />
            <div className="absolute inset-0 rounded-2xl border border-indigo-500/0 group-focus-within:border-indigo-500/30 pointer-events-none transition-all" />
          </div>
          
          <button 
            onClick={() => key.trim() && onComplete(key.trim())}
            disabled={!key.trim()}
            className="w-full bg-white text-black font-medium py-4 rounded-2xl hover:bg-indigo-50 transition-all disabled:opacity-20 disabled:cursor-not-allowed text-sm uppercase tracking-widest"
          >
            Authorize Assistant
          </button>
        </div>

        <div className="text-[9px] text-center text-white/20 uppercase tracking-[0.2em] mt-4 leading-loose">
          Your key is stored locally in your browser cache<br/>
          and is never shared with third parties.
        </div>
      </div>
    </div>
  );
}
