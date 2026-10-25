# API key form verification

Verified on October 25, 2026 against the local Docker installation at `http://localhost:34083`.

## Browser workflow

- Created `Form QA 2026-10-25` through the dashboard with read permission, four quotas (40/400/4000/40000), HTTPS required, expiration, two IP rules in deny mode, two website hostnames, allowed and blocked user-agent patterns, and GET/HEAD methods.
- Read the saved record through the administration API and reopened the form. All settings matched. Local `2027-10-25 12:00` correctly became `2027-10-25T08:30:00.000Z`.
- Edited the name, minute quota and HTTPS setting with advanced sections collapsed; existing rules remained intact.
- On the mobile form, enabled write permission, changed all four quotas, cleared expiration/domain/agent rules, selected IP allow mode and removed HEAD. Reopening and API inspection confirmed these changes.
- A zero quota was rejected by browser validation before submission.
- An unchanged expired date did not prevent saving other settings.
- Tested widths 390×844 and 320×740. At 320px, the expanded drawer's client width and scroll width both measured 319px: no horizontal overflow. Save remained accessible while scrolling. Restored the original viewport afterward.

## Live HTTP checks

| Scenario | Result |
| --- | --- |
| HTTPS-required key over HTTP | 403, HTTPS required |
| Matching origin and user agent | 200 |
| Wrong origin | 403 |
| Agent outside allowlist | 403 |
| Agent matching blocklist | 403 |
| Write without write permission | 403 |
| Read without read permission | 403 |
| IP outside allowlist | 403 |
| IP matching denylist | 403 |
| PUT excluded by methods | 403 |
| Empty method list, write enabled | 200; value stored |
| Empty optional restrictions | 200 |
| Each minute/hour/day/month quota reached, tested independently | 403 |
| Quotas cleared | 200 |
| Expired key | 401 |
| Disabled key | 401 |

Creation and the two complete edit rounds used the UI. Subsequent isolated enforcement cases used administration API patches on the same test key so each policy could be tested independently.

## Fixes and checks

- Explicitly disabled custom policy checkboxes during saving.
- Associated the IP-mode label with the native select using a unique ID; exact-label selection succeeded afterward.
- Dashboard typecheck, production build and all six dashboard tests passed.
- Copied the built dashboard into the running local E2E container. A future image build includes the source changes; the existing image itself was not rebuilt.
- Disabled the test key and deleted its test storage item. Existing application keys were unchanged. Temporary credential files were removed.

## Boundaries

Mobile checks used browser viewport emulation, not physical iOS/Android devices. HTTPS rejection was tested; positive TLS/proxy handling was not. Quota enforcement was tested, not calendar rollover scheduling. WebSocket policy behavior and secret rotation were outside this form-focused run.
