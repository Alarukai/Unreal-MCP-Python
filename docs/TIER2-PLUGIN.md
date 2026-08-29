# unreal-mcp Roadmap — Tier 2 (optional C++ plugin)

Everything here is **impossible via Python Remote Execution / Remote Control**
because it needs editor-internal C++ APIs that Unreal does not expose to Python.
This is deferred, separate work — a real UE C++ plugin — and is the strongest
argument for building the optional `UnrealMCPBridge` plugin that the README and
`PluginBridgeClient` already anticipate (TCP, port 55557).

It should only be undertaken once the Tier 1 Python work
([`ROADMAP.md`](./ROADMAP.md)) is in place, since Tier 1 covers the ~95% that
does not need a plugin.

## Why these need C++

A capability review confirmed, across three independent passes, that the
following UE systems are **not reachable from the Python `unreal` module** — they
require live editor-graph objects, the Slate/render thread, or editor-only
subsystems:

- `UEdGraph::Nodes`, `UEdGraphPin`, `FGraphNodeCreator<T>`,
  `UEdGraphSchema_K2::TryCreateConnection` — Blueprint graph structure and K2
  node spawning/wiring.
- `FWidgetRenderer`, `FThumbnailRenderer`, `UTextureRenderTarget2D` +
  `ReadPixels` on the render thread, `FCanvasTileItem`/`FCanvasLineItem` —
  offscreen rendering to an image.
- `FKismetDebugUtilities` — breakpoints, watches, node-level compile
  diagnostics.

## Capabilities (grouped)

### T2.1 Blueprint graph editing (the core reason to build the plugin)
The existing `add_graph_node`, `connect_graph_nodes`, `remove_graph_node`,
`list_graph_nodes`, and the graph portion of `edit_blueprint` already detect the
plugin and fall back to "requires the UnrealMCPBridge plugin." The plugin makes
them real.

- `add_node` — spawn a K2 node by type (100+ types: CallFunction, Branch,
  Sequence, Timeline, VariableGet/Set, casts, math, custom events) via
  `FGraphNodeCreator<T>`.
- `connect_nodes` — wire two pins with schema type-checking
  (`UEdGraphSchema_K2::TryCreateConnection`) and structured error reporting.
- `list_nodes` — enumerate `UEdGraph::Nodes` with GUIDs, positions, pins,
  `LinkedTo` connections. **This read-back is the single most valuable piece** —
  it lets the agent see the graph it built and self-correct, which Python cannot
  do at all.
- `set_pin_defaults`, `break_connections`, `remove_node`.

Wire these through the existing `executeWithPluginFallback()` dual-path pattern
so the tools "upgrade" transparently when the plugin is present.

### T2.2 Offscreen render-to-PNG (visual feedback loop)
- `render_blueprint_graph` — Sugiyama-style layered layout (exec-flow aware,
  longest-path layer assignment) + headless canvas draw of node boxes,
  connection lines, and pin labels to a `UTextureRenderTarget2D`, auto-scaled
  256–4096px. (SGraphEditor renders blank headless, hence the manual canvas.)
- `render_widget_blueprint` — `UWidget::TakeWidget()` → `FWidgetRenderer`
  (offscreen) → `DrawWidget` to a render target → `ReadPixels` → PNG via
  `IImageWrapperModule`.
- `render_material_thumbnail` / `get_asset_thumbnail` — `FThumbnailRenderer`
  for a material/asset preview PNG.

These give a multimodal agent a picture of what it built. Note that
`take_screenshot` (viewport) and `render_sequence` (MovieRenderQueue) are
already Python-feasible and shipped — only these *offscreen* renderers need C++.

### T2.3 Blueprint node auto-layout
- `organize_blueprint_nodes` — the Sugiyama layered layout from T2.2 applied to
  the live graph, turning an unreadable node heap into a legible left-to-right
  exec flow. Pure quality-of-life but high impact for human review of
  agent-authored graphs.

### T2.4 Blueprint debugging
- `bp_get_compile_errors` — collect node-level error state + compiler log
  (`FKismetDebugUtilities`, node error messages).
- `bp_set_breakpoint` / `bp_remove_breakpoint` / `bp_list_breakpoints`.
- `bp_add_watch` / `bp_get_watch_values`.
- `bp_find_unconnected_pins`, `bp_fix_broken_references`.

Closes the diagnostic loop for Blueprint logic the way `read_log` (Tier 1) does
for the text log.

## Architecture notes for whoever builds this

- **Protocol already exists client-side.** `PluginBridgeClient` speaks
  length-prefixed JSON over TCP (port 55557) with capability negotiation
  (`get_capabilities`), request IDs, and a streaming frame parser. The plugin
  must implement the matching server end and advertise the command set it
  supports so tools can feature-detect.
- **Game-thread marshalling.** Every graph/render op must run on the game
  thread. Use a bounded wait (the reference uses a `TPromise`/`TFuture` with a
  ~60s timeout and `AsyncTask(ENamedThreads::GameThread, …)`) so a blocked game
  thread times out cleanly instead of wedging the connection.
- **Bind address = trust boundary.** The plugin's own listener must bind
  loopback-only and verify the connecting peer is loopback, failing closed if
  the peer can't be determined. (UE's `FHttpServerModule` takes no bind-address
  argument — if HTTP is used instead of raw TCP, enforce the peer check in the
  handler, as the reference eventually had to.)
- **Do not import the reference's failure modes.** The reference plugin's
  security review found: an embedded CEF browser loading a remote origin with a
  fully-unguarded native bridge (`ExecutePython`/`SaveFile` with no origin or
  path check), a path sandbox that existed but was not called at the dangerous
  sinks, zip-slip in its content pipeline, and SSRF from an unvalidated download
  URL. A UE-graph-editing plugin needs **none** of that surface — keep it to the
  TCP command protocol above, loopback-only, no browser, no download pipeline,
  no filesystem writes outside explicitly sandboxed paths.

### T2.5 PIE (Play-In-Editor) runtime control — *new, see ROADMAP.md Part D2*
Confirmed via a direct read of the IntegrationKit reference plugin's C++: it
dedicates ~625 lines (`IKPIETools.cpp`) to reaching `GEditor->PlayWorld` and
manipulating the *live* game world while Play is running — something this
server currently cannot do at all (every existing tool operates on the editor
world). The size of that dedicated implementation is itself evidence this
needs C++, not a Python workaround.

- `play_in_editor` / `stop_pie` — start/stop Play.
- `pie_spawn_actor` / `pie_destroy_actor` / `pie_teleport_actor` — live actor
  lifecycle and transform control during Play.
- `pie_get_property` / `pie_set_property` — reflection-based get/set on a live
  PIE actor (mirrors `get_actor_properties`/`set_actor_property`, but against
  `PlayWorld` instead of the editor world).
- `pie_set_blackboard_key` / `pie_get_blackboard_key` — poke/read an AI
  controller's live Blackboard values.
- `pie_move_ai_to` / `pie_stop_ai` — direct AI controller commands during Play.
- `pie_get_game_state` / `pie_list_actors` — live world snapshot (actor
  positions, counts) for test/debug loops.
- `pie_console_command` — console commands scoped to the PIE world.

This is arguably **higher practical value** than T2.1 (Blueprint graph
editing) for anyone iterating on gameplay — it closes the "does this actually
work when played" loop, which nothing in Tier 1 can reach.

### T2.6 Blueprint interface / event-dispatcher / reparent editing
Same `FBlueprintEditorUtils` / `UEdGraph` dependency as T2.1, confirmed
present in the IntegrationKit reference as a distinct set of operations:
- `add_interface` / `remove_interface` — implement/remove a Blueprint
  interface.
- `create_event_dispatcher` — add a multicast delegate the Blueprint can bind
  to/broadcast.
- `reparent_blueprint` — change a Blueprint's parent class post-creation.

### T2.7 Blueprint Error Fixer
Extends T2.4's diagnostic surface — same C++-only dependency:
- `bp_fix_broken_references` — repair dangling references after an asset
  rename/move outside the editor's own refactor tools.
- `bp_fix_deprecated_nodes` — replace deprecated K2 nodes with their current
  equivalents.
- `bp_refresh_all_nodes` — force a full node refresh (post-reparent, post
  native-class-change).
- `bp_find_unconnected_pins` — surface dangling/unwired pins as a diagnostic
  list.

### T2.8 Misc confirmed-Tier-2 items (lower priority)
- **`get_asset_thumbnail`** — same `FThumbnailRenderer` dependency as T2.2's
  material thumbnails; fold into that work item.
- **AnimBP state machine node editing** (`add_anim_bp_state_machine`) —
  `UAnimStateMachineGraph` is `UEdGraph`-based, same restriction as T2.1.
- **IK Rig / IK Retargeter / Pose Search (Motion Matching)** — niche,
  engine-version-gated (UE 5.7+ only in the reference plugin). Revisit only on
  specific user demand.
- **`create_landscape`** — explicitly *not* recommended even as a Tier 2 item:
  the reference plugin's own C++ implementation refuses to attempt this and
  tells the caller to use `execute_python` with `ALandscape::Import` instead,
  meaning full C++ access didn't make it safe/reliable enough to wire up. Do
  not build a dedicated tool for this on either tier.

## Effort / sequencing
1. Plugin skeleton + capability negotiation + one round-trip command
   (`list_nodes`) to validate the transport end-to-end.
2. Graph editing (T2.1) — the core value.
3. Render (T2.2) + auto-layout (T2.3).
4. Debugging (T2.4) + Blueprint Error Fixer (T2.7, same surface).
5. PIE runtime control (T2.5) — self-contained, does not depend on 2-4;
   could be built first if gameplay-testing feedback loops are the priority.
6. Interface/dispatcher/reparent editing (T2.6) — extends T2.1.
7. Misc (T2.8) — pick up opportunistically.

Ship as an **optional** plugin: the server must keep working (Python path)
when it is absent, exactly as it does today.
