"use client";

/**
 * Create — the creative workspace (Website Studio creative engine).
 *
 * One prominent command field: type or speak what you want, optionally point at one of your
 * photos, and JATA says in plain language what it understood before anything is spent.
 * Generation runs through `/api/studio/creative`, which answers with an honest state —
 * completed only when a real asset exists, unavailable/unsupported otherwise. This screen
 * never displays a placeholder as a "result".
 *
 * Speech uses the browser's own recognition only where the browser offers it (e.g. Chrome
 * on Android). The mic button explains itself when speech is not supported and surfaces
 * permission errors instead of failing silently.
 */
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, Image as ImageIcon, Loader2, Mic, MicOff, RefreshCw, Sparkles, Wand2 } from "lucide-react";
import {
  CREATIVE_EXAMPLES, MEDIA_TYPE_LABELS, parseCreativeInstruction,
  type CreativeMediaType,
} from "@/lib/creative/intent";
import type { CreativeCapability, CreativeCapabilityMatrix } from "@/lib/creative/capabilities";

type Asset = { id: string; url: string; alt?: string | null; label?: string | null };
type JobState = "idle" | "working" | "completed" | "failed" | "unavailable" | "unsupported" | "needs-input";

const TYPE_CHIPS: Array<CreativeMediaType | "auto"> = ["auto", "hero", "poster", "product", "edit", "animation", "video"];

type SpeechRecognitionLike = {
  lang: string; interimResults: boolean; continuous: boolean;
  start: () => void; stop: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

function speechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  const ctor = (w.SpeechRecognition || w.webkitSpeechRecognition) as (new () => SpeechRecognitionLike) | undefined;
  return typeof ctor === "function" ? ctor : null;
}

export function CreativeStudio({ businessId }: { businessId: string }) {
  const [instruction, setInstruction] = useState("");
  const [mediaType, setMediaType] = useState<CreativeMediaType | "auto">("auto");
  const [library, setLibrary] = useState<Asset[]>([]);
  const [reference, setReference] = useState<Asset | null>(null);
  const [matrix, setMatrix] = useState<CreativeCapabilityMatrix | null>(null);
  const [job, setJob] = useState<JobState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [results, setResults] = useState<Asset[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [listening, setListening] = useState(false);
  const [speechSupported] = useState<boolean>(() => speechRecognitionCtor() !== null || typeof window === "undefined");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const intent = useMemo(
    () => parseCreativeInstruction(instruction, { hasReferenceImage: Boolean(reference), forcedMediaType: mediaType }),
    [instruction, mediaType, reference],
  );

  const loadCapabilities = useCallback(async () => {
    try {
      const response = await fetch(`/api/studio/creative?businessId=${encodeURIComponent(businessId)}`, { cache: "no-store" });
      const data = await response.json().catch(() => null);
      if (response.ok && data) setMatrix(data as CreativeCapabilityMatrix);
    } catch { /* the conservative copy below covers an unreachable capability check */ }
  }, [businessId]);

  const loadLibrary = useCallback(async () => {
    try {
      const response = await fetch(`/api/media?businessId=${encodeURIComponent(businessId)}&limit=24`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      setLibrary(Array.isArray(data.assets) ? data.assets : []);
    } catch { setLibrary([]); }
  }, [businessId]);

  useEffect(() => { void loadCapabilities(); void loadLibrary(); }, [loadCapabilities, loadLibrary]);

  function toggleSpeech() {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const Ctor = speechRecognitionCtor();
    if (!Ctor) {
      setMessage("This browser does not support speaking instructions. Typing the same words works exactly the same.");
      return;
    }
    try {
      const recognition = new Ctor();
      recognition.lang = "en-KE";
      recognition.interimResults = false;
      recognition.continuous = false;
      recognition.onresult = (event) => {
        const transcript = event.results?.[0]?.[0]?.transcript?.trim();
        if (transcript) setInstruction((current) => (current ? `${current} ${transcript}` : transcript));
      };
      recognition.onerror = (event) => {
        setListening(false);
        setMessage(event.error === "not-allowed"
          ? "The microphone was not allowed. Allow microphone access in your browser, or type your instruction instead."
          : "Speech was not understood this time. Try again somewhere quieter, or type your instruction.");
      };
      recognition.onend = () => setListening(false);
      recognitionRef.current = recognition;
      recognition.start();
      setListening(true);
      setMessage(null);
    } catch {
      setMessage("Speech could not start on this device. Typing works the same.");
    }
  }

  async function generate(refresh: boolean) {
    setJob("working");
    setMessage(null);
    setNotes([]);
    if (!refresh) setResults([]);
    try {
      const response = await fetch("/api/studio/creative", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId,
          instruction,
          mediaType,
          referenceAssetId: reference?.id ?? null,
          refresh,
        }),
      });
      const data = await response.json().catch(() => ({}));
      const status = (data.status as JobState) || (response.ok ? "completed" : "failed");
      if (status === "completed") {
        setResults(Array.isArray(data.assets) ? data.assets : []);
        setNotes(Array.isArray(data.notes) ? data.notes : []);
        setJob("completed");
        setMessage("Done. Nothing is on your website yet — choose where an image should go from Photos when you are happy with it.");
        void loadLibrary();
      } else if (status === "needs-input") {
        setJob("needs-input");
        setMessage(data.followUp || "A little more detail will help.");
      } else if (status === "unsupported" || status === "unavailable") {
        setJob(status);
        setMessage(data.capability?.reason || data.error || "That is not available in this deployment yet.");
        if (data.suggestion) setNotes([String(data.suggestion)]);
      } else {
        setJob("failed");
        setMessage(data.error || "That did not work this time. Your website and photos are safe — try again.");
      }
    } catch {
      setJob("failed");
      setMessage("We couldn't reach JATA. Check your connection and try again.");
    }
  }

  const generationCapability: CreativeCapability | undefined = matrix?.capabilities.find((c) => c.key === "image-generation");

  return (
    <div className="space-y-4">
      <section className="jata-card" aria-label="Create with a command">
        <h2 className="flex items-center gap-2 text-base font-bold"><Wand2 size={17} aria-hidden="true" /> What shall we create?</h2>
        <p className="mt-1 text-sm text-zinc-600">Say it your own way. JATA uses your business type, colours and the photo you pick — and only offers what is actually switched on.</p>

        <label className="jata-field mt-3">
          <span className="jata-label">Your instruction</span>
          <textarea
            className="jata-input min-h-[84px] text-base"
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder="Create a premium poster advertising my weekend offer…"
            aria-describedby="creative-understood"
          />
        </label>
        <p id="creative-understood" className="mt-1 text-sm text-zinc-600" role="status">
          {instruction.trim() ? <>JATA understands: <strong>{intent.understood}</strong></> : "JATA will show you what it understood before creating anything."}
        </p>

        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="What to make">
          {TYPE_CHIPS.map((chip) => (
            <button key={chip} type="button" aria-pressed={mediaType === chip}
              onClick={() => setMediaType(chip)} className="jata-btn jata-btn-ghost">
              {chip === "auto" ? "✨ Work it out for me" : MEDIA_TYPE_LABELS[chip]}
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className="jata-btn jata-btn-primary" disabled={job === "working" || !instruction.trim()}
            onClick={() => void generate(false)}>
            {job === "working" ? <><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Creating…</> : <><Sparkles size={15} aria-hidden="true" /> Generate</>}
          </button>
          <button type="button" className="jata-btn jata-btn-secondary" onClick={toggleSpeech}
            aria-pressed={listening} title={speechSupported ? "Speak your instruction" : "Speech is not supported in this browser"}>
            {listening ? <><MicOff size={15} aria-hidden="true" /> Stop</> : <><Mic size={15} aria-hidden="true" /> Speak</>}
          </button>
          {job === "completed" || job === "failed" ? (
            <button type="button" className="jata-btn jata-btn-secondary" onClick={() => void generate(true)}>
              <RefreshCw size={15} aria-hidden="true" /> {job === "failed" ? "Try again" : "Make other options"}
            </button>
          ) : null}
        </div>

        {!instruction.trim() ? (
          <div className="mt-3 flex flex-wrap gap-2" aria-label="Examples">
            {CREATIVE_EXAMPLES.map((example) => (
              <button key={example} type="button" className="rounded-full border px-3 py-1.5 text-left text-xs font-semibold"
                onClick={() => setInstruction(example)}>{example}</button>
            ))}
          </div>
        ) : null}

        {job === "working" ? (
          <div className="mt-3" role="status" aria-live="polite">
            <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100"><div className="h-full w-1/2 animate-pulse bg-zinc-900" /></div>
            <p className="mt-1 text-xs text-zinc-600">Creating… good images can take a minute. Keep this page open.</p>
          </div>
        ) : null}

        {message ? (
          <div className={`mt-3 rounded-xl border p-3 ${job === "completed" ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`} role={job === "completed" ? "status" : "alert"}>
            <p className="text-sm text-zinc-800">{message}</p>
            {notes.map((note) => <p key={note} className="mt-1 text-sm text-zinc-600">{note}</p>)}
            {(job === "unavailable" || job === "unsupported") ? (
              <p className="mt-2 text-sm">
                In the meantime: <Link className="font-semibold underline" href={`/dashboard/businesses/${businessId}/photos`}>pick a ready image for your kind of business</Link> — those always work.
              </p>
            ) : null}
          </div>
        ) : null}

        {results.length > 0 ? (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2" aria-label="Created images">
            {results.map((asset) => (
              <li key={asset.id} className="overflow-hidden rounded-2xl border bg-white">
                <img src={asset.url} alt={asset.alt || "Created image"} className="aspect-[4/3] w-full object-cover" />
                <div className="flex items-center justify-between gap-2 px-3 py-2">
                  <span className="text-xs text-zinc-600">{asset.label === "REPRESENTATIVE" ? "Designed artwork — not a photo of your actual product" : "Saved to your gallery"}</span>
                  <Link className="jata-btn jata-btn-secondary" href={`/dashboard/businesses/${businessId}/photos`}><Check size={14} aria-hidden="true" /> Use from Photos</Link>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="jata-card" aria-label="Use one of my photos">
        <h2 className="flex items-center gap-2 text-sm font-bold"><ImageIcon size={15} aria-hidden="true" /> Start from my photo</h2>
        <p className="mt-1 text-sm text-zinc-600">Pick a photo, then ask for changes above — for example “improve the lighting and background of this photo”. The original is always kept.</p>
        {library.length === 0 ? (
          <p className="jata-hint mt-2">No saved photos yet. Add photos from the Photos tab, or use the ready images there.</p>
        ) : (
          <ul className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {library.map((asset) => (
              <li key={asset.id} className="shrink-0">
                <button type="button" aria-pressed={reference?.id === asset.id}
                  onClick={() => setReference((current) => (current?.id === asset.id ? null : asset))}
                  className={`block overflow-hidden rounded-xl border ${reference?.id === asset.id ? "border-zinc-900 ring-2 ring-zinc-900" : ""}`}>
                  <img src={asset.url} alt={asset.alt || "My photo"} className="h-20 w-20 object-cover" loading="lazy" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="jata-hint mt-2">
          On-phone improvement (light, colour, crop) lives in <Link className="underline" href={`/dashboard/businesses/${businessId}/photos`}>Photos → Improve a photo</Link>.
        </p>
      </section>

      <section className="jata-card" aria-label="What Create can do here">
        <h2 className="text-sm font-bold">What Create can do here</h2>
        {!matrix ? (
          <p className="mt-1 text-sm text-zinc-600">Checking what is switched on… If this does not load, treat generation as unavailable and use the ready images in Photos.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {matrix.capabilities.map((capability) => (
              <li key={capability.key} className="flex items-start justify-between gap-3 rounded-xl border bg-white px-3 py-2">
                <span>
                  <span className="block text-sm font-semibold">{capability.label}</span>
                  <span className="block text-xs text-zinc-600">{capability.reason}</span>
                </span>
                <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-bold ${capability.state === "available" ? "bg-emerald-100 text-emerald-800" : capability.state === "browser-dependent" ? "bg-amber-100 text-amber-800" : "bg-zinc-100 text-zinc-600"}`}>
                  {capability.state === "available" ? "Available" : capability.state === "browser-dependent" ? "Depends on browser" : "Not yet"}
                </span>
              </li>
            ))}
          </ul>
        )}
        {generationCapability && generationCapability.state !== "available" ? (
          <p className="jata-hint mt-2">{generationCapability.reason}</p>
        ) : null}
      </section>
    </div>
  );
}

export default CreativeStudio;
