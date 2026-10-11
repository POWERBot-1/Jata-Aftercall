/** Configuration format version, independent of monotonically increasing draft/publication revisions. */
export const EXPERIENCE_SCHEMA_VERSION = 1 as const;

export class UnsupportedExperienceVersionError extends Error {
  constructor() {
    super("This website uses an unsupported experience format. Nothing was changed.");
    this.name = "UnsupportedExperienceVersionError";
  }
}

/** Missing version is the original legacy-v1 format. Explicit versions are never clamped or guessed. */
export function supportedExperienceVersion(value: unknown): typeof EXPERIENCE_SCHEMA_VERSION {
  if (value === undefined || value === EXPERIENCE_SCHEMA_VERSION) return EXPERIENCE_SCHEMA_VERSION;
  throw new UnsupportedExperienceVersionError();
}
