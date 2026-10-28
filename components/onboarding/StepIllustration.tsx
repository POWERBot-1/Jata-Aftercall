"use client";

/**
 * Onboarding step illustrations and guidance.
 *
 * Seven hand-drawn SVG scenes, one per setup step, drawn with the product's own tokens so they
 * follow the active appearance (light or graphite) instead of shipping a fixed-colour artwork.
 * They are decorative: every scene is `aria-hidden` and the guidance beside it carries the
 * meaning in text. The bullets say what the step actually asks for, so an owner can prepare
 * before starting rather than discovering the requirement halfway through.
 */

import { useId } from "react";

type Step = { title: string; hints: string[] };

const STEPS: Step[] = [
  { title: "Name your business", hints: ["The name customers already know", "The category that shapes your page"] },
  { title: "Add a contact", hints: ["A phone number customers can tap", "WhatsApp, if it differs from the phone"] },
  { title: "Show where you are", hints: ["Neighbourhood and landmark", "Optional map pin — never required"] },
  { title: "List what you sell", hints: ["Name and price for each item or service", "Skip now, add more whenever you like"] },
  { title: "Set the look", hints: ["A one-line description of what you do", "A style that matches your business"] },
  { title: "Choose a plan", hints: ["Payment opens publishing", "Nothing is charged until you confirm"] },
  { title: "Publish", hints: ["Preview the draft first", "Your page goes live only after payment"] },
];

function Scene({ step, tint }: { step: number; tint: string }) {
  const stroke = "currentColor";
  const common = { fill: "none", stroke, strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (step) {
    case 1: // shopfront with awning
      return (
        <g {...common}>
          <path d="M8 22h32v22H8z" />
          <path d="M8 22l4-8h24l4 8" />
          <path d="M8 22c0 3 2.6 5 5.3 5S18.7 25 18.7 22c0 3 2.6 5 5.3 5s5.3-2 5.3-5c0 3 2.7 5 5.4 5S40 25 40 22" />
          <path d="M18 44V32h12v12" />
          <circle cx="32" cy="38" r={0.9} fill={stroke} stroke="none" />
        </g>
      );
    case 2: // phone with a call wave
      return (
        <g {...common}>
          <rect x="15" y="8" width="18" height="32" rx="4" />
          <path d="M21 12h6" />
          <path d="M28.5 24c3.4.6 6 3.2 6.6 6.6" />
          <path d="M31.5 19.5c4.8 1 8.7 5 9.7 9.8" />
          <circle cx="24" cy="35" r={1.6} fill={tint} stroke="none" />
        </g>
      );
    case 3: // map pin over roads
      return (
        <g {...common}>
          <path d="M6 34c6-3 12-3 18 0s12 3 18 0" />
          <path d="M6 42c6-3 12-3 18 0s12 3 18 0" opacity="0.55" />
          <path d="M24 8c5 0 9 4 9 9 0 6.5-9 15-9 15s-9-8.5-9-15c0-5 4-9 9-9z" />
          <circle cx="24" cy="17" r="3.2" fill={tint} stroke="none" />
        </g>
      );
    case 4: // stacked catalogue cards with price tags
      return (
        <g {...common}>
          <rect x="9" y="12" width="16" height="14" rx="2.5" />
          <path d="M9 18h16" />
          <rect x="25" y="20" width="16" height="14" rx="2.5" />
          <path d="M25 26h16" />
          <path d="M13 31h8" />
          <path d="M29 39h8" />
          <circle cx="31" cy="16" r="0.9" fill={stroke} stroke="none" />
        </g>
      );
    case 5: // paint swatches
      return (
        <g {...common}>
          <path d="M12 12h12v12H12z" />
          <path d="M24 12h12v12H24z" fill={tint} stroke="none" />
          <path d="M12 24h12v12H12z" />
          <path d="M24 24h12v12H24z" />
          <path d="M14 41h20" opacity="0.5" />
        </g>
      );
    case 6: // plan card with a check
      return (
        <g {...common}>
          <rect x="9" y="14" width="30" height="22" rx="4" />
          <path d="M9 21h30" />
          <path d="M14 28h10" />
          <path d="M14 32h6" opacity="0.55" />
          <path d="M30 27.5l2.8 3 5.2-6" stroke={tint} strokeWidth={2.2} />
        </g>
      );
    case 7: // rocket / launch
    default:
      return (
        <g {...common}>
          <path d="M24 8c4.5 3.8 7 9.4 7 15 0 3.6-1.2 6.8-3 9h-8c-1.8-2.2-3-5.4-3-9 0-5.6 2.5-11.2 7-15z" />
          <circle cx="24" cy="20" r="2.8" fill={tint} stroke="none" />
          <path d="M17 27l-5 5 6-1" />
          <path d="M31 27l5 5-6-1" />
          <path d="M21 34c0 3 1.4 4.6 3 6 1.6-1.4 3-3 3-6" opacity="0.6" />
        </g>
      );
  }
}

export function StepIllustration({ step }: { step: number }) {
  const id = useId().replace(/[:]/g, "");
  const current = STEPS[Math.min(Math.max(step, 1), STEPS.length) - 1];
  const tint = `var(--jata-action)`;
  return (
    <section className="ob-step" aria-label="What this step needs">
      <svg viewBox="0 0 48 48" className="ob-step__scene" aria-hidden="true" style={{ color: "var(--jata-muted)" }}>
        <defs>
          <linearGradient id={`ob-fade-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--jata-action)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="var(--jata-action)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="48" height="48" rx="12" fill={`url(#ob-fade-${id})`} stroke="var(--jata-line)" />
        <Scene step={step} tint={tint} />
      </svg>
      <div className="ob-step__body">
        <p className="ob-step__title">{current.title}</p>
        <ul className="ob-step__hints">
          {current.hints.map((hint) => (
            <li key={hint}>{hint}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
