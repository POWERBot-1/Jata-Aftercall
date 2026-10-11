/** Configuration format version, independent of draft/publication revisions. v1 remains unchanged. */
export const EXPERIENCE_SCHEMA_VERSION = 2 as const;
export const SUPPORTED_EXPERIENCE_SCHEMA_VERSIONS = [1, 2] as const;
export type ExperienceSchemaVersion = typeof SUPPORTED_EXPERIENCE_SCHEMA_VERSIONS[number];
export class UnsupportedExperienceVersionError extends Error {
  constructor() {
    super("This website uses an unsupported experience format. Nothing was changed.");
    this.name = "UnsupportedExperienceVersionError";
  }
}
export function isSupportedExperienceVersion(value: unknown): value is ExperienceSchemaVersion {
  return value === 1 || value === 2;
}
/** Missing version is explicitly original v1, never the latest/new composition schema. */
export function supportedExperienceVersion(value: unknown): ExperienceSchemaVersion {
  if (value === undefined) return 1;
  if (isSupportedExperienceVersion(value)) return value;
  throw new UnsupportedExperienceVersionError();
}
