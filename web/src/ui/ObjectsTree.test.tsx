import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ObjectsTree, type ObjectsTreeHandle } from './ObjectsTree'
import { createDemoSystem, createPeriodDoublingSystem } from '../system/fixtures'
import { useRef, useState } from 'react'
import { addObject, createSystem, toggleNodeExpanded } from '../system/model'
import type { OrbitObject } from '../system/types'

describe('ObjectsTree', () => {
  it('selects, renames, and toggles visibility', async () => {
    const user = userEvent.setup()
    const { system, objectNodeId } = createDemoSystem()
    const onSelect = vi.fn()
    const onToggleVisibility = vi.fn()
    const onRename = vi.fn()
    const onToggleExpanded = vi.fn()
    const onReorderNode = vi.fn()

    render(
      <ObjectsTree
        system={system}
        selectedNodeId={null}
        onSelect={onSelect}
        onToggleVisibility={onToggleVisibility}
        onRename={onRename}
        onToggleExpanded={onToggleExpanded}
        onReorderNode={onReorderNode}
        onCreateOrbit={vi.fn()}
        onCreateEquilibrium={vi.fn()}
        onDeleteNode={vi.fn()}
      />
    )

    await user.click(screen.getByTestId(`object-tree-node-${objectNodeId}`))
    expect(onSelect).toHaveBeenCalledWith(objectNodeId)

    await user.click(screen.getByTestId(`node-visibility-${objectNodeId}`))
    expect(onToggleVisibility).toHaveBeenCalledWith(objectNodeId)

    fireEvent.contextMenu(screen.getByTestId(`object-tree-row-${objectNodeId}`))
    await user.click(screen.getByTestId('object-context-rename'))
    const input = screen.getByTestId(`node-rename-input-${objectNodeId}`)
    await user.clear(input)
    await user.type(input, 'Orbit Z{enter}')
    expect(onRename).toHaveBeenCalledWith(objectNodeId, 'Orbit Z')
  })

  it('shows a custom parameters tag for overridden objects', () => {
    const system = createSystem({
      name: 'Custom_Params',
      config: {
        name: 'Custom_Params',
        equations: ['y', '-x'],
        params: [0.1],
        paramNames: ['mu'],
        varNames: ['x', 'y'],
        solver: 'rk4',
        type: 'flow',
      },
    })
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Orbit_Custom',
      systemName: system.config.name,
      data: [],
      t_start: 0,
      t_end: 0,
      dt: 0.1,
      customParameters: [0.5],
    }
    const { system: next, nodeId } = addObject(system, orbit)

    render(
      <ObjectsTree
        system={next}
        selectedNodeId={null}
        onSelect={vi.fn()}
        onToggleVisibility={vi.fn()}
        onRename={vi.fn()}
        onToggleExpanded={vi.fn()}
        onReorderNode={vi.fn()}
        onCreateOrbit={vi.fn()}
        onCreateEquilibrium={vi.fn()}
        onDeleteNode={vi.fn()}
      />
    )

    expect(screen.getByTestId(`object-tree-custom-${nodeId}`)).toBeInTheDocument()
  })

  it('shows a frozen-variable badge for objects with frozen vars', () => {
    const system = createSystem({
      name: 'Frozen_Vars',
      config: {
        name: 'Frozen_Vars',
        equations: ['y', '-x'],
        params: [0.1],
        paramNames: ['mu'],
        varNames: ['x', 'y'],
        solver: 'rk4',
        type: 'flow',
      },
    })
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Orbit_Frozen',
      systemName: system.config.name,
      data: [],
      t_start: 0,
      t_end: 0,
      dt: 0.1,
      frozenVariables: { frozenValuesByVarName: { x: 0.25 } },
    }
    const { system: next, nodeId } = addObject(system, orbit)

    render(
      <ObjectsTree
        system={next}
        selectedNodeId={null}
        onSelect={vi.fn()}
        onToggleVisibility={vi.fn()}
        onRename={vi.fn()}
        onToggleExpanded={vi.fn()}
        onReorderNode={vi.fn()}
        onCreateOrbit={vi.fn()}
        onCreateEquilibrium={vi.fn()}
        onDeleteNode={vi.fn()}
      />
    )

    expect(screen.getByTestId(`object-tree-frozen-${nodeId}`)).toBeInTheDocument()
  })

  it('opens a context menu and deletes a node', async () => {
    const user = userEvent.setup()
    const { system, objectNodeId } = createDemoSystem()
    const onDeleteNode = vi.fn()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(
      <ObjectsTree
        system={system}
        selectedNodeId={null}
        onSelect={vi.fn()}
        onToggleVisibility={vi.fn()}
        onRename={vi.fn()}
        onToggleExpanded={vi.fn()}
        onReorderNode={vi.fn()}
        onCreateOrbit={vi.fn()}
        onCreateEquilibrium={vi.fn()}
        onDeleteNode={onDeleteNode}
      />
    )

    const row = screen.getByTestId(`object-tree-row-${objectNodeId}`)
    fireEvent.contextMenu(row)

    const menu = screen.getByTestId('object-context-menu')
    expect(menu).toBeInTheDocument()

    await user.click(screen.getByTestId('object-context-delete'))
    expect(confirmSpy).toHaveBeenCalled()
    expect(onDeleteNode).toHaveBeenCalledWith(objectNodeId)
    confirmSpy.mockRestore()
  })

  it('opens the create menu and triggers a create action', async () => {
    const user = userEvent.setup()
    const { system } = createDemoSystem()
    const onCreateOrbit = vi.fn()

    function Wrapper() {
      const treeRef = useRef<ObjectsTreeHandle | null>(null)
      return (
        <>
          <button
            onClick={(event) =>
              treeRef.current?.openCreateMenu({
                x: event.clientX,
                y: event.clientY,
              })
            }
            data-testid="create-object-button"
          >
            Create Object
          </button>
          <ObjectsTree
            ref={treeRef}
            system={system}
            selectedNodeId={null}
            onSelect={vi.fn()}
            onToggleVisibility={vi.fn()}
            onRename={vi.fn()}
            onToggleExpanded={vi.fn()}
            onReorderNode={vi.fn()}
            onCreateOrbit={onCreateOrbit}
            onCreateEquilibrium={vi.fn()}
            onDeleteNode={vi.fn()}
          />
        </>
      )
    }

    render(<Wrapper />)

    await user.click(screen.getByTestId('create-object-button'))
    expect(screen.getByTestId('create-object-menu')).toBeInTheDocument()

    await user.click(screen.getByTestId('create-object-button'))
    await user.click(screen.getByTestId('create-orbit'))
    expect(onCreateOrbit).toHaveBeenCalled()
  })

  it('shows drag handles for root nodes only', () => {
    const { system, objectNodeId, branchNodeId } = createDemoSystem()

    render(
      <ObjectsTree
        system={system}
        selectedNodeId={null}
        onSelect={vi.fn()}
        onToggleVisibility={vi.fn()}
        onRename={vi.fn()}
        onToggleExpanded={vi.fn()}
        onReorderNode={vi.fn()}
        onCreateOrbit={vi.fn()}
        onCreateEquilibrium={vi.fn()}
        onDeleteNode={vi.fn()}
      />
    )

    expect(screen.getByTestId(`node-drag-${objectNodeId}`)).toBeInTheDocument()
    expect(screen.queryByTestId(`node-drag-${branchNodeId}`)).toBeNull()
  })

  it('indents limit cycle continuation branches under their parent object', () => {
    const { system } = createPeriodDoublingSystem()
    const branchId = Object.keys(system.branches)[0]
    const branch = branchId ? system.branches[branchId] : undefined
    const limitCycleId =
      branch &&
      Object.entries(system.objects).find(([, obj]) => obj.name === branch.parentObject)?.[0]
    if (!branchId || !branch || !limitCycleId) {
      throw new Error('Missing limit cycle branch fixture data.')
    }

    render(
      <ObjectsTree
        system={system}
        selectedNodeId={null}
        onSelect={vi.fn()}
        onToggleVisibility={vi.fn()}
        onRename={vi.fn()}
        onToggleExpanded={vi.fn()}
        onReorderNode={vi.fn()}
        onCreateOrbit={vi.fn()}
        onCreateEquilibrium={vi.fn()}
        onDeleteNode={vi.fn()}
      />
    )

    const parentRow = screen.getByTestId(`object-tree-row-${limitCycleId}`)
    const branchRow = screen.getByTestId(`object-tree-row-${branchId}`)
    const parentPadding = Number.parseFloat(parentRow.style.paddingLeft || '0')
    const branchPadding = Number.parseFloat(branchRow.style.paddingLeft || '0')

    expect(branchPadding).toBeGreaterThan(parentPadding)
  })

  it('shows parenthetical labels for continuation branches', () => {
    const demo = createDemoSystem()
    const periodDoubling = createPeriodDoublingSystem()
    const limitCycleBranchId = Object.keys(periodDoubling.system.branches)[0]

    if (!limitCycleBranchId) {
      throw new Error('Missing limit cycle branch fixture data.')
    }

    render(
      <ObjectsTree
        system={demo.system}
        selectedNodeId={null}
        onSelect={vi.fn()}
        onToggleVisibility={vi.fn()}
        onRename={vi.fn()}
        onToggleExpanded={vi.fn()}
        onReorderNode={vi.fn()}
        onCreateOrbit={vi.fn()}
        onCreateEquilibrium={vi.fn()}
        onDeleteNode={vi.fn()}
      />
    )

    expect(screen.getByTestId(`object-tree-node-${demo.branchNodeId}`)).toHaveTextContent(
      'eq_branch (equilibrium)'
    )

    render(
      <ObjectsTree
        system={periodDoubling.system}
        selectedNodeId={null}
        onSelect={vi.fn()}
        onToggleVisibility={vi.fn()}
        onRename={vi.fn()}
        onToggleExpanded={vi.fn()}
        onReorderNode={vi.fn()}
        onCreateOrbit={vi.fn()}
        onCreateEquilibrium={vi.fn()}
        onDeleteNode={vi.fn()}
      />
    )

    expect(screen.getByTestId(`object-tree-node-${limitCycleBranchId}`)).toHaveTextContent(
      'lc_pd_mu (limit cycle)'
    )
  })

  it('appends 2D manifold stop reason to branch labels when diagnostics are present', () => {
    const demo = createDemoSystem()
    const branch = demo.system.branches[demo.branchNodeId]
    if (!branch) {
      throw new Error('Missing demo branch fixture data.')
    }
    branch.branchType = 'eq_manifold_2d'
    branch.data.manifold_geometry = {
      type: 'Surface',
      dim: 3,
      vertices_flat: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      triangles: [0, 1, 2],
      ring_offsets: [0, 3],
      ring_diagnostics: [],
      solver_diagnostics: {
        termination_reason: 'ring_build_failed',
        final_leaf_delta: 0.01,
        ring_attempts: 10,
        build_failures: 1,
        spacing_failures: 0,
        reject_ring_quality: 2,
        reject_geodesic_quality: 3,
        reject_too_small: 0,
      },
    }

    render(
      <ObjectsTree
        system={demo.system}
        selectedNodeId={null}
        onSelect={vi.fn()}
        onToggleVisibility={vi.fn()}
        onRename={vi.fn()}
        onToggleExpanded={vi.fn()}
        onReorderNode={vi.fn()}
        onCreateOrbit={vi.fn()}
        onCreateEquilibrium={vi.fn()}
        onDeleteNode={vi.fn()}
      />
    )

    expect(screen.getByTestId(`object-tree-node-${demo.branchNodeId}`)).toHaveTextContent(
      'eq_branch (equilibrium manifold (2d, ring build failed))'
    )
  })

  it('highlights only the selected node row', () => {
    const { system } = createPeriodDoublingSystem()
    const branchId = Object.keys(system.branches)[0]
    const branch = branchId ? system.branches[branchId] : undefined
    const limitCycleId =
      branch &&
      Object.entries(system.objects).find(([, obj]) => obj.name === branch.parentObject)?.[0]
    if (!branchId || !branch || !limitCycleId) {
      throw new Error('Missing limit cycle branch fixture data.')
    }

    render(
      <ObjectsTree
        system={system}
        selectedNodeId={limitCycleId}
        onSelect={vi.fn()}
        onToggleVisibility={vi.fn()}
        onRename={vi.fn()}
        onToggleExpanded={vi.fn()}
        onReorderNode={vi.fn()}
        onCreateOrbit={vi.fn()}
        onCreateEquilibrium={vi.fn()}
        onDeleteNode={vi.fn()}
      />
    )

    const parentRow = screen.getByTestId(`object-tree-row-${limitCycleId}`)
    const branchRow = screen.getByTestId(`object-tree-row-${branchId}`)

    expect(parentRow).toHaveClass('tree-node__row--selected')
    expect(branchRow).not.toHaveClass('tree-node__row--selected')
  })

  it('collapses and expands state-space objects with children', async () => {
    const user = userEvent.setup()
    const { system } = createPeriodDoublingSystem()
    const branchId = Object.keys(system.branches)[0]
    const branch = branchId ? system.branches[branchId] : undefined
    const limitCycleId =
      branch &&
      Object.entries(system.objects).find(([, obj]) => obj.name === branch.parentObject)?.[0]
    if (!branchId || !branch || !limitCycleId) {
      throw new Error('Missing limit cycle branch fixture data.')
    }
    const onSelect = vi.fn()

    function Wrapper() {
      const [state, setState] = useState(system)
      return (
        <ObjectsTree
          system={state}
          selectedNodeId={null}
          onSelect={onSelect}
          onToggleVisibility={vi.fn()}
          onRename={vi.fn()}
          onToggleExpanded={(nodeId) => {
            setState((prev) => toggleNodeExpanded(prev, nodeId))
          }}
          onReorderNode={vi.fn()}
          onCreateOrbit={vi.fn()}
          onCreateEquilibrium={vi.fn()}
          onDeleteNode={vi.fn()}
        />
      )
    }

    render(<Wrapper />)

    expect(screen.getByTestId(`object-tree-row-${branchId}`)).toBeInTheDocument()

    const toggle = screen.getByTestId(`node-expand-${limitCycleId}`)
    await user.click(toggle)
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.queryByTestId(`object-tree-row-${branchId}`)).toBeNull()

    await user.click(toggle)
    expect(screen.getByTestId(`object-tree-row-${branchId}`)).toBeInTheDocument()
  })
})
