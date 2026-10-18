# BE-008 — Grid placement in profiles

Upstream: REQ-008 and DES-008.

Add optional grid cell coordinates/size to each workspace Poll placement and bump profile schema to 4. Preserve the old rectangle for schema 1–3 migration. Validate bounded positive grid geometry and atomically reject future/invalid profiles. Regenerate ts-rs bindings. Do not change Modbus commands or poll data.
