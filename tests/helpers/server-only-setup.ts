import { vi } from "vitest";

// This dedicated PostgreSQL suite runs real server modules; only Next's marker is stubbed.
vi.mock("server-only", () => ({}));
