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

## Effort / sequencing
1. Plugin skeleton + capability negotiation + one round-trip command
   (`list_nodes`) to validate the transport end-to-end.
2. Graph editing (T2.1) — the core value.
3. Render (T2.2) + auto-layout (T2.3).
4. Debugging (T2.4).

Ship as an **optional** plugin: the server must keep working (Python path)
when it is absent, exactly as it does today.
