import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ObjectsTree, type ObjectsTreeHandle } from './ObjectsTree'
import { createDemoSystem, createPeriodDoublingSystem } from '../system/fixtures'
import { useRef, useState } from 'react'
import {
  addBranch,
  addFolder,
  addObject,
  createSystem,
  moveNodeIntoParent,
  removeNode,
  selectNode,
  toggleNodeExpanded,
} from '../system/model'
import type { ContinuationObject, OrbitObject } from '../system/types'

function createPointerEvent(
  type: string,
  init: {
    button?: number
    clientX: number
    clientY: number
    isPrimary?: boolean
    pointerId: number
    pointerType: string
  }
) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    button: { value: init.button ?? 0 },
    clientX: { value: init.clientX },
    clientY: { value: init.clientY },
    isPrimary: { value: init.isPrimary ?? true },
    pointerId: { value: init.pointerId },
    pointerType: { value: init.pointerType },
  })
  return event
}

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

  it('opens the node context menu from a touch long press', () => {
    vi.useFakeTimers()
    try {
      const { system, objectNodeId } = createDemoSystem()
      const onSelect = vi.fn()

      render(
        <ObjectsTree
          system={system}
          selectedNodeId={null}
          onSelect={onSelect}
          onToggleVisibility={vi.fn()}
          onRename={vi.fn()}
          onToggleExpanded={vi.fn()}
          onReorderNode={vi.fn()}
          onCreateOrbit={vi.fn()}
          onCreateEquilibrium={vi.fn()}
          onDeleteNode={vi.fn()}
        />
      )

      fireEvent(
        screen.getByTestId(`object-tree-row-${objectNodeId}`),
        createPointerEvent('pointerdown', {
          button: 0,
          clientX: 24,
          clientY: 32,
          pointerId: 7,
          pointerType: 'touch',
        })
      )
      act(() => {
        vi.advanceTimersByTime(650)
      })

      expect(onSelect).toHaveBeenCalledWith(objectNodeId)
      expect(screen.getByTestId('object-context-menu')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
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

  it('opens a context menu and duplicates object and branch nodes', async () => {
    const user = userEvent.setup()
    const { system, objectNodeId, branchNodeId } = createDemoSystem()
    const onDuplicateNode = vi.fn()

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
        onDuplicateNode={onDuplicateNode}
        onDeleteNode={vi.fn()}
      />
    )

    fireEvent.contextMenu(screen.getByTestId(`object-tree-row-${objectNodeId}`))
    await user.click(screen.getByTestId('object-context-duplicate'))
    expect(onDuplicateNode).toHaveBeenCalledWith(objectNodeId)

    fireEvent.contextMenu(screen.getByTestId(`object-tree-row-${branchNodeId}`))
    await user.click(screen.getByTestId('object-context-duplicate'))
    expect(onDuplicateNode).toHaveBeenLastCalledWith(branchNodeId)
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

  it('makes root and child rows draggable without drag handles', () => {
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

    expect(screen.getByTestId(`object-tree-row-${objectNodeId}`)).toHaveAttribute(
      'draggable',
      'true'
    )
    expect(screen.getByTestId(`object-tree-row-${branchNodeId}`)).toHaveAttribute(
      'draggable',
      'true'
    )
    expect(screen.queryByTestId(`node-drag-${objectNodeId}`)).toBeNull()
    expect(screen.queryByTestId(`node-drag-${branchNodeId}`)).toBeNull()
  })

  it('does not dim rows while dragging and clears missed drag endings globally', () => {
    const { system, objectNodeId } = createDemoSystem()

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

    const dataTransfer = {
      effectAllowed: '',
      data: new Map<string, string>(),
      getData(type: string) {
        return this.data.get(type) ?? ''
      },
      setData(type: string, value: string) {
        this.data.set(type, value)
      },
    }
    const row = screen.getByTestId(`object-tree-row-${objectNodeId}`)
    const tree = screen.getByTestId('objects-tree')

    fireEvent.dragStart(row, { dataTransfer })

    expect(row).not.toHaveClass('tree-node__row--dragging')
    expect(tree).toHaveClass('objects-tree--dragging')
    expect(tree).not.toHaveClass('objects-tree--touch-dragging')

    fireEvent(
      window,
      createPointerEvent('pointercancel', {
        clientX: 0,
        clientY: 0,
        pointerId: 1,
        pointerType: 'mouse',
      })
    )

    expect(tree).toHaveClass('objects-tree--dragging')

    fireEvent(window, new Event('dragend'))

    expect(tree).not.toHaveClass('objects-tree--dragging')
  })

  it('renders root folders and wraps an object in a new folder from its context menu', async () => {
    const user = userEvent.setup()
    const { system, objectNodeId } = createDemoSystem()
    const withFolder = addFolder(system, 'Folder_1')
    const onCreateFolder = vi.fn()
    const onToggleVisibility = vi.fn()

    render(
      <ObjectsTree
        system={withFolder.system}
        selectedNodeId={null}
        onSelect={vi.fn()}
        onToggleVisibility={onToggleVisibility}
        onRename={vi.fn()}
        onToggleExpanded={vi.fn()}
        onReorderNode={vi.fn()}
        onCreateFolder={onCreateFolder}
        onCreateOrbit={vi.fn()}
        onCreateEquilibrium={vi.fn()}
        onDeleteNode={vi.fn()}
      />
    )

    expect(screen.getByTestId(`node-folder-icon-${withFolder.nodeId}`)).toBeInTheDocument()
    expect(screen.getByTestId(`object-tree-node-${withFolder.nodeId}`)).toHaveTextContent(
      'Folder_1'
    )
    await user.click(screen.getByTestId(`node-visibility-${withFolder.nodeId}`))
    expect(onToggleVisibility).toHaveBeenCalledWith(withFolder.nodeId)

    // On an object, "create folder" wraps it in a new sibling folder instead of nesting.
    fireEvent.contextMenu(screen.getByTestId(`object-tree-row-${objectNodeId}`))
    await user.click(screen.getByTestId('object-context-create-folder'))
    expect(onCreateFolder).toHaveBeenCalledWith(null, { wrapNodeId: objectNodeId })

    // Objects with branches can still get a folder for their branches.
    fireEvent.contextMenu(screen.getByTestId(`object-tree-row-${objectNodeId}`))
    await user.click(screen.getByTestId('object-context-create-branch-folder'))
    expect(onCreateFolder).toHaveBeenLastCalledWith(objectNodeId)

    fireEvent.contextMenu(screen.getByTestId(`object-tree-row-${withFolder.nodeId}`))
    await user.click(screen.getByTestId('object-context-create-folder'))
    expect(onCreateFolder).toHaveBeenLastCalledWith(withFolder.nodeId)
  })

  it('reorders child nodes before a sibling drop boundary when drag data is protected', () => {
    const { system, objectNodeId, branchNodeId } = createDemoSystem()
    const sourceBranch = system.branches[branchNodeId]
    if (!sourceBranch) {
      throw new Error('Missing demo branch fixture data.')
    }
    const secondBranch: ContinuationObject = {
      ...sourceBranch,
      name: 'eq_branch_second',
      data: {
        ...sourceBranch.data,
        points: [...sourceBranch.data.points],
        bifurcations: [...sourceBranch.data.bifurcations],
        indices: [...sourceBranch.data.indices],
      },
    }
    const { system: next, nodeId: secondBranchNodeId } = addBranch(
      system,
      secondBranch,
      objectNodeId
    )
    const onReorderNode = vi.fn()

    render(
      <ObjectsTree
        system={next}
        selectedNodeId={null}
        onSelect={vi.fn()}
        onToggleVisibility={vi.fn()}
        onRename={vi.fn()}
        onToggleExpanded={vi.fn()}
        onReorderNode={onReorderNode}
        onCreateOrbit={vi.fn()}
        onCreateEquilibrium={vi.fn()}
        onDeleteNode={vi.fn()}
      />
    )

    let exposeDragData = true
    const dataTransfer = {
      effectAllowed: '',
      data: new Map<string, string>(),
      getData(type: string) {
        return exposeDragData ? (this.data.get(type) ?? '') : ''
      },
      setData(type: string, value: string) {
        this.data.set(type, value)
      },
    }

    fireEvent.dragStart(screen.getByTestId(`object-tree-row-${secondBranchNodeId}`), {
      dataTransfer,
    })
    exposeDragData = false
    const targetRow = screen.getByTestId(`object-tree-row-${branchNodeId}`)
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      bottom: 120,
      height: 20,
      left: 0,
      right: 200,
      top: 100,
      width: 200,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    })

    const dragOver = new Event('dragover', { bubbles: true, cancelable: true })
    Object.defineProperty(dragOver, 'clientY', { value: 104 })
    Object.defineProperty(dragOver, 'dataTransfer', { value: dataTransfer })
    fireEvent(targetRow, dragOver)
    const drop = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'clientY', { value: 104 })
    Object.defineProperty(drop, 'dataTransfer', { value: dataTransfer })
    fireEvent(targetRow, drop)

    expect(onReorderNode).toHaveBeenCalledWith(secondBranchNodeId, branchNodeId, 'before')
    rectSpy.mockRestore()
  })

  it('reorders child nodes from a touch drag', () => {
    vi.useFakeTimers()
    const { system, objectNodeId, branchNodeId } = createDemoSystem()
    const sourceBranch = system.branches[branchNodeId]
    if (!sourceBranch) {
      throw new Error('Missing demo branch fixture data.')
    }
    const secondBranch: ContinuationObject = {
      ...sourceBranch,
      name: 'eq_branch_second',
      data: {
        ...sourceBranch.data,
        points: [...sourceBranch.data.points],
        bifurcations: [...sourceBranch.data.bifurcations],
        indices: [...sourceBranch.data.indices],
      },
    }
    const { system: next, nodeId: secondBranchNodeId } = addBranch(
      system,
      secondBranch,
      objectNodeId
    )
    const onReorderNode = vi.fn()

    render(
      <ObjectsTree
        system={next}
        selectedNodeId={null}
        onSelect={vi.fn()}
        onToggleVisibility={vi.fn()}
        onRename={vi.fn()}
        onToggleExpanded={vi.fn()}
        onReorderNode={onReorderNode}
        onCreateOrbit={vi.fn()}
        onCreateEquilibrium={vi.fn()}
        onDeleteNode={vi.fn()}
      />
    )

    const sourceRow = screen.getByTestId(`object-tree-row-${secondBranchNodeId}`)
    const targetRow = screen.getByTestId(`object-tree-row-${branchNodeId}`)
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      bottom: 120,
      height: 20,
      left: 0,
      right: 200,
      top: 100,
      width: 200,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    })
    const originalElementFromPoint = document.elementFromPoint
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => targetRow),
    })

    try {
      fireEvent(
        sourceRow,
        createPointerEvent('pointerdown', {
          button: 0,
          clientX: 16,
          clientY: 16,
          pointerId: 9,
          pointerType: 'touch',
        })
      )
      act(() => {
        vi.advanceTimersByTime(250)
      })
      fireEvent(
        sourceRow,
        createPointerEvent('pointermove', {
          clientX: 20,
          clientY: 104,
          pointerId: 9,
          pointerType: 'touch',
        })
      )
      expect(screen.getByTestId('objects-tree')).toHaveClass('objects-tree--touch-dragging')
      fireEvent(
        sourceRow,
        createPointerEvent('pointerup', {
          clientX: 20,
          clientY: 104,
          pointerId: 9,
          pointerType: 'touch',
        })
      )

      expect(onReorderNode).toHaveBeenCalledWith(secondBranchNodeId, branchNodeId, 'before')
      expect(screen.getByTestId('objects-tree')).not.toHaveClass(
        'objects-tree--touch-dragging'
      )
    } finally {
      if (originalElementFromPoint) {
        Object.defineProperty(document, 'elementFromPoint', {
          configurable: true,
          value: originalElementFromPoint,
        })
      } else {
        Reflect.deleteProperty(document, 'elementFromPoint')
      }
      rectSpy.mockRestore()
      vi.useRealTimers()
    }
  })

  it('reorders child nodes after a sibling drop boundary', () => {
    const { system, objectNodeId, branchNodeId } = createDemoSystem()
    const sourceBranch = system.branches[branchNodeId]
    if (!sourceBranch) {
      throw new Error('Missing demo branch fixture data.')
    }
    const secondBranch: ContinuationObject = {
      ...sourceBranch,
      name: 'eq_branch_second',
      data: {
        ...sourceBranch.data,
        points: [...sourceBranch.data.points],
        bifurcations: [...sourceBranch.data.bifurcations],
        indices: [...sourceBranch.data.indices],
      },
    }
    const { system: next, nodeId: secondBranchNodeId } = addBranch(
      system,
      secondBranch,
      objectNodeId
    )
    const onReorderNode = vi.fn()

    render(
      <ObjectsTree
        system={next}
        selectedNodeId={null}
        onSelect={vi.fn()}
        onToggleVisibility={vi.fn()}
        onRename={vi.fn()}
        onToggleExpanded={vi.fn()}
        onReorderNode={onReorderNode}
        onCreateOrbit={vi.fn()}
        onCreateEquilibrium={vi.fn()}
        onDeleteNode={vi.fn()}
      />
    )

    const dataTransfer = {
      effectAllowed: '',
      data: new Map<string, string>(),
      getData(type: string) {
        return this.data.get(type) ?? ''
      },
      setData(type: string, value: string) {
        this.data.set(type, value)
      },
    }

    const targetRow = screen.getByTestId(`object-tree-row-${branchNodeId}`)
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      bottom: 0,
      height: 20,
      left: 0,
      right: 200,
      top: -20,
      width: 200,
      x: 0,
      y: -20,
      toJSON: () => ({}),
    })

    fireEvent.dragStart(screen.getByTestId(`object-tree-row-${secondBranchNodeId}`), {
      dataTransfer,
    })
    const dragOver = new Event('dragover', { bubbles: true, cancelable: true })
    Object.defineProperty(dragOver, 'clientY', { value: 116 })
    Object.defineProperty(dragOver, 'dataTransfer', { value: dataTransfer })
    fireEvent(targetRow, dragOver)
    const drop = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'clientY', { value: 116 })
    Object.defineProperty(drop, 'dataTransfer', { value: dataTransfer })
    fireEvent(targetRow, drop)

    expect(onReorderNode).toHaveBeenCalledWith(secondBranchNodeId, branchNodeId, 'after')
    rectSpy.mockRestore()
  })

  it('commits the previewed drop even when the browser drops on the dragged row', () => {
    const { system, objectNodeId, branchNodeId } = createDemoSystem()
    const sourceBranch = system.branches[branchNodeId]
    if (!sourceBranch) {
      throw new Error('Missing demo branch fixture data.')
    }
    const secondBranch: ContinuationObject = {
      ...sourceBranch,
      name: 'eq_branch_second',
      data: {
        ...sourceBranch.data,
        points: [...sourceBranch.data.points],
        bifurcations: [...sourceBranch.data.bifurcations],
        indices: [...sourceBranch.data.indices],
      },
    }
    const { system: next, nodeId: secondBranchNodeId } = addBranch(
      system,
      secondBranch,
      objectNodeId
    )
    const onReorderNode = vi.fn()

    render(
      <ObjectsTree
        system={next}
        selectedNodeId={null}
        onSelect={vi.fn()}
        onToggleVisibility={vi.fn()}
        onRename={vi.fn()}
        onToggleExpanded={vi.fn()}
        onReorderNode={onReorderNode}
        onCreateOrbit={vi.fn()}
        onCreateEquilibrium={vi.fn()}
        onDeleteNode={vi.fn()}
      />
    )

    const dataTransfer = {
      effectAllowed: '',
      data: new Map<string, string>(),
      getData(type: string) {
        return this.data.get(type) ?? ''
      },
      setData(type: string, value: string) {
        this.data.set(type, value)
      },
    }
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      bottom: 120,
      height: 20,
      left: 0,
      right: 200,
      top: 100,
      width: 200,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    })

    fireEvent.dragStart(screen.getByTestId(`object-tree-row-${secondBranchNodeId}`), {
      dataTransfer,
    })
    const dragOver = new Event('dragover', { bubbles: true, cancelable: true })
    Object.defineProperty(dragOver, 'clientY', { value: 104 })
    Object.defineProperty(dragOver, 'dataTransfer', { value: dataTransfer })
    fireEvent(screen.getByTestId(`object-tree-row-${branchNodeId}`), dragOver)

    const drop = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'clientY', { value: 104 })
    Object.defineProperty(drop, 'dataTransfer', { value: dataTransfer })
    fireEvent(screen.getByTestId(`object-tree-row-${secondBranchNodeId}`), drop)

    expect(onReorderNode).toHaveBeenCalledWith(secondBranchNodeId, branchNodeId, 'before')
    rectSpy.mockRestore()
  })

  it('moves a root object into a compatible folder when dropped over the folder', () => {
    const { system, objectNodeId } = createDemoSystem()
    const folder = addFolder(system, 'Folder_1')
    const onMoveNodeIntoParent = vi.fn()

    render(
      <ObjectsTree
        system={folder.system}
        selectedNodeId={null}
        onSelect={vi.fn()}
        onToggleVisibility={vi.fn()}
        onRename={vi.fn()}
        onToggleExpanded={vi.fn()}
        onReorderNode={vi.fn()}
        onMoveNodeIntoParent={onMoveNodeIntoParent}
        onCreateOrbit={vi.fn()}
        onCreateEquilibrium={vi.fn()}
        onDeleteNode={vi.fn()}
      />
    )

    const dataTransfer = {
      effectAllowed: '',
      data: new Map<string, string>(),
      getData(type: string) {
        return this.data.get(type) ?? ''
      },
      setData(type: string, value: string) {
        this.data.set(type, value)
      },
    }

    fireEvent.dragStart(screen.getByTestId(`object-tree-row-${objectNodeId}`), {
      dataTransfer,
    })
    const dragOver = new Event('dragover', { bubbles: true, cancelable: true })
    Object.defineProperty(dragOver, 'clientY', { value: 100 })
    Object.defineProperty(dragOver, 'dataTransfer', { value: dataTransfer })
    fireEvent(screen.getByTestId(`object-tree-row-${folder.nodeId}`), dragOver)
    const drop = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'dataTransfer', { value: dataTransfer })
    fireEvent(screen.getByTestId('objects-tree'), drop)

    expect(onMoveNodeIntoParent).toHaveBeenCalledWith(objectNodeId, folder.nodeId)
  })

  it('reorders a root object out of a folder into a root sibling position', () => {
    const { system, objectNodeId } = createDemoSystem()
    const targetObject: OrbitObject = {
      type: 'orbit',
      name: 'Orbit_Target',
      systemName: system.config.name,
      data: [[0, 0, 0, 0]],
      t_start: 0,
      t_end: 1,
      dt: 0.1,
    }
    const withTarget = addObject(system, targetObject)
    const targetRootId = withTarget.nodeId
    const folder = addFolder(withTarget.system, 'Folder_1')
    const nested = moveNodeIntoParent(folder.system, objectNodeId, folder.nodeId)
    const onReorderNode = vi.fn()

    render(
      <ObjectsTree
        system={nested}
        selectedNodeId={null}
        onSelect={vi.fn()}
        onToggleVisibility={vi.fn()}
        onRename={vi.fn()}
        onToggleExpanded={vi.fn()}
        onReorderNode={onReorderNode}
        onCreateOrbit={vi.fn()}
        onCreateEquilibrium={vi.fn()}
        onDeleteNode={vi.fn()}
      />
    )

    const dataTransfer = {
      effectAllowed: '',
      data: new Map<string, string>(),
      getData(type: string) {
        return this.data.get(type) ?? ''
      },
      setData(type: string, value: string) {
        this.data.set(type, value)
      },
    }
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      bottom: 120,
      height: 20,
      left: 0,
      right: 200,
      top: 100,
      width: 200,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    })

    fireEvent.dragStart(screen.getByTestId(`object-tree-row-${objectNodeId}`), {
      dataTransfer,
    })
    const dragOver = new Event('dragover', { bubbles: true, cancelable: true })
    Object.defineProperty(dragOver, 'clientY', { value: 104 })
    Object.defineProperty(dragOver, 'dataTransfer', { value: dataTransfer })
    fireEvent(screen.getByTestId(`object-tree-row-${targetRootId}`), dragOver)
    const drop = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'dataTransfer', { value: dataTransfer })
    fireEvent(screen.getByTestId('objects-tree'), drop)

    expect(onReorderNode).toHaveBeenCalledWith(objectNodeId, targetRootId, 'before')
    rectSpy.mockRestore()
  })

  it('reorders a root object to the end when dropped on tree whitespace', () => {
    const { system, objectNodeId } = createDemoSystem()
    const targetObject: OrbitObject = {
      type: 'orbit',
      name: 'Orbit_Target',
      systemName: system.config.name,
      data: [[0, 0, 0, 0]],
      t_start: 0,
      t_end: 1,
      dt: 0.1,
    }
    const withTarget = addObject(system, targetObject)
    const targetRootId = withTarget.nodeId
    const onReorderNode = vi.fn()

    render(
      <ObjectsTree
        system={withTarget.system}
        selectedNodeId={null}
        onSelect={vi.fn()}
        onToggleVisibility={vi.fn()}
        onRename={vi.fn()}
        onToggleExpanded={vi.fn()}
        onReorderNode={onReorderNode}
        onCreateOrbit={vi.fn()}
        onCreateEquilibrium={vi.fn()}
        onDeleteNode={vi.fn()}
      />
    )

    const dataTransfer = {
      effectAllowed: '',
      dropEffect: '',
      data: new Map<string, string>(),
      getData(type: string) {
        return this.data.get(type) ?? ''
      },
      setData(type: string, value: string) {
        this.data.set(type, value)
      },
    }
    const tree = screen.getByTestId('objects-tree')

    fireEvent.dragStart(screen.getByTestId(`object-tree-row-${objectNodeId}`), {
      dataTransfer,
    })
    const dragOver = new Event('dragover', { bubbles: true, cancelable: true })
    Object.defineProperty(dragOver, 'clientY', { value: 500 })
    Object.defineProperty(dragOver, 'dataTransfer', { value: dataTransfer })
    fireEvent(tree, dragOver)
    expect(dragOver.defaultPrevented).toBe(true)
    expect(dataTransfer.dropEffect).toBe('move')

    const drop = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'dataTransfer', { value: dataTransfer })
    fireEvent(tree, drop)

    expect(onReorderNode).toHaveBeenCalledWith(objectNodeId, targetRootId, 'after')
  })

  it('commits the current reorder preview on native drag end', () => {
    const system = createSystem({
      name: 'Drag_End_Commit_Test',
    })
    const firstObject: OrbitObject = {
      type: 'orbit',
      name: 'Orbit_First',
      systemName: system.config.name,
      data: [[0, 0, 0, 0]],
      t_start: 0,
      t_end: 1,
      dt: 0.1,
    }
    const secondObject: OrbitObject = {
      ...firstObject,
      name: 'Orbit_Second',
    }
    const withFirst = addObject(system, firstObject)
    const withSecond = addObject(withFirst.system, secondObject)
    const onReorderNode = vi.fn()

    render(
      <ObjectsTree
        system={withSecond.system}
        selectedNodeId={null}
        onSelect={vi.fn()}
        onToggleVisibility={vi.fn()}
        onRename={vi.fn()}
        onToggleExpanded={vi.fn()}
        onReorderNode={onReorderNode}
        onCreateOrbit={vi.fn()}
        onCreateEquilibrium={vi.fn()}
        onDeleteNode={vi.fn()}
      />
    )

    const dataTransfer = {
      effectAllowed: '',
      dropEffect: '',
      data: new Map<string, string>(),
      getData(type: string) {
        return this.data.get(type) ?? ''
      },
      setData(type: string, value: string) {
        this.data.set(type, value)
      },
    }
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    rectSpy.mockImplementation(function getMockRect(this: HTMLElement) {
      if (this.dataset.treeNodeId === withFirst.nodeId) {
        return {
          bottom: 120,
          height: 20,
          left: 0,
          right: 200,
          top: 100,
          width: 200,
          x: 0,
          y: 100,
          toJSON: () => ({}),
        }
      }
      return {
        bottom: 150,
        height: 20,
        left: 0,
        right: 200,
        top: 130,
        width: 200,
        x: 0,
        y: 130,
        toJSON: () => ({}),
      }
    })

    try {
      const sourceRow = screen.getByTestId(`object-tree-row-${withSecond.nodeId}`)
      fireEvent.dragStart(sourceRow, { dataTransfer })
      const dragOver = new Event('dragover', { bubbles: true, cancelable: true })
      Object.defineProperty(dragOver, 'clientY', { value: 104 })
      Object.defineProperty(dragOver, 'dataTransfer', { value: dataTransfer })
      fireEvent(screen.getByTestId(`object-tree-row-${withFirst.nodeId}`), dragOver)

      fireEvent.dragEnd(sourceRow, { dataTransfer })

      expect(onReorderNode).toHaveBeenCalledWith(
        withSecond.nodeId,
        withFirst.nodeId,
        'before'
      )
    } finally {
      rectSpy.mockRestore()
    }
  })

  it('reorders a root object to the start when dragged above the tree', () => {
    const system = createSystem({
      name: 'Root_Start_Test',
    })
    const firstObject: OrbitObject = {
      type: 'orbit',
      name: 'Orbit_First',
      systemName: system.config.name,
      data: [[0, 0, 0, 0]],
      t_start: 0,
      t_end: 1,
      dt: 0.1,
    }
    const secondObject: OrbitObject = {
      ...firstObject,
      name: 'Orbit_Second',
    }
    const withFirst = addObject(system, firstObject)
    const withSecond = addObject(withFirst.system, secondObject)
    const onReorderNode = vi.fn()

    render(
      <ObjectsTree
        system={withSecond.system}
        selectedNodeId={null}
        onSelect={vi.fn()}
        onToggleVisibility={vi.fn()}
        onRename={vi.fn()}
        onToggleExpanded={vi.fn()}
        onReorderNode={onReorderNode}
        onCreateOrbit={vi.fn()}
        onCreateEquilibrium={vi.fn()}
        onDeleteNode={vi.fn()}
      />
    )

    const dataTransfer = {
      effectAllowed: '',
      dropEffect: '',
      data: new Map<string, string>(),
      getData(type: string) {
        return this.data.get(type) ?? ''
      },
      setData(type: string, value: string) {
        this.data.set(type, value)
      },
    }
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    rectSpy.mockImplementation(function getMockRect(this: HTMLElement) {
      if (this.dataset.treeNodeId === withFirst.nodeId) {
        return {
          bottom: 120,
          height: 20,
          left: 0,
          right: 200,
          top: 100,
          width: 200,
          x: 0,
          y: 100,
          toJSON: () => ({}),
        }
      }
      if (this.dataset.treeNodeId === withSecond.nodeId) {
        return {
          bottom: 150,
          height: 20,
          left: 0,
          right: 200,
          top: 130,
          width: 200,
          x: 0,
          y: 130,
          toJSON: () => ({}),
        }
      }
      return {
        bottom: 200,
        height: 200,
        left: 0,
        right: 200,
        top: 0,
        width: 200,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }
    })

    try {
      fireEvent.dragStart(screen.getByTestId(`object-tree-row-${withSecond.nodeId}`), {
        dataTransfer,
      })
      const dragOver = new Event('dragover', { bubbles: true, cancelable: true })
      Object.defineProperty(dragOver, 'clientY', { value: 80 })
      Object.defineProperty(dragOver, 'dataTransfer', { value: dataTransfer })
      fireEvent(window, dragOver)
      expect(dragOver.defaultPrevented).toBe(true)
      expect(dataTransfer.dropEffect).toBe('move')

      const drop = new Event('drop', { bubbles: true, cancelable: true })
      Object.defineProperty(drop, 'dataTransfer', { value: dataTransfer })
      fireEvent(window, drop)

      expect(onReorderNode).toHaveBeenCalledWith(
        withSecond.nodeId,
        withFirst.nodeId,
        'before'
      )
    } finally {
      rectSpy.mockRestore()
    }
  })

  it('commits the current reorder preview when dropped outside the tree', () => {
    const { system, objectNodeId } = createDemoSystem()
    const targetObject: OrbitObject = {
      type: 'orbit',
      name: 'Orbit_Target',
      systemName: system.config.name,
      data: [[0, 0, 0, 0]],
      t_start: 0,
      t_end: 1,
      dt: 0.1,
    }
    const withTarget = addObject(system, targetObject)
    const targetRootId = withTarget.nodeId
    const onReorderNode = vi.fn()

    render(
      <ObjectsTree
        system={withTarget.system}
        selectedNodeId={null}
        onSelect={vi.fn()}
        onToggleVisibility={vi.fn()}
        onRename={vi.fn()}
        onToggleExpanded={vi.fn()}
        onReorderNode={onReorderNode}
        onCreateOrbit={vi.fn()}
        onCreateEquilibrium={vi.fn()}
        onDeleteNode={vi.fn()}
      />
    )

    const dataTransfer = {
      effectAllowed: '',
      dropEffect: '',
      data: new Map<string, string>(),
      getData(type: string) {
        return this.data.get(type) ?? ''
      },
      setData(type: string, value: string) {
        this.data.set(type, value)
      },
    }
    const tree = screen.getByTestId('objects-tree')

    fireEvent.dragStart(screen.getByTestId(`object-tree-row-${objectNodeId}`), {
      dataTransfer,
    })
    const dragOver = new Event('dragover', { bubbles: true, cancelable: true })
    Object.defineProperty(dragOver, 'clientY', { value: 500 })
    Object.defineProperty(dragOver, 'dataTransfer', { value: dataTransfer })
    fireEvent(tree, dragOver)

    const windowDragOver = new Event('dragover', { bubbles: true, cancelable: true })
    Object.defineProperty(windowDragOver, 'clientY', { value: 500 })
    Object.defineProperty(windowDragOver, 'dataTransfer', { value: dataTransfer })
    fireEvent(window, windowDragOver)
    expect(windowDragOver.defaultPrevented).toBe(true)

    const drop = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'dataTransfer', { value: dataTransfer })
    fireEvent(window, drop)

    expect(onReorderNode).toHaveBeenCalledWith(objectNodeId, targetRootId, 'after')
  })

  it('touch drags a root object to the end when moved over tree whitespace', () => {
    vi.useFakeTimers()
    const { system, objectNodeId } = createDemoSystem()
    const targetObject: OrbitObject = {
      type: 'orbit',
      name: 'Orbit_Target',
      systemName: system.config.name,
      data: [[0, 0, 0, 0]],
      t_start: 0,
      t_end: 1,
      dt: 0.1,
    }
    const withTarget = addObject(system, targetObject)
    const targetRootId = withTarget.nodeId
    const onReorderNode = vi.fn()

    render(
      <ObjectsTree
        system={withTarget.system}
        selectedNodeId={null}
        onSelect={vi.fn()}
        onToggleVisibility={vi.fn()}
        onRename={vi.fn()}
        onToggleExpanded={vi.fn()}
        onReorderNode={onReorderNode}
        onCreateOrbit={vi.fn()}
        onCreateEquilibrium={vi.fn()}
        onDeleteNode={vi.fn()}
      />
    )

    const sourceRow = screen.getByTestId(`object-tree-row-${objectNodeId}`)
    const tree = screen.getByTestId('objects-tree')
    const originalElementFromPoint = document.elementFromPoint
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => tree),
    })

    try {
      fireEvent(
        sourceRow,
        createPointerEvent('pointerdown', {
          button: 0,
          clientX: 16,
          clientY: 16,
          pointerId: 9,
          pointerType: 'touch',
        })
      )
      act(() => {
        vi.advanceTimersByTime(250)
      })
      fireEvent(
        sourceRow,
        createPointerEvent('pointermove', {
          clientX: 20,
          clientY: 500,
          pointerId: 9,
          pointerType: 'touch',
        })
      )
      fireEvent(
        sourceRow,
        createPointerEvent('pointerup', {
          clientX: 20,
          clientY: 500,
          pointerId: 9,
          pointerType: 'touch',
        })
      )

      expect(onReorderNode).toHaveBeenCalledWith(objectNodeId, targetRootId, 'after')
    } finally {
      if (originalElementFromPoint) {
        Object.defineProperty(document, 'elementFromPoint', {
          configurable: true,
          value: originalElementFromPoint,
        })
      } else {
        Reflect.deleteProperty(document, 'elementFromPoint')
      }
      vi.useRealTimers()
    }
  })

  it('moves an object child branch into a child folder under the same object', () => {
    const { system, objectNodeId, branchNodeId } = createDemoSystem()
    const folder = addFolder(system, 'Folder_1', objectNodeId)
    const onMoveNodeIntoParent = vi.fn()

    render(
      <ObjectsTree
        system={folder.system}
        selectedNodeId={null}
        onSelect={vi.fn()}
        onToggleVisibility={vi.fn()}
        onRename={vi.fn()}
        onToggleExpanded={vi.fn()}
        onReorderNode={vi.fn()}
        onMoveNodeIntoParent={onMoveNodeIntoParent}
        onCreateOrbit={vi.fn()}
        onCreateEquilibrium={vi.fn()}
        onDeleteNode={vi.fn()}
      />
    )

    const dataTransfer = {
      effectAllowed: '',
      data: new Map<string, string>(),
      getData(type: string) {
        return this.data.get(type) ?? ''
      },
      setData(type: string, value: string) {
        this.data.set(type, value)
      },
    }

    fireEvent.dragStart(screen.getByTestId(`object-tree-row-${branchNodeId}`), {
      dataTransfer,
    })
    const dragOver = new Event('dragover', { bubbles: true, cancelable: true })
    Object.defineProperty(dragOver, 'clientY', { value: 100 })
    Object.defineProperty(dragOver, 'dataTransfer', { value: dataTransfer })
    fireEvent(screen.getByTestId(`object-tree-row-${folder.nodeId}`), dragOver)
    const drop = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'dataTransfer', { value: dataTransfer })
    fireEvent(screen.getByTestId('objects-tree'), drop)

    expect(onMoveNodeIntoParent).toHaveBeenCalledWith(branchNodeId, folder.nodeId)
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
    const parentDepth = Number.parseFloat(
      parentRow.style.getPropertyValue('--tree-node-depth') || '0'
    )
    const branchDepth = Number.parseFloat(
      branchRow.style.getPropertyValue('--tree-node-depth') || '0'
    )

    expect(branchDepth).toBeGreaterThan(parentDepth)
  })

  it('keeps continuation types in accessible labels and separate metadata', () => {
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

    expect(screen.getByTestId(`object-tree-node-${demo.branchNodeId}`)).toHaveAccessibleName(
      'Branch: eq_branch (equilibrium)'
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

    expect(screen.getByTestId(`object-tree-node-${limitCycleBranchId}`)).toHaveAccessibleName(
      'Branch: lc_pd_mu (limit cycle)'
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

    expect(screen.getByTestId(`object-tree-node-${demo.branchNodeId}`)).toHaveAccessibleName(
      'Branch: eq_branch (equilibrium manifold (2d, ring build failed))'
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

  describe('single-line rows', () => {
    function renderTree(
      system: ReturnType<typeof createDemoSystem>['system'],
      overrides: Partial<Parameters<typeof ObjectsTree>[0]> = {}
    ) {
      const props = {
        system,
        selectedNodeId: null as string | null,
        onSelect: vi.fn(),
        onToggleVisibility: vi.fn(),
        onRename: vi.fn(),
        onToggleExpanded: vi.fn(),
        onReorderNode: vi.fn(),
        onCreateOrbit: vi.fn(),
        onCreateEquilibrium: vi.fn(),
        onDeleteNode: vi.fn(),
        ...overrides,
      }
      const utils = render(<ObjectsTree {...props} />)
      return { ...utils, props }
    }

    function withBifurcatingBranch() {
      const demo = createDemoSystem()
      const branch = demo.system.branches[demo.branchNodeId]
      const points = [-0.5, 0, 0.5, 1, 1.5].map((param_value, index) => ({
        state: [0, 0],
        param_value,
        stability: index === 1 || index === 3 ? 'Fold' : index === 2 ? 'Hopf' : 'None',
        eigenvalues: [],
      }))
      const system = structuredClone(demo.system)
      system.branches[demo.branchNodeId] = {
        ...branch,
        data: { ...branch.data, points, bifurcations: [1, 2, 3], indices: [0, 1, 2, 3, 4] },
      }
      return { ...demo, system }
    }

    it('shows a type glyph, a data summary and deduplicated bifurcation badges', () => {
      const demo = withBifurcatingBranch()
      renderTree(demo.system)

      const orbitRow = screen.getByTestId(`object-tree-row-${demo.objectNodeId}`)
      expect(orbitRow.querySelector('.tree-node__glyph')).toHaveAttribute('data-kind', 'orbit')
      expect(orbitRow.querySelector('.tree-node__data')).toHaveTextContent('t 0–0.2 · 3')

      const branchRow = screen.getByTestId(`object-tree-row-${demo.branchNodeId}`)
      expect(branchRow.querySelector('.tree-node__glyph')).toHaveAttribute(
        'data-kind',
        'branch-equilibrium'
      )
      expect(branchRow.querySelector('.tree-node__data')).toHaveTextContent('p1 −0.5…1.5 · 5')
      const badges = Array.from(branchRow.querySelectorAll('.bif')).map((el) => el.textContent)
      expect(badges).toEqual(['LP×2', 'H'])

      const label = screen.getByTestId(`object-tree-node-${demo.branchNodeId}`)
      expect(label).toHaveAccessibleName('Branch: eq_branch (equilibrium)')
      expect(label).toHaveAccessibleDescription(/p1 −0.5…1.5 · 5/)
    })

    it('falls back to index summaries for entities that are not hydrated', () => {
      const demo = withBifurcatingBranch()
      const skeleton = structuredClone(demo.system)
      skeleton.index.branches[demo.branchNodeId].summary = {
        text: 'p1 −0.5…1.5 · 5',
        bifs: [
          ['LP', 2],
          ['H', 1],
        ],
      }
      skeleton.index.objects[demo.objectNodeId].summary = { status: 'saddle 1u', tone: 'saddle' }
      skeleton.objects = {}
      skeleton.branches = {}
      renderTree(skeleton)

      const objectRow = screen.getByTestId(`object-tree-row-${demo.objectNodeId}`)
      expect(objectRow.querySelector('.chip--saddle')).toHaveTextContent('saddle 1u')
      const branchRow = screen.getByTestId(`object-tree-row-${demo.branchNodeId}`)
      expect(branchRow.querySelector('.tree-node__data')).toHaveTextContent('p1 −0.5…1.5 · 5')
      expect(branchRow.querySelectorAll('.bif')).toHaveLength(2)
    })

    it('uses an explicit eye toggle, dims hidden rows and counts folder children', async () => {
      const user = userEvent.setup()
      const demo = createDemoSystem()
      const withFolder = addFolder(demo.system, 'Folder_1')
      const moved = moveNodeIntoParent(withFolder.system, demo.objectNodeId, withFolder.nodeId)
      moved.nodes[demo.objectNodeId].visibility = false
      const { props } = renderTree(moved)

      const folderLabel = screen.getByTestId(`object-tree-node-${withFolder.nodeId}`)
      expect(folderLabel.textContent).toBe('Folder_1')
      const folderRow = screen.getByTestId(`object-tree-row-${withFolder.nodeId}`)
      expect(folderRow.querySelector('.tree-node__count')).toHaveTextContent('1')

      const hiddenRow = screen.getByTestId(`object-tree-row-${demo.objectNodeId}`)
      expect(hiddenRow).toHaveClass('tree-node__row--hidden')
      const eye = screen.getByTestId(`node-visibility-${demo.objectNodeId}`)
      expect(eye).toHaveAttribute('data-visible', 'false')
      expect(eye).toHaveAccessibleName('Show node')
      await user.click(eye)
      expect(props.onToggleVisibility).toHaveBeenCalledWith(demo.objectNodeId)
      expect(props.onSelect).not.toHaveBeenCalled()
      expect(screen.getByTestId(`object-tree-row-${demo.branchNodeId}`)).toHaveClass(
        'tree-node__row--inherited-hidden'
      )
    })

    it('filters rows by name or summary and keeps ancestors visible', async () => {
      const user = userEvent.setup()
      const demo = withBifurcatingBranch()
      let system = demo.system
      const extraIds: string[] = []
      for (let index = 0; index < 7; index += 1) {
        const orbit: OrbitObject = {
          type: 'orbit',
          name: `Extra_${index}`,
          systemName: system.config.name,
          data: [],
          t_start: 0,
          t_end: 1,
          dt: 0.1,
        }
        const added = addObject(system, orbit)
        system = added.system
        extraIds.push(added.nodeId)
      }
      // Collapse the parent: matches inside collapsed nodes are still found.
      system = toggleNodeExpanded(system, demo.objectNodeId)
      renderTree(system)

      const filter = screen.getByTestId('objects-tree-filter')
      await user.type(filter, 'H')
      expect(screen.getByTestId(`object-tree-row-${demo.branchNodeId}`)).toBeInTheDocument()
      expect(screen.getByTestId(`object-tree-row-${demo.objectNodeId}`)).toBeInTheDocument()
      expect(screen.queryByTestId(`object-tree-row-${extraIds[0]}`)).toBeNull()

      await user.clear(filter)
      await user.type(filter, 'extra_3')
      expect(screen.getByTestId(`object-tree-row-${extraIds[3]}`)).toBeInTheDocument()
      expect(screen.queryByTestId(`object-tree-row-${demo.objectNodeId}`)).toBeNull()

      await user.clear(filter)
      await user.type(filter, 'zzz')
      expect(screen.getByText('No matches')).toBeInTheDocument()
    })

    it('supports keyboard navigation, visibility, rename, delete and the context menu key', () => {
      const demo = createDemoSystem()
      const orbitB: OrbitObject = {
        type: 'orbit',
        name: 'Orbit B',
        systemName: demo.system.config.name,
        data: [],
        t_start: 0,
        t_end: 1,
        dt: 0.1,
      }
      const second = addObject(demo.system, orbitB)
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
      const { props } = renderTree(second.system, { selectedNodeId: demo.objectNodeId })
      expect(screen.getByRole('tree')).toBeInTheDocument()
      const first = screen.getByTestId(`object-tree-node-${demo.objectNodeId}`)
      expect(first).toHaveAttribute('tabindex', '0')
      expect(screen.getByTestId(`object-tree-node-${second.nodeId}`)).toHaveAttribute(
        'tabindex',
        '-1'
      )

      fireEvent.keyDown(first, { key: 'ArrowDown' })
      expect(props.onSelect).toHaveBeenLastCalledWith(demo.branchNodeId)
      fireEvent.keyDown(first, { key: 'ArrowLeft' })
      expect(props.onToggleExpanded).toHaveBeenLastCalledWith(demo.objectNodeId)
      fireEvent.keyDown(screen.getByTestId(`object-tree-node-${demo.branchNodeId}`), {
        key: 'ArrowLeft',
      })
      expect(props.onSelect).toHaveBeenLastCalledWith(demo.objectNodeId)
      fireEvent.keyDown(first, { key: 'End' })
      expect(props.onSelect).toHaveBeenLastCalledWith(second.nodeId)

      fireEvent.keyDown(first, { key: ' ' })
      expect(props.onToggleVisibility).toHaveBeenLastCalledWith(demo.objectNodeId)

      fireEvent.keyDown(first, { key: 'Delete' })
      expect(confirmSpy).toHaveBeenCalled()
      expect(props.onDeleteNode).toHaveBeenCalledWith(demo.objectNodeId)
      confirmSpy.mockRestore()

      fireEvent.keyDown(first, { key: 'ContextMenu' })
      expect(screen.getByTestId('object-context-menu')).toBeInTheDocument()
      fireEvent.keyDown(window, { key: 'Escape' })
      expect(screen.queryByTestId('object-context-menu')).toBeNull()

      fireEvent.keyDown(first, { key: 'F2' })
      expect(screen.getByTestId(`node-rename-input-${demo.objectNodeId}`)).toHaveValue('Orbit A')
    })

    it('rejects an inline rename to a name a sibling already uses', async () => {
      const user = userEvent.setup()
      const demo = createDemoSystem()
      const orbitB: OrbitObject = {
        type: 'orbit',
        name: 'Orbit B',
        systemName: demo.system.config.name,
        data: [],
        t_start: 0,
        t_end: 1,
        dt: 0.1,
      }
      const second = addObject(demo.system, orbitB)
      const { props } = renderTree(second.system)
      fireEvent.keyDown(screen.getByTestId(`object-tree-node-${second.nodeId}`), { key: 'F2' })
      const input = screen.getByTestId(`node-rename-input-${second.nodeId}`)
      await user.clear(input)
      await user.type(input, 'Orbit A{enter}')
      expect(props.onRename).not.toHaveBeenCalled()
      expect(input).toBeInTheDocument()
      expect(input).toHaveAttribute('aria-invalid', 'true')
      expect(input).toHaveAttribute('title', 'Orbit "Orbit A" already exists.')
      await user.type(input, '2{enter}')
      expect(props.onRename).toHaveBeenCalledWith(second.nodeId, 'Orbit A2')
      expect(screen.queryByTestId(`node-rename-input-${second.nodeId}`)).toBeNull()
    })

    it('keeps keyboard focus in the tree after deleting a row', () => {
      const demo = createDemoSystem()
      const orbitB: OrbitObject = {
        type: 'orbit',
        name: 'Orbit B',
        systemName: demo.system.config.name,
        data: [],
        t_start: 0,
        t_end: 1,
        dt: 0.1,
      }
      const second = addObject(demo.system, orbitB)
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
      const onSelect = vi.fn()

      function Harness() {
        const [system, setSystem] = useState(second.system)
        return (
          <ObjectsTree
            system={system}
            selectedNodeId={system.ui.selectedNodeId}
            onSelect={onSelect}
            onToggleVisibility={vi.fn()}
            onRename={vi.fn()}
            onToggleExpanded={vi.fn()}
            onReorderNode={vi.fn()}
            onCreateOrbit={vi.fn()}
            onCreateEquilibrium={vi.fn()}
            onDeleteNode={(id) => setSystem((current) => removeNode(current, id))}
          />
        )
      }

      render(<Harness />)
      const first = screen.getByTestId(`object-tree-node-${demo.objectNodeId}`)
      first.focus()
      // The orbit's branch is deleted with it, so focus skips to the next orbit.
      fireEvent.keyDown(first, { key: 'Delete' })
      confirmSpy.mockRestore()
      expect(screen.queryByTestId(`object-tree-node-${demo.objectNodeId}`)).toBeNull()
      expect(onSelect).toHaveBeenLastCalledWith(second.nodeId)
      expect(screen.getByTestId(`object-tree-node-${second.nodeId}`)).toHaveFocus()
    })

    it('starts renaming a folder created outside the tree', async () => {
      const demo = createDemoSystem()

      function Harness() {
        const [system, setSystem] = useState(demo.system)
        const createFolder = () => {
          const created = addFolder(system, 'Folder_3')
          setSystem(selectNode(created.system, created.nodeId))
        }
        return (
          <>
          <button type="button" onClick={createFolder}>
            external folder
          </button>
          <ObjectsTree
            system={system}
            selectedNodeId={system.ui.selectedNodeId}
            onSelect={vi.fn()}
            onToggleVisibility={vi.fn()}
            onRename={vi.fn()}
            onToggleExpanded={vi.fn()}
            onReorderNode={vi.fn()}
            onCreateOrbit={vi.fn()}
            onCreateEquilibrium={vi.fn()}
            onDeleteNode={vi.fn()}
          />
          </>
        )
      }

      render(<Harness />)
      expect(screen.queryByDisplayValue('Folder_3')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'external folder' }))
      const input = await screen.findByDisplayValue('Folder_3')
      expect(input.getAttribute('data-testid')).toMatch(/^node-rename-input-/)
      expect(input).toHaveFocus()
    })

    it('merges a failure warning into the status chip and marks custom parameters with p', () => {
      let system = createSystem({ name: 'Flags' })
      system = {
        ...system,
        config: { ...system.config, paramNames: ['a'], params: [1] },
      }
      const failed = addObject(system, {
        type: 'equilibrium',
        name: 'Eq_Failed',
        systemName: 'Flags',
        customParameters: [2],
        lastRun: {
          timestamp: 'x',
          success: false,
          diagnostic: { kind: 'singular_jacobian', message: 'Newton solve: Jacobian is singular.' },
        },
      } as never)
      renderTree(failed.system)
      const row = screen.getByTestId(`object-tree-row-${failed.nodeId}`)
      const status = row.querySelector('.tree-node__status')
      expect(status).toHaveTextContent('failed')
      expect(status).toHaveAttribute('title', 'Newton solve: Jacobian is singular.')
      expect(row.querySelector('.tree-node__warn')).toBeNull()
      expect(screen.getByTestId(`object-tree-custom-${failed.nodeId}`)).toHaveTextContent('p')
    })

    it('renames on double click', async () => {
      const user = userEvent.setup()
      const demo = createDemoSystem()
      const { props } = renderTree(demo.system)
      await user.dblClick(screen.getByTestId(`object-tree-node-${demo.objectNodeId}`))
      const input = screen.getByTestId(`node-rename-input-${demo.objectNodeId}`)
      expect(input).toHaveFocus()
      await user.clear(input)
      await user.type(input, 'Renamed{enter}')
      expect(props.onRename).toHaveBeenCalledWith(demo.objectNodeId, 'Renamed')
    })

    it('starts renaming a folder created from the menus', async () => {
      const user = userEvent.setup()
      const demo = createDemoSystem()

      function Harness() {
        const [system, setSystem] = useState(demo.system)
        return (
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
            onCreateFolder={(parentId) => {
              const created = addFolder(system, 'Folder_7', parentId ?? null)
              setSystem(created.system)
              return created.nodeId
            }}
          />
        )
      }

      render(<Harness />)
      fireEvent.contextMenu(screen.getByTestId(`object-tree-row-${demo.objectNodeId}`))
      await user.click(screen.getByTestId('object-context-create-folder'))
      const input = await screen.findByDisplayValue('Folder_7')
      expect(input.getAttribute('data-testid')).toMatch(/^node-rename-input-/)
    })
  })
})
