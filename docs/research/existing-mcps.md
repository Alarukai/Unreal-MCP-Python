# Existing Unreal Engine MCP Servers — Research (March 2026)

## Overview

A survey of 13+ existing MCP (Model Context Protocol) servers for Unreal Engine, analyzed for capabilities, architecture, maturity, and gaps.

---

## Tier 1: Most Mature / Feature-Rich

### 1. chongdashu/unreal-mcp

- **URL:** https://github.com/chongdashu/unreal-mcp
- **Stars:** ~1,600 (most popular)
- **Language:** C++ (52%) + Python (47%)
- **UE Version:** 5.5+ (pre-built binaries for 5.5 and 5.6)
- **Connection:** Custom C++ UE plugin provides TCP server on port 55557; Python MCP server translates MCP calls to TCP/JSON commands
- **Capabilities:**
  - Actor operations: create, delete, transform, list
  - Blueprint development: create BP classes, add components, configure properties, compile, spawn actors
  - Node graph editing: event nodes, function call nodes, variable management, graph node discovery
  - Editor/viewport control, camera orientation
  - Comes with sample UE 5.5 project (MCPGameProject)
- **Architecture:**
  ```
  Claude Desktop / Claude Code
      | (MCP stdio)
  Python MCP Server
      | (TCP port 55557, JSON)
  C++ UE Plugin (in-editor)
      | (UE C++ APIs)
  Unreal Editor
  ```
- **Strengths:** Most popular, good docs, active community, pre-built binaries
- **Limitations:** No build control, no material graph editing, no sequencer, no testing

---

### 2. flopperam/unreal-engine-mcp

- **URL:** https://github.com/flopperam/unreal-engine-mcp
- **Website:** https://www.flopperam.com/
- **Stars:** ~592
- **Language:** Python (MCP server) + C++ (UE plugin)
- **UE Version:** 5.5+
- **Connection:** Native C++ plugin with TCP communication and automatic reconnection
- **Capabilities:**
  - **Deepest Blueprint support of any project:**
    - 23+ node types: Branch, Comparison, Switch, SwitchEnum, SwitchInteger, ExecutionSequence, etc.
    - Variables with full property control
    - Custom functions
    - Dynamic graph management
    - Dedicated `blueprint-graph-guide.md` documentation
  - World building/architecture (towns, castles, mazes)
  - Level design, physics & materials
  - Actor management
  - Blueprint analysis and graph inspection
- **Architecture:** Similar to chongdashu — C++ plugin + Python MCP server
- **Strengths:** Most advanced Blueprint/visual scripting support, detailed guides, Docker image available
- **Limitations:** No build control, no material graph authoring, no sequencer, no testing

---

### 3. ChiR24/Unreal_mcp

- **URL:** https://github.com/ChiR24/Unreal_mcp
- **Stars:** ~374
- **Language:** TypeScript + C++
- **Connection:** Native C++ Automation Bridge plugin with action-based dispatch
- **Capabilities (36 MCP tools):**
  - Asset & world management: browse, import, duplicate, rename, delete assets, create materials
  - Actor & editor control: spawning, transforms, physics, tags, PIE, camera, screenshots
  - Animation & VFX: animation BPs, state machines, ragdolls, vehicles, Niagara particles
  - Graph editing: Blueprint, Niagara, Material, and Behavior Tree graphs (broadest coverage)
  - Audio, sequencer/cinematics, AI/behavior trees
  - Gameplay ability system, networking, input management
- **Strengths:** Most feature-rich by tool count (36 tools), broadest graph type coverage
- **Limitations:** 523 commits but lower star count; no build control

---

## Tier 2: Specialized / Moderate

### 4. runreal/unreal-mcp

- **URL:** https://github.com/runreal/unreal-mcp
- **npm:** `@runreal/unreal-mcp` (v0.1.4)
- **Stars:** ~82
- **Language:** Python (61%) + TypeScript (39%)
- **Connection:** Uses UE's built-in Python Remote Execution protocol (port 6776) — **no custom plugin required**
- **UE Version:** 5.4+
- **Capabilities (19 tools):**
  - Configuration, editor Python execution
  - Asset management: list, export, search, validate, references
  - Project & level info
  - World manipulation: create, update, delete objects
  - Console commands, screenshots, camera control
- **Strengths:** Only MCP published on npm; no plugin installation needed; simple setup
- **Limitations:** No Blueprint support, no build control

---

### 5. ayeletstudioindia/unreal-analyzer-mcp

- **URL:** https://github.com/ayeletstudioindia/unreal-analyzer-mcp
- **Stars:** ~145
- **Language:** TypeScript
- **Connection:** Does NOT connect to running UE editor — analyzes source code on disk
- **Capabilities:**
  - C++ class analysis (methods, properties, inheritance)
  - Class hierarchy mapping
  - Context-aware code search, reference finding
  - UE subsystem analysis (Rendering, Physics, etc.)
  - Pattern detection & learning
  - Best practices guide (UPROPERTY, UFUNCTION, etc.)
- **Strengths:** Excellent for understanding UE codebases; complements editor-control MCPs
- **Limitations:** Read-only code analysis; no editor interaction

---

### 6. atomantic/UEMCP

- **URL:** https://github.com/atomantic/uemcp
- **Stars:** ~15
- **Language:** Python (UE plugin) + Node.js/TypeScript (MCP server)
- **Connection:** Two-tier: Node.js MCP protocol layer + Python editor plugin
- **Capabilities (36 tools across 8 categories):**
  - Project & asset management
  - Actor management: spawn, duplicate, delete, modify, organize, snap, batch
  - Level operations, viewport control (8 tools including render modes)
  - Material system, Blueprint system
  - System tools: **unrestricted Python proxy** (execute arbitrary Python), undo/redo, history, checkpoints, batch operations
- **Strengths:** Auto-detects multiple AI clients; Python proxy gives escape hatch to full UE API
- **Limitations:** Low star count; Python proxy is powerful but unstructured

---

### 7. Natfii/ue5-mcp-bridge + Natfii/UnrealClaude

- **URL:** https://github.com/Natfii/ue5-mcp-bridge / https://github.com/Natfii/UnrealClaude
- **Stars:** ~13
- **Language:** TypeScript (MCP bridge) + C++ (UE plugin)
- **UE Version:** 5.7
- **Capabilities (20+ tools):**
  - Level & actor management, asset operations
  - Script execution (C++, Python, console)
  - Blueprint & Animation Blueprint editing (state machines, transitions, condition graphs)
  - Enhanced Input System, character data, material management
  - Viewport screenshots, async task queue
  - **UE 5.7 API documentation access**
- **Strengths:** Targets latest UE 5.7; strong Animation Blueprint support; Claude Code CLI integration
- **Limitations:** Very new, low adoption

---

## Tier 3: Early / Experimental

### 8. kvick-games/UnrealMCP

- **URL:** https://github.com/kvick-games/UnrealMCP
- **Language:** C++ (62%) + Python (36%)
- **UE Version:** 5.5
- **Connection:** C++ TCP server plugin on port 13377 + Python MCP bridge
- **Capabilities (5 tools):**
  - `get_scene_info` — scene queries
  - `create_object` — spawn actors
  - `delete_object` — remove actors
  - `modify_object` — transform changes
  - `execute_python` — run arbitrary Python in UE
- **Status:** Self-described as "VERY WIP REPO"
- **Roadmap:** Asset tools, Blueprints, Niagara, Metasound, Landscape, Modeling, PCG

---

### 9. GenOrca/unreal-mcp (Unreal-MCPython)

- **URL:** https://github.com/GenOrca/unreal-mcp
- **Stars:** ~52
- **Capabilities:** Actor manipulation, asset management, material system, Blueprint graph operations (partial — inspect/add/connect/remove nodes), behavior tree & blackboard management

### 10. VedantRGosavi/UE5-MCP

- **URL:** https://github.com/VedantRGosavi/UE5-MCP
- **Status:** Appears to be more design document/research project than working implementation

### 11. prajwalshettydev/UnrealGenAISupport

- **URL:** https://github.com/prajwalshettydev/UnrealGenAISupport
- **Status:** Multi-LLM UE plugin with built-in MCP server; explicitly warns "should not be used in production"

### 12. p4ulyb / UE Semantic Analysis MCP Server

- **URL:** Listed on LobeHub
- **Status:** Niche — Clangd LSP integration for semantic code analysis, SQLite FTS5 indexing

### 13. runeape-sats/unreal-mcp

- **URL:** https://github.com/runeape-sats/unreal-mcp
- **Status:** Early alpha; UE 5.3; basic Remote Control API wrapper

---

## Architecture Patterns Observed

| Pattern | Used By | Pros | Cons |
|---------|---------|------|------|
| **Custom C++ plugin + TCP + Python MCP** | chongdashu, flopperam, kvick-games | Full C++ API access, low latency | Requires plugin build per UE version |
| **Custom C++ plugin + TCP + TypeScript MCP** | ChiR24, Natfii | Same as above, TS ecosystem | Same maintenance burden |
| **Python UE plugin + Node.js MCP** | atomantic | Python is easier to iterate | Two runtimes |
| **UE Python Remote Exec (port 6776)** | runreal | No custom plugin needed | Limited to Python API surface |
| **UE Remote Control API (HTTP)** | runeape-sats, 5pmika | No custom plugin, REST standard | Not all operations available |
| **Static code analysis (no editor)** | ayeletstudio, p4ulyb | No UE dependency | Can't modify anything |

---

## MCP Registries / Directories

- **PulseMCP** (pulsemcp.com) — lists runreal/unreal-mcp
- **mcpservers.org** — lists multiple Unreal MCPs
- **LobeHub** (lobehub.com) — lists several Unreal MCPs
- **Glama.ai** — lists unreal-analyzer-mcp
- **Docker Hub** — has image for unreal-engine-mcp
- **npm** — only `@runreal/unreal-mcp` published
- **PyPI** — none published
