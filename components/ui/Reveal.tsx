"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

/**
 * Reveal — the platform's only entrance animation.
 *
 * Rules enforced here:
 *   • Reduced motion is honoured through `useReducedMotion()`, so a customer who disabled
 *     animation gets the content immediately with no movement at all.
 *   • The animation is opacity/translate only and cannot move a control the customer is about
 *     to press: reveal completes in under 300ms and never wraps a form or a checkout action.
 *   • `once` keeps the cost to first paint; nothing animates on scroll in a POS till.
 */
export function Reveal({
  children,
  delay = 0,
  className,
  as = "div",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: "div" | "li" | "article";
}) {
  const reduced = useReducedMotion();
  const MotionTag = motion[as];
  if (reduced) return <MotionTag className={className}>{children}</MotionTag>;
  return (
    <MotionTag
      className={className}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, delay: Math.min(delay, 0.2), ease: [0.22, 0.61, 0.36, 1] }}
    >
      {children}
    </MotionTag>
  );
}

export default Reveal;
