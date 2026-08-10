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
  const synthRef = useRef<SpeechSynthesis | null>(null);

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
    } catch (err) {
      console.error('Failed to parse PDF:', err);
    } finally {
      setIsParsing(false);
    }
  };

  // Playback handler. Reads chunks/selectedVoiceURI from refs kept in sync
  // below, so the recursive onend callback always sees current values
  // instead of a stale closure from when playback started.
  const chunksRef = useRef<string[]>([]);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  useEffect(() => { chunksRef.current = chunks; }, [chunks]);
  useEffect(() => {
    voiceRef.current = voices.find((v) => v.voiceURI === selectedVoiceURI) ?? null;
  }, [voices, selectedVoiceURI]);

  const playChunk = (index: number) => {
    const currentChunks = chunksRef.current;
    if (!synthRef.current || index >= currentChunks.length) {
      setIsPlaying(false);
      return;
    }

    synthRef.current.cancel(); // Clear previous queue
    const utterance = new SpeechSynthesisUtterance(currentChunks[index]);

    if (voiceRef.current) utterance.voice = voiceRef.current;

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
            {isParsing ? 'Extracting text...' : 'Upload PDF Document'}
          </span>
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

          <div className="text-sm text-zinc-400">
            Chunk {currentChunk + 1} of {chunks.length}
          </div>
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
