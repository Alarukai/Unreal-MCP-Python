# Unreal-MCP-Python
Original by sam-david

The most comprehensive MCP server for Unreal Engine — **258 tools** across **31 subsystems**, with **4 transport layers** and **no mandatory C++ plugin**.

> **Beta** — This project is under active development and testing. Tools are being validated against UE 5.6. Some tools may not work as expected. Bug reports and contributions are welcome.

## Why This One?

| | unreal-mcp | [flopperam](https://github.com/flopperam/unreal-engine-mcp) | [chongdashu](https://github.com/chongdashu/unreal-mcp) | [kvick-games](https://github.com/kvick-games/UnrealMCP) | [ChiR24](https://github.com/ChiR24/Unreal_mcp) |
|---|---|---|---|---|---|
| Tools | **258** | ~30 | ~20 | ~5 | 36 |
| Transports | **4** | 1 | 1 | 1 | 1 |
| Requires C++ plugin | **No** | Yes | Yes | Yes | Yes |
| Build/package tools | **Yes** | No | No | No | Partial |

Most Unreal MCP projects require compiling and installing a custom C++ plugin into your UE project. This one works out of the box by using Unreal's built-in Python and Remote Control plugins — zero-install beyond enabling what already ships with UE.

## Quick Start

### Prerequisites

- Node.js >= 18
- Unreal Engine 5.x with editor open
- **Python Editor Script Plugin** enabled (built-in) with **Enable Remote Execution** checked in its settings

### Install

```bash
git clone https://github.com/YOUR_USERNAME/unreal-mcp.git
cd unreal-mcp
npm install
npm run build
```

### Add to Claude Code

**Per-project** (from your UE project directory):
```bash
claude mcp add --transport stdio unreal-mcp -- node /path/to/unreal-mcp/dist/bin.js
```

**Global** (available in all projects):
```bash
claude mcp add --scope user --transport stdio unreal-mcp -- node /path/to/unreal-mcp/dist/bin.js
```

Then drop a `.unrealmcp.json` in each UE project:
```json
{
  "projectPath": "."
}
```

### Add to Claude Desktop

Add to `%APPDATA%\Claude\claude_desktop_config.json` (Windows) or `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "unreal": {
      "command": "node",
      "args": ["/path/to/unreal-mcp/dist/bin.js"],
      "env": {
        "UNREAL_MCP_PROJECT_PATH": "/path/to/YourProject.uproject"
      }
    }
  }
}
```

## Tool Modules

| Module | Tools | Description |
|--------|-------|-------------|
| **actor** | 13 | Spawn, delete, transform, select, duplicate, tag, attach/detach, rename actors |
| **asset** | 16 | List, search, import, export, rename, delete, validate assets |
| **blueprint** | 12 | Create blueprints, add components/variables/functions, graph nodes |
| **build** | 12 | Build targets, cook content, package, generate project files, project/build/map-check info |
| **material** | 23 | Create materials/instances, add expressions, wire graphs, typed material function editing, slots/textures/batch instance updates |
| **console** | 7 | Execute Python, console commands, screenshots, viewport camera, read editor log |
| **sequencer** | 9 | Create sequences, add tracks/bindings/keyframes, set playback range |
| **animation** | 11 | Animation blueprints, montage authoring/read-back, modifiers, skeletal mesh |
| **niagara** | 11 | Spawn/create/inspect particle systems, set parameters (float/vector/color/bool) |
| **editor-utils** | 14 | Undo/redo, LOD generation, collision, lightmap UVs, static mesh set/info/material-slots/spawn/Nanite, mesh complexity report, utility widgets |
| **testing** | 8 | Automation tests, map check, data validation, Gauntlet |
| **profiling** | 5 | CSV profiling, Unreal Insights traces, stat commands |
| **source-control** | 6 | Status, checkout, checkin, revert, mark for add, diff |
| **world-partition** | 5 | Data layers, streaming sources, loaded cells, WP status info |
| **remote-control-presets** | 5 | List/get/set preset properties, call preset functions |
| **plugin** | 3 | List, enable, disable plugins in .uproject |
| **environment** | 14 | Lighting, fog, post-process, physics simulation/constraints, splines |
| **audio** | 3 | Spawn ambient sounds, set volume/pitch/auto-activate, sound asset metadata |
| **navigation** | 3 | Build NavMesh, synchronous pathfinding queries, NavMeshBoundsVolume info |
| **widget** | 4 | Create UMG Widget Blueprints, read/mutate the widget tree, set widget/slot properties |
| **datatable** | 4 | Create DataTables, read/add rows, bulk JSON import |
| **input** | 5 | Enhanced Input: InputAction/InputMappingContext creation, key mapping edit |
| **ai** | 7 | Behavior Tree + Blackboard creation/read/edit, State Tree creation/read/state-add |
| **level** | 8 | New/open/save level, level info, starter-level/light-rig/grid/ring macros |
| **gameplay** | 15 | GAS (ability/effect/attribute set) + game-framework Blueprint presets, project default GameMode |
| **world** | 7 | World settings, actor replication/net dormancy, landscape material/info |
| **foliage** | 4 | Register foliage types, scatter/erase instances, foliage stats |
| **pcg** | 9 | Create/find PCG graphs, spawn PCG volumes, generate, add/connect graph nodes, read graph/component info, assign spawner meshes |
| **control-rig** | 2 | Create Control Rig Blueprints, read preview mesh/class info |
| **spatial** | 6 | Actor bounds, line trace, overlap test, place-on-ground, distance, spatial context analysis |
| **performance** | 3 | Render stats, disk-based memory/asset-size report, per-actor render cost profiling |

## Architecture

```
MCP Client (Claude Code, Claude Desktop, etc.)
  ↕ stdio (MCP protocol)
unreal-mcp server
  ↕ 4 transport layers
Unreal Engine
```

### Transport Layers

| Transport | Protocol | Port | What It Needs |
|-----------|----------|------|---------------|
| **Python Remote Execution** | UDP multicast + inverted TCP | 6776 | Python Editor Script Plugin (built-in) |
| **Remote Control API** | HTTP REST | 30010 | Remote Control API plugin (built-in) |
| **Plugin Bridge** | TCP, length-prefixed JSON | 55557 | Optional C++ plugin |
| **Subprocess Runner** | Spawns UAT/UBT processes | N/A | Engine path only |

The server probes all transports on startup and tools gracefully degrade. Most tools use Python Remote Execution. Build tools use subprocess. The optional C++ plugin adds deep Blueprint graph manipulation.

### Two Paths

- **Core path** (no plugin): Python + Remote Control covers ~95% of tools. Just enable the built-in UE plugins.
- **Plugin path** (optional): C++ plugin on port 55557 adds K2 node graph manipulation, faster bulk operations, and editor UI integration. Falls back to Python automatically when unavailable.

## Configuration

Three-layer priority: CLI args > environment variables > config file > defaults.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `UNREAL_MCP_PROJECT_PATH` | — | Path to .uproject file or project directory |
| `UNREAL_MCP_ENGINE_PATH` | auto-detect | UE engine install path |
| `UNREAL_MCP_RC_PORT` | 30010 | Remote Control API port |
| `UNREAL_MCP_PYTHON_PORT` | 6776 | Python Remote Execution port |
| `UNREAL_MCP_MULTICAST_BIND` | 127.0.0.1 | Bind address for the Python Remote Execution discovery socket. See the security warning above before setting this to `0.0.0.0`. |
| `UNREAL_MCP_MULTICAST_IFACE` | auto-detect | Outbound interface (IPv4) for multicast discovery pings. Only relevant once `UNREAL_MCP_MULTICAST_BIND` is widened past loopback — on hosts with multiple network adapters (Bluetooth PAN, Wi-Fi Direct, VPNs, an unplugged NIC), the OS can pick a link-local `169.254.*` adapter that never reaches the editor. Auto-detects the first real external IPv4; set this explicitly if auto-detection picks the wrong one. |
| `UNREAL_MCP_PLATFORM` | Win64 | Target platform |
| `UNREAL_MCP_CONFIGURATION` | Development | Build configuration |
| `UNREAL_MCP_MODULES` | all | Comma-separated list of modules to enable |
| `UNREAL_MCP_PLUGIN_SECRET` | — | Optional pre-shared secret for the plugin bridge's `authenticate` handshake (see the Blueprint graph tools section below). No effect unless the C++ plugin also validates it. |

### CLI Arguments

```bash
node dist/bin.js --project-path /path/to/project --engine-path /path/to/UE_5.5 --rc-port 30010 --multicast-bind 127.0.0.1
```

### Config File

Place `.unrealmcp.json` in your project directory or home directory:

```json
{
  "projectPath": ".",
  "platform": "Win64",
  "configuration": "Development",
  "enabledModules": ["console", "actor", "asset", "build", "blueprint", "material"]
}
```

**Least privilege:** only enable the modules you actually use. The default (no
`enabledModules` set) turns on all 30 modules, including ones with real destructive/system
reach (`build` runs UBT/UAT subprocesses, `plugin` rewrites your `.uproject`'s plugin list,
`source-control` checks in/reverts files). A tighter example for day-to-day level/content work:

```json
{
  "projectPath": ".",
  "enabledModules": ["console", "actor", "asset", "blueprint", "material"]
}
```

## Unreal Editor Setup

### Required (for most tools)

1. Edit > Plugins > enable **Python Editor Script Plugin**
2. Restart the editor
3. Edit > Project Settings > Plugins > **Python** > scroll to **Remote Execution** section:
   - Check **Enable Remote Execution**
   - **UE 5.3+:** If discovery fails with `127.0.0.1`, you may need to change **Multicast Bind Address** to `0.0.0.0` — Epic changed the default in 5.3 and it can break discovery between the editor and external tools, even on the same machine (WSL/VPN/multi-adapter setups are the usual cause).
   - Verify Multicast Group Endpoint is `239.0.0.1:6766`
4. Restart the editor again

> ⚠️ **Security warning — read before changing Multicast Bind Address to `0.0.0.0`.**
> UE's Python Remote Execution protocol has **no authentication**. Whoever can reach it gets
> arbitrary code execution inside the editor process (file system, shell, engine content —
> everything the editor process can do). Binding to `0.0.0.0` makes the editor's multicast
> socket listen on **every network interface**, not just loopback — including your LAN/Wi-Fi
> adapter. Anyone on the same network segment can then trick the editor into connecting out to
> them and executing their Python code (the protocol is "inverted": the editor dials out to
> whoever announced itself over multicast, with no identity check).
>
> Try `127.0.0.1` first — it works for the common case (this MCP server and the editor on the
> same machine, same network namespace). Only switch to `0.0.0.0` if discovery genuinely fails,
> and if you do:
> - Add a firewall rule that blocks inbound UDP 6766 and TCP 6776 from anything but
>   `127.0.0.1`/the loopback adapter (Windows Firewall: scope the allow rule to "Local subnet"
>   removed, "These IP addresses: 127.0.0.1" only), rather than leaving the ports reachable from
>   the whole LAN.
> - Never do this on an untrusted network (coffee shop Wi-Fi, conference network, shared office
>   LAN without device isolation).
> - Treat it as equivalent to leaving a root shell open on your network — because that's
>   effectively what it is.
>
> This server itself only ever connects to `127.0.0.1` (hardcoded, not configurable) — the
> exposure described above is purely a property of the UE editor's own setting, which this
> README used to recommend widening without this warning.
>
> **Residual risk even at `127.0.0.1`-only:** the TCP command channel this server opens
> (port 6776, via the `unreal-remote-execution` package) accepts whichever process connects
> to it first — it does not verify the connecting peer is actually the UE Editor. Binding to
> loopback stops other machines from reaching it, but **not** other users/processes on the
> same machine: on a shared or multi-user system, a second local process could in principle
> race to connect first and both receive the Python command meant for UE and return a forged
> result back to this server. This is a property of the underlying protocol (Epic's Python
> Remote Execution has no shared secret to authenticate with), not something this server can
> fix on its own. Don't run this on a shared/multi-tenant machine you don't fully trust.

**Still getting "No Unreal Editor nodes found"?**
- **VPN/Tailscale users:** Tailscale's virtual network adapter can hijack multicast. Try temporarily disabling Tailscale, or disable the Tailscale network adapter in Windows Network Connections.
- **Firewall:** Allow UDP port 6766 and TCP port 6776, or temporarily disable Windows Firewall to test.
- **Multiple adapters (Bluetooth PAN, Wi-Fi Direct, an unplugged NIC, WSL, Hyper-V, VPNs):** once `UNREAL_MCP_MULTICAST_BIND` is widened past `127.0.0.1`, discovery pings can leave on the wrong adapter — Windows often picks a link-local `169.254.*` one the editor never sees, even though the editor is answering pings sent on the correct adapter. Set `UNREAL_MCP_MULTICAST_IFACE` to your real LAN IP to pin the outbound interface explicitly, rather than disabling unused adapters.

### Optional (for Remote Control tools)

1. Edit > Plugins > enable **Remote Control API**
2. Restart the editor
3. Edit > Project Settings > Plugins > **Remote Control** > **Server**:
   - Check **Restrict Server Access** — this sounds restrictive but actually *enables* the sub-options below (unchecked = features hidden/off)
   - Check **Enable Remote Python Execution**
   - Check **Allow Console Command Remote Execution**
   - Allowed Origins: leave blank or add `127.0.0.1`
   - These take effect immediately, no restart needed

> ⚠️ **Trust boundary — Remote Control API has no authentication of its own.**
> UE's Remote Control plugin accepts plain HTTP requests with no API key, token, or
> other credential — this server sends none, because there is nothing on the UE side
> to validate one against. The only real protection is that this server hardcodes
> `127.0.0.1` for the Remote Control connection (not configurable via flag or env
> var), so the exposure is the same "anyone on this machine can reach it" boundary
> described above for Python Remote Execution, not a network-wide one. Don't expose
> port 30010 (or any of this server's ports) beyond loopback.

### Optional (for Blueprint graph tools)

Install the C++ plugin from `plugin/UnrealMCPBridge/` into your project's `Plugins/` directory. This enables `add_graph_node`, `connect_graph_nodes`, and `remove_graph_node`.

Unlike the Remote Control API and Python Remote Execution (both UE-owned protocols with
no auth surface we can add to), the plugin bridge is this project's *own* protocol — both
the TypeScript client and the C++ plugin server are ours, which makes a real handshake
possible. Set `UNREAL_MCP_PLUGIN_SECRET` (or `--plugin-secret <value>`) to a shared secret
and the client sends it as an `authenticate` command right after connecting, before capability
negotiation; a mismatched or unsupported secret fails the connection closed rather than
falling through to an unauthenticated one. This is opt-in and requires matching support on
the plugin side — leaving it unset changes nothing about the existing zero-config behavior.

## Roadmap

Planned work is split by whether it needs the optional C++ plugin:

- **[Tier 1 — no plugin](docs/ROADMAP.md)** — achievable today over Python
  Remote Execution / Remote Control. Covers communication improvements
  (`read_log` to surface the real UE Output Log, build progress notifications,
  editor-context resources) and new domains (a full **environment** module —
  lighting, fog, post-process, physics, splines — plus **audio**, **navigation**,
  and **widget** authoring), along with read-back/inspect gaps in the niagara,
  animation, sequencer, and material modules. Also captures the security
  invariants to keep as the surface grows.
- **[Tier 2 — optional C++ plugin](docs/TIER2-PLUGIN.md)** — capabilities Unreal
  does not expose to Python: real Blueprint graph node editing, offscreen
  render-to-PNG feedback (graph / widget / material thumbnail), node auto-layout,
  and Blueprint debugging (breakpoints, watches, compile-error introspection).

## Development

```bash
npm run dev        # Watch-mode dev server
npm run build      # Compile TypeScript
npm run lint       # Biome linter
npm run fmt        # Biome formatter
npm test           # Run tests
npm run verify-tools  # Generate every tool's Python and check it with ast.parse (needs python3 on PATH; normal use doesn't)
```

## License

MIT
