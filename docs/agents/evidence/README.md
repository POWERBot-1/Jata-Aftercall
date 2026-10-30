# Local browser evidence — agent application, not an activated programme

These screenshots were captured from the local engine-less Next.js build, with database URLs unset and no live provider. They show the current public informational page and signed-out application/login paths; they do **not** demonstrate phone verification, agent activation, authenticated sales metrics, referral tracking, payments or commissions.

`landing-<width>x<height>.png` covers each requested viewport (320×568, 360×800, 390×844, 430×932, 768×1024, 1366×768). `application-signed-out-390x844.png` and `agent-login-390x844.png` show the signed-out flow. The browser check also confirmed the homepage agent link and anonymous dashboard redirect. It did not test keyboard navigation, contrast, authenticated pages or slow networks.

Command: `LD_LIBRARY_PATH=/tmp/agent-chromium/lib CHROME_PATH=/tmp/chromium npm run test:browser:agents`. The local Chromium 153 binary and NSS/NSPR shared libraries came from the same npm `@sparticuz/chromium@153.0.0` package, installed only under ignored `node_modules`; no dependency was added to the project. The build ran with no database URL and no production configuration. The local preview was stopped after the check.
