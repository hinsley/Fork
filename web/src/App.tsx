import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './ui/primitives.css'
import './App.css'
import './ui/inspector/inspector.css'
import { useAppContext } from './state/appContext'
import { Panel } from './ui/Panel'
import { Icon } from './ui/Icon'
import { ObjectsTree, type ObjectsTreeHandle } from './ui/ObjectsTree'
import { InspectorPanel } from './ui/InspectorPanel'
import { ViewportPanel } from './ui/ViewportPanel'
import { SystemDialog } from './ui/SystemDialog'
import { SystemLibrary } from './ui/SystemLibrary'
import { SystemSettingsDialog } from './ui/SystemSettingsDialog'
import { Toolbar, type ToolbarProgress } from './ui/Toolbar'
import { EmbedDialog } from './ui/EmbedDialog'
import { ErrorToast } from './ui/ErrorToast'
import { CommandPalette, type Command } from './ui/CommandPalette'
import { formatSystemChip } from './ui/shellFormat'
import { isEditableTarget } from './ui/shortcuts'
import { useThemePreference } from './ui/useThemePreference'
import { useMediaQuery } from './ui/useMediaQuery'
import { suggestDefaultName } from './utils/naming'
import { formatEquilibriumLabel } from './system/labels'
import type { System } from './system/types'
import type { ContinuationProgressState } from './state/appState'
import type {
  BranchPointSelection,
  LimitCyclePointSelection,
  OrbitPointSelection,
} from './ui/branchPointSelection'
// Last so shell rules win over component stylesheets imported above.
import './ui/shell.css'

const MIN_LEFT_WIDTH = 220
const MIN_RIGHT_WIDTH = 240
const MAX_PANEL_WIDTH = 520
const SPLITTER_WIDTH = 2
const DEFAULT_LEFT_WIDTH = 280
const DEFAULT_RIGHT_WIDTH = 320
const MANIFOLD_2D_LABELS = new Set([
  'Invariant Manifold (Equilibrium 2D)',
  'Invariant Manifold (Limit Cycle 2D)',
  'Extend Invariant Manifold (2D)',
])

function toToolbarProgress(state: ContinuationProgressState | null): ToolbarProgress | null {
  if (!state) return null
  const { progress } = state
  return {
    label: state.label,
    target: state.target,
    currentStep: progress.current_step,
    maxSteps: progress.max_steps,
    points: progress.points_computed,
    bifurcations: progress.bifurcations_found,
    ringsComputed: progress.rings_computed,
    showArclength: MANIFOLD_2D_LABELS.has(state.label),
    arclength: progress.current_step,
    arclengthTarget: progress.max_steps,
    radius: progress.current_param,
    phase: progress.phase,
    discoveredBoxes: progress.discovered_boxes,
    frontierBoxes: progress.frontier_boxes,
    edgesBuilt: progress.edges_built,
    residual: progress.residual,
    tolerance: progress.tolerance,
    restartCount: progress.restart_count,
    maxRestarts: progress.max_restarts,
    subspaceDimension: progress.subspace_dimension,
    maxSubspaceDimension: progress.max_subspace_dimension,
    convergedModes: progress.converged_modes,
    requestedModes: progress.requested_modes,
  }
}

function humanize(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
}

function nodeHint(system: System, nodeId: string): string {
  const node = system.nodes[nodeId]
  if (!node) return ''
  if (node.kind === 'branch') {
    const branchType = system.index.branches[nodeId]?.branchType
    return branchType ? `${humanize(branchType)} branch` : 'branch'
  }
  if (node.kind === 'diagram') return 'bifurcation diagram'
  return humanize(node.objectType ?? node.kind)
}

function App() {
  const { state, actions } = useAppContext()
  const { system, systems, busy, error, continuationProgress } = state
  const [dialogOpen, setDialogOpen] = useState(false)
  const [systemSettingsOpen, setSystemSettingsOpen] = useState(false)
  const [embedDialogOpen, setEmbedDialogOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  // Below 900px the side panels overlay the plot, one at a time, and start closed.
  const narrow = useMediaQuery('(max-width: 900px)')
  const [narrowPanel, setNarrowPanel] = useState<'objects' | 'inspector' | null>(null)
  const { preference: themePreference, theme, setPreference: setThemePreference } =
    useThemePreference()
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

  const objectsOpen = narrow
    ? narrowPanel === 'objects'
    : (system?.ui.layout.objectsOpen ?? true)
  const inspectorOpen = narrow
    ? narrowPanel === 'inspector'
    : (system?.ui.layout.inspectorOpen ?? true)
  const isSystemSettingsOpen = systemSettingsOpen && Boolean(system)

  const closeSystemsDialog = useCallback(() => setDialogOpen(false), [])

  const toggleObjects = useCallback(() => {
    if (narrow) setNarrowPanel((panel) => (panel === 'objects' ? null : 'objects'))
    else actions.updateLayout({ objectsOpen: !objectsOpen })
  }, [actions, narrow, objectsOpen])

  const toggleInspector = useCallback(() => {
    if (narrow) setNarrowPanel((panel) => (panel === 'inspector' ? null : 'inspector'))
    else actions.updateLayout({ inspectorOpen: !inspectorOpen })
  }, [actions, narrow, inspectorOpen])

  const revealInspector = () => {
    if (narrow) setNarrowPanel('inspector')
    else if (!inspectorOpen) actions.updateLayout({ inspectorOpen: true })
  }

  const goHome = useCallback(() => {
    setDialogOpen(false)
    setSystemSettingsOpen(false)
    actions.closeSystem()
  }, [actions])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey
      const otherModalOpen = Boolean(
        document.querySelector('[aria-modal="true"]:not([data-testid="command-palette"])')
      )
      if (mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
        if (otherModalOpen) return
        event.preventDefault()
        setPaletteOpen((open) => !open)
        return
      }
      if (!system || mod || event.altKey || isEditableTarget(event.target)) return
      if (otherModalOpen || paletteOpen) return
      if (event.key === '[') {
        event.preventDefault()
        toggleObjects()
      } else if (event.key === ']') {
        event.preventDefault()
        toggleInspector()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [system, paletteOpen, toggleObjects, toggleInspector])

  const selectNode = (nodeId: string) => {
    actions.selectNode(nodeId)
  }

  const existingObjectNames = () => Object.values(system?.objects ?? {}).map((obj) => obj.name)

  const createOrbit = async () => {
    if (!system) return
    const name = suggestDefaultName('orbit', { existingNames: existingObjectNames() })
    await actions.createOrbitObject(name)
  }

  const createEquilibrium = async () => {
    if (!system) return
    const name = suggestDefaultName('equilibrium', {
      entityLabel: formatEquilibriumLabel(system.config.type),
      existingNames: existingObjectNames(),
    })
    await actions.createEquilibriumObject(name)
  }

  const createIsocline = async () => {
    if (!system) return
    const name = suggestDefaultName('isocline', { existingNames: existingObjectNames() })
    await actions.createIsoclineObject(name)
  }

  const createStateGrid = async () => {
    if (!system) return
    const name = suggestDefaultName('stateGrid', { existingNames: existingObjectNames() })
    await actions.createStateGridObject(name)
  }

  const createForcedPeriodicResponse = async (orbitId?: string) => {
    if (!system) return
    const name = suggestDefaultName('forcedPeriodicResponse', {
      entityLabel: 'Forced response',
      existingNames: existingObjectNames(),
    })
    await actions.createForcedPeriodicResponseObject(name, orbitId)
  }

  const openCreateObjectMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    objectsTreeRef.current?.openCreateMenu({ x: event.clientX, y: event.clientY })
  }

  const createRootFolder = () => {
    actions.createFolder(null)
  }

  const createScene = async (targetId?: string | null) => {
    if (!system) return
    const names = system.scenes.map((scene) => scene.name)
    const name = suggestDefaultName('scene', { existingNames: names })
    await actions.addScene(name, targetId)
  }

  const createBifurcation = async (targetId?: string | null) => {
    if (!system) return
    const names = system.bifurcationDiagrams.map((diagram) => diagram.name)
    const name = suggestDefaultName('bifurcationDiagram', { existingNames: names })
    await actions.addBifurcationDiagram(name, targetId)
  }

  const createAnalysis = async (targetId?: string | null) => {
    if (!system) return
    const names = system.analysisViewports.map((viewport) => viewport.name)
    const name = suggestDefaultName('analysisViewport', { existingNames: names })
    await actions.addAnalysisViewport(name, targetId)
  }

  // Rebuilt only while the palette is open; cheap enough to recompute per render then.
  const commands: Command[] = !paletteOpen
    ? []
    : (() => {
        const list: Command[] = []
        if (system) {
          Object.values(system.nodes).forEach((node) => {
            if (node.kind === 'camera') return
            list.push({
              id: `node-${node.id}`,
              label: node.name,
              hint: nodeHint(system, node.id),
              icon: node.kind === 'folder' ? 'folder' : undefined,
              run: () => {
                selectNode(node.id)
                revealInspector()
              },
            })
          })
          const creators: Array<[string, string, () => unknown]> = [
            ['orbit', 'Orbit', createOrbit],
            ['equilibrium', formatEquilibriumLabel(system.config.type), createEquilibrium],
            ['isocline', 'Isocline', createIsocline],
            ['state-grid', 'State grid', createStateGrid],
            ['scene', 'Scene', () => createScene(null)],
            ['bifurcation', 'Bifurcation diagram', () => createBifurcation(null)],
            ['analysis', 'Analysis viewport', () => createAnalysis(null)],
            ['folder', 'Folder', createRootFolder],
          ]
          creators.forEach(([id, label, run]) => {
            list.push({
              id: `create-${id}`,
              label: `New ${label.toLowerCase()}`,
              hint: 'Create',
              icon: 'plus',
              run: () => void run(),
            })
          })
          list.push(
            {
              id: 'system-settings',
              label: 'System settings',
              hint: formatSystemChip({
                name: system.name,
                type: system.config.type,
                dimension: system.config.varNames.length,
                solver: system.config.solver,
              }),
              icon: 'function',
              keywords: 'equations parameters edit',
              run: () => setSystemSettingsOpen(true),
            },
            {
              id: 'toggle-objects',
              label: `${objectsOpen ? 'Hide' : 'Show'} objects panel`,
              hint: '[',
              icon: 'panel-left',
              run: toggleObjects,
            },
            {
              id: 'toggle-inspector',
              label: `${inspectorOpen ? 'Hide' : 'Show'} inspector panel`,
              hint: ']',
              icon: 'panel-right',
              run: toggleInspector,
            },
            { id: 'go-home', label: 'All systems', hint: 'Home', icon: 'systems', run: goHome }
          )
        }
        systems
          .filter((entry) => entry.id !== system?.id)
          .forEach((entry) => {
            list.push({
              id: `system-${entry.id}`,
              label: entry.name,
              hint: `Open ${entry.type === 'map' ? 'map' : 'flow'}`,
              icon: 'systems',
              keywords: 'switch system open',
              run: () => void actions.openSystem(entry.id),
            })
          })
        const themes: Array<[typeof themePreference, string]> = [
          ['light', 'Light'],
          ['dark', 'Dark'],
          ['system', 'System'],
        ]
        themes
          .filter(([value]) => value !== themePreference)
          .forEach(([value, label]) => {
            list.push({
              id: `theme-${value}`,
              label: `${label} theme`,
              hint: 'Theme',
              icon: value === 'dark' ? 'moon' : 'sun',
              keywords: 'color scheme appearance',
              run: () => setThemePreference(value),
            })
          })
        return list
      })()

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

  const resetWidth = (side: 'left' | 'right') => () => {
    actions.updateLayout(
      side === 'left' ? { leftWidth: DEFAULT_LEFT_WIDTH } : { rightWidth: DEFAULT_RIGHT_WIDTH }
    )
  }

  const gridTemplateColumns = useMemo(() => {
    if (!system) return '1fr'
    const { leftWidth, rightWidth } = system.ui.layout
    return [
      objectsOpen ? `${leftWidth}px` : '0px',
      objectsOpen ? `${SPLITTER_WIDTH}px` : '0px',
      'minmax(0, 1fr)',
      inspectorOpen ? `${SPLITTER_WIDTH}px` : '0px',
      inspectorOpen ? `${rightWidth}px` : '0px',
    ].join(' ')
  }, [system, objectsOpen, inspectorOpen])

  const libraryActions = {
    onCreateSystem: async (name: string) => {
      await actions.createSystem(name)
      closeSystemsDialog()
    },
    onOpenSystem: async (id: string) => {
      await actions.openSystem(id)
      closeSystemsDialog()
    },
    onExportSystem: (id: string) => void actions.exportSystem(id),
    onCreateEmbed: async (id: string) => {
      if (system?.id !== id) await actions.openSystem(id)
      closeSystemsDialog()
      setEmbedDialogOpen(true)
    },
    onDeleteSystem: (id: string) => void actions.deleteSystem(id),
    onImportSystem: async (file: File) => {
      await actions.importSystem(file)
      closeSystemsDialog()
    },
  }

  return (
    <div className="app">
      <Toolbar
        system={
          system
            ? {
                name: system.name,
                type: system.config.type,
                dimension: system.config.varNames.length,
                solver: system.config.solver,
              }
            : null
        }
        busy={busy}
        progress={toToolbarProgress(continuationProgress)}
        onHome={goHome}
        onOpenSystems={() => setDialogOpen(true)}
        onOpenSystemSettings={() => setSystemSettingsOpen(true)}
        onOpenCommandPalette={() => setPaletteOpen(true)}
        onSelectNode={system ? selectNode : undefined}
        panels={
          system
            ? {
                objectsOpen,
                inspectorOpen,
                onToggleObjects: toggleObjects,
                onToggleInspector: toggleInspector,
              }
            : null
        }
        themePreference={themePreference}
        onThemeChange={setThemePreference}
        onResetFork={actions.resetFork}
        onCancelCalculation={actions.cancelCalculation}
      />

      <SystemDialog
        open={dialogOpen}
        systems={systems}
        activeSystemId={system?.id ?? null}
        onClose={closeSystemsDialog}
        {...libraryActions}
      />
      <SystemSettingsDialog
        open={isSystemSettingsOpen}
        system={system}
        onClose={() => {
          setSystemSettingsOpen(false)
          setEmbedDialogOpen(false)
        }}
        actions={actions}
      />
      <EmbedDialog
        open={embedDialogOpen && Boolean(system)}
        system={system}
        appTheme={theme}
        onClose={() => setEmbedDialogOpen(false)}
      />
      {paletteOpen ? (
        <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />
      ) : null}

      {error ? <ErrorToast message={error} onDismiss={actions.clearError} /> : null}

      {!system ? (
        <main className="home" data-testid="home">
          <div className="home__inner">
            <SystemLibrary systems={systems} {...libraryActions} />
          </div>
        </main>
      ) : (
        <main
          className={[
            'workspace',
            dragPreview ? 'workspace--resizing' : '',
            objectsOpen ? '' : 'workspace--objects-closed',
            inspectorOpen ? '' : 'workspace--inspector-closed',
          ]
            .filter(Boolean)
            .join(' ')}
          style={{ gridTemplateColumns }}
          data-testid="workspace"
          ref={workspaceRef}
        >
          <div className="workspace__left" hidden={!objectsOpen}>
            <Panel
              title="Objects"
              open
              onToggle={toggleObjects}
              testId="objects-panel"
              className="panel--objects"
              showToggle={false}
              actions={
                <div className="panel-actions">
                  <button onClick={openCreateObjectMenu} data-testid="create-object-button">
                    <Icon name="plus" /> Create object
                  </button>
                  <button
                    onClick={createRootFolder}
                    title="Create folder"
                    aria-label="Create folder"
                    data-testid="create-folder-button"
                  >
                    <Icon name="folder" />
                  </button>
                </div>
              }
            >
              <ObjectsTree
                ref={objectsTreeRef}
                system={system}
                selectedNodeId={system.ui.selectedNodeId}
                onSelect={(nodeId) => {
                  selectNode(nodeId)
                  if (narrow) setNarrowPanel('inspector')
                }}
                onToggleVisibility={actions.toggleVisibility}
                onRename={actions.renameNode}
                onToggleExpanded={actions.toggleExpanded}
                onReorderNode={actions.reorderNode}
                onMoveNodeIntoParent={actions.moveNodeIntoParent}
                onCreateFolder={actions.createFolder}
                onCreateOrbit={createOrbit}
                onCreateEquilibrium={createEquilibrium}
                onCreateForcedPeriodicResponse={createForcedPeriodicResponse}
                onCreateIsocline={createIsocline}
                onCreateStateGrid={createStateGrid}
                onDuplicateNode={actions.duplicateNode}
                onDeleteNode={actions.deleteNode}
              />
            </Panel>
          </div>
          <div
            className="splitter splitter--left"
            hidden={!objectsOpen}
            onPointerDown={onPointerDown('left')}
            onPointerMove={handleResizeMove}
            onPointerUp={finishResize}
            onPointerCancel={finishResize}
            onDoubleClick={resetWidth('left')}
            title="Drag to resize · double-click to reset"
            data-testid="splitter-left"
          />
          <div
            className="workspace__center"
            onPointerDown={narrow && narrowPanel ? () => setNarrowPanel(null) : undefined}
          >
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
                orbitPointSelection={orbitPointSelection}
                limitCyclePointSelection={limitCyclePointSelection}
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
                onCreateAnalysis={createAnalysis}
                onCreateBifurcation={createBifurcation}
                onRenameViewport={actions.renameNode}
                onDuplicateViewport={actions.duplicateNode}
                onDeleteViewport={actions.deleteNode}
                onSampleMap1DFunction={actions.sampleMap1DFunction}
                onComputeEventSeriesFromOrbit={actions.computeEventSeriesFromOrbit}
                onComputeEventSeriesFromSamples={actions.computeEventSeriesFromSamples}
                isoclineGeometryCache={state.isoclineGeometryCache}
                onUpdateScene={actions.updateScene}
                onUpdateBifurcationDiagram={actions.updateBifurcationDiagram}
                onUpdateSystem={actions.updateSystem}
                onOpenEmbed={() => setEmbedDialogOpen(true)}
              />
            </Panel>
          </div>
          <div
            className="splitter splitter--right"
            hidden={!inspectorOpen}
            onPointerDown={onPointerDown('right')}
            onPointerMove={handleResizeMove}
            onPointerUp={finishResize}
            onPointerCancel={finishResize}
            onDoubleClick={resetWidth('right')}
            title="Drag to resize · double-click to reset"
            data-testid="splitter-right"
          />
          <div className="workspace__right" hidden={!inspectorOpen}>
            <Panel
              title="Inspector"
              open
              onToggle={toggleInspector}
              testId="inspector-panel"
              className="panel--inspector"
              hideHeader
            >
              <InspectorPanel
                system={system}
                selectedNodeId={system.ui.selectedNodeId}
                theme={theme}
                actions={actions}
                pointSelections={{
                  branch: {
                    value: branchPointSelection,
                    onSelect: setBranchPointSelection,
                  },
                  orbit: {
                    value: orbitPointSelection,
                    onSelect: setOrbitPointSelection,
                  },
                  limitCycle: {
                    value: limitCyclePointSelection,
                    onSelect: setLimitCyclePointSelection,
                  },
                }}
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
    </div>
  )
}

export default App
