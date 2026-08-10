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

  // Extract text from uploaded
