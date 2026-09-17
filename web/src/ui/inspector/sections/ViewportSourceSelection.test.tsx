import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { createSystem } from '../../../system/model'
import type { InspectorSelectionController } from '../../InspectorDetailsPanel'
import { DiagramInspectorSections } from './DiagramInspectorSections'
import { SceneInspectorSections } from './SceneInspectorSections'

const entries = [
  { id: 'alpha', name: 'Alpha', type: 'branch', visible: true, points: 3 },
  { id: 'beta', name: 'Beta', type: 'branch', visible: false, points: 4 },
]

function SourceSelection({ kind }: { kind: 'scene' | 'diagram' }) {
  const [selectedIds, setSelectedIds] = useState(['beta', 'missing', 'alpha'])
  const [search, setSearch] = useState('')
  const selectedSet = new Set(selectedIds)
  const selectedEntries = selectedIds.flatMap((id) => entries.filter((entry) => entry.id === id))
  const filteredEntries = entries.filter((entry) => entry.name.toLowerCase().includes(search))
  const common = { system: createSystem({ name: 'Sources' }) }
  if (kind === 'scene') {
    const scope = {
      ...common,
      scene: { id: 'scene', display: 'all' },
      sceneSelectedIds: selectedIds,
      sceneSelectedSet: selectedSet,
      sceneSelectedEntries: selectedEntries,
      sceneFilteredEntries: filteredEntries,
      sceneSearch: search,
      setSceneSearch: setSearch,
      onUpdateScene: (_: string, update: { selectedNodeIds: string[] }) =>
        setSelectedIds(update.selectedNodeIds),
      showSceneAxisPicker: false,
    } as unknown as InspectorSelectionController
    return <SceneInspectorSections scope={scope} />
  }
  const scope = {
    ...common,
    diagram: { id: 'diagram' },
    axisOptions: [],
    branchEntries: entries,
    diagramSelectedIds: selectedIds,
    diagramSelectedSet: selectedSet,
    diagramSelectedEntries: selectedEntries,
    diagramFilteredBranches: filteredEntries,
    diagramSearch: search,
    setDiagramSearch: setSearch,
    onUpdateBifurcationDiagram: (_: string, update: { selectedBranchIds: string[] }) =>
      setSelectedIds(update.selectedBranchIds),
  } as unknown as InspectorSelectionController
  return <DiagramInspectorSections scope={scope} />
}

describe('viewport source selection', () => {
  it.each(['scene', 'diagram'] as const)(
    'keeps selected %s sources ordered and removable under search without losing other selections',
    (kind) => {
      render(<SourceSelection kind={kind} />)
      const search = screen.getByRole('textbox')
      fireEvent.change(search, { target: { value: 'no match' } })
      const beta = screen.getByRole('checkbox', { name: /Beta/ })
      const missing = screen.getByRole('checkbox', { name: /missing/ })
      const alpha = screen.getByRole('checkbox', { name: /Alpha/ })
      expect(screen.getAllByRole('checkbox')).toEqual([beta, missing, alpha])
      expect(beta).toBeChecked()
      expect(missing).toBeChecked()
      expect(alpha).toBeChecked()
      fireEvent.click(missing)
      expect(screen.queryByRole('checkbox', { name: /missing/ })).toBeNull()
      expect(beta).toBeChecked()
      expect(alpha).toBeChecked()
      fireEvent.click(beta)
      expect(screen.queryByRole('checkbox', { name: /Beta/ })).toBeNull()
      expect(alpha).toBeChecked()
      fireEvent.change(search, { target: { value: '' } })
      const availableBeta = screen.getByRole('checkbox', { name: /Beta/ })
      expect(availableBeta).not.toBeChecked()
      expect(screen.getAllByRole('checkbox')).toEqual([alpha, availableBeta])
      fireEvent.click(availableBeta)
      expect(availableBeta).toBeChecked()
      expect(alpha).toBeChecked()
    }
  )
})
