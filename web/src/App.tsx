import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { useAppContext } from './state/appContext'
import { Panel } from './ui/Panel'
import { ObjectsTree, type ObjectsTreeHandle } from './ui/ObjectsTree'
import { InspectorPanel } from './ui/InspectorPanel'
import { ViewportPanel } from './ui/ViewportPanel'
import { SystemDialog } from './ui/SystemDialog'
import { SystemSettingsDialog } from './ui/SystemSettingsDialog'
import { Toolbar } from './ui/Toolbar'
import { PerfOverlay } from './ui/PerfOverlay'
import { isDeterministicMode } from './utils/determinism'
import { toCliSafeName } from './utils/naming'
import { formatEquilibriumLabel } from './system/labels'
import type {
  BranchPointSelection,
  LimitCyclePointSelection,
  OrbitPointSelection,
} from './ui/branchPointSelection'

const MIN_LEFT_WIDTH = 220
const MIN_RIGHT_WIDTH = 240
const MAX_PANEL_WIDTH = 520
const SPLITTER_WIDTH = 2

function nextObjectName(prefix: string, existing: string[]) {
  const base = toCliSafeName(prefix)
  let index = 1
  let name = `${base}_${index}`
  while (existing.includes(name)) {
    index += 1
    name = `${base}_${index}`
  }
  return name
}

function App() {
  const { state, actions } = useAppContext()
  const { system, systems, busy, error, continuationProgress } = state
  const [dialogOpen, setDialogOpen] = useState(false)
  const [systemSettingsOpen, setSystemSettingsOpen] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'light'
    if (isDeterministicMode()) return 'light'
    const stored =
      'localStorage' in window && typeof window.localStorage.getItem === 'function'
        ? window.localStorage.getItem('fork-theme')
        : null
    return stored === 'dark' ? 'dark' : 'light'
  })
  const [branchPointSelection, setBranchPointSelection] =
    useState<BranchPointSelection>(null)
  const [orbitPointSelection, setOrbitPointSelection] =
    useState<OrbitPointSelection>(null)
  const [limitCyclePointSelection, setLimitCyclePointSelection] =
    useState<LimitCyclePointSelection>(null)
  const dragRef = useRef<{
    side: 'left' | 'right'
    startX: number
    startWidth: number
    currentWidth: number
    workspaceWidth: number
    pointerId: number
    target: HTMLDivElement | null
  } | null>(null)
  const [dragPreview, setDragPreview] = useState<{ offset: number } | null>(null)
  const objectsTreeRef = useRef<ObjectsTreeHandle | null>(null)
  const workspaceRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    void actions.refreshSystems()
  }, [actions])

  const isSystemDialogOpen = dialogOpen

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    if (
      !isDeterministicMode() &&
      'localStorage' in window &&
      typeof window.localStorage.setItem === 'function'
    ) {
      window.localStorage.setItem('fork-theme', theme)
    }
  }, [theme])

  useEffect(() => {
    if (!system) return
    if (system.ui.selectedNodeId && !system.ui.layout.inspectorOpen) {
      actions.updateLayout({ inspectorOpen: true })
    }
  }, [actions, system, system?.ui.layout.inspectorOpen, system?.ui.selectedNodeId])

  const isSystemSettingsOpen = systemSettingsOpen && Boolean(system)

  const openSystemsDialog = () => {
    setDialogOpen(true)
  }
  const closeSystemsDialog = () => {
    setDialogOpen(false)
  }
  const finishSystemsDialog = () => {
    setDialogOpen(false)
  }

  const openSystemSettings = () => {
    setSystemSettingsOpen(true)
  }

  const closeSystemSettings = () => {
    setSystemSettingsOpen(false)
  }

  const selectNode = (nodeId: string) => {
    actions.selectNode(nodeId)
    if (system && !system.ui.layout.inspectorOpen) {
      actions.updateLayout({ inspectorOpen: true })
    }
  }

  const createOrbit = async () => {
    if (!system) return
    const names = Object.values(system.objects).map((obj) => obj.name)
    const name = nextObjectName('Orbit', names)
    await actions.createOrbitObject(name)
  }

  const createEquilibrium = async () => {
    if (!system) return
    const names = Object.values(system.objects).map((obj) => obj.name)
    const name = nextObjectName(formatEquilibriumLabel(system.config.type), names)
    await actions.createEquilibriumObject(name)
  }

  const openCreateObjectMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    objectsTreeRef.current?.openCreateMenu({ x: event.clientX, y: event.clientY })
  }

  const createScene = async (targetId?: string | null) => {
    if (!system) return
    const names = system.scenes.map((scene) => scene.name)
    const name = nextObjectName('Scene', names)
    await actions.addScene(name, targetId)
  }

  const createBifurcation = async (targetId?: string | null) => {
    if (!system) return
    const names = system.bifurcationDiagrams.map((diagram) => diagram.name)
    const name = nextObjectName('Bifurcation', names)
    await actions.addBifurcationDiagram(name, targetId)
  }

  const updatePreview = (side: 'left' | 'right', nextWidth: number, workspaceWidth: number) => {
    const rawOffset =
      side === 'left' ? nextWidth : workspaceWidth - nextWidth - SPLITTER_WIDTH
    const offset = Math.min(Math.max(rawOffset, 0), workspaceWidth)
    setDragPreview({ offset })
  }

  const handleResizeMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    const delta = event.clientX - drag.startX
    const nextWidth =
      drag.side === 'left'
        ? Math.min(MAX_PANEL_WIDTH, Math.max(MIN_LEFT_WIDTH, drag.startWidth + delta))
        : Math.min(MAX_PANEL_WIDTH, Math.max(MIN_RIGHT_WIDTH, drag.startWidth - delta))
    drag.currentWidth = nextWidth
    updatePreview(drag.side, nextWidth, drag.workspaceWidth)
  }

  const finishResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    drag.target?.releasePointerCapture?.(drag.pointerId)
    if (drag.side === 'left') {
      actions.updateLayout({ leftWidth: drag.currentWidth })
    } else {
      actions.updateLayout({ rightWidth: drag.currentWidth })
    }
    dragRef.current = null
    setDragPreview(null)
  }

  const onPointerDown = (side: 'left' | 'right') => (event: React.PointerEvent) => {
    if (!system) return
    const workspaceRect = workspaceRef.current?.getBoundingClientRect()
    if (!workspaceRect) return
    event.preventDefault()
    event.stopPropagation()
    const startWidth = side === 'left' ? system.ui.layout.leftWidth : system.ui.layout.rightWidth
    const target = event.currentTarget as HTMLDivElement
    target.setPointerCapture?.(event.pointerId)
    dragRef.current = {
      side,
      startX: event.clientX,
      startWidth,
      currentWidth: startWidth,
      workspaceWidth: workspaceRect.width,
      pointerId: event.pointerId,
      target,
    }

    updatePreview(side, startWidth, workspaceRect.width)
  }

  const gridTemplateColumns = useMemo(() => {
    if (!system) return '1fr'
    return `${system.ui.layout.leftWidth}px ${SPLITTER_WIDTH}px 1fr ${SPLITTER_WIDTH}px ${system.ui.layout.rightWidth}px`
  }, [system])

  return (
    <div className="app">
      <Toolbar
        systemName={system?.name ?? null}
        busy={busy}
        progress={
          continuationProgress
            ? {
                label: continuationProgress.label,
                currentStep: continuationProgress.progress.current_step,
                maxSteps: continuationProgress.progress.max_steps,
                points: continuationProgress.progress.points_computed,
                bifurcations: continuationProgress.progress.bifurcations_found,
              }
            : null
        }
        onOpenSystems={openSystemsDialog}
        theme={theme}
        onThemeChange={setTheme}
        onResetFork={actions.resetFork}
      />

      <SystemDialog
        open={isSystemDialogOpen}
        systems={systems}
        onClose={closeSystemsDialog}
        onCreateSystem={async (name) => {
          await actions.createSystem(name)
          finishSystemsDialog()
        }}
        onOpenSystem={async (id) => {
          await actions.openSystem(id)
          finishSystemsDialog()
        }}
        onExportSystem={(id) => void actions.exportSystem(id)}
        onDeleteSystem={(id) => void actions.deleteSystem(id)}
        onImportSystem={async (file) => {
          await actions.importSystem(file)
          finishSystemsDialog()
        }}
      />
      <SystemSettingsDialog
        open={isSystemSettingsOpen}
        system={system}
        selectedNodeId={system?.ui.selectedNodeId ?? null}
        theme={theme}
        branchPointSelection={branchPointSelection}
        orbitPointSelection={orbitPointSelection}
        limitCyclePointSelection={limitCyclePointSelection}
        onBranchPointSelect={setBranchPointSelection}
        onOrbitPointSelect={setOrbitPointSelection}
        onLimitCyclePointSelect={setLimitCyclePointSelection}
        onClose={closeSystemSettings}
        onRename={actions.renameNode}
        onToggleVisibility={actions.toggleVisibility}
        onUpdateRender={actions.updateRender}
        onUpdateObjectParams={actions.updateObjectParams}
        onUpdateScene={actions.updateScene}
        onUpdateBifurcationDiagram={actions.updateBifurcationDiagram}
        onSetLimitCycleRenderTarget={actions.setLimitCycleRenderTarget}
        onUpdateSystem={actions.updateSystem}
        onValidateSystem={actions.validateSystem}
        onRunOrbit={actions.runOrbit}
        onComputeLyapunovExponents={actions.computeLyapunovExponents}
        onComputeCovariantLyapunovVectors={actions.computeCovariantLyapunovVectors}
        onSolveEquilibrium={actions.solveEquilibrium}
        onCreateEquilibriumBranch={actions.createEquilibriumBranch}
        onCreateBranchFromPoint={actions.createBranchFromPoint}
        onExtendBranch={actions.extendBranch}
        onCreateFoldCurveFromPoint={actions.createFoldCurveFromPoint}
        onCreateHopfCurveFromPoint={actions.createHopfCurveFromPoint}
        onCreateLimitCycleFromHopf={actions.createLimitCycleFromHopf}
        onCreateLimitCycleFromOrbit={actions.createLimitCycleFromOrbit}
        onCreateCycleFromPD={actions.createCycleFromPD}
        onCreateLimitCycleFromPD={actions.createLimitCycleFromPD}
      />

      {error ? (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button onClick={actions.clearError}>Dismiss</button>
        </div>
      ) : null}

      {!system ? (
        <main className="empty-workspace">
          <div className="empty-card">
            <h1>Fork</h1>
            <p>Create or open a system to start exploring.</p>
            <button onClick={() => setDialogOpen(true)} data-testid="open-systems-empty">
              Open Systems
            </button>
          </div>
        </main>
      ) : (
        <main
          className={`workspace${dragPreview ? ' workspace--resizing' : ''}`}
          style={{ gridTemplateColumns }}
          data-testid="workspace"
          ref={workspaceRef}
        >
          <div className="workspace__left">
            <Panel
              title="Objects"
              open
              onToggle={() => undefined}
              testId="objects-panel"
              showToggle={false}
              actions={
                <button onClick={openCreateObjectMenu} data-testid="create-object-button">
                  Create Object
                </button>
              }
            >
              <ObjectsTree
                ref={objectsTreeRef}
                system={system}
                selectedNodeId={system.ui.selectedNodeId}
                onSelect={selectNode}
                onToggleVisibility={actions.toggleVisibility}
                onRename={actions.renameNode}
                onToggleExpanded={actions.toggleExpanded}
                onReorderNode={actions.reorderNode}
                onCreateOrbit={createOrbit}
                onCreateEquilibrium={createEquilibrium}
                onDeleteNode={actions.deleteNode}
              />
            </Panel>
          </div>
          <div
            className="splitter splitter--left"
            onPointerDown={onPointerDown('left')}
            onPointerMove={handleResizeMove}
            onPointerUp={finishResize}
            onPointerCancel={finishResize}
            data-testid="splitter-left"
          />
          <div className="workspace__center">
            <Panel
              title="Viewport"
              open
              onToggle={() => undefined}
              testId="viewport-panel"
              className="panel--viewport"
              hideHeader
            >
              <ViewportPanel
                system={system}
                selectedNodeId={system.ui.selectedNodeId}
                branchPointSelection={branchPointSelection}
                theme={theme}
                onSelectViewport={selectNode}
                onSelectObject={selectNode}
                onSelectBranchPoint={setBranchPointSelection}
                onSelectOrbitPoint={setOrbitPointSelection}
                onSelectLimitCyclePoint={setLimitCyclePointSelection}
                onReorderViewport={actions.reorderNode}
                onResizeViewport={actions.updateViewportHeight}
                onToggleViewport={actions.toggleExpanded}
                onCreateScene={createScene}
                onCreateBifurcation={createBifurcation}
                onRenameViewport={actions.renameNode}
                onDeleteViewport={actions.deleteNode}
                onSampleMap1DFunction={actions.sampleMap1DFunction}
              />
            </Panel>
          </div>
          <div
            className="splitter splitter--right"
            onPointerDown={onPointerDown('right')}
            onPointerMove={handleResizeMove}
            onPointerUp={finishResize}
            onPointerCancel={finishResize}
            data-testid="splitter-right"
          />
          <div className="workspace__right">
            <Panel
              title="Inspector"
              open
              onToggle={() => undefined}
              testId="inspector-panel"
              showToggle={false}
              actions={
                <button onClick={openSystemSettings} data-testid="open-system-settings">
                  System Settings
                </button>
              }
            >
              <InspectorPanel
                system={system}
                selectedNodeId={system.ui.selectedNodeId}
                theme={theme}
                branchPointSelection={branchPointSelection}
                orbitPointSelection={orbitPointSelection}
                limitCyclePointSelection={limitCyclePointSelection}
                onBranchPointSelect={setBranchPointSelection}
                onOrbitPointSelect={setOrbitPointSelection}
                onLimitCyclePointSelect={setLimitCyclePointSelection}
                onRename={actions.renameNode}
                onToggleVisibility={actions.toggleVisibility}
                onUpdateRender={actions.updateRender}
                onUpdateObjectParams={actions.updateObjectParams}
                onUpdateScene={actions.updateScene}
                onUpdateBifurcationDiagram={actions.updateBifurcationDiagram}
                onSetLimitCycleRenderTarget={actions.setLimitCycleRenderTarget}
                onUpdateSystem={actions.updateSystem}
                onValidateSystem={actions.validateSystem}
                onRunOrbit={actions.runOrbit}
                onComputeLyapunovExponents={actions.computeLyapunovExponents}
                onComputeCovariantLyapunovVectors={actions.computeCovariantLyapunovVectors}
                onSolveEquilibrium={actions.solveEquilibrium}
                onCreateEquilibriumBranch={actions.createEquilibriumBranch}
                onCreateBranchFromPoint={actions.createBranchFromPoint}
                onExtendBranch={actions.extendBranch}
                onCreateFoldCurveFromPoint={actions.createFoldCurveFromPoint}
                onCreateHopfCurveFromPoint={actions.createHopfCurveFromPoint}
                onCreateLimitCycleFromHopf={actions.createLimitCycleFromHopf}
                onCreateLimitCycleFromOrbit={actions.createLimitCycleFromOrbit}
                onCreateCycleFromPD={actions.createCycleFromPD}
                onCreateLimitCycleFromPD={actions.createLimitCycleFromPD}
              />
            </Panel>
          </div>
          {dragPreview ? (
            <div
              className="splitter-preview"
              style={{ left: `${dragPreview.offset}px` }}
              data-testid="splitter-preview"
            />
          ) : null}
        </main>
      )}
      {import.meta.env.DEV ? <PerfOverlay /> : null}
    </div>
  )
}

export default App
