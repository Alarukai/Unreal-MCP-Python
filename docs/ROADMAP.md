# unreal-mcp Roadmap — Tier 1 (no C++ plugin required)

This is the actionable plan for improving communication with Unreal and closing
domain gaps **using only the existing Python Remote Execution / Remote Control
transports** — no C++ plugin needed. It is the output of a capability review of
a mature reference plugin, cross-checked against this server's actual tool
inventory.

Tier 2 (the C++ plugin work: real Blueprint graph editing, offscreen render
feedback, Blueprint debugging) lives in [`TIER2-PLUGIN.md`](./TIER2-PLUGIN.md).

## Guiding principles

1. **Python-first.** Every item below is achievable via `unreal.*` Python APIs
   over Python Remote Execution. Exact method names must be verified against the
   target UE version at implementation time (this plan was written without a
   live editor) — treat the listed APIs as the intended approach, not verified
   signatures.
2. **Close the feedback loop.** The single biggest weakness today is that the
   server executes and *hopes* — it captures Python `stdout`/exceptions but not
   what the editor logs C++-side. Read-back / inspect / log tools turn
   "write and hope" into "write, read the real editor feedback, self-correct."
3. **Every new tool follows existing conventions:** Zod schema, `inlineScript`
   with `{{var}}` escaped substitution (never raw `${var}`), `readOnlyHint` /
   `destructiveHint` annotations where they apply, and a unit test for any pure
   helper it introduces.

---

## Part A — Communication improvements

These make the *existing* tools more effective, independent of new domains.

### A1. `read_log` — read the UE Output Log ⭐ highest ROI, smallest effort

**Problem:** A `compile_blueprint` (or asset import, or any Python op) that logs
`LogK2Compiler`/`LogBlueprint` errors C++-side but does **not** raise a Python
exception reports `success` — the agent never sees the errors and cannot
self-correct.

**Tool:** `read_log(lines?, severity?, category?)`
- Reads the active UE log file from `unreal.Paths.project_log_dir()` (typically
  `Saved/Logs/<Project>.log`), returns the tail filtered by severity
  (`Error`/`Warning`/`Log`) and category (e.g. `LogK2Compiler`, `LogBlueprint`).
- Module: `console` or `editor-utils`. `readOnlyHint: true`.
- **Caveat to verify:** the editor holds the log file open; an in-process Python
  read is normally fine, but confirm on Windows. Fallback: UE also exposes a
  small in-memory log ring in some versions — prefer the on-disk tail for
  portability.

**Why first:** one tool, no new domain, and it upgrades the diagnostic quality
of *every* other tool the agent already calls.

### A2. Progress notifications for long subprocess ops

**Problem:** `build_target` / `cook_content` / `package_project` block silently
for minutes.

**Plan:** The MCP SDK passes an `extra` (with `sendNotification` / a
`progressToken`) into the tool callback. The `subprocess` runner already streams
stdout chunks, and `output-parser.ts` already extracts `[N/M]` progress — wire
that into progress notifications so the client sees live build progress instead
of a stall. Scope: `build.ts` + `subprocess.ts`.

### A3. Editor-context MCP resources

**Problem:** Only two resources exist (`unreal://project`, `unreal://status`).
Anything the agent wants about editor state costs a full tool round-trip.

**Plan:** Add read-only resources the client can pull cheaply:
- `unreal://level/current` — current level name, actor count, streaming levels
- `unreal://editor/selection` — currently selected actors
- `unreal://editor/performance` — FPS / stat unit snapshot
- `unreal://editor/log` — recent log tail (pairs with A1)

All feasible via Python. Register alongside the existing resources in `index.ts`.

### A4. (Optional, larger) Uniform response envelope

**Problem:** Every tool returns ad-hoc JSON of varying shape; an LLM caller has
to guess the schema per tool.

**Plan (defer unless churn is acceptable):** a light shared helper that wraps
results as `{ success, data?, errors?, warnings? }` with stable error codes,
adopted incrementally. High consistency value, but touches every tool — do it
opportunistically, not as a blocking PR.

---

## Part B — New and expanded domains (items 1–5)

Cross-checked against the current inventory: items listed here are **confirmed
missing** or thin today.

### B1. Environment module (NEW) — largest gap, highest domain value

New module `environment` (mirror the structure of `niagara.ts`). All tools drive
standard UE component APIs and are Python-feasible.

| Tool | Purpose | UE Python API (verify) | Annotation |
|---|---|---|---|
| `set_light_properties` | intensity, color, temperature, shadows, source radius, cone angles | `ULightComponent.set_intensity/set_light_color/set_temperature` | — |
| `set_fog` | density, height falloff, start distance, volumetric | `UExponentialHeightFogComponent` props | — |
| `set_post_process` | bloom, exposure, vignette, saturation, contrast | `APostProcessVolume.settings` (`FPostProcessSettings`) | — |
| `set_sky_atmosphere` | scattering / sky params | `ASkyAtmosphere` component reflection | — |
| `set_physics_simulation` | simulate, gravity, mass, linear/angular damping | `UPrimitiveComponent.set_simulate_physics/...` | — |
| `set_collision_profile` | apply a named collision preset | `UPrimitiveComponent.set_collision_profile_name` | — |
| `add_physics_constraint` | fixed / hinge / ball-socket between two actors | `UPhysicsConstraintComponent` | — |
| `get_physics_info` | mass, damping, simulation state, profile | `UPrimitiveComponent` getters | `readOnlyHint` |
| `create_spline_actor` | spawn actor + spline with initial points | `USplineComponent.add_spline_point` | — |
| `add_spline_point` | append a point | `USplineComponent.add_spline_point` | — |
| `set_spline_point` | move a point by index | `USplineComponent.set_location_at_spline_point` | — |
| `remove_spline_point` | delete a point by index | `USplineComponent.remove_spline_point` | `destructiveHint` |
| `get_spline_info` | points, length, closed state | `USplineComponent` getters | `readOnlyHint` |
| `set_spline_closed` | toggle closed loop | `USplineComponent.set_closed_loop` | — |
| `set_spline_point_type` | linear / curve / constant / clamped | `USplineComponent.set_spline_point_type` | — |

### B2. Audio module (NEW) — closes a whole domain with 3 tools

New module `audio` (or fold into a `gameplay` module).

| Tool | Purpose | UE Python API (verify) | Annotation |
|---|---|---|---|
| `spawn_sound` | spawn `AmbientSound` actor with a sound asset, volume, pitch | `AmbientSound` + `UAudioComponent.set_sound` | — |
| `set_audio_properties` | volume, pitch, auto-activate on an actor's audio component | `UAudioComponent.set_volume_multiplier/set_pitch_multiplier` | — |
| `get_sound_info` | duration, sample rate, channels of a sound asset | `USoundBase.get_duration`, `USoundWave` metadata | `readOnlyHint` |

### B3. Navigation tools (NEW) — 3 tools, high gameplay value

Fold into a `gameplay` module (with audio) or `environment`.

| Tool | Purpose | UE Python API (verify) | Annotation |
|---|---|---|---|
| `build_navigation` | trigger a navmesh rebuild (needs a `NavMeshBoundsVolume`) | `UNavigationSystemV1.build` | — |
| `query_navigation_path` | A* path between two points → waypoints, length | `UNavigationSystemV1.find_path_sync` | `readOnlyHint` |
| `get_navigation_info` | navmesh built state + bounds-volume count | `UNavigationSystemV1.is_navigation_built` | `readOnlyHint` |

### B4. Widget module (NEW) — full UMG authoring, render deferred to Tier 2

New module `widget`. Everything except the PNG render is Python-feasible.

| Tool | Purpose | UE Python API (verify) | Annotation |
|---|---|---|---|
| `create_widget_blueprint` | create a `WidgetBlueprint` with a chosen root panel | `unreal.WidgetBlueprint`, `WidgetTree`, `BlueprintCompilationManager` | — |
| `read_widget_blueprint` | read the widget tree (names, classes, props, slots) back | `WidgetTree` + `UPanelWidget.get_child_at`, reflection | `readOnlyHint` |
| `add_widget` | add a widget (25+ types) with parent/slot layout | `WidgetTree.construct_widget`, `UPanelWidget.add_child` | — |
| `set_widget_property` | set an arbitrary widget/slot property (with aliases) | `set_editor_property` + dotted-path/alias resolution | — |
| ~~`render_widget_blueprint`~~ | UMG → PNG | **Tier 2 — `FWidgetRenderer` is C++-only** | — |

Note the reference plugin marks the widget blueprint dirty but does **not**
synchronously compile mid-tree-mutation (that crashes) — mirror that: mutate,
mark modified, compile on a separate explicit step / save.

### B5. Read-back & authoring gaps in existing domains

Small, high-value additions to modules you already have.

| Module | Add | Why |
|---|---|---|
| `niagara` | `create_niagara_system`, `read_niagara_system`, `add_niagara_emitter` | you only have spawn/set; can't create or inspect systems |
| `animation` | `read_montage`, `add_montage_section`, `link_montage_sections`, `add_montage_notify`, `read_anim_blueprint` | montage detail editing + introspection |
| `sequencer` | `add_sequence_keyframe` | you have tracks/bindings but can't keyframe |
| `material` | material-function editing with typed validation (`edit/inspect/find/create/delete_material_function`) | typed input validation (Scalar/VectorN/Texture, previewValue shape) is a strong, Python-feasible pattern |

---

## Part C — Safety hardening (from the security review)

The reference plugin's security failures are directly instructive for this
server. None of these are open holes here today, but they are the invariants to
keep and the traps to avoid as the surface grows.

### C1. Keep template escaping the only path to Python (invariant)
Every Python string must go through `inlineScript`/`substituteVars` with
`{{var}}` — never raw JS `${var}`. The reference's whole class of injection came
from unescaped interpolation. Enforcement idea: a lint/CI check that flags
`${` inside a template literal passed to `runPython`.

### C2. If a tool ever takes a real filesystem path, resolve-then-bound it
Today the only filename input is guarded by `assertSafeFilename` (allowlist).
If any future tool (e.g. content import, log export) takes a *path*, adopt the
reference's correct pattern — **combine with a base dir, canonicalize, then
verify `IsUnderDirectory`** — not a substring denylist. Substring/`..` denylists
were shown to be bypassable (case, encoding, absolute paths). A resolution-based
check is the robust form.

### C3. A guard only counts where it is called
The reference had a correct path sandbox and *did not call it* at three critical
sinks (bridge, zip extraction, content import). Lesson: when adding a validator,
grep for **every** sink and wire it at each — a helper that exists but is
skipped is worse than none (false confidence).

### C4. Never trust a caller-supplied "expected hash" as authenticity
If downloads are ever added: the expected hash must come from a trusted,
out-of-band source (signed manifest, pinned constant), never from the same
request that chose the URL. Also require a real scheme allowlist and reject
`file://`, `localhost`, and private/link-local IPs (SSRF).

### C5. Comments rot faster than code — keep security claims true
The reference shipped a module whose header comment said "MCP server only, no
browser widget" directly above code that initializes the browser widget. Audit
our own security-relevant comments (e.g. "loopback-only is the trust boundary")
against what the code actually does whenever that code changes.

### C6. Don't silently drop advertised inputs
If a tool's schema advertises a field (e.g. `default_value`), the code must
apply it or say it didn't (as `edit_blueprint` now does with `default_value_note`
on the Python fallback). Silent drops mislead the agent.

---

## Suggested sequencing (PRs)

Each PR: build + lint green, tests for any pure helper, server smoke test
(`tools/list` count + one `tools/call`), README table updated.

- [x] **PR 1 — `read_log` + editor-context resources (A1, A3).** Smallest, highest
  ROI; upgrades diagnostics for everything else. Ship first.
- [x] **PR 2 — Environment module (B1).** Largest domain gap; 14 tools; standard
  component APIs.
- [x] **PR 3 — Audio + Navigation (B2, B3).** Two small domains, six tools.
- [x] **PR 4 — Widget module without render (B4).** New domain; mind the
  no-sync-compile-mid-mutation rule.
- [x] **PR 5 — Read-back gaps (B5).** Niagara/anim/sequencer inspect + keyframe;
  material functions.
- [ ] **PR 6 (optional) — Progress notifications (A2)** and, opportunistically, the
  response envelope (A4). Not yet implemented — deliberately deferred per this
  roadmap's own "optional" framing; the mandatory Tier 1 scope (PR1-5) is done.

PR1-5 are implemented on `claude/python-discovery-fix` (commits `e6f2b5e`,
`98a5f16`, `2d31194`, `93cdeb9`, `afce1e3`), each verified via: `npm run build`
+ `npm run lint`; a Node.js harness that imports the compiled tool module,
captures every generated Python script across representative argument
combinations, and validates each with `python3 -c "import ast; ast.parse(...)"`;
a stdio JSON-RPC smoke test confirming tool/resource registration counts;
`npx vitest run`; and a README tool-count update. This caught two real bugs
before they shipped — an empty `try:` block in `set_physics_simulation` (PR2)
and a validated-but-never-used `bool_value` parameter in
`edit_material_function` (PR5) — see those commits for details.

Safety items (Part C) are cross-cutting: fold C1/C3 into a CI check, apply
C2/C4 the moment any path/download tool is introduced, and treat C5/C6 as
review-checklist items on every PR.

## Out of scope for Tier 1 (see TIER2-PLUGIN.md)
- Blueprint graph node editing (`add_nodes`/`connect_pins`/enumeration) — UE
  graph APIs (`UEdGraph`, `FGraphNodeCreator`, `UEdGraphPin`) are not exposed to
  Python. This is why the existing graph tools already fall back to "requires the
  plugin."
- Offscreen render-to-PNG: `render_blueprint_graph`, `render_widget_blueprint`,
  material thumbnails (`FWidgetRenderer`/`FThumbnailRenderer`/canvas — C++-only).
- Blueprint debugging: compile-error introspection, breakpoints, watches
  (`FKismetDebugUtilities`).
