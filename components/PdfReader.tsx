'use client';

import { useState, useEffect, useRef } from 'react';
import { Play, Pause, RotateCcw, Upload } from 'lucide-react';

export default function PdfReader() {
  const [chunks, setChunks] = useState<string[]>([]);
  const [currentChunk, setCurrentChunk] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isParsing, setIsParsing] = useState<boolean>(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const [speed, setSpeed] = useState<number>(1);
  const [chunkElapsed, setChunkElapsed] = useState<number>(0);
  const synthRef = useRef<SpeechSynthesis | null>(null);

  // Roughly average spoken-word pace at normal (1x) speed, used to estimate
  // how long each sentence — and the whole document — will take to read.
  const WORDS_PER_MINUTE_AT_1X = 150;

  const formatDuration = (totalSeconds: number): string => {
    const s = Math.max(0, Math.round(totalSeconds));
    const hours = Math.floor(s / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    const seconds = s % 60;

    const parts: string[] = [];
    if (hours > 0) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
    if (minutes > 0) parts.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`);
    if (seconds > 0 || parts.length === 0) {
      parts.push(`${seconds} ${seconds === 1 ? 'second' : 'seconds'}`);
    }

    if (parts.length === 1) return parts[0];
    if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
    return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
  };

  // Preferred voice names, in order — first match wins. Chrome exposes
  // "Google UK English Male" once its voice list has loaded.
  const PREFERRED_VOICES = ['Google UK English Male'];

  const pickDefaultVoice = (available: SpeechSynthesisVoice[]) => {
    for (const name of PREFERRED_VOICES) {
      const match = available.find((v) => v.name === name);
      if (match) return match;
    }
    // Fall back to any other UK English voice, then leave unset (browser default)
    const ukFallback = available.find((v) => v.lang === 'en-GB');
    return ukFallback ?? null;
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    synthRef.current = window.speechSynthesis;

    const loadVoices = () => {
      const available = synthRef.current?.getVoices() ?? [];
      if (available.length === 0) return;
      setVoices(available);
      setSelectedVoiceURI((current) => {
        if (current) return current; // don't override a user's manual pick
        const preferred = pickDefaultVoice(available);
        return preferred?.voiceURI ?? '';
      });
    };

    loadVoices();
    // Chrome loads voices asynchronously the first time
    synthRef.current.addEventListener('voiceschanged', loadVoices);

    return () => {
      synthRef.current?.removeEventListener('voiceschanged', loadVoices);
      synthRef.current?.cancel();
    };
  }, []);

  // Extract text from uploaded PDF file
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsParsing(true);
    try {
      // Load pdfjs-dist only in the browser — it touches DOM APIs at import
      // time and must never be evaluated during server-side rendering/build.
      const pdfjsLib = await import('pdfjs-dist');
      pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

      let fullText = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const tokenized = await page.getTextContent();
        const pageText = tokenized.items.map((item: any) => item.str).join(' ');
        fullText += pageText + ' ';
      }

      // Chunk into sentences (~200 chars) to avoid buffer timeouts
      const sentences = fullText.match(/[^.!?]+[.!?]+/g) || [fullText];
      setChunks(sentences);
      setCurrentChunk(0);
      setFileName(file.name);
    } catch (err) {
      console.error('Failed to parse PDF:', err);
      setFileName('');
    } finally {
      setIsParsing(false);
    }
  };

  // Playback handler. Reads chunks/selectedVoiceURI from refs kept in sync
  // below, so the recursive onend callback always sees current values
  // instead of a stale closure from when playback started.
  const chunksRef = useRef<string[]>([]);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const speedRef = useRef<number>(1);
  useEffect(() => { chunksRef.current = chunks; }, [chunks]);
  useEffect(() => {
    voiceRef.current = voices.find((v) => v.voiceURI === selectedVoiceURI) ?? null;
  }, [voices, selectedVoiceURI]);
  useEffect(() => { speedRef.current = speed; }, [speed]);

  // Estimated seconds to speak each sentence at the current speed, based on
  // its word count. This is what powers the time-based progress display.
  const chunkDurations = chunks.map((chunk) => {
    const wordCount = chunk.trim().split(/\s+/).filter(Boolean).length;
    const secondsAt1x = (wordCount / WORDS_PER_MINUTE_AT_1X) * 60;
    return secondsAt1x / speed;
  });
  const totalDuration = chunkDurations.reduce((sum, d) => sum + d, 0);
  const elapsedBeforeCurrent = chunkDurations
    .slice(0, currentChunk)
    .reduce((sum, d) => sum + d, 0);
  const elapsedSeconds =
    elapsedBeforeCurrent + Math.min(chunkElapsed, chunkDurations[currentChunk] ?? 0);

  // Tick the in-chunk elapsed counter once a second while actually playing.
  useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(() => setChunkElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [isPlaying]);

  // Reset the in-chunk counter whenever the current sentence changes,
  // whether from natural progression or a seek.
  useEffect(() => {
    setChunkElapsed(0);
  }, [currentChunk]);

  const playChunk = (index: number) => {
    const currentChunks = chunksRef.current;
    if (!synthRef.current || index >= currentChunks.length) {
      setIsPlaying(false);
      return;
    }

    synthRef.current.cancel(); // Clear previous queue
    const utterance = new SpeechSynthesisUtterance(currentChunks[index]);

    if (voiceRef.current) utterance.voice = voiceRef.current;
    utterance.rate = speedRef.current;

    utterance.onend = () => {
      if (index + 1 < currentChunks.length) {
        setCurrentChunk(index + 1);
        playChunk(index + 1);
      } else {
        setIsPlaying(false);
      }
    };

    synthRef.current.speak(utterance);
    setIsPlaying(true);
  };

  const togglePlayPause = () => {
    if (!synthRef.current) return;

    if (isPlaying) {
      synthRef.current.pause();
      setIsPlaying(false);
    } else {
      if (synthRef.current.paused && !synthRef.current.speaking) {
        // Nothing queued (e.g. after a seek) — start fresh from currentChunk
        // rather than trying to resume a cancelled utterance.
        if (chunksRef.current.length > 0) playChunk(currentChunk);
      } else if (synthRef.current.paused) {
        synthRef.current.resume();
        setIsPlaying(true);
      } else if (chunks.length > 0) {
        playChunk(currentChunk);
      }
    }
  };

  // Jump playback to a specific sentence — used by both the click-to-seek
  // text and the progress slider. Restarts speech immediately if it was
  // already playing; otherwise just moves the cursor for the next Play.
  const seekTo = (index: number) => {
    if (!synthRef.current) return;
    const wasPlaying = isPlaying;
    synthRef.current.cancel();
    setCurrentChunk(index);
    if (wasPlaying) {
      playChunk(index);
    } else {
      setIsPlaying(false);
    }
  };

  const resetPlayback = () => {
    if (synthRef.current) synthRef.current.cancel();
    setCurrentChunk(0);
    setIsPlaying(false);
  };

  // Speech rate can't be changed on an utterance that's already speaking, so
  // when the user drags the speed slider mid-playback we restart just the
  // current sentence at the new rate rather than waiting for the next one.
  const handleSpeedChange = (newSpeed: number) => {
    setSpeed(newSpeed);
    speedRef.current = newSpeed;
    if (isPlaying) {
      synthRef.current?.cancel();
      playChunk(currentChunk);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      {/* File Upload Zone */}
      <div className="border-2 border-dashed border-zinc-700 hover:border-indigo-500 rounded-xl p-8 text-center transition">
        <input
          type="file"
          accept="application/pdf"
          onChange={handleFileUpload}
          id="pdf-upload"
          className="hidden"
        />
        <label htmlFor="pdf-upload" className="cursor-pointer flex flex-col items-center gap-2">
          <Upload className="w-8 h-8 text-indigo-400" />
          <span className="font-medium text-zinc-200">
            {isParsing
              ? 'Extracting text...'
              : fileName
              ? fileName
              : 'Upload PDF Document'}
          </span>
          {fileName && !isParsing && (
            <span className="text-xs text-zinc-500">Click to upload a different file</span>
          )}
        </label>
      </div>

      {/* Controls Bar */}
      {chunks.length > 0 && (
        <div className="flex items-center justify-between bg-zinc-900 border border-zinc-800 p-4 rounded-xl">
          <div className="flex items-center gap-3">
            <button
              onClick={togglePlayPause}
              className="p-3 bg-indigo-600 hover:bg-indigo-500 rounded-full text-white transition"
            >
              {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
            </button>
            <button
              onClick={resetPlayback}
              className="p-3 bg-zinc-800 hover:bg-zinc-700 rounded-full text-zinc-300 transition"
            >
              <RotateCcw className="w-5 h-5" />
            </button>
          </div>

          <div className="text-sm text-zinc-400 text-right">
            {formatDuration(elapsedSeconds)} of {formatDuration(totalDuration)}
          </div>
        </div>
      )}

      {/* Speed Control */}
      {chunks.length > 0 && (
        <div className="flex items-center gap-3 text-sm">
          <label htmlFor="speed-select" className="text-zinc-400 shrink-0">
            Speed
          </label>
          <input
            id="speed-select"
            type="range"
            min={0.5}
            max={2}
            step={0.25}
            value={speed}
            onChange={(e) => handleSpeedChange(Number(e.target.value))}
            className="w-full accent-indigo-500"
          />
          <span className="text-zinc-300 w-12 text-right tabular-nums">{speed}x</span>
        </div>
      )}

      {/* Progress Slider */}
      {chunks.length > 1 && (
        <input
          type="range"
          min={0}
          max={chunks.length - 1}
          value={currentChunk}
          onChange={(e) => seekTo(Number(e.target.value))}
          className="w-full accent-indigo-500"
          aria-label="Seek to sentence"
        />
      )}

      {/* Voice Picker */}
      {voices.length > 0 && (
        <div className="flex items-center gap-3 text-sm">
          <label htmlFor="voice-select" className="text-zinc-400 shrink-0">
            Voice
          </label>
          <select
            id="voice-select"
            value={selectedVoiceURI}
            onChange={(e) => setSelectedVoiceURI(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200"
          >
            {voices.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.name} ({v.lang})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Text Display */}
      {chunks.length > 0 && (
        <div className="bg-zinc-900/50 border border-zinc-800 p-6 rounded-xl max-h-96 overflow-y-auto leading-relaxed text-zinc-300">
          {chunks.map((chunk, idx) => (
            <span
              key={idx}
              onClick={() => seekTo(idx)}
              className={`cursor-pointer hover:bg-zinc-800 rounded transition ${
                idx === currentChunk ? 'bg-indigo-900/60 text-indigo-200 font-medium px-1' : ''
              }`}
            >
              {chunk}{' '}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
