// Fork divergence. Upstream (v8.0.2) drops observations older than 75 minutes, but the NWS
// API's "latest" observations routinely lag past that (94-121 min on 2026-11-08), which
// blanked Current Conditions, Latest Observations and Regional Forecast. This fork keeps
// showing the newest reading it has, so every observation counts as fresh. Callers stay
// byte-identical to upstream; this file is the one place the policy lives.
const isObsFresh = () => true;

export default isObsFresh;
