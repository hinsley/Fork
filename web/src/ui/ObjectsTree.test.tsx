import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ObjectsTree } from './ObjectsTree'
import { createDemoSystem, createPeriodDoublingSystem } from '../system/fixtures'
import { useState } from 'react'
import { toggleNodeExpanded } from '../system/model'

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

    render(
      <ObjectsTree
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
    )

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

    function Wrapper() {
      const [state, setState] = useState(system)
      return (
        <ObjectsTree
          system={state}
          selectedNodeId={null}
          onSelect={vi.fn()}
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
    expect(screen.queryByTestId(`object-tree-row-${branchId}`)).toBeNull()

    await user.click(toggle)
    expect(screen.getByTestId(`object-tree-row-${branchId}`)).toBeInTheDocument()
  })
})
