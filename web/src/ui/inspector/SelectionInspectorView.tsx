import { useMemo, useState } from 'react'
import type { InspectorSelectionController } from '../InspectorDetailsPanel'
import { OrbitInspectorSections } from './sections/OrbitInspectorSections'
import { EquilibriumInspectorSections } from './sections/EquilibriumInspectorSections'
import { ForcedPeriodicResponseInspectorSections } from './sections/ForcedPeriodicResponseInspectorSections'
import { LimitCycleInspectorSections } from './sections/LimitCycleInspectorSections'
import { LimitCycleManifoldSection } from './sections/LimitCycleManifoldSection'
import { IsoclineInspectorSections } from './sections/IsoclineInspectorSections'
import { InvariantMeasureInspectorSections } from './sections/InvariantMeasureInspectorSections'
import { SceneInspectorSections } from './sections/SceneInspectorSections'
import { AnalysisInspectorSections } from './sections/AnalysisInspectorSections'
import { DiagramInspectorSections } from './sections/DiagramInspectorSections'
import { BranchInspectorSections } from './sections/BranchInspectorSections'
import type { LineStyle } from '../../system/types'
import {
  continuationPieceRanges,
  formatBifurcationLabel,
} from '../../system/continuation'
import { OpacityPercentInput } from '../OpacityPercentInput'
import { Icon } from '../Icon'
import { ActionBar, EntityHeader, SnowflakeIcon, type HeaderPanel } from './InspectorChrome'
import { buildObjectHeaderModel } from './sections/ObjectGlance'
import { NoSelectionInspector } from './NoSelectionInspector'

export function SelectionInspectorView({
  scope,
}: {
  scope: InspectorSelectionController
}) {
  const {
    StateTable,
    WorkflowFocusToolbar,
    activeFrozenVariableRef,
    autonomousAnalysisError,
    branch,
    commitSelectionName,
    currentObjectFrozenValues,
    currentFrozenEquationContext,
    equationContextName,
    equationContextUsed,
    formatPointValues,
    frozenVariableDrafts,
    frozenEquationContextDraft,
    handleClearParamOverride,
    handleFrozenVariableValueChange,
    handleFrozenEquationContextValueChange,
    handleParamOverrideChange,
    handlePasteParamOverride,
    handleToggleFrozenVariable,
    handleToggleFrozenEquationContext,
    hasCustomParamOverride,
    hasParamOverride,
    isocline,
    manifoldSurfaceVisible,
    nodeRender,
    nodeVisibility,
    onToggleVisibility,
    onUpdateRender,
    paramOverrideDraft,
    paramOverrideError,
    paramOverrideTarget,
    parseInteger,
    selectionKey,
    selectionNameDraft,
    selectionNode,
    selectionPayloadPending,
    selectionTypeLabel,
    setSelectionNameDraft,
    showVisibilityToggle,
    subsystemSnapshotMismatch,
    summary,
    supportsManifoldSurfaceToggle,
    supportsStateSpaceStride,
    systemDraft,
    workflowActions,
    workflowFocus,
    writeClipboardText,
  } = scope

    const branchPieceRanges = useMemo(
      () =>
        branch
          ? continuationPieceRanges(
              branch.data.points.length,
              branch.data.bifurcations
            )
          : [],
      [branch]
    )
    const [pieceSelection, setPieceSelection] = useState({
      selectionKey,
      pieceIndex: 0,
    })
    const selectedPieceIndex =
      pieceSelection.selectionKey === selectionKey &&
      pieceSelection.pieceIndex < branchPieceRanges.length
        ? pieceSelection.pieceIndex
        : 0
    const selectedPieceOverride =
      nodeRender.continuationPieceOverrides?.[selectedPieceIndex]
    const formatPieceBoundary = (pointIndex: number, edge: 'start' | 'end') => {
      if (!branch) return ''
      if (pointIndex === 0 && edge === 'start') return 'start'
      if (
        pointIndex === branch.data.points.length - 1 &&
        edge === 'end'
      ) {
        return 'end'
      }
      const point = branch.data.points[pointIndex]
      const logicalIndex = branch.data.indices[pointIndex]
      const displayIndex = Number.isFinite(logicalIndex)
        ? logicalIndex
        : pointIndex
      return formatBifurcationLabel(displayIndex, point?.stability)
    }
    const updateSelectedPieceOverride = (
      update: NonNullable<
        typeof nodeRender.continuationPieceOverrides
      >[number]
    ) => {
      if (!selectionNode) return
      onUpdateRender(selectionNode.id, {
        continuationPieceOverrides: {
          ...(nodeRender.continuationPieceOverrides ?? {}),
          [selectedPieceIndex]: {
            ...(nodeRender.continuationPieceOverrides?.[selectedPieceIndex] ?? {}),
            ...update,
          },
        },
      })
    }
    const enableSelectedPieceOverride = () => {
      updateSelectedPieceOverride({
        color: nodeRender.color,
        opacity: nodeRender.opacity,
        lineWidth: nodeRender.lineWidth,
        lineStyle: nodeRender.lineStyle,
        pointSize: nodeRender.pointSize,
      })
    }
    const clearSelectedPieceOverride = () => {
      if (!selectionNode) return
      const nextOverrides = {
        ...(nodeRender.continuationPieceOverrides ?? {}),
      }
      delete nextOverrides[selectedPieceIndex]
      onUpdateRender(selectionNode.id, {
        continuationPieceOverrides: nextOverrides,
      })
    }

    const navigationClass =
      workflowFocus?.navigationPhase !== 'idle' && workflowFocus?.navigationDirection
        ? ` inspector-navigation-page--${workflowFocus.navigationPhase}-${workflowFocus.navigationDirection}`
        : ''

    const objectModel = selectionNode?.kind === 'object' ? buildObjectHeaderModel(scope) : null
    const headerDetail: string | string[] | null =
      objectModel?.meta ?? summary?.detail ?? null
    const frozenCount =
      Object.keys(currentObjectFrozenValues).length + (currentFrozenEquationContext ? 1 : 0)

    const appearanceContent =
      selectionNode && (selectionNode.kind === 'object' || selectionNode.kind === 'branch') ? (
        <div className="inspector-section inspector-appearance" data-testid="appearance-section">
          <div className="inspector-form-grid">
            <label>
              Color
              <input
                type="color"
                value={nodeRender.color}
                onChange={(event) =>
                  onUpdateRender(selectionNode.id, { color: event.target.value })
                }
                data-testid="inspector-color"
              />
            </label>
            <label>
              Opacity %
              <OpacityPercentInput
                value={nodeRender.opacity}
                onChange={(opacity) => onUpdateRender(selectionNode.id, { opacity })}
                ariaLabel="Color opacity percentage"
                testId="inspector-color-opacity"
              />
            </label>
            <label>
              Line width
              <input
                type="number"
                min={1}
                max={8}
                value={nodeRender.lineWidth}
                onChange={(event) =>
                  onUpdateRender(selectionNode.id, {
                    lineWidth: Number(event.target.value),
                  })
                }
                data-testid="inspector-line-width"
              />
            </label>
            <label>
              Point size
              <input
                type="number"
                min={2}
                max={12}
                value={nodeRender.pointSize}
                onChange={(event) =>
                  onUpdateRender(selectionNode.id, {
                    pointSize: Number(event.target.value),
                  })
                }
                data-testid="inspector-point-size"
              />
            </label>
            {selectionNode.kind === 'branch' ? (
              <label>
                Line style
                <select
                  value={nodeRender.lineStyle}
                  onChange={(event) =>
                    onUpdateRender(selectionNode.id, {
                      lineStyle: event.target.value as LineStyle,
                    })
                  }
                  data-testid="inspector-line-style"
                >
                  <option value="solid">Solid</option>
                  <option value="dashed">Dashed</option>
                  <option value="dotted">Dotted</option>
                </select>
              </label>
            ) : null}
            {selectionNode.kind === 'branch' &&
            supportsStateSpaceStride &&
            systemDraft.type === 'flow' ? (
              <label title="Plot every Nth point in state space">
                State stride
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={nodeRender.stateSpaceStride ?? 1}
                  onChange={(event) => {
                    const parsed = parseInteger(event.target.value)
                    const safeValue = parsed && parsed > 0 ? parsed : 1
                    onUpdateRender(selectionNode.id, {
                      stateSpaceStride: safeValue,
                    })
                  }}
                  onFocus={(event) => event.currentTarget.select()}
                  data-testid="inspector-state-space-stride"
                />
              </label>
            ) : null}
          </div>
          {supportsManifoldSurfaceToggle ? (
            <button
              type="button"
              className="btn inspector-toggle-button"
              aria-pressed={manifoldSurfaceVisible}
              onClick={() =>
                onUpdateRender(selectionNode.id, {
                  manifoldSurfaceVisible: !manifoldSurfaceVisible,
                })
              }
              data-testid="inspector-manifold-surface-toggle"
            >
              {manifoldSurfaceVisible ? 'Hide surface' : 'Show surface'}
            </button>
          ) : null}
          {selectionNode.kind === 'branch' && branch && branchPieceRanges.length > 1 ? (
            <div className="inspector-subsection" data-testid="branch-piece-appearance">
              <div
                className="section-head"
                title="Bifurcation points split the branch into pieces; each piece can override the branch style."
              >
                <span>Pieces</span>
              </div>
              <select
                value={selectedPieceIndex}
                onChange={(event) =>
                  setPieceSelection({
                    selectionKey,
                    pieceIndex: Number(event.target.value),
                  })
                }
                aria-label="Piece"
                data-testid="branch-piece-select"
              >
                {branchPieceRanges.map((range) => (
                  <option key={range.pieceIndex} value={range.pieceIndex}>
                    {`Piece ${range.pieceIndex + 1} · ${formatPieceBoundary(
                      range.startPointIndex,
                      'start'
                    )} → ${formatPieceBoundary(range.endPointIndex, 'end')}`}
                  </option>
                ))}
              </select>
              {selectedPieceOverride ? (
                <>
                  <div className="inspector-form-grid">
                    <label>
                      Color
                      <input
                        type="color"
                        value={selectedPieceOverride.color ?? nodeRender.color}
                        onChange={(event) =>
                          updateSelectedPieceOverride({
                            color: event.target.value,
                          })
                        }
                        data-testid="branch-piece-color"
                      />
                    </label>
                    <label>
                      Opacity %
                      <OpacityPercentInput
                        value={selectedPieceOverride.opacity ?? nodeRender.opacity}
                        onChange={(opacity) => updateSelectedPieceOverride({ opacity })}
                        ariaLabel="Piece color opacity percentage"
                        testId="branch-piece-opacity"
                      />
                    </label>
                    <label>
                      Line width
                      <input
                        type="number"
                        min={1}
                        max={8}
                        value={selectedPieceOverride.lineWidth ?? nodeRender.lineWidth}
                        onChange={(event) =>
                          updateSelectedPieceOverride({
                            lineWidth: Number(event.target.value),
                          })
                        }
                        data-testid="branch-piece-line-width"
                      />
                    </label>
                    <label>
                      Point size
                      <input
                        type="number"
                        min={2}
                        max={12}
                        value={selectedPieceOverride.pointSize ?? nodeRender.pointSize}
                        onChange={(event) =>
                          updateSelectedPieceOverride({
                            pointSize: Number(event.target.value),
                          })
                        }
                        data-testid="branch-piece-point-size"
                      />
                    </label>
                    <label>
                      Line style
                      <select
                        value={selectedPieceOverride.lineStyle ?? nodeRender.lineStyle}
                        onChange={(event) =>
                          updateSelectedPieceOverride({
                            lineStyle: event.target.value as LineStyle,
                          })
                        }
                        data-testid="branch-piece-line-style"
                      >
                        <option value="solid">Solid</option>
                        <option value="dashed">Dashed</option>
                        <option value="dotted">Dotted</option>
                      </select>
                    </label>
                  </div>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={clearSelectedPieceOverride}
                    data-testid="branch-piece-clear"
                  >
                    Use branch style
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={enableSelectedPieceOverride}
                  data-testid="branch-piece-customize"
                >
                  Customize piece
                </button>
              )}
            </div>
          ) : null}
        </div>
      ) : null

    const frozenContent = paramOverrideTarget && (!isocline || equationContextUsed) ? (
      <div className="inspector-section" data-testid="frozen-variables-section">
        {subsystemSnapshotMismatch ? (
          <span
            className="chip chip--warning"
            title="Stored results used a different frozen-variable configuration"
            data-testid="subsystem-mismatch-badge"
          >
            mismatch
          </span>
        ) : null}
        {autonomousAnalysisError ? (
          <div className="field-warning" data-testid="autonomous-context-warning">
            {autonomousAnalysisError}
          </div>
        ) : null}
        <table className="data-table inspector-frozen-table" aria-label="Frozen variables">
          <thead>
            <tr>
              <th>Variable</th>
              <th title="Hold constant for this object's computations">Frozen</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {equationContextUsed ? (
              <tr key="frozen-equation-context-row">
                <td title="Equation forcing context">{equationContextName}</td>
                <td>
                  <input
                    type="checkbox"
                    checked={Boolean(currentFrozenEquationContext)}
                    onChange={(event) =>
                      handleToggleFrozenEquationContext(event.target.checked)
                    }
                    data-testid="frozen-equation-context-toggle"
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step={equationContextName === 'n' ? 1 : 'any'}
                    className="state-table__input"
                    value={frozenEquationContextDraft}
                    disabled={!currentFrozenEquationContext}
                    onChange={(event) =>
                      handleFrozenEquationContextValueChange(event.target.value)
                    }
                    data-testid="frozen-equation-context-value"
                  />
                </td>
              </tr>
            ) : null}
            {!isocline
              ? systemDraft.varNames.map((name, index) => {
                  const isFrozen = Object.prototype.hasOwnProperty.call(
                    currentObjectFrozenValues,
                    name
                  )
                  const value = currentObjectFrozenValues[name] ?? 0
                  return (
                    <tr key={`frozen-variable-row-${name || index}`}>
                      <td>{name || `x${index + 1}`}</td>
                      <td>
                        <input
                          type="checkbox"
                          checked={isFrozen}
                          onChange={(event) =>
                            handleToggleFrozenVariable(name, event.target.checked)
                          }
                          data-testid={`frozen-variable-toggle-${name}`}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          inputMode="decimal"
                          className="state-table__input"
                          value={frozenVariableDrafts[name] ?? value.toString()}
                          disabled={!isFrozen}
                          onFocus={() => {
                            activeFrozenVariableRef.current = name
                          }}
                          onBlur={() => {
                            if (activeFrozenVariableRef.current === name) {
                              activeFrozenVariableRef.current = null
                            }
                          }}
                          onChange={(event) =>
                            handleFrozenVariableValueChange(name, event.target.value)
                          }
                          data-testid={`frozen-variable-value-${name}`}
                        />
                      </td>
                    </tr>
                  )
                })
              : null}
          </tbody>
        </table>
      </div>
    ) : null

    const parametersContent = paramOverrideTarget && !isocline ? (
      <div className="inspector-section" data-testid="param-override-section">
        <StateTable
          title="Values"
          varNames={systemDraft.paramNames}
          values={paramOverrideDraft}
          onChange={handleParamOverrideChange}
          onCopy={() => void writeClipboardText(formatPointValues(paramOverrideDraft))}
          onPaste={handlePasteParamOverride}
          testIdPrefix="param-override"
        />
        {hasParamOverride ? (
          <button
            type="button"
            className="btn btn--ghost"
            onClick={handleClearParamOverride}
            data-testid="param-override-clear"
          >
            Restore defaults
          </button>
        ) : null}
        {paramOverrideError ? <div className="field-error">{paramOverrideError}</div> : null}
      </div>
    ) : null

    const headerPanels: HeaderPanel[] = []
    if (appearanceContent) {
      headerPanels.push({
        id: 'appearance',
        label: 'Appearance',
        icon: (
          <span className="inspector-swatch-icon">
            <Icon name="palette" />
            <span
              className="inspector-swatch-icon__dot"
              style={{ background: nodeRender.color }}
              aria-hidden="true"
            />
          </span>
        ),
        content: appearanceContent,
      })
    }
    if (parametersContent) {
      headerPanels.push({
        id: 'parameters',
        label: hasCustomParamOverride ? 'Parameters (custom)' : 'Parameters',
        icon: <Icon name="sliders" />,
        highlighted: hasCustomParamOverride,
        badge: hasCustomParamOverride ? 'p' : undefined,
        content: parametersContent,
      })
    }
    if (frozenContent) {
      headerPanels.push({
        id: 'frozen-variables',
        label: isocline ? 'Equation forcing context' : 'Frozen variables',
        icon: <SnowflakeIcon />,
        highlighted: frozenCount > 0 || subsystemSnapshotMismatch,
        badge: subsystemSnapshotMismatch ? '!' : frozenCount > 0 ? frozenCount : undefined,
        content: frozenContent,
      })
    }

    return (
      <div
        className={`inspector-panel inspector-browser${
          workflowFocus?.activeWorkflow ? ' inspector-browser--workflow' : ''
        }`}
        data-testid="inspector-panel-body"
        data-active-workflow={workflowFocus?.activeWorkflow ?? undefined}
        data-navigation-direction={workflowFocus?.navigationDirection ?? undefined}
        data-navigation-phase={workflowFocus?.navigationPhase ?? 'idle'}
      >
        {selectionNode ? (
          <div
            className={`inspector-group inspector-navigation-page${navigationClass}`}
            key={selectionKey}
          >
            <EntityHeader
              name={selectionNameDraft}
              onNameChange={setSelectionNameDraft}
              onNameCommit={commitSelectionName}
              onNameCancel={() => setSelectionNameDraft(selectionNode.name)}
              typeLabel={selectionTypeLabel}
              chip={objectModel?.chip ?? null}
              detail={headerDetail}
              visible={nodeVisibility}
              onToggleVisibility={
                showVisibilityToggle ? () => onToggleVisibility(selectionNode.id) : undefined
              }
              panels={headerPanels}
            />

            {objectModel?.glance ? (
              <div className="inspector-glance" data-testid="inspector-glance">
                {objectModel.glance}
              </div>
            ) : null}

            <WorkflowFocusToolbar entries={workflowActions} />

            {selectionPayloadPending ? (
              <div className="inspector-section">
                <p className="empty-state">Loading…</p>
              </div>
            ) : null}

            <ActionBar entries={workflowActions} />

            <OrbitInspectorSections scope={scope} />

            <EquilibriumInspectorSections scope={scope} />

            <ForcedPeriodicResponseInspectorSections scope={scope} />

            <LimitCycleInspectorSections scope={scope} />

            <LimitCycleManifoldSection scope={scope} />

            <InvariantMeasureInspectorSections scope={scope} />

            <IsoclineInspectorSections scope={scope} />

            <SceneInspectorSections scope={scope} />

            <AnalysisInspectorSections scope={scope} />

            <DiagramInspectorSections scope={scope} />

            <BranchInspectorSections scope={scope} />
          </div>
        ) : (
          <NoSelectionInspector system={scope.system} />
        )}
      </div>
    )

}
