import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { addObject, createSystem } from '../../system/model'
import type { StateGridObject } from '../../system/types'
import type { StateGridComputeRequest } from '../../state/appState'
import { StateGridInspector } from './StateGridInspector'
import { WorkflowFocusProvider } from './selectionSession'

function fixture() {
  const base = createSystem({ name: 'Linear flow' })
  const object: StateGridObject = {
    type: 'state_grid',
    name: 'State_Grid_1',
    systemName: base.name,
    axes: [
      { variableName: 'x', min: -1, max: 1, resolution: 3 },
      { variableName: 'y', min: -1, max: 1, resolution: 4 },
    ],
    sampling: { type: 'cartesian_cell_centers' },
    analysis: {
      type: 'expansion_entropy',
      steps: 100,
      dt: 0.01,
      checkpointStride: 10,
      stabilizationStride: 5,
    },
    parameters: [],
    createdAt: '2026-07-30T00:00:00.000Z',
  }
  const added = addObject(base, object)
  return {
    system: added.system,
    nodeId: added.nodeId,
    object: added.system.objects[added.nodeId] as StateGridObject,
  }
}

describe('StateGridInspector', () => {
  it('uses the shared nested configure actions for parameters and frozen variables', () => {
    const initial = fixture()
    const onUpdateObjectParams = vi.fn()
    const onUpdateObjectFrozenVariables = vi.fn()
    render(
      <WorkflowFocusProvider>
        <StateGridInspector
          system={initial.system}
          nodeId={initial.nodeId}
          object={initial.object}
          onRename={() => {}}
          onUpdate={() => {}}
          onCompute={async () => null}
          onUpdateObjectParams={onUpdateObjectParams}
          onUpdateObjectFrozenVariables={onUpdateObjectFrozenVariables}
        />
      </WorkflowFocusProvider>
    )

    expect(screen.getByTestId('action-frozen-variables-toggle')).toBeInTheDocument()
    expect(screen.getByTestId('action-parameters-toggle')).toBeInTheDocument()
    expect(screen.getByTestId('action-state-grid-setup-toggle')).toBeInTheDocument()
    expect(screen.getByTestId('action-state-grid-entropy-toggle')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('action-frozen-variables-toggle'))
    fireEvent.click(screen.getByTestId('frozen-variable-toggle-x'))
    expect(onUpdateObjectFrozenVariables).toHaveBeenCalledWith(initial.nodeId, { x: 0 })
  })

  it('keeps State Grid setup in Configure and only offers invariant measure for maps', () => {
    const initial = fixture()
    const mapSystem = {
      ...initial.system,
      config: {
        ...initial.system.config,
        type: 'map' as const,
        solver: 'discrete' as const,
      },
    }
    const { unmount } = render(
      <WorkflowFocusProvider>
        <StateGridInspector
          system={mapSystem}
          nodeId={initial.nodeId}
          object={initial.object}
          onRename={() => {}}
          onUpdate={() => {}}
          onCompute={async () => null}
        />
      </WorkflowFocusProvider>
    )

    const configureGroup = screen.getByText('Configure').closest('.inspector-actions__group')
    expect(
      Array.from(configureGroup?.querySelectorAll('button') ?? []).map((button) =>
        button.getAttribute('data-testid')
      )
    ).toEqual([
      'action-frozen-variables-toggle',
      'action-parameters-toggle',
      'action-state-grid-setup-toggle',
    ])
    expect(screen.getByTestId('action-state-grid-transfer-toggle')).toBeInTheDocument()
    unmount()

    const flowSystem = {
      ...initial.system,
      config: {
        ...initial.system.config,
        type: 'flow' as const,
        solver: 'rk4' as const,
      },
    }
    render(
      <WorkflowFocusProvider>
        <StateGridInspector
          system={flowSystem}
          nodeId={initial.nodeId}
          object={initial.object}
          onRename={() => {}}
          onUpdate={() => {}}
          onCompute={async () => null}
        />
      </WorkflowFocusProvider>
    )
    expect(screen.queryByTestId('action-state-grid-transfer-toggle')).not.toBeInTheDocument()
  })

  it('updates the Cartesian product count live as a resolution changes', () => {
    const initial = fixture()

    function Harness() {
      const [object, setObject] = useState(initial.object)
      return (
        <StateGridInspector
          system={{ ...initial.system, objects: { [initial.nodeId]: object } }}
          nodeId={initial.nodeId}
          object={object}
          onRename={() => {}}
          onUpdate={(_id, update) => setObject((current) => ({ ...current, ...update }))}
          onCompute={async () => null}
        />
      )
    }

    render(<Harness />)
    expect(screen.getByTestId('state-grid-total-points')).toHaveTextContent('12')
    fireEvent.change(screen.getByTestId('state-grid-x-resolution'), {
      target: { value: '5' },
    })
    expect(screen.getByTestId('state-grid-total-points')).toHaveTextContent('20')
    expect(screen.getByTestId('state-grid-workload')).toHaveTextContent('2,000')
  })

  it.each(['flow', 'map'] as const)(
    'keeps transient State Grid bounds and resolution drafts for %s systems',
    (dynamicsType) => {
      const initial = fixture()
      const system =
        dynamicsType === 'map'
          ? {
              ...initial.system,
              config: {
                ...initial.system.config,
                type: 'map' as const,
                solver: 'discrete' as const,
              },
            }
          : initial.system
      const onUpdate = vi.fn()

      render(
        <StateGridInspector
          system={system}
          nodeId={initial.nodeId}
          object={initial.object}
          onRename={() => {}}
          onUpdate={onUpdate}
          onCompute={async () => null}
        />
      )

      const fields = [
        screen.getByTestId('state-grid-x-min'),
        screen.getByTestId('state-grid-x-max'),
        screen.getByTestId('state-grid-x-resolution'),
      ]
      for (const field of fields) {
        fireEvent.change(field, { target: { value: '-' } })
      }

      for (const field of fields) {
        expect(field).toHaveValue('-')
      }
      expect(onUpdate).not.toHaveBeenCalled()

      fireEvent.change(screen.getByTestId('state-grid-x-min'), {
        target: { value: '-0.5' },
      })
      fireEvent.change(screen.getByTestId('state-grid-x-max'), {
        target: { value: '0.5' },
      })
      fireEvent.change(screen.getByTestId('state-grid-x-resolution'), {
        target: { value: '5' },
      })
      expect(onUpdate).toHaveBeenCalledWith(initial.nodeId, {
        axes: expect.arrayContaining([
          expect.objectContaining({ variableName: 'x', min: -0.5 }),
        ]),
      })
      expect(onUpdate).toHaveBeenCalledWith(initial.nodeId, {
        axes: expect.arrayContaining([
          expect.objectContaining({ variableName: 'x', max: 0.5 }),
        ]),
      })
      expect(onUpdate).toHaveBeenCalledWith(initial.nodeId, {
        axes: expect.arrayContaining([
          expect.objectContaining({ variableName: 'x', resolution: 5 }),
        ]),
      })
      expect(onUpdate).toHaveBeenCalledTimes(3)
    }
  )

  it.each(['flow', 'map'] as const)(
    'rejects an unfinished State Grid draft at entropy submit for %s systems',
    async (dynamicsType) => {
      const initial = fixture()
      const system =
        dynamicsType === 'map'
          ? {
              ...initial.system,
              config: {
                ...initial.system.config,
                type: 'map' as const,
                solver: 'discrete' as const,
              },
            }
          : initial.system
      const onCompute = vi.fn(async () => null)

      render(
        <StateGridInspector
          system={system}
          nodeId={initial.nodeId}
          object={initial.object}
          onRename={() => {}}
          onUpdate={() => {}}
          onCompute={onCompute}
        />
      )

      fireEvent.change(screen.getByTestId('state-grid-x-min'), {
        target: { value: '-' },
      })
      fireEvent.click(screen.getByTestId('state-grid-run-expansion-entropy'))

      expect(onCompute).not.toHaveBeenCalled()
      expect(screen.getByTestId('state-grid-inspector')).toHaveTextContent(
        'State Grid min for "x" must be a finite number.'
      )
    }
  )

  it('runs expansion entropy and exposes cancellation while work is active', async () => {
    const initial = fixture()
    let resolveRun: () => void = () => {}
    const onCompute = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRun = resolve
        })
    )

    render(
      <StateGridInspector
        system={initial.system}
        nodeId={initial.nodeId}
        object={initial.object}
        onRename={() => {}}
        onUpdate={() => {}}
        onCompute={onCompute}
      />
    )
    fireEvent.click(screen.getByTestId('state-grid-run-expansion-entropy'))
    expect(onCompute).toHaveBeenCalledWith(
      { stateGridId: initial.nodeId },
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
    expect(screen.getByTestId('state-grid-cancel-expansion-entropy')).toBeInTheDocument()
    resolveRun()
    await waitFor(() =>
      expect(screen.queryByTestId('state-grid-cancel-expansion-entropy')).not.toBeInTheDocument()
    )
  })

  it('uses iteration terminology and enables expansion entropy for maps', async () => {
    const initial = fixture()
    const mapSystem = {
      ...initial.system,
      config: {
        ...initial.system.config,
        type: 'map' as const,
        solver: 'discrete' as const,
      },
    }
    const onCompute = vi.fn(async () => null)

    render(
      <StateGridInspector
        system={mapSystem}
        nodeId={initial.nodeId}
        object={initial.object}
        onRename={() => {}}
        onUpdate={() => {}}
        onCompute={onCompute}
      />
    )

    expect(screen.getByText('Iterations')).toBeInTheDocument()
    expect(screen.queryByText('Step size')).not.toBeInTheDocument()
    expect(screen.getByTestId('state-grid-workload')).toHaveTextContent(
      'Map/tangent iterations'
    )
    fireEvent.click(screen.getByTestId('state-grid-run-expansion-entropy'))
    await waitFor(() => expect(onCompute).toHaveBeenCalled())
  })

  it('configures and creates a separate invariant measure for maps', async () => {
    const initial = fixture()
    const mapSystem = {
      ...initial.system,
      config: {
        ...initial.system.config,
        type: 'map' as const,
        solver: 'discrete' as const,
      },
    }
    const onUpdate = vi.fn()
    let resolveRun: () => void = () => {}
    let receivedSignal: AbortSignal | undefined
    const onComputeTransferOperator = vi.fn(
      (request: StateGridComputeRequest, opts?: { signal?: AbortSignal }) => {
        void request
        receivedSignal = opts?.signal
        return new Promise<void>((resolve) => {
          resolveRun = resolve
        })
      }
    )

    render(
      <WorkflowFocusProvider>
        <StateGridInspector
          system={mapSystem}
          nodeId={initial.nodeId}
          object={initial.object}
          onRename={() => {}}
          onUpdate={onUpdate}
          onCompute={async () => null}
          onComputeTransferOperator={onComputeTransferOperator}
        />
      </WorkflowFocusProvider>
    )

    fireEvent.click(screen.getByTestId('action-state-grid-transfer-toggle'))
    expect(screen.getByTestId('state-grid-invariant-measure-workflow')).toHaveTextContent(
      'Create a separate invariant-measure object'
    )
    fireEvent.change(screen.getByTestId('state-grid-transfer-samples-per-cell'), {
      target: { value: '8' },
    })
    expect(onUpdate).toHaveBeenCalledWith(initial.nodeId, {
      transferOperator: {
        settings: expect.objectContaining({ samplesPerCell: 8 }),
      },
    })

    fireEvent.click(screen.getByTestId('state-grid-create-invariant-measure'))
    expect(onComputeTransferOperator).toHaveBeenCalledWith(
      { stateGridId: initial.nodeId },
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
    fireEvent.click(screen.getByTestId('state-grid-cancel-invariant-measure'))
    expect(receivedSignal?.aborted).toBe(true)
    resolveRun()
    await waitFor(() =>
      expect(screen.queryByTestId('state-grid-cancel-invariant-measure')).not.toBeInTheDocument()
    )
  })

  it('surfaces location-rich invariant-measure failures in the State Grid workflow', async () => {
    const initial = fixture()
    const mapSystem = {
      ...initial.system,
      config: {
        ...initial.system.config,
        type: 'map' as const,
        solver: 'discrete' as const,
      },
    }
    const diagnostic =
      'The conditional transfer domain is not closed: source cell coordinates [0] with bounds x ∈ [0, 0.5] has an in-grid transition to zero-survivor target cell coordinates [1] with bounds x ∈ [0.5, 1].'
    const onComputeTransferOperator = vi.fn(async () => {
      throw new Error(diagnostic)
    })

    render(
      <WorkflowFocusProvider>
        <StateGridInspector
          system={mapSystem}
          nodeId={initial.nodeId}
          object={initial.object}
          onRename={() => {}}
          onUpdate={() => {}}
          onCompute={async () => null}
          onComputeTransferOperator={onComputeTransferOperator}
        />
      </WorkflowFocusProvider>
    )

    fireEvent.click(screen.getByTestId('action-state-grid-transfer-toggle'))
    fireEvent.click(screen.getByTestId('state-grid-create-invariant-measure'))
    await waitFor(() => expect(screen.getByTestId('state-grid-transfer-error')).toHaveTextContent(diagnostic))
  })

  it('shows a stored finite-time estimate and survivor diagnostics', () => {
    const initial = fixture()
    const object: StateGridObject = {
      ...initial.object,
      lastResult: {
        analysisType: 'expansion_entropy',
        method: 'hunt_ott',
        scope: 'finite_horizon_finite_ensemble_region_restricted',
        dynamicsType: 'flow',
        horizonKind: 'time',
        escapePolicy: 'closed_box_checked_after_each_integration_step',
        axes: structuredClone(initial.object.axes),
        settings: structuredClone(initial.object.analysis),
        parameters: [],
        checkpoints: [0.5, 1],
        logMeanExpansion: [0.1, 0.2],
        entropyEstimates: [0.2, 0.2],
        survivorCounts: [12, 10],
        survivorFractions: [1, 10 / 12],
        totalSamples: 12,
        maxLogConditionNumber: 2,
        conditioningWarning: false,
        computedAt: '2026-07-30T00:01:00.000Z',
      },
    }
    render(
      <StateGridInspector
        system={{ ...initial.system, objects: { [initial.nodeId]: object } }}
        nodeId={initial.nodeId}
        object={object}
        onRename={() => {}}
        onUpdate={() => {}}
        onCompute={async () => null}
      />
    )

    expect(screen.getByTestId('state-grid-final-estimate')).toHaveTextContent('0.200000')
    expect(screen.getByTestId('state-grid-expansion-entropy-result')).toHaveTextContent('10 / 12')
    expect(screen.getByTestId('state-grid-expansion-entropy-plot')).toBeInTheDocument()
  })
})
