from pathlib import Path
import json


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"Expected exactly one {label}; found {count}")
    return text.replace(old, new, 1)


# Web: resolve @fork-wasm as the generated package, including its package.json/types entry.
vite_path = Path("web/vite.config.ts")
vite = vite_path.read_text()
vite = replace_once(
    vite,
    """      '@fork-wasm': path.resolve(\n        __dirname,\n        '..',\n        'crates',\n        'fork_wasm',\n        'pkg-web',\n        'fork_wasm.js'\n      ),""",
    """      '@fork-wasm': path.resolve(__dirname, '..', 'crates', 'fork_wasm', 'pkg-web'),""",
    "web WASM alias",
)
vite_path.write_text(vite)

web_tsconfig_path = Path("web/tsconfig.app.json")
web_tsconfig = web_tsconfig_path.read_text()
web_tsconfig = replace_once(
    web_tsconfig,
    '    "module": "ESNext",\n',
    '    "module": "ESNext",\n    "baseUrl": ".",\n    "paths": {\n      "@fork-wasm": ["../crates/fork_wasm/pkg-web"]\n    },\n',
    "web TypeScript WASM path",
)
web_tsconfig_path.write_text(web_tsconfig)

ambient_path = Path("web/src/types/wasm.d.ts")
if not ambient_path.exists():
    raise RuntimeError("Expected the hand-maintained web WASM declaration shim")
ambient_path.unlink()

worker_path = Path("web/src/compute/worker/forkCoreWorker.ts")
worker = worker_path.read_text()
worker = replace_once(
    worker,
    "  ContinuationBranchDataWire,\n",
    "",
    "ContinuationBranchDataWire import",
)
manual_type_start = worker.index("type WasmModule = {")
manual_type_end = worker.index("\n\nconst pendingControllers", manual_type_start)
module_types = """type WasmModule = typeof import('@fork-wasm')
type GeneratedWasmSystem = InstanceType<WasmModule['WasmSystem']>
type WasmSystem = Omit<
  GeneratedWasmSystem,
  | 'compute_event_series_from_orbit'
  | 'compute_event_series_from_samples'
  | 'compute_isocline'
> & {
  compute_event_series_from_orbit?: GeneratedWasmSystem['compute_event_series_from_orbit']
  computeEventSeriesFromOrbit?: GeneratedWasmSystem['compute_event_series_from_orbit']
  compute_event_series_from_samples?: GeneratedWasmSystem['compute_event_series_from_samples']
  computeEventSeriesFromSamples?: GeneratedWasmSystem['compute_event_series_from_samples']
  compute_isocline?: GeneratedWasmSystem['compute_isocline']
  computeIsocline?: GeneratedWasmSystem['compute_isocline']
}"""
worker = worker[:manual_type_start] + module_types + worker[manual_type_end:]
worker = replace_once(
    worker,
    """    wasmPromise = import('@fork-wasm').then(async (mod) => {
      if (typeof mod.default === 'function') {
        await mod.default()
      }
      return mod as WasmModule
    })""",
    """    wasmPromise = import('@fork-wasm').then(async (module) => {
      await module.default()
      return module
    })""",
    "web WASM loader",
)
worker = replace_once(
    worker,
    "function createWasmSystem(wasm: WasmModule, system: SystemConfig) {",
    "function createWasmSystem(wasm: WasmModule, system: SystemConfig): WasmSystem {",
    "createWasmSystem signature",
)
worker = replace_once(
    worker,
    """    system.type
  )
  instance.set_periods?.(new Float64Array(periodicPeriodsForConfig(system)))""",
    """    system.type
  ) as WasmSystem
  instance.set_periods(new Float64Array(periodicPeriodsForConfig(system)))""",
    "generated WasmSystem construction",
)
worker = replace_once(
    worker,
    """  const axisMins = request.axes.map((axis) => axis.min)
  const axisMaxs = request.axes.map((axis) => axis.max)
  const axisSamples = request.axes.map((axis) => axis.samples)""",
    """  const axisIndexValues = Uint32Array.from(axisIndices)
  const axisMins = Float64Array.from(request.axes.map((axis) => axis.min))
  const axisMaxs = Float64Array.from(request.axes.map((axis) => axis.max))
  const axisSamples = Uint32Array.from(request.axes.map((axis) => axis.samples))
  const frozenState = Float64Array.from(request.frozenState)""",
    "isocline typed-array preparation",
)
worker = replace_once(worker, "    axisIndices,\n", "    axisIndexValues,\n", "isocline axis arguments")
worker = replace_once(worker, "    request.frozenState,\n", "    frozenState,\n", "isocline frozen state")
worker = replace_once(
    worker,
    """  return system.solve_equilibrium(
    request.initialGuess,""",
    """  return system.solve_equilibrium(
    new Float64Array(request.initialGuess),""",
    "equilibrium initial guess conversion",
)
worker = replace_once(
    worker,
    """  let seed = system.init_map_cycle_from_pd(
    request.pdState,""",
    """  let seed = system.init_map_cycle_from_pd(
    new Float64Array(request.pdState),""",
    "map-cycle PD seed conversion",
)
worker = replace_once(
    worker,
    """    const solution = system.solve_equilibrium(
      seed,""",
    """    const solution = system.solve_equilibrium(
      new Float64Array(seed),""",
    "map-cycle equilibrium seed conversion",
)
if "type WasmModule = {" in worker:
    raise RuntimeError("Hand-maintained WasmModule declaration remains")
worker_path.write_text(worker)

# CLI: guarantee the generated Node package exists before TypeScript compilation.
cli_package_path = Path("cli/package.json")
cli_package = json.loads(cli_package_path.read_text())
scripts = cli_package["scripts"]
new_scripts = {}
for key, value in scripts.items():
    if key == "start":
        new_scripts["prestart"] = "npm run wasm:node"
    if key == "build":
        new_scripts["prebuild"] = "npm run wasm:node"
    new_scripts[key] = value
cli_package["scripts"] = new_scripts
cli_package_path.write_text(json.dumps(cli_package, indent=2) + "\n")

cli_wasm_path = Path("cli/src/wasm.ts")
cli = cli_wasm_path.read_text()
cli = replace_once(
    cli,
    """// We use require to load the WASM bindings generated by wasm-pack target nodejs
let wasmModule: any;""",
    """export type ForkWasmModule = typeof import("../../crates/fork_wasm/pkg/fork_wasm");
export type GeneratedWasmSystem = InstanceType<ForkWasmModule["WasmSystem"]>;
type WasmSystem = GeneratedWasmSystem & {
    continue_limit_cycle_from_hopf?: (
        hopfState: Float64Array,
        hopfParam: number,
        parameterName: string,
        methodRequest: unknown,
        amplitude: number,
        settings: unknown,
        forward: boolean
    ) => unknown;
    extend_limit_cycle_branch?: (
        branchData: unknown,
        parameterName: string,
        meta: LimitCycleMeta,
        settings: unknown,
        forward: boolean
    ) => unknown;
};

// We use require to load the WASM bindings generated by wasm-pack target nodejs
let wasmModule: ForkWasmModule | undefined;""",
    "CLI generated module type",
)
cli = replace_once(
    cli,
    '    wasmModule = require("../../crates/fork_wasm/pkg/fork_wasm.js");',
    '    wasmModule = require("../../crates/fork_wasm/pkg/fork_wasm.js") as ForkWasmModule;',
    "typed Node WASM require",
)
cli = replace_once(cli, "    instance: any;", "    instance: WasmSystem;", "WasmBridge instance type")
cli = replace_once(
    cli,
    """            systemType
        );
        this.instance.set_periods?.(new Float64Array(periodicPeriodsForConfig(this.config)));""",
    """            systemType
        ) as WasmSystem;
        this.instance.set_periods(new Float64Array(periodicPeriodsForConfig(this.config)));""",
    "typed WasmSystem construction",
)
cli = cli.replace("(wasmModule as any).", "wasmModule.")
cli = replace_once(
    cli,
    """        return this.instance.continue_limit_cycle_from_hopf(
            new Float64Array(hopfState),""",
    """        const continueFromHopf = this.instance.continue_limit_cycle_from_hopf;
        if (typeof continueFromHopf !== "function") {
            throw new Error(
                "Legacy limit-cycle continuation is unavailable in this WASM build."
            );
        }
        return continueFromHopf(
            new Float64Array(hopfState),""",
    "legacy limit-cycle continuation guard",
)
cli = replace_once(
    cli,
    """        return this.instance.extend_limit_cycle_branch(
            branchData,""",
    """        const extendBranch = this.instance.extend_limit_cycle_branch;
        if (typeof extendBranch !== "function") {
            throw new Error(
                "Legacy limit-cycle branch extension is unavailable in this WASM build."
            );
        }
        return extendBranch(
            branchData,""",
    "legacy limit-cycle extension guard",
)

fold_start = cli.index("    continueFoldCurve(")
fold_end = cli.index("\n    }", fold_start) + len("\n    }")
fold_block = cli[fold_start:fold_end]
fold_block = replace_once(
    fold_block,
    """            param2Name,
            param2Value,
            settings,""",
    """            param2Name,
            param2Value,
            1,
            settings,""",
    "direct fold map-iteration argument",
)
cli = cli[:fold_start] + fold_block + cli[fold_end:]

hopf_start = cli.index("    continueHopfCurve(")
hopf_end = cli.index("\n    }", hopf_start) + len("\n    }")
hopf_block = cli[hopf_start:hopf_end]
hopf_block = replace_once(
    hopf_block,
    """            param2Name,
            param2Value,
            settings,""",
    """            param2Name,
            param2Value,
            1,
            settings,""",
    "direct Hopf map-iteration argument",
)
cli = cli[:hopf_start] + hopf_block + cli[hopf_end:]

if "let wasmModule: any" in cli or "instance: any" in cli or "(wasmModule as any)" in cli:
    raise RuntimeError("Broad CLI WASM any typing remains")
cli_wasm_path.write_text(cli)
