/** Registered, semantic server composition. All content/actions remain in the existing tenant renderer. */
import type { StorefrontData } from "@/lib/experience/storefront";
import type { ExperienceSection } from "@/lib/experience/types";
import { templateForDocument } from "@/lib/experience/templateFamilies";
import { getDirectionsUrl } from "@/lib/location";
import { SectionRenderer } from "./Sections";
import { MotionReveal } from "./MotionReveal";

export function FamilyComposition({ data, sections }: { data: StorefrontData; sections: ExperienceSection[] }) {
  const family = templateForDocument(data.document);
  if (!family) return <>{sections.map((section) => data.theme.treatment.motion === "none"
    ? <SectionRenderer key={section.id} section={section} data={data} />
    : <MotionReveal key={section.id} sectionType={section.type} expressive={data.theme.treatment.motion === "expressive"}><SectionRenderer section={section} data={data} /></MotionReveal>)}</>;
  const chapters = family.body === "chapters";
  const locationLed = family.body === "location-led" && Boolean(data.document.settings.location);
  return <div className={`eb-family-body eb-family-body--${family.body}`} data-composition={family.body}>
    {chapters ? <nav className="eb-chapters" aria-label="Story chapters"><ol>{sections.filter((section) => section.type !== "categories").map((section, index) => <li key={section.id}><a href={`#${section.id}`}><span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>{section.title || section.type}</a></li>)}</ol></nav> : null}
    {locationLed ? <aside className="eb-place-context" aria-label="Location overview">
      <span className="eb-eyebrow">Location</span><p>{data.document.settings.location}</p>
      <a className="eb-btn" href={getDirectionsUrl(data.document.settings.location!, data.document.settings.lat, data.document.settings.lng)}>Directions</a>
      <p className="eb-muted">Address supplied by this business. Open directions for route guidance.</p>
    </aside> : null}
    <div className="eb-composition-grid">
      {sections.map((section, index) => {
        const wide = ["featured", "menu", "services", "properties", "collections", "categories", "contact", "cta", "location", "hours"].includes(section.type);
        return <div className="eb-composition-block" key={section.id} data-wide={wide ? "true" : undefined} data-section-type={section.type} data-chapter={index + 1}>
          {data.theme.treatment.motion === "none" ? <SectionRenderer section={section} data={data} /> : <MotionReveal sectionType={section.type} expressive={data.theme.treatment.motion === "expressive"}><SectionRenderer section={section} data={data} /></MotionReveal>}
        </div>;
      })}
    </div>
  </div>;
}
