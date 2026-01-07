import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ObjectsTree } from './ObjectsTree'
import { createDemoSystem } from '../system/fixtures'

describe('ObjectsTree', () => {
  it('selects, renames, and toggles visibility', async () => {
    const user = userEvent.setup()
    const { system, objectNodeId } = createDemoSystem()
    const onSelect = vi.fn()
    const onToggleVisibility = vi.fn()
    const onRename = vi.fn()
    const onToggleExpanded = vi.fn()
    const onMoveNode = vi.fn()

    render(
      <ObjectsTree
        system={system}
        selectedNodeId={null}
        onSelect={onSelect}
        onToggleVisibility={onToggleVisibility}
        onRename={onRename}
        onToggleExpanded={onToggleExpanded}
        onMoveNode={onMoveNode}
        onCreateOrbit={vi.fn()}
        onCreateEquilibrium={vi.fn()}
        onCreateScene={vi.fn()}
        onCreateBifurcation={vi.fn()}
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

    render(
      <ObjectsTree
        system={system}
        selectedNodeId={null}
        onSelect={vi.fn()}
        onToggleVisibility={vi.fn()}
        onRename={vi.fn()}
        onToggleExpanded={vi.fn()}
        onMoveNode={vi.fn()}
        onCreateOrbit={vi.fn()}
        onCreateEquilibrium={vi.fn()}
        onCreateScene={vi.fn()}
        onCreateBifurcation={vi.fn()}
        onDeleteNode={onDeleteNode}
      />
    )

    const row = screen.getByTestId(`object-tree-row-${objectNodeId}`)
    fireEvent.contextMenu(row)

    const menu = screen.getByTestId('object-context-menu')
    expect(menu).toBeInTheDocument()

    await user.click(screen.getByTestId('object-context-delete'))
    expect(onDeleteNode).toHaveBeenCalledWith(objectNodeId)
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
        onMoveNode={vi.fn()}
        onCreateOrbit={onCreateOrbit}
        onCreateEquilibrium={vi.fn()}
        onCreateScene={vi.fn()}
        onCreateBifurcation={vi.fn()}
        onDeleteNode={vi.fn()}
      />
    )

    await user.click(screen.getByTestId('create-object-button'))
    expect(screen.getByTestId('create-object-menu')).toBeInTheDocument()

    await user.click(screen.getByTestId('create-object-button'))
    await user.click(screen.getByTestId('create-orbit'))
    expect(onCreateOrbit).toHaveBeenCalled()
  })
})
