# App controllers

`App.tsx` remains the composition/orchestration owner for the legacy frontend state, but derived and cross-cutting controller logic is kept here instead of growing the root component.

Rules:

- do not duplicate API retry/cache/idempotency logic in `App.tsx`; keep it in `useApiClient`;
- keep extracted hook order stable unless a behavior change is intentional and covered by a dedicated migration/acceptance step;
- prefer typed argument/return contracts over `Record<string, any>` for controller hooks;
- do not move a `useState`/`useEffect` owner merely to reduce line count; lifecycle ownership is a behavior contract;
- Step 190.6B preservation tests flatten the extracted custom hooks and compare them with the accepted 190.6A hook sequence.
