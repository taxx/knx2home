# AGENTS.md

Agentic coding guide for contributors working on **knx2home** (AI-assisted development, LLM tools, and human maintainers).

This file gives LLM agents and humans the context needed to work on this codebase efficiently. Read it before making changes.

## Project overview

**knx2home** is a Next.js application that converts KNX configuration files (ETS projects) into Home Assistant compatible YAML configuration. It detects entities (lights, switches, covers, sensors, scenes, time/date, etc.), matches KNX group addresses with DPT metadata, and generates ready-to-use Home Assistant `knx:` YAML.

Key characteristics:

- **100% client-side.** Parsing happens in a Web Worker; there are no API route handlers, no server components, and no backend. The app can be deployed as a static export.
- Built with Next.js 16 (Turbopack), React 19, TypeScript (strict), Tailwind CSS 4, shadcn-style UI primitives (Radix), and CodeMirror for YAML preview.
- The CI pipeline builds a static export (`./out`) and publishes it to GitHub Pages.

## Architecture / data flow

```
.knxproj file (uploaded)
        │
        ▼
KnxUpload.tsx (dropzone) ──► useKnxWorker (hook) ──► knxParser.worker.ts (Web Worker)
        │
        ▼
parse.ts: parseKnxproj()
  1. unzip() outer archive with fflate, filter for *.xml + P-*.zip
  2. extractNestedXml() decrypts any encrypted P-*.zip (ETS6) and merges XML
  3. XMLParser (fast-xml-parser) parses project.xml / 0.xml / knx_master.xml
  4. heuristics.ts / map.ts classify entities
  5. aggregate.ts builds logical sets
  6. export.ts produces Home Assistant YAML
        │
        ▼
KnxCatalog (typed result) → UI table / preview / export wizard
```

- `useKnxWorker` posts a message to the worker and returns a promise; the worker runs the whole `parseKnxproj` pipeline and posts back `{ t: "result", catalog }` or an error.
- The UI is a multi-step workflow: upload → parse → configure/override → export (YAML single file or ZIP per domain).

## Directory map (src/)

| Path | Purpose |
|------|---------|
| `lib/knx/parse.ts` | Entry point `parseKnxproj(file, opts)`; unzip, XML extraction, entity building |
| `lib/knx/ets6.ts` | ETS6 password-protected decryption (WinZip AES, Web Crypto) |
| `lib/knx/heuristics.ts` | Entity type classification heuristics |
| `lib/knx/map.ts` | Maps parsed XML to typed entities/group addresses |
| `lib/knx/aggregate.ts` | Combines related entities into aggregate sets |
| `lib/knx/export.ts` | YAML generation (single file / per-domain ZIP) |
| `lib/knx/sensorMeta.ts`, `lib/knx/utils.ts` | DPT/sensor metadata and shared helpers |
| `lib/types/` | Shared TypeScript types (`KnxCatalog`, `ParseProgress`, ...) |
| `lib/utils/` | `config.ts` (project config), `download.ts` (file download helpers) |
| `components/KnxUpload.tsx` | Main import workflow UI; owns the parse state machine |
| `components/knx/OptionsBar.tsx` | Options row incl. **project password input** |
| `hooks/useKnxWorker.ts` | Bridges UI ↔ worker |
| `workers/knxParser.worker.ts` | Runs `parseKnxproj` off the main thread |

## Key commands

```bash
npm install        # install deps
npm run dev        # dev server (Turbopack) on :3000
npm run build      # production build (Turbopack)
npm run start      # run built app
npm run test       # jest (--watch: npm run test-watch)
npx jest --config jest.config.cjs <path>   # targeted test
npx tsc --noEmit   # typecheck
npm run lint       # eslint
```

## Conventions & gotchas

- **TypeScript strict**; `noEmit: true` (compiled by Next/Turbopack). `@/*` maps to `src/*`.
- **Tests**: Jest + ts-jest. Tests live next to code under `src/lib/knx/__tests__/`. Synthetic archives and fixtures are built inline — do not depend on `/Volumes/...` or other machine-specific paths in committed tests.
- **Do not write a custom AES implementation.** Use the Web Crypto API (`crypto.subtle`) for PBKDF2 and AES — `crypto.subtle` supports SHA-1 in PBKDF2 on all modern browsers/Node/Web Workers.
- The `about/page.tsx` file uses `LucideIcon` (not raw `JSX.Element`) — React 19 removed the global `JSX` namespace; import `type { JSX } from "react"` if needed.
- fflate: `compressSync` emits gzip, not raw DEFLATE — use `deflateSync` for raw deflate. `inflateSync` handles raw deflate; there is no `inflateRawSync` export.

## KNX / ETS domain notes

- An ETS project file (`*.knxproj`) is a ZIP whose outer archive contains `P-<hex>.zip`, `knx_master.xml`, `*.signature`, `.validation`, etc. The actual project XML (`project.xml`, `0.xml`) lives **inside** `P-<hex>.zip`, not in the outer archive.
- Passwordless projects have a plain `P-<hex>.zip`; protected projects encrypt that inner archive with WinZip AES (AE-2).
- ETS6 decryption recipe (matches `ffs.py`):
  1. Zip password = `base64(PBKDF2-HMAC-SHA256(pw_utf16le, salt="21.project.ets.knx.org", 65536 iters, 32 bytes))`
  2. Per-file key material = `PBKDF2-HMAC-SHA1(zipPwd, fileSalt, 1000 iters, 66 bytes)` → AES key `[0:32]`, MAC key `[32:64]`, password check `[64:66]`
  3. File layout inside the inner zip local header: `salt(16) ‖ pwd_verify(2) ‖ AES-CTR ciphertext ‖ HMAC-SHA1(10)`
  4. AES-256-CTR uses a 128-bit **little-endian counter starting at 1** (WinZip AE-2). Web Crypto's AES-CTR increments a big-endian counter, so decrypt each 16-byte block with an explicit little-endian counter block.
  5. Decrypted payload is **raw DEFLATE** (no zlib header).

## Deployment

Two paths:

1. **Static export (CI / GitHub Pages)**: `output: "export"` in `next.config.ts`; CI uploads `./out`.
2. **Docker**: multi-stage build that runs `npm ci` → `npm run build` → serves the static `out/` with a tiny Node static file server (`docker/server.js`). See `docker-compose.yml` for a one-command local deploy (`docker compose up --build`).

## Status

- ETS6 password-protected files: supported (Web Crypto, verified byte-for-byte against a passwordless reference). Password is entered in the Options bar and threaded through the worker to `parseKnxproj`.
- Known pre-existing issue: none in `src/`; `about/page.tsx` JSX typing fixed.
