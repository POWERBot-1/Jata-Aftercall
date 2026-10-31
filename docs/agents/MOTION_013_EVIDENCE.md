# MOTION-013 browser evidence — preliminary findings

**MOTION ACCEPTANCE BLOCKED — DO NOT MERGE OR DEPLOY.**

The prior exact-head Chrome run [41221169668](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/41221169668) tested `9acb1d83a889a22865536e9ffa75c2931a447314` on Chrome/156.0.8078.47 with a disposable PostgreSQL service and reported 48 rows. Its check-run annotation records classic `motion / eligible` and `lite / reduced-motion`, AI preview `lite / owner-lite`, and no motion scope for denial and not-found. **The capture job FAILED**: 0 recordings were produced and all 48 rows failed the recording-required criterion. This does not prove visual preservation, queue behavior, complete route coverage, successful AI motion, or independently reviewed evidence.

The job uploaded its partial artifact on the run page. A download attempt for the prior `992e832` artifact redirected to a blob host blocked by this sandbox's egress policy, so no screenshots or videos have been independently inspected here. A GitHub user with artifact access may retrieve the run's artifact; that availability is not a visual review. No customer data or production changes are involved.

The capture checks Puppeteer's `page.screencast`, which requires ffmpeg. The prior annotation did not include the per-row encoder exception, so the root cause is not established. The updated workflow ensures ffmpeg is installed in the disposable CI runner and prints distinct recording/capture exceptions in the check annotation. Missing or empty recordings still fail closed. Retest is needed; a green capture is still only partial coverage.

The complete coverage matrix remains in `MOTION_011_COVERAGE_MATRIX.md`: generated/published families, authenticated commerce paths, AI published path, visual before/after comparison, queue/re-entry/cleanup and independent inspection are still NOT TESTED for acceptance. A default-disabled AI preview on a classic seeded site is not a test of an enabled AI renderer with an actual Studio theme.
