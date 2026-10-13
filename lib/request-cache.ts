import * as React from "react";

/**
 * Request-scoped memoisation (React `cache`) — M11 / hydration #418 fix.
 *
 * Next.js aliases `react` to its bundled React 19 inside the app runtime, which
 * exports `cache`; the workspace `react` package (18.x, used by vitest) does
 * not. Fall back to an identity wrapper there so importing this module is safe
 * outside the Next server — the app runtime always gets real deduplication.
 *
 * WHY (root cause, proven in docs/WEBSITE_STUDIO_HYDRATION_INVESTIGATION.md):
 * when `generateMetadata` and the page body each run their own DB loads, the
 * root segment is still pending when Fizz first flushes. Fizz then emits the
 * `script#_R_` + Flight/bootstrap scripts right after `<body>` (its
 * "pending tasks" branch), BEFORE the content divs. React's body-level
 * hydration walk cannot skip those leading scripts in non-root context and
 * throws #418 on the first expected `div`. Sharing ONE load per request makes
 * the root segment complete with the metadata: the head cannot close while
 * metadata is pending, and Fizz writes `</head>` and the root segment in the
 * same flush — so the bootstrap scripts always land AFTER the content and the
 * mismatch becomes impossible by construction.
 */
type CacheFn = <T extends (...args: never[]) => unknown>(fn: T) => T;

const identity: CacheFn = (fn) => fn;
const reactCache = (React as unknown as { cache?: CacheFn }).cache;

export const requestCache: CacheFn = reactCache ?? identity;
