import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { useAppContext } from './state/appContext'
import { Panel } from './ui/Panel'
import { ObjectsTree } from './ui/ObjectsTree'
import { InspectorPanel } from './ui/InspectorPanel'
import { ViewportPanel } from './ui/ViewportPanel'
import { SystemDialog } from './ui/SystemDialog'
import { Toolbar } from './ui/Toolbar'
import { PerfOverlay } from './ui/PerfOverlay'
import { isDeterministicMode } from './utils/determinism'
import { toCliSafeName } from './utils/naming'

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
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'light'
    if (isDeterministicMode()) return 'light'
    const stored =
      'localStorage' in window && typeof window.localStorage.getItem === 'function'
        ? window.localStorage.getItem('fork-theme')
        : null
    return stored === 'dark' ? 'dark' : 'light'
  })
  const [inspectorView, setInspectorView] = useState<'selection' | 'system'>('selection')
  const dragRef = useRef<{ side: 'left' | 'right'; startX: number; startWidth: number } | null>(
    null
  )

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
    if (inspectorView === 'system' && !system.ui.layout.inspectorOpen) {
      actions.updateLayout({ inspectorOpen: true })
    }
  }, [actions, inspectorView, system, system?.ui.layout.inspectorOpen])

  useEffect(() => {
    if (!system) return
    if (system.ui.selectedNodeId && !system.ui.layout.inspectorOpen) {
      actions.updateLayout({ inspectorOpen: true })
    }
  }, [actions, system, system?.ui.layout.inspectorOpen, system?.ui.selectedNodeId])

  const openSystemsDialog = () => {
    setDialogOpen(true)
  }
  const closeSystemsDialog = () => {
    setDialogOpen(false)
  }
  const finishSystemsDialog = () => {
    setDialogOpen(false)
  }

  const selectNode = (nodeId: string) => {
    actions.selectNode(nodeId)
    if (system && !system.ui.layout.inspectorOpen) {
      actions.updateLayout({ inspectorOpen: true })
    }
    // Force the inspector to show selection details even if the selection didn't change.
    setInspectorView('selection')
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
    const name = nextObjectName('Equilibrium', names)
    await actions.createEquilibriumObject(name)
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

  const onPointerDown = (side: 'left' | 'right') => (event: React.PointerEvent) => {
    if (!system) return
    dragRef.current = {
      side,
      startX: event.clientX,
      startWidth: side === 'left' ? system.ui.layout.leftWidth : system.ui.layout.rightWidth,
    }

    const handleMove = (moveEvent: PointerEvent) => {
      if (!system || !dragRef.current) return
      const { startX, startWidth } = dragRef.current
      const delta = moveEvent.clientX - startX
      if (side === 'left') {
        const next = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_LEFT_WIDTH, startWidth + delta))
        actions.updateLayout({ leftWidth: next })
      } else {
        const next = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_RIGHT_WIDTH, startWidth - delta))
        actions.updateLayout({ rightWidth: next })
      }
    }

    const handleUp = () => {
      dragRef.current = null
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
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
      />

      <SystemDialog
        open={isSystemDialogOpen}
        systems={systems}
        onClose={closeSystemsDialog}
        onCreateSystem={async (name) => {
          await actions.createSystem(name)
          finishSystemsDialog()
          setInspectorView('selection')
        }}
        onOpenSystem={async (id) => {
          await actions.openSystem(id)
          finishSystemsDialog()
          setInspectorView('selection')
        }}
        onExportSystem={(id) => void actions.exportSystem(id)}
        onDeleteSystem={(id) => void actions.deleteSystem(id)}
        onImportSystem={async (file) => {
          await actions.importSystem(file)
          finishSystemsDialog()
          setInspectorView('selection')
        }}
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
        <main className="workspace" style={{ gridTemplateColumns }} data-testid="workspace">
          <div className="workspace__left">
            <Panel
              title="Objects"
              open={system.ui.layout.objectsOpen}
              onToggle={() =>
                actions.updateLayout({ objectsOpen: !system.ui.layout.objectsOpen })
              }
              testId="objects-panel"
            >
              <ObjectsTree
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
                onSelectViewport={selectNode}
                onSelectObject={selectNode}
                onReorderViewport={actions.reorderNode}
                onResizeViewport={actions.updateViewportHeight}
                onToggleViewport={actions.toggleExpanded}
                onCreateScene={createScene}
                onCreateBifurcation={createBifurcation}
                onRenameViewport={actions.renameNode}
                onDeleteViewport={actions.deleteNode}
              />
            </Panel>
          </div>
          <div
            className="splitter splitter--right"
            onPointerDown={onPointerDown('right')}
            data-testid="splitter-right"
          />
          <div className="workspace__right">
            <Panel
              title="Inspector"
              open={system.ui.layout.inspectorOpen}
              onToggle={() =>
                actions.updateLayout({ inspectorOpen: !system.ui.layout.inspectorOpen })
              }
              testId="inspector-panel"
            >
              <InspectorPanel
                system={system}
                selectedNodeId={system.ui.selectedNodeId}
                view={inspectorView}
                onViewChange={setInspectorView}
                onRename={actions.renameNode}
                onToggleVisibility={actions.toggleVisibility}
                onUpdateRender={actions.updateRender}
                onUpdateScene={actions.updateScene}
                onUpdateBifurcationDiagram={actions.updateBifurcationDiagram}
                onUpdateSystem={actions.updateSystem}
                onValidateSystem={actions.validateSystem}
                onRunOrbit={actions.runOrbit}
                onComputeLyapunovExponents={actions.computeLyapunovExponents}
                onComputeCovariantLyapunovVectors={actions.computeCovariantLyapunovVectors}
              onSolveEquilibrium={actions.solveEquilibrium}
              onCreateLimitCycle={actions.createLimitCycleObject}
              onCreateEquilibriumBranch={actions.createEquilibriumBranch}
              onCreateBranchFromPoint={actions.createBranchFromPoint}
              onCreateFoldCurveFromPoint={actions.createFoldCurveFromPoint}
              onCreateHopfCurveFromPoint={actions.createHopfCurveFromPoint}
            />
            </Panel>
          </div>
        </main>
      )}
      {import.meta.env.DEV ? <PerfOverlay /> : null}
    </div>
  )
}

export default App
