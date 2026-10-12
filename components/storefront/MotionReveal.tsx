/**
 * Server-rendered recipe marker. Always visible, including before hydration and without scripts.
 * The single scoped controller enhances this wrapper only after it enters the viewport.
 */
import type { ReactNode } from "react";
import { motionRecipeForSection } from "@/lib/experience/motionRecipes";
import type { SectionType } from "@/lib/experience/types";

export function MotionReveal({ children, expressive = false, sectionType }: { children: ReactNode; expressive?: boolean; sectionType?: SectionType }) {
  return <div className="eb-reveal" data-motion-recipe={motionRecipeForSection(sectionType, expressive)}>{children}</div>;
}
