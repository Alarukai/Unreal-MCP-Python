# Unreal Engine Automatable API Surface — Research (March 2026)

A comprehensive map of every UE subsystem that can be programmatically controlled, with current MCP coverage status.

---

## 1. Remote Control API (HTTP REST + WebSocket)

**Built-in plugin** — ships with UE. No custom code needed.

- **HTTP port:** 30010
- **WebSocket port:** 30020

### Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| PUT | `/remote/object/property` | Get/set any property on any UObject |
| PUT | `/remote/object/call` | Call any BlueprintCallable function on any UObject |
| PUT | `/remote/batch` | Batch multiple property/call requests |
| PUT | `/remote/search` | Search for objects/assets in the editor |
| GET/PUT | `/remote/preset/{preset}/*` | Access Remote Control Preset properties/functions |

### WebSocket

Persistent connection at `ws://127.0.0.1:30020`. Supports:
- Property change subscriptions
- Event watching
- Same capabilities as HTTP

### MCP Coverage

**Poorly covered.** Only `5pmika/unreal-remote-control-mcp` wraps this, exposing just `get_info` and `call_function`. Property get/set, batch, search, preset management, and WebSocket subscriptions are all unexposed.

---

## 2. Python Scripting API (`unreal` module)

**Built-in plugin** — enable "Python Editor Script Plugin" in UE.

### Editor Subsystems (UE5+ pattern)

| Subsystem | Purpose |
|-----------|---------|
| `EditorAssetSubsystem` | List, find, rename, duplicate, delete, consolidate assets |
| `EditorActorSubsystem` | Spawn, select, duplicate, destroy actors; get selected |
| `EditorLevelSubsystem` | Load/save levels, get editor world |
| `EditorStaticMeshLibrary` | LOD generation, collision, mesh simplification |
| `EditorSkeletalMeshLibrary` | LOD, reimport skeletal meshes |
| `AssetEditorSubsystem` | Open/close asset editors |
| `LayersSubsystem` | Manage editor layers |
| `ImportSubsystem` | Asset import hooks |
| `EditorValidatorSubsystem` | Run data validation |
| `UnrealEditorSubsystem` | Editor state queries |

### Asset Pipeline

| API | Purpose |
|-----|---------|
| `AssetTools` / `AssetToolsHelpers` | Create, import, export, migrate assets |
| `EditorAssetLibrary` | Rename, duplicate, delete, find, checkout, save assets |
| `EditorFilterLibrary` | Filter asset lists |

### Python Remote Execution

- **Port 6776** — built-in protocol for executing Python remotely in the editor
- Used by `runreal/unreal-mcp` — no custom plugin needed
- Can access the full `unreal` module

### MCP Coverage

Some MCPs offer arbitrary Python execution (`atomantic/python_proxy`, `kvick-games/execute_python`) but **no MCP wraps these into typed, validated, discoverable tools**.

---

## 3. UnrealBuildTool (UBT) & Unreal Automation Tool (UAT)

### UBT (`UnrealBuildTool.exe`)

Compiles C++ code. Key parameters:
- **Target:** Game, Editor, Client, Server
- **Platform:** Win64, Linux, Mac, Android, iOS, etc.
- **Configuration:** Debug, DebugGame, Development, Shipping, Test
- **Flags:** `-Clean`, `-NoHotReload`, `-DisableUnity`, `-Verbose`

### UAT (`RunUAT.bat` / `RunUAT.sh`)

Primary automation entry point. Key commands:

| Command | Purpose |
|---------|---------|
| `BuildCookRun` | The main pipeline: build + cook + stage + package + archive + deploy + run |
| `BuildGraph` | Execute BuildGraph XML scripts for CI/CD |
| `BuildPlugin` | Build a plugin standalone |
| `RunUnreal` | Launch Gauntlet test sessions |
| `Localise` | Localization pipeline |
| `BuildDerivedDataCache` | Pre-fill DDC |
| `AnalyzeThirdPartyLibs` | Dependency analysis |
| `GenerateProjectFiles` | Regenerate IDE project files |

### BuildCookRun Key Flags

`-build`, `-cook`, `-stage`, `-package`, `-archive`, `-deploy`, `-run`, `-iterate`, `-compressed`, `-pak`, `-distribution`, `-platform=`, `-configuration=`

### MCP Coverage

**Completely unexposed.** No existing MCP wraps UBT or UAT. This is the single biggest gap for CI/CD and build workflows.

---

## 4. Editor Utility Widgets & Editor Scripting Utilities

### Editor Scripting Utilities Plugin

- `EditorAssetLibrary` — bulk asset operations
- `EditorLevelLibrary` — level manipulation
- `EditorStaticMeshLibrary` — mesh optimization (LOD generation, collision setup, lightmap UV generation)
- Data validation framework

### Editor Utility Widgets (EUW)

- UMG-based dockable editor panels
- Can be marked as "Startup Objects" to auto-run
- Support Blueprint and Python scripting
- Invokable programmatically via `EditorUtilitySubsystem`

### Editor Utility Blueprints (EUB)

- `Run` event can be triggered programmatically
- Can execute arbitrary editor operations

### MCP Coverage

**Unexposed.** No MCP can trigger EUW/EUB by name or access Editor Scripting Utilities functions.

---

## 5. Commandlets

Run headless via `UnrealEditor.exe ProjectName -run=CommandletName`.

| Commandlet | Purpose |
|-----------|---------|
| `ResavePackages` | Bulk resave all packages |
| `CookPackages` | Cook content for target platform |
| `CompressAnimations` | Batch compress all animations |
| `ContentAudit` | Find costly/problematic assets |
| `FixUpRedirects` | Clean up asset redirectors |
| `MergePackages` | Merge package contents |
| `BatchExport` | Export resources from packages |
| `DiffPackages` | Compare package contents |
| `AnalyzeReferencedContent` | Identify data usage |
| `DerivedDataCache` | Fill/manage DDC |
| `GatherText` | Localization text gathering |
| `ImportLocalizedDialogue` | Import localized audio |

### MCP Coverage

**Completely unexposed.** Bulk asset operations, content auditing, localization — all missing.

---

## 6. Source Control Integration

### Python API (`unreal.SourceControl`)

| Method | Purpose |
|--------|---------|
| `check_out(filename)` | Check out files |
| `check_in(filename)` | Check in files |
| `mark_for_add(filename)` | Mark new files |
| `revert(filename)` | Revert changes |
| `status(filename)` | Query file status |

### SourceControlState Properties

`can_check_in`, `can_check_out`, `is_checked_out`, `is_checked_out_other`, `is_current`, `is_added`, `is_deleted`, `is_modified`, `can_revert`, `is_source_controlled`, `is_conflicted`

### C++ API

`ISourceControlModule` — full provider abstraction (Perforce, Git, SVN, Plastic SCM)

### MCP Coverage

**Completely unexposed.**

---

## 7. Unreal Insights / Profiling

### Trace System

- Trace channels: CPU, GPU, Frame, Memory, Counters, Bookmarks, File activity, Net, Asset loading
- Stored as `.utrace` files
- Launch with `-trace=cpu,gpu,frame,memory` flags
- `stat` console commands for runtime stats
- CSV profiling for automated perf regression testing

### MCP Coverage

**Completely unexposed.** Trace session management, perf data querying, stat commands — all missing.

---

## 8. Gameplay Ability System (GAS)

### Components

| Class | Purpose |
|-------|---------|
| `UAbilitySystemComponent` | Core — grant, activate, cancel abilities |
| `UGameplayAbility` | Define abilities (Blueprint or C++) |
| `UGameplayEffect` | Modify attributes, apply buffs/debuffs |
| `UGameplayEffectExecutionCalculation` | Custom effect calculations (C++ only) |
| `UAttributeSet` | Define gameplay attributes |
| `FGameplayTag` / `FGameplayTagContainer` | Tag-based management |
| `UGameplayCueManager` | Visual/audio feedback |
| `UGameplayTask` | Async ability tasks |

### MCP Coverage

**Unexposed.** Granting/revoking abilities, applying effects, querying attributes, managing tags — all missing.

---

## 9. Niagara VFX System

### Python API

| Method | Purpose |
|--------|---------|
| `NiagaraComponent.set_niagara_variable_float()` | Set float parameter |
| `NiagaraComponent.set_niagara_variable_vec3()` | Set vector parameter |
| `NiagaraComponent.set_niagara_variable_linear_color()` | Set color parameter |
| `NiagaraComponent.set_variable_bool()` | Set bool parameter |
| `NiagaraComponent.reset_system()` | Reset VFX system |
| `NiagaraComponent.reinit_system()` | Reinitialize system |
| `NiagaraFunctionLibrary.spawn_system_at_location()` | Spawn VFX at location |
| `NiagaraFunctionLibrary.spawn_system_attached()` | Spawn VFX attached to actor |

### MCP Coverage

**Unexposed.** ChiR24/Unreal_mcp claims Niagara graph editing but parameter control and spawning are not covered by any MCP.

---

## 10. Material Editor Scripting

### `MaterialEditingLibrary` (Python)

| Method | Purpose |
|--------|---------|
| `create_material_expression(material, class, x, y)` | Add nodes to material graph |
| `create_material_expression_in_function(func, class, x, y)` | Add nodes to material functions |
| `connect_material_expressions(from, out, to, in)` | Wire nodes together |
| `connect_material_property(from, out, property)` | Connect to material output |
| `delete_material_expression(material, expression)` | Remove nodes |
| `get_material_expressions(material)` | List all expression nodes |
| `set_material_instance_parent(instance, parent)` | Set MI parent |
| `get/set_material_instance_scalar_parameter_value()` | Scalar params |
| `get/set_material_instance_texture_parameter_value()` | Texture params |
| `get/set_material_instance_vector_parameter_value()` | Vector params |
| `recompile_material(material)` | Recompile after changes |

### MCP Coverage

**Mostly unexposed.** flopperam supports applying materials to actors, but **material graph construction** (creating/wiring expression nodes, material function authoring) is not covered.

---

## 11. Sequencer / Cinematics

### `LevelSequence` / `MovieSceneSequence` (Python)

- Load/create level sequences
- Add/remove bindings (actors bound to tracks)
- Add/remove tracks (transform, animation, audio, event, etc.)
- Add/remove sections with keyframes
- Control playback range, frame rate

### `SequencerTools`

| Method | Purpose |
|--------|---------|
| `export_anim_sequence()` | Export bindings as AnimSequences |
| `export_level_sequence_fbx()` | Export to FBX |
| `import_level_sequence_fbx()` | Import from FBX |

### Movie Render Queue

- `MoviePipelineQueueSubsystem` — queue render jobs
- `MoviePipelineExecutorJob` — configure render settings
- Multi-pass rendering, accumulation, various output formats

### MCP Coverage

**Completely unexposed.** Cinematic creation, track/keyframe manipulation, rendering, Movie Render Queue — all missing.

---

## 12. Animation Scripting

### Python API

| Class/Method | Purpose |
|-------------|---------|
| `AnimBlueprint` | Create via `AnimBlueprintFactory`, set `target_skeleton` |
| `AnimSequence` | Access length, frames, bone data; add custom attributes |
| `AnimMontage` | Montage assets |
| `AnimationLibrary` | `get_nodes_of_class()`, `get_num_frames()`, query graph nodes |
| `AnimationModifiersLibrary` | Apply animation modifiers |
| `EditorSkeletalMeshLibrary` | LOD, reimport |

### Limitations

AnimBP graph editing (state machines, blend trees) is largely C++/Blueprint-only. Python can create AnimBPs and set properties but cannot easily construct state machine topology.

### MCP Coverage

**Mostly unexposed.** Natfii/ue5-mcp-bridge has Animation Blueprint support (state machines, transitions) but is very new/low adoption.

---

## 13. World Partition / Data Layers

### Data Layers

- `UDataLayerManager` — manage data layers
- Change layer state: Loaded, Activated, Unloaded
- Actors assigned to layers for streaming control

### World Partition

- `UWorldPartitionStreamingSourceComponent` — any actor as streaming source
- `UWorldPartitionSubsystem` — query loaded/unloaded cells
- HLOD management (auto-generated hierarchical LODs)

### MCP Coverage

**Completely unexposed.**

---

## 14. Plugin Management

- `.uplugin` / `.uproject` files control plugin enable/disable
- C++: `IPluginManager` interface
- Python: No official API for runtime enable/disable

### MCP Coverage

**Completely unexposed.**

---

## 15. Testing / Automation Framework

### Frameworks

| Framework | Type | Scope |
|-----------|------|-------|
| Automation Spec | C++ macro-based | Unit/integration tests, parametric |
| Functional Tests (`AFunctionalTest`) | Blueprint/C++ | In-level integration tests |
| Gauntlet | Orchestration | Multi-run, multi-platform sessions |
| Low Level Tests (Catch2) | C++ | Fast, isolated unit tests |
| Map Check | Editor tool | Level validation |
| Data Validation (`IsDataValid`) | Override | Per-asset validation |
| CQTest | C++ | Before/AfterAll lifecycle hooks |

### Execution

- **Gauntlet:** `RunUAT RunUnreal -project=... -platform=Win64 -configuration=Development -build=local -test=TestName`
- **Console:** `automation run`, `automation list`, `automation runall`

### MCP Coverage

**Completely unexposed.** Running tests, querying results, triggering validation, Gauntlet sessions — all missing.

---

## Gap Summary

### Covered by Existing MCPs (collectively)

- Actor CRUD (spawn, delete, transform)
- Blueprint class creation & compilation
- Blueprint event graph node creation/wiring
- Component add/configure
- Material application to actors
- Viewport camera control
- Arbitrary Python execution (escape hatch)
- Static C++ code analysis

### Major Gaps (no MCP covers)

| Priority | Gap Area | UE API |
|----------|----------|--------|
| **Critical** | Build/Cook/Package pipeline | RunUAT BuildCookRun, UBT |
| **Critical** | Testing/Automation | Gauntlet, Automation Spec, Functional Tests |
| **High** | Source Control operations | `unreal.SourceControl` |
| **High** | Sequencer/Cinematics | LevelSequence, SequencerTools, Movie Render Queue |
| **High** | Material graph authoring | `MaterialEditingLibrary` |
| **High** | Commandlet execution | ResavePackages, ContentAudit, etc. |
| **High** | Structured asset management | EditorAssetSubsystem, AssetTools |
| **Medium** | Niagara VFX control | NiagaraComponent, NiagaraFunctionLibrary |
| **Medium** | Animation scripting | AnimBlueprint, AnimSequence, AnimationLibrary |
| **Medium** | Remote Control property get/set | Full REST API |
| **Medium** | Profiling/Insights | Trace system, stat commands |
| **Medium** | World Partition/Data Layers | DataLayerManager, WorldPartitionSubsystem |
| **Medium** | Gameplay Ability System | AbilitySystemComponent, GameplayEffects, Tags |
| **Medium** | Editor Utility invocation | EditorUtilitySubsystem |
| **Low** | Plugin management | .uplugin/.uproject, IPluginManager |

---

## Sources

- [UE Remote Control API HTTP Reference (5.7)](https://dev.epicgames.com/documentation/en-us/unreal-engine/remote-control-api-http-reference-for-unreal-engine)
- [UE Remote Control API WebSocket Reference (5.7)](https://dev.epicgames.com/documentation/en-us/unreal-engine/remote-control-api-websocket-reference-for-unreal-engine)
- [Scripting the UE Editor Using Python (5.7)](https://dev.epicgames.com/documentation/en-us/unreal-engine/scripting-the-unreal-editor-using-python)
- [Python Scripting in Sequencer (5.6)](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-scripting-in-sequencer-in-unreal-engine)
- [MaterialEditingLibrary Python API (5.4)](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/MaterialEditingLibrary)
- [Gameplay Ability System (5.7)](https://dev.epicgames.com/documentation/en-us/unreal-engine/gameplay-ability-system-for-unreal-engine)
- [Gauntlet Automation Framework (5.7)](https://dev.epicgames.com/documentation/en-us/unreal-engine/gauntlet-automation-framework-in-unreal-engine)
- [Automation Test Framework (5.7)](https://dev.epicgames.com/documentation/en-us/unreal-engine/automation-test-framework-in-unreal-engine)
- [World Partition Data Layers (5.7)](https://dev.epicgames.com/documentation/en-us/unreal-engine/world-partition---data-layers-in-unreal-engine)
- [Unreal Insights (5.7)](https://dev.epicgames.com/documentation/unreal-engine/unreal-insights-in-unreal-engine)
- [Editor Utility Widgets (5.7)](https://dev.epicgames.com/documentation/en-us/unreal-engine/editor-utility-widgets-in-unreal-engine)
- [NiagaraComponent Python API](https://docs.unrealengine.com/4.27/en-US/PythonAPI/class/NiagaraComponent.html)
- [UBT/UAT Reference (ikrima gamedev guide)](https://ikrima.dev/ue4guide/build-guide/ubt/automationtool-exe-unrealbuildtool-exe-reference/)
