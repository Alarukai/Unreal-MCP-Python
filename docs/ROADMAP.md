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

---

## Part D — Tier 1.5: further gaps (2026-08-29)

Second capability pass, after Tier 1 (PR1-5) shipped. Two sources, cross-checked
against each other:

1. Three parallel research passes over live UE5 Python API docs (Geometry
   Script/Landscape/Foliage; DataTable/Levels/Lighting/Enhanced Input; Control
   Rig/Chaos/PCG/SoundCue/Groom/compile-diagnostics).
2. A direct read of the IntegrationKit (IK) reference plugin's C++ source
   (21 tool-class headers, ~1970 lines) — the same reference this project was
   originally benchmarked against. IK is a **full C++ plugin**, so "IK implements
   X in C++" is not by itself evidence that X is Python-feasible; where IK's own
   code *refuses* to do something in C++ and tells the caller to fall back to
   `execute_python`, or where it required custom, non-trivial C++ (PIE runtime
   control), that is instead a signal the capability is genuinely hard or Tier 2.

### D1. New Tier 1 domains (Python-feasible, high confidence)

| Domain | Tools | Evidence |
|---|---|---|
| **Behavior Tree + Blackboard** | `create_behavior_tree`, `read_behavior_tree` (readOnlyHint), `create_blackboard`, `edit_blackboard` (add/remove keys) | **Implemented** (`ai.ts`, wave 2). IK implements all four in ~15 lines each via `AssetTools.CreateAsset(UBehaviorTree::StaticClass())`, `NewObject<UBlackboardData>`, `BlackboardKeyType_*` — all ordinary UObject/factory patterns with direct `unreal.*` Python equivalents (`unreal.BehaviorTree`, `unreal.BlackboardData`, `unreal.BlackboardKeyType_Bool/Int/Float/String/Vector/...`). **Caveat**: full node-graph wiring (Composite/Task/Decorator/Service, actually connecting them) is NOT included — IK's own `AddBehaviorTreeNodes` only validates node-type strings and marks the package dirty, then says outright: *"Full graph wiring needs execute_python (BehaviorTreeEditor module is internal)."* Ship create/read/blackboard-CRUD as Tier 1; treat node-graph wiring as out of scope (same class of problem as Blueprint graph editing). |
| **DataTable** | `create_data_table`, `add_data_table_row`, `read_data_table`, `import_data_table_json` | **Implemented** (`datatable.ts`, wave 1). Confirmed by both IK (`IKDataTools`) and live docs (`unreal.DataTableFunctionLibrary.fill_data_table_from_json_string/file`, `.get_table_as_json`, `.get_row_names`). No confirmed single-row-add primitive in stock Python — `add_data_table_row` is a get-JSON → mutate → refill-JSON composite. **Correction after a second, critical read of IK's actual `.cpp` (not just headers)**: `create_struct`/`create_enum` were downgraded out of this table — see D2, they need `FStructureEditorUtils`/`FEnumEditorUtils` (UnrealEd-only) to add fields/values, which IK's own code confirms. A struct/enum asset with no way to add members has little value, so these were not implemented. |
| **Enhanced Input** | `create_input_action`, `create_input_mapping_context`, `find_input_actions`, `delete_input_action`, `edit_mapping_context` | **Implemented** (`input.ts`, wave 1). Confirmed by both IK (`IKInputTools`) and docs (`unreal.InputAction_Factory`, `unreal.InputMappingContext.map_key/unmap_key/unmap_action`). IK's own `.cpp` confirmed `NewObject<UInputAction>` + plain `CreatePackage`/`FAssetRegistryModule::AssetCreated` — no editor-only dependency, ported directly to `unreal.AssetToolsHelpers.get_asset_tools().create_asset(name, path, unreal.InputAction, None)`. |
| **Level management** | `new_level`, `open_level`, `save_level`, `get_level_info` | **Implemented** (`level.ts`, wave 3). Confirmed by both IK (`IKLevelTools`) and docs (`unreal.LevelEditorSubsystem.new_level/load_level/save_current_level`, replacing the deprecated `EditorLevelLibrary` equivalents). |
| **Level macros / shortcuts** | `create_basic_level`, `create_light_rig`, `create_grid_layout`, `create_ring_layout` | **Implemented** (`level.ts`, wave 3). IK ships these as pure compositions of actor-spawn calls we already have (`spawn_actor`, lighting tools) — no new API surface, just convenience presets. |
| **Landscape (partial)** | `set_landscape_material`, `get_landscape_info` | **Implemented** (`world.ts`, wave 5). IK implements both in ~10 lines via `TActorIterator<ALandscapeProxy>` + direct property read/write — trivially portable to `unreal.EditorActorSubsystem.get_all_level_actors()` + `isinstance(a, unreal.LandscapeProxy)`. **`create_landscape` is explicitly NOT included** — see D2. |
| **Foliage** | `add_foliage_type`, `paint_foliage` (add instances), `erase_foliage` (remove instances), `get_foliage_stats` | **Implemented** (`foliage.ts`, wave 6; `erase_foliage`/`get_foliage_stats` are honest best-effort — `FoliageInfos`/`Instances` reflection may not resolve on every engine version, in which case they report what they could read plus a warning rather than silently no-op'ing). Confirmed by IK (`AInstancedFoliageActor::AddFoliageType`, `NewObject<UFoliageType_InstancedStaticMesh>`) and docs (`unreal.InstancedFoliageActor.add_instances`, confirmed real call-site syntax found in an Epic forum bug report). Procedural/rule-based scatter (slope/density-constrained auto-placement) is out of scope — compose `paint_foliage` from generated transforms instead. |
| **PCG (Procedural Content Generation) graph** | `create_pcg_graph`, `find_pcg_graphs`, `spawn_pcg_volume`, `generate_pcg`, `add_pcg_node` | **Implemented** (`pcg.ts`, wave 6). `spawn_pcg_volume` deliberately does NOT auto-generate on spawn — IK's own code comment says exactly this crashed with ACCESS_VIOLATION on an empty/unwired graph, found via scenario testing; ported that safety behavior directly (generate is a separate explicit `generate_pcg` call). `add_pcg_node` tries `graph.add_node_of_type()` first, falling back to manual `PCGNode` construction + `set_settings_interface`, mirroring IK's own two-tier fallback for "older 5.x or alternate API surface." Confirmed by IK, which dynamically loads `/Script/PCGEditor.PCGGraphFactory` + `/Script/PCG.PCGGraph`, and by docs (`unreal.PCGGraph` node/edge creation, cited in an Epic forum thread titled "Create PCG Graph with Python"). Node *removal* in some contexts is flagged as possibly restricted — verify in-editor before shipping `remove_pcg_node`. |
| **State Tree** | `create_state_tree`, `read_state_tree` (readOnlyHint), `add_state_tree_state` | **Implemented** (`ai.ts`, wave 2). IK ships a dedicated `IKStateTreeTools` (292 lines) using plain `UStateTreeFactory`/`NewObject<UStateTreeState>`/reflection-accessible `EditorData.SubTrees`/`Children` — no editor-only dependency found on a full read of the `.cpp`. Transition wiring (`FStateTreeTransition`) is excluded — IK's own comment says it "needs execute_python (... internal and varies by UE version)". |
| **Actor attach/detach/rename** | `attach_actor_to_actor`, `detach_actor`, `rename_actor` | **Implemented** (`actor.ts`, wave 1). Small gap found via an exact tool-name diff against IK's dispatch table — we had `duplicate_actors`/`select_actors`/`set_actor_tags`/`set_actor_transform` but no attach/detach (`AActor.attach_to_actor`/`detach_from_actor`, both plain reflection-callable) or a dedicated rename (`set_actor_label`). |
| **Master-material top-level properties** | `set_material_property` | **Implemented** (`material.ts`, wave 1). Distinct from our existing expression-level property tools — this is for whole-material properties like `BlendMode`, `ShadingModel`, `TwoSided` (`unreal.Material.get/set_editor_property`, same reflection pattern already used everywhere). Found via the exact tool-name diff; not previously listed. |
| **Project/build info** | `get_project_info`, `get_map_check_errors`, `get_build_configuration` | **Implemented** (`build.ts`, wave 7), with two corrections found by reading IK's actual `.cpp` bodies rather than trusting the names alone: `list_project_modules` was **dropped** — IK's implementation calls `FModuleManager::Get().QueryModules()`, a C++-only reflection API with no Python binding found; shipping it would have meant a tool that always errors. `get_map_check_errors` in IK is a literal stub — `return "Use Window > Message Log > Map Check in editor..."` — so instead of porting the stub, this project's version actually runs the `MAP CHECK` console command and scrapes the resulting log lines (reusing the `read_log` pattern), which is strictly more useful than what IK ships, while still being honest that it's free-text scraping, not a structured issue list. `get_build_configuration` doesn't touch Python at all — it echoes this server's own configured `platform`/`configuration` (already known from `config.ts`), since the running editor's own compile-time flags (`UE_BUILD_DEBUG` etc.) aren't reflected to Python either. |
| **GAS (Gameplay Ability System)** | `create_gameplay_ability`, `create_gameplay_effect`, `create_attribute_set`, `list_gameplay_abilities`, `list_gameplay_effects`, `list_attribute_sets`, `get_gas_info` | **Implemented** (`gameplay.ts`, wave 4). Confirmed by a full read of IK's `.cpp`: `CreateGASBlueprint` is exactly `FKismetEditorUtilities::CreateBlueprint` against a dynamically-resolved parent class (`FindFirstObject`/`LoadObject<UClass>('/Script/GameplayAbilities.X')`), same shape as our own `create_blueprint`. `list_*` mirrors IK's own crash-avoidance pattern (read the `NativeParentClass` asset-registry tag instead of force-loading every candidate asset, since loading a compile-failed GAS Blueprint before the plugin is loaded can null-deref). |
| **Game Framework presets** | `create_game_mode`, `create_player_controller`, `create_game_state`, `create_player_state`, `create_hud`, `get_game_framework_info` | **Implemented** (`gameplay.ts`, wave 4). Same reasoning as GAS — thin `create_blueprint`-style wrappers with fixed parent classes (`GameModeBase`, `PlayerController`, `GameStateBase`, `PlayerState`, `HUD`). `get_game_framework_info` additionally reads the level's `DefaultGameMode` from World Settings and, if set, that GameMode class's own `DefaultPawnClass`/`PlayerControllerClass`/`GameStateClass`/`PlayerStateClass`/`HUDClass` off its CDO (these live on the GameMode, not World Settings, so IK's `get_world_settings`-only read was extended). |
| **World settings** | `get_world_settings`, `set_world_settings` | **Implemented** (`world.ts`, wave 5). Tier 1 via reflection on `world.get_world_settings()` — `bGlobalGravitySet`/`GlobalGravityZ`/`DefaultGameMode`/`KillZ`, confirmed by a full read of IK's `IKSettingsTools::GetWorldSettings`. `set_game_mode` (project-wide default, distinct from the per-level World Settings one above) was superseded — see the `get_project_settings`/`set_project_settings` row below, added in a later pass (wave 8). |
| **Project-wide default GameMode** | `get_project_settings`, `set_project_settings` | **Implemented** (`gameplay.ts`, wave 8). IK's version is a one-field wrapper around `UGameMapsSettings::GetGlobalDefaultGameMode`/`SetGlobalDefaultGameMode` — both static functions with direct Python equivalents (`unreal.GameMapsSettings.get_global_default_game_mode()`/`.set_global_default_game_mode()`). This is Project Settings > Maps & Modes > Default GameMode, the project-wide fallback — distinct from `set_world_settings`'s per-level `DefaultGameMode` override. |
| **World Partition status** | `get_world_partition_info` | **Implemented** (`world-partition.ts`, wave 8). `world.get_world_partition()` was already proven working in this codebase (used by the pre-existing `get_loaded_cells` tool) — this just surfaces it as a proper info tool (enabled + runtime hash name) instead of a hint-only stub. |
| **Blueprint component removal/edit** | `remove_component`, `edit_component` | **Confirmed Tier 2, not implemented** (checked in wave 8). IK's `RemoveComponent`/`EditComponent` call `FBlueprintEditorUtils::MarkBlueprintAsModified` and manipulate the SimpleConstructionScript node tree — `FBlueprintEditorUtils` is UnrealEd-only, same restriction as the rest of Blueprint graph/component editing already in Tier 2 (T2.1/T2.6). |
| **Replication** | `get_replication_info`, `set_replication_settings`, `set_net_dormancy` | **Implemented** (`world.ts`, wave 5). Tier 1 via reflection on `bReplicates`/`bReplicateMovement`/`NetUpdateFrequency`/`NetDormancy` actor properties, confirmed by a full read of IK's `.cpp` (plain `AActor::SetReplicates`/`SetReplicateMovement` calls, no editor-only dependency). `NetDormancy` enum values ported as `unreal.NetDormancy.DORM_<Mode>`, matching the verbatim-C++-name convention already confirmed for `unreal.FunctionInputType` in PR5. |
| **Undo / Redo (actual trigger)** | `undo`, `redo` | **Correction**: these already existed in `editor-utils.ts` before this gap analysis (single-shot, no `count` param) — the stdio smoke test caught the duplicate registration when wave 3 first tried to add them again in `level.ts`. Fixed by extending the existing `editor-utils.ts` tools with a `count` param (1-50 transactions) instead of duplicating; nothing added to `level.ts`. |
| **World Partition region loading** | `load_world_partition_region` | **Dropped** — the earlier assessment ("small, contained addition") was wrong; a full read of IK's own `LoadWorldPartitionRegion` shows it validates a bounding box and returns `success:true` **without actually loading anything**, with the comment *"WP editor cell loading is typically done via the WP editor UI"*. Even IK, with full C++ access, didn't implement real region loading. Shipping this tool would mean lying about what it does — not implemented. |
| **Material read-back gaps** | `list_material_slots`, `find_textures`, `delete_material`, `delete_material_instance`, `update_material_instance` (batch scalar/vector/texture update in one call) | **Implemented** (`material.ts`, wave 7). IK's `IKMaterialTools` has these; they're all thin wrappers over patterns our `material.ts` already uses (`MaterialEditingLibrary`, `EditorAssetLibrary.delete_asset`, asset-registry search). |

### D2. Confirmed Tier 2 additions (needs the C++ plugin — new evidence)

| Domain | Why | Evidence |
|---|---|---|
| **`create_struct` / `create_enum` field & value editing** (`UserDefinedStruct`/`UserDefinedEnum` member CRUD) | Found on a second, critical re-read of IK's actual `.cpp` bodies (not just its headers): `IKDataTools::CreateStruct` calls `FStructureEditorUtils::CreateUserDefinedStruct` + per-field `FStructureEditorUtils` member-add calls, and `CreateEnum` calls `FEnumEditorUtils::CreateUserDefinedEnum` + per-value `FEnumEditorUtils` calls — both are UnrealEd-only C++ classes with no Python binding. Creating an *empty* struct/enum asset alone (no fields/values) is technically Tier 1 via a bare factory call, but has too little standalone value to ship — not implemented. |
| **PIE (Play-In-Editor) runtime control** — `pie_teleport_actor`, `pie_spawn_actor`, `pie_destroy_actor`, `pie_get/set_property`, `pie_get/set_blackboard_key`, `pie_move_ai_to`, `pie_stop_ai`, `pie_get_game_state`, `pie_list_actors`, `pie_console_command`, plus `play_in_editor`/`stop_pie` themselves | IK wrote ~625 lines of dedicated C++ (`IKPIETools.cpp`) to reach `GEditor->PlayWorld` and manipulate live actors during Play. Everything this server currently does operates on the **editor** world; PIE's live game world is not reliably reachable from stock Python the way the editor world is. This is a big, genuinely valuable capability (teleport/spawn/blackboard-poke/console-command *while the game is running*, for interactive testing) but the size of IK's dedicated implementation is itself evidence it needed C++, not just convenience. **Highest-value Tier 2 addition** — bigger than the existing T2.1-T2.4 items in practical impact for anyone iterating on gameplay. |
| **`create_landscape`** (landscape creation from scratch) | IK's own C++ implementation refuses to do this and returns: *"Landscape creation requires heightmap+component setup not safely exposable via JSON. Use execute_python with ALandscape::Import or LandscapeEditorUtils for proper creation."* Even with full C++ access, IK didn't consider it safe/reliable enough to wire up. Do not build a dedicated tool for this — at most, document an `execute_python` recipe with a heavy caveat. |
| **Blueprint interface / event-dispatcher / reparent editing** — `add_interface`, `remove_interface`, `create_event_dispatcher`, `reparent_blueprint` | These need `FBlueprintEditorUtils` (UnrealEd-only, same C++-only tier as the rest of Blueprint graph editing already in T2.1). IK implements them as part of its Blueprint graph C++ layer, not via Python. |
| **Blueprint Error Fixer** — `bp_fix_broken_references`, `bp_fix_deprecated_nodes`, `bp_refresh_all_nodes`, `bp_find_unconnected_pins` | Same `UEdGraphNode`/`FBlueprintEditorUtils` dependency as T2.1/T2.4. Add to the existing T2.4 (Blueprint debugging) bucket — it's the same C++ surface. |
| **Asset thumbnail rendering** — `get_asset_thumbnail` | `FThumbnailRenderer`, same C++-only render-to-PNG tier as T2.2. |
| **AnimBP state machine node editing** — `add_anim_bp_state_machine` | `UAnimStateMachineGraph` is `UEdGraph`-based, same restriction as regular Blueprint graphs (T2.1). |
| **IK Rig / IK Retargeter / Pose Search (Motion Matching)** | IK gates this entire tool set behind `NWIRO_HAS_IK_TOOLS` (UE 5.7+ only) and implements it in C++. Niche and engine-version-gated; low priority even for Tier 2 — revisit only if a user specifically needs retargeting/motion-matching automation. |
| **Control Rig graph editing** | Research (independent of IK) found `unreal.ControlRigBlueprint` + its `Controller` object (`add_unit_node`, `add_comment_node`, pin-linking) is a real, documented Python graph-editing API — **this one may actually be Tier 1**, unlike the rest of this table. Flagged here for visibility but needs a hands-on engine check before committing either way; if confirmed, move to D1. |
| **Chaos Cloth asset authoring** (not component config) | No confirmed Python path for pattern-based cloth authoring (sewing, weight painting) — that's the dedicated ChaosClothAsset editor tool. Geometry Collection (destruction) *configuration* is Tier 1-feasible via `unreal.GeometryCollection`; fracture *generation* itself is unconfirmed either way. |
| **Sound Cue graph editing** | Architecturally different from Blueprint graphs (runtime `UObject` node network, not `UEdGraph`) — `unreal.SoundCue.first_node`/`unreal.SoundNode.child_nodes` are documented Python properties. Genuinely uncertain whether *writing* `first_node` and wiring `SoundNodeWavePlayer` nodes works — no evidence of a hard block was found, but no confirmed write example either. Worth a 5-minute empirical test rather than assuming Tier 2; tentatively listed here pending that check. |

### D3. Verified via exact tool-name diff against IK's dispatch table
A full extraction of every `ToolName == TEXT("...")` string in IK's
`IKMCPServer.cpp` (225 unique tool names) diffed against our own tool
inventory. Findings not already covered above:

- **Confirmed NOT a gap** — `get_asset_referencers`: our existing
  `get_asset_references` already takes a `direction: dependencies|referencers|both`
  param and covers this in one tool; IK splits it into two. No action needed.
- **Confirmed NOT a gap** — `find_static_meshes`, `read_asset`, `find_assets`,
  `transform_actor`, `select_actor`, `duplicate_actor`, `get_actor_property`:
  all naming variants of tools we already have (`list_assets`/`search_assets`
  with `class_filter`, `get_asset_info`, `search_assets`, `set_actor_transform`,
  `select_actors`, `duplicate_actors`, `get_actor_properties`).
- **Confirmed NOT a gap** — `list_resources`/`read_resource`: these are IK's
  tool-shaped wrapper around MCP's native `resources/list`/`resources/read`
  protocol methods, which this server already implements directly as MCP
  resources (`unreal://project`, `unreal://status`, `unreal://level/current`,
  etc.) rather than as callable tools. No action needed.
- **Deliberately excluded** — `write_file`, `read_file`, `delete_file`,
  `rename_file` (generic filesystem access, not asset-registry-scoped). IK's
  own `IKPathSandbox.h` documents a real CVE-class bug it had to patch here
  (an absolute-path check bypass that let a tool call touch any file on disk,
  e.g. `/etc/passwd`). Given this project's own security-hardening history
  (the branch this roadmap lives on), do not add unscoped filesystem tools —
  every existing file-touching tool here goes through `EditorAssetLibrary`/the
  content-browser asset system, which has no equivalent path-escape surface.
- **Out of scope — different product category** — `generate_3d_model_meshy`,
  `generate_texture_meshy`, `generate_3d_model_tripo`, `list_voices_elevenlabs`,
  `generate_voice_elevenlabs`, `generate_sfx_elevenlabs`,
  `generate_music_elevenlabs`, `generate_material_fal`: third-party paid
  generative-AI service integrations (Meshy, Tripo, ElevenLabs, fal.ai). These
  need external API keys and outbound network calls to third-party services —
  a fundamentally different trust model than "drive the local UE editor via
  Python," and not something this MCP server should take a dependency on.

### D4. Not investigated further (out of scope / low value)
- **Groom/hair authoring** (raw strand import) — binding an existing groom asset
  to a skeletal mesh is Tier 1 (`unreal.GroomComponent`/`GroomBindingAsset`), but
  this project has no existing hair/groom domain to extend and it's a narrow use
  case; not worth a dedicated module unless requested.
- **Geometry Script** (`unreal.GeometryScript_*` — primitives, boolean ops, UVs,
  static-mesh baking) — confirmed broadly Tier 1 and genuinely high-value
  (Epic's flagship Python-scriptable UE5 mesh system), but it's a large,
  self-contained new module (procedural mesh authoring) rather than a small gap
  in an existing one, and IK does not implement it at all (no cross-reference
  signal either way). Recommend treating as its own future roadmap item if
  procedural mesh generation becomes a priority, rather than folding it into
  this gap list.
- **Lighting build** (`unreal.LevelEditorSubsystem.build_light_maps`) — clean,
  single-call, high-confidence Tier 1 win, but IK does not implement it either
  (no `build_lighting`-equivalent found in its tool list), so it's noted here
  rather than promoted to D1's cross-referenced table. Still a good small
  addition to `build.ts` or `environment.ts` if picked up later.

### D5. What this changes about the plugin's value proposition
IK's own code — written with full C++ access and no Python constraint — still
explicitly punts `create_landscape` to `execute_python`, and still needed ~625
lines of dedicated C++ for PIE runtime control specifically (not for graph
editing, which was the assumed Tier 2 headline). That reframes the Tier 2
plugin's strongest case: **PIE runtime control**, not just Blueprint graph
editing, is the other capability worth a C++ plugin — live-game-world
manipulation has no Python equivalent at all today, whereas Blueprint graphs at
least have partial Python read-back via the existing `get_blueprint_info`.
