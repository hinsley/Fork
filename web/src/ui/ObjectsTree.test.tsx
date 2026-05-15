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

  it('renders root folders and creates a child folder from an object context menu', async () => {
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

    fireEvent.contextMenu(screen.getByTestId(`object-tree-row-${objectNodeId}`))
    await user.click(screen.getByTestId('object-context-create-folder'))
    expect(onCreateFolder).toHaveBeenCalledWith(objectNodeId)

    fireEvent.contextMenu(screen.getByTestId(`object-tree-row-${withFolder.nodeId}`))
    expect(screen.getByTestId('object-context-create-folder')).toHaveTextContent(
      'Create Subfolder'
    )
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
