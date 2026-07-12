import type { InspectorSelectionController } from '../InspectorDetailsPanel'
import { OrbitInspectorSections } from './sections/OrbitInspectorSections'
import { EquilibriumInspectorSections } from './sections/EquilibriumInspectorSections'
import { LimitCycleInspectorSections } from './sections/LimitCycleInspectorSections'
import { LimitCycleManifoldSection } from './sections/LimitCycleManifoldSection'
import { IsoclineInspectorSections } from './sections/IsoclineInspectorSections'
import { SceneInspectorSections } from './sections/SceneInspectorSections'
import { AnalysisInspectorSections } from './sections/AnalysisInspectorSections'
import { DiagramInspectorSections } from './sections/DiagramInspectorSections'
import { BranchInspectorSections } from './sections/BranchInspectorSections'
import type { LineStyle } from '../../system/types'

export function SelectionInspectorView({
  scope,
}: {
  scope: InspectorSelectionController
}) {
  const {
    InspectorDisclosure,
    InspectorMetrics,
    PlotlyViewport,
    StateTable,
    WorkflowActionList,
    WorkflowFocusToolbar,
    activeFrozenVariableRef,
    commitSelectionName,
    currentObjectFrozenValues,
    formatComplexValue,
    formatFixed,
    formatLimitCycleOrigin,
    formatNumber,
    formatPointValues,
    frozenVariableDrafts,
    handleClearParamOverride,
    handleComputeLimitCycleFloquetModes,
    handleFrozenVariableValueChange,
    handleLimitCycleFloquetColorChange,
    handleLimitCycleFloquetVisibilityChange,
    handleLimitCyclePreviewJump,
    handleParamOverrideChange,
    handlePasteParamOverride,
    handleToggleFrozenVariable,
    hasParamOverride,
    isRealEigenvalue,
    isocline,
    limitCycle,
    limitCycleDisplayParamValue,
    limitCycleDisplayParams,
    limitCycleFloquetColors,
    limitCycleFloquetIndices,
    limitCycleFloquetModePointCount,
    limitCycleFloquetModes,
    limitCycleFloquetModesAvailable,
    limitCycleFloquetModesError,
    limitCycleFloquetModesMatchMesh,
    limitCycleFloquetRender,
    limitCycleFloquetVisibleSet,
    limitCycleModeMultipliers,
    limitCycleMultiplierPlot,
    limitCyclePreviewEnd,
    limitCyclePreviewError,
    limitCyclePreviewInput,
    limitCyclePreviewPage,
    limitCyclePreviewPageCount,
    limitCyclePreviewRows,
    limitCyclePreviewStart,
    limitCyclePreviewVarNames,
    limitCycleProfilePoints,
    limitCycleRenderableMultipliers,
    manifoldSurfaceVisible,
    nodeRender,
    nodeVisibility,
    onLimitCyclePointSelect,
    onToggleVisibility,
    onUpdateRender,
    paramOverrideDraft,
    paramOverrideError,
    paramOverrideTarget,
    paramOverrideTitle,
    parseInteger,
    runDisabled,
    selectedLimitCyclePoint,
    selectedLimitCyclePointIndex,
    selectedNodeId,
    selectionKey,
    selectionNameDraft,
    selectionNode,
    selectionPayloadPending,
    selectionTypeLabel,
    setLimitCyclePreviewError,
    setLimitCyclePreviewInput,
    setLimitCyclePreviewPageIndex,
    setSelectionNameDraft,
    showVisibilityToggle,
    subsystemSnapshotMismatch,
    summary,
    supportsManifoldSurfaceToggle,
    supportsStateSpaceStride,
    systemDraft,
    updateLimitCycleFloquetRender,
    workflowActions,
    workflowFocus,
    writeClipboardText,
  } = scope

    return (
      <div
        className={`inspector-panel inspector-browser${
          workflowFocus?.activeWorkflow ? ' inspector-browser--workflow' : ''
        }${workflowFocus?.advancedOpen ? ' inspector-browser--advanced' : ''}`}
        data-testid="inspector-panel-body"
        data-active-workflow={workflowFocus?.activeWorkflow ?? undefined}
      >
        {selectionNode ? (
          <div className="inspector-group">
            <div className="inspector-section inspector-entity-header">
              <label>
                Name
                <input
                  value={selectionNameDraft}
                  onChange={(event) => setSelectionNameDraft(event.target.value)}
                  onBlur={commitSelectionName}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      event.currentTarget.blur()
                      return
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      setSelectionNameDraft(selectionNode.name)
                      event.currentTarget.blur()
                    }
                  }}
                  data-testid="inspector-name"
                />
              </label>
              <div className="inspector-meta">
                <span>{selectionTypeLabel}</span>
                {summary?.detail ? <span>{summary.detail}</span> : null}
              </div>
            </div>

            <WorkflowFocusToolbar entries={workflowActions} />

          {selectionPayloadPending ? (
            <div className="inspector-section">
              <p className="empty-state">Loading selected computation…</p>
            </div>
          ) : null}

          <WorkflowActionList entries={workflowActions} />

          {showVisibilityToggle ||
          selectionNode.kind === 'object' ||
          selectionNode.kind === 'branch' ? (
            <InspectorDisclosure
              title="Modify appearance"
              testId="appearance-toggle"
              actionOnly
            >
              <div className="inspector-section" data-testid="appearance-section">
                {showVisibilityToggle ? (
                  <label>
                    Visibility
                    <button
                      type="button"
                      onClick={() => onToggleVisibility(selectionNode.id)}
                      data-testid="inspector-visibility"
                    >
                      {nodeVisibility ? 'Visible' : 'Hidden'}
                    </button>
                  </label>
                ) : null}
                {selectionNode.kind === 'object' || selectionNode.kind === 'branch' ? (
                  <>
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
                      Line Width
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
                  </>
                ) : null}
                {selectionNode.kind === 'branch' ? (
                  <label>
                    Line Style
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
                {selectionNode.kind === 'object' || selectionNode.kind === 'branch' ? (
                  <label>
                    Point Size
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
                ) : null}
                {supportsManifoldSurfaceToggle ? (
                  <button
                    type="button"
                    className="inspector-inline-button inspector-toggle-button"
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
                {selectionNode.kind === 'branch' &&
                supportsStateSpaceStride &&
                systemDraft.type === 'flow' ? (
                  <label>
                    State space stride
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
            </InspectorDisclosure>
          ) : null}

          <LimitCycleInspectorSections scope={scope} />

          {paramOverrideTarget && !isocline ? (
            <InspectorDisclosure
              key={`${selectionKey}-frozen-variables`}
              title={
                subsystemSnapshotMismatch ? (
                  <>
                    <span>Frozen Variables</span>
                    <span className="tree-node__tag" data-testid="subsystem-mismatch-badge">
                      mismatch
                    </span>
                  </>
                ) : (
                  'Frozen Variables'
                )
              }
              testId="frozen-variables-toggle"
              actionOnly
            >
              <div className="inspector-section" data-testid="frozen-variables-section">
                <div className="state-table__wrap" role="region" aria-label="Frozen variables">
                  <table className="state-table__grid">
                    <thead>
                      <tr>
                        <th>Variable</th>
                        <th>Frozen</th>
                        <th>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {systemDraft.varNames.map((name, index) => {
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
                                value={
                                  frozenVariableDrafts[name] ??
                                  value.toString()
                                }
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
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="empty-state">
                  Frozen variables are embedded as constants across this object's computations.
                </p>
              </div>
            </InspectorDisclosure>

          ) : null}

          {paramOverrideTarget && !isocline ? (
            <InspectorDisclosure
              key={`${selectionKey}-parameters`}
              title={paramOverrideTitle}
              testId="parameters-toggle"
              actionOnly
            >
              <div className="inspector-section" data-testid="param-override-section">
                <StateTable
                  title="Parameter values"
                  varNames={systemDraft.paramNames}
                  values={paramOverrideDraft}
                  onChange={handleParamOverrideChange}
                  onCopy={() => void writeClipboardText(formatPointValues(paramOverrideDraft))}
                  onPaste={handlePasteParamOverride}
                  emptyMessage="No parameters defined yet."
                  testIdPrefix="param-override"
                />
                {hasParamOverride ? (
                  <div className="inspector-inline-actions">
                    <button
                      type="button"
                      className="inspector-inline-button"
                      onClick={handleClearParamOverride}
                      data-testid="param-override-clear"
                    >
                      Restore default parameters
                    </button>
                  </div>
                ) : null}
                {paramOverrideError ? (
                  <div className="field-error">{paramOverrideError}</div>
                ) : null}
              </div>
            </InspectorDisclosure>
          ) : null}

          <OrbitInspectorSections scope={scope} />

          <EquilibriumInspectorSections scope={scope} />

          {limitCycle ? (
            <InspectorDisclosure
              key={`${selectionKey}-limit-cycle-data`}
              title="Limit Cycle Data"
              testId="limit-cycle-data-toggle"
            >
              <div className="inspector-section">
                <h4 className="inspector-subheading">Summary</h4>
                <InspectorMetrics
                  rows={[
                    { label: 'System', value: limitCycle.systemName },
                    { label: 'Mesh', value: `${limitCycle.ntst} x ${limitCycle.ncol}` },
                    { label: 'Period', value: formatNumber(limitCycle.period, 6) },
                    { label: 'Continuation param', value: limitCycle.parameterName ?? 'n/a' },
                    {
                      label: 'Parameter value',
                      value:
                        limitCycleDisplayParamValue !== undefined
                          ? formatNumber(limitCycleDisplayParamValue, 6)
                          : 'n/a',
                    },
                    { label: 'Origin', value: formatLimitCycleOrigin(limitCycle.origin) },
                    { label: 'Created', value: limitCycle.createdAt },
                  ]}
                />
              </div>
              <div className="inspector-section">
                <div className="inspector-subheading-row">
                  <h4 className="inspector-subheading">Parameters</h4>
                  {limitCycleDisplayParams.length > 0 ? (
                    <button
                      type="button"
                      className="inspector-inline-button"
                      onClick={() =>
                        void writeClipboardText(formatPointValues(limitCycleDisplayParams))
                      }
                    >
                      Copy
                    </button>
                  ) : null}
                </div>
                {limitCycleDisplayParams.length > 0 ? (
                  <InspectorMetrics
                    rows={limitCycleDisplayParams.map((value, index) => ({
                      label: systemDraft.paramNames[index] || `p${index + 1}`,
                      value: formatNumber(value, 6),
                    }))}
                  />
                ) : (
                  <p className="empty-state">Parameters not recorded yet.</p>
                )}
              </div>
              <div className="inspector-section">
                <h4 className="inspector-subheading">Data preview</h4>
                {limitCycleProfilePoints.length > 0 ? (
                  <div className="orbit-preview">
                    <div className="orbit-preview__controls">
                      <div className="inspector-row inspector-row--nav">
                        <button
                          type="button"
                          onClick={() => setLimitCyclePreviewPageIndex(0)}
                          disabled={limitCyclePreviewPage <= 0}
                          data-testid="limit-cycle-preview-start"
                        >
                          Start
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setLimitCyclePreviewPageIndex(limitCyclePreviewPage - 1)
                          }
                          disabled={limitCyclePreviewPage <= 0}
                          data-testid="limit-cycle-preview-prev"
                        >
                          Previous
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setLimitCyclePreviewPageIndex(limitCyclePreviewPage + 1)
                          }
                          disabled={limitCyclePreviewPage >= limitCyclePreviewPageCount - 1}
                          data-testid="limit-cycle-preview-next"
                        >
                          Next
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setLimitCyclePreviewPageIndex(limitCyclePreviewPageCount - 1)
                          }
                          disabled={limitCyclePreviewPage >= limitCyclePreviewPageCount - 1}
                          data-testid="limit-cycle-preview-end"
                        >
                          End
                        </button>
                      </div>
                      <span className="orbit-preview__page">
                        Page {limitCyclePreviewPage + 1} of {limitCyclePreviewPageCount}
                      </span>
                      <label>
                        Jump to page
                        <div className="inspector-row orbit-preview__jump">
                          <input
                            type="number"
                            min={1}
                            max={limitCyclePreviewPageCount}
                            value={limitCyclePreviewInput}
                            onChange={(event) => {
                              setLimitCyclePreviewInput(event.target.value)
                              setLimitCyclePreviewError(null)
                            }}
                            data-testid="limit-cycle-preview-page-input"
                          />
                          <button
                            type="button"
                            onClick={handleLimitCyclePreviewJump}
                            data-testid="limit-cycle-preview-page-jump"
                          >
                            Jump
                          </button>
                        </div>
                      </label>
                      {limitCyclePreviewError ? (
                        <div className="field-error">{limitCyclePreviewError}</div>
                      ) : null}
                      <div className="orbit-preview__summary">
                        Showing {limitCyclePreviewStart + 1}–{limitCyclePreviewEnd} of{' '}
                        {limitCycleProfilePoints.length.toLocaleString()}
                      </div>
                      {selectedLimitCyclePoint ? (
                        <div className="inspector-inline-actions">
                          <span className="inspector-meta">
                            Selected point #{selectedLimitCyclePointIndex}
                          </span>
                          <button
                            type="button"
                            className="inspector-inline-button"
                            onClick={() =>
                              void writeClipboardText(formatPointValues(selectedLimitCyclePoint))
                            }
                          >
                            Copy state
                          </button>
                          {onLimitCyclePointSelect ? (
                            <button
                              type="button"
                              className="inspector-inline-button"
                              onClick={() => onLimitCyclePointSelect(null)}
                            >
                              Clear
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <div
                      className="orbit-preview__table"
                      role="region"
                      aria-label="Limit cycle data preview"
                    >
                      <table className="orbit-preview__table-grid">
                        <thead>
                          <tr>
                            <th>#</th>
                            {limitCyclePreviewVarNames.map((name, index) => (
                              <th key={`limit-cycle-preview-col-${index}`}>{name}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {limitCyclePreviewRows.map((point, rowIndex) => {
                            const pointIndex = limitCyclePreviewStart + rowIndex
                            const isSelected = pointIndex === selectedLimitCyclePointIndex
                            return (
                              <tr
                                key={`limit-cycle-preview-row-${pointIndex}`}
                                className={isSelected ? 'is-selected' : undefined}
                                onClick={() => {
                                  if (!onLimitCyclePointSelect || !selectedNodeId) return
                                  onLimitCyclePointSelect({
                                    limitCycleId: selectedNodeId,
                                    pointIndex,
                                  })
                                }}
                              >
                                <td>{pointIndex}</td>
                                {limitCyclePreviewVarNames.map((_, varIndex) => (
                                  <td key={`limit-cycle-preview-cell-${rowIndex}-${varIndex}`}>
                                    {formatFixed(point[varIndex] ?? Number.NaN, 4)}
                                  </td>
                                ))}
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <p className="empty-state">No limit cycle profile points stored yet.</p>
                )}
              </div>
              <div className="inspector-section">
                <h4 className="inspector-subheading">Floquet multipliers</h4>
                <div className="inspector-list">
                  {limitCycleModeMultipliers.length > 0 ? (
                    <>
                      {limitCycleMultiplierPlot ? (
                        <div className="inspector-plot">
                          <PlotlyViewport
                            plotId="limit-cycle-multiplier-plot"
                            data={limitCycleMultiplierPlot.data}
                            layout={limitCycleMultiplierPlot.layout}
                            testId="limit-cycle-multiplier-plot"
                          />
                        </div>
                      ) : null}
                      <InspectorMetrics
                        rows={limitCycleModeMultipliers.map((value, index) => ({
                          label: `Multiplier ${index + 1}`,
                          value: formatComplexValue(value),
                        }))}
                      />
                    </>
                  ) : (
                    <p className="empty-state">Floquet multipliers not computed yet.</p>
                  )}
                  {systemDraft.type === 'flow' ? (
                    <>
                      <div className="inspector-inline-actions">
                        <button
                          type="button"
                          onClick={() => void handleComputeLimitCycleFloquetModes()}
                          disabled={runDisabled}
                          data-testid="limit-cycle-floquet-modes-compute"
                        >
                          Compute Floquet modes
                        </button>
                      </div>
                      {limitCycleFloquetModesError ? (
                        <div className="field-error">{limitCycleFloquetModesError}</div>
                      ) : null}
                      {limitCycleFloquetModes ? (
                        <>
                          {!limitCycleFloquetModesMatchMesh ? (
                            <div className="field-warning">
                              Stored Floquet modes use mesh {limitCycleFloquetModes.ntst}/
                              {limitCycleFloquetModes.ncol}, but this limit cycle uses{' '}
                              {limitCycle?.ntst ?? 0}/{limitCycle?.ncol ?? 0}. Recompute modes.
                            </div>
                          ) : null}
                          <InspectorMetrics
                            rows={[
                              {
                                label: 'Stored samples',
                                value: limitCycleFloquetModePointCount.toLocaleString(),
                              },
                              {
                                label: 'Computed',
                                value: limitCycleFloquetModes.computedAt,
                              },
                            ]}
                          />
                        </>
                      ) : (
                        <p className="empty-state">Floquet mode vectors not computed yet.</p>
                      )}
                      {limitCycleFloquetModesAvailable ? (
                        <>
                          <label>
                            Show Floquet eigenspaces
                            <input
                              type="checkbox"
                              checked={limitCycleFloquetRender.enabled}
                              onChange={(event) =>
                                updateLimitCycleFloquetRender({
                                  enabled: event.target.checked,
                                })
                              }
                              data-testid="limit-cycle-floquet-enabled"
                            />
                          </label>
                          <label>
                            Point stride
                            <input
                              type="number"
                              min={1}
                              step={1}
                              value={limitCycleFloquetRender.stride}
                              onChange={(event) =>
                                updateLimitCycleFloquetRender({
                                  stride: Number(event.target.value),
                                })
                              }
                              data-testid="limit-cycle-floquet-stride"
                            />
                          </label>
                          <label>
                            Eigenline length (fraction of scene)
                            <input
                              type="number"
                              min={0}
                              step={0.01}
                              value={limitCycleFloquetRender.lineLengthScale}
                              onChange={(event) =>
                                updateLimitCycleFloquetRender({
                                  lineLengthScale: Number(event.target.value),
                                })
                              }
                              data-testid="limit-cycle-floquet-line-length"
                            />
                          </label>
                          <label>
                            Eigenline thickness (px)
                            <input
                              type="number"
                              min={0.5}
                              step={0.5}
                              value={limitCycleFloquetRender.lineThickness}
                              onChange={(event) =>
                                updateLimitCycleFloquetRender({
                                  lineThickness: Number(event.target.value),
                                })
                              }
                              data-testid="limit-cycle-floquet-line-thickness"
                            />
                          </label>
                          <label>
                            Eigenspace disc radius (fraction of scene)
                            <input
                              type="number"
                              min={0}
                              step={0.01}
                              value={limitCycleFloquetRender.discRadiusScale}
                              onChange={(event) =>
                                updateLimitCycleFloquetRender({
                                  discRadiusScale: Number(event.target.value),
                                })
                              }
                              data-testid="limit-cycle-floquet-disc-radius"
                            />
                          </label>
                          <label>
                            Eigenspace disc thickness (px)
                            <input
                              type="number"
                              min={0.5}
                              step={0.5}
                              value={limitCycleFloquetRender.discThickness}
                              onChange={(event) =>
                                updateLimitCycleFloquetRender({
                                  discThickness: Number(event.target.value),
                                })
                              }
                              data-testid="limit-cycle-floquet-disc-thickness"
                            />
                          </label>
                          {limitCycleFloquetIndices.length > 0 ? (
                            <div className="inspector-list">
                                {limitCycleFloquetIndices.map((index, idx) => {
                                  const value = limitCycleRenderableMultipliers[index]
                                  const label =
                                    value && !isRealEigenvalue(value)
                                      ? `Floquet eigenspace ${index + 1}`
                                      : `Floquet eigenline ${index + 1}`
                                const visible = limitCycleFloquetVisibleSet.has(index)
                                return (
                                  <div
                                    className="clv-control-row"
                                    key={`limit-cycle-floquet-color-${index}`}
                                  >
                                    <span className="clv-control-row__label">{label}</span>
                                    <input
                                      type="checkbox"
                                      checked={visible}
                                      onChange={(event) =>
                                        handleLimitCycleFloquetVisibilityChange(
                                          index,
                                          event.target.checked
                                        )
                                      }
                                      aria-label={`Show ${label.toLowerCase()}`}
                                      data-testid={`limit-cycle-floquet-show-${index}`}
                                    />
                                    <input
                                      type="color"
                                      value={limitCycleFloquetColors[idx]}
                                      onChange={(event) =>
                                        handleLimitCycleFloquetColorChange(
                                          index,
                                          event.target.value
                                        )
                                      }
                                      disabled={!visible}
                                      aria-label={`${label} color`}
                                      data-testid={`limit-cycle-floquet-color-${index}`}
                                    />
                                  </div>
                                )
                              })}
                            </div>
                          ) : null}
                        </>
                      ) : null}
                    </>
                  ) : (
                    <p className="empty-state">
                      Floquet mode vectors are available for flow systems only.
                    </p>
                  )}
                </div>
              </div>
            </InspectorDisclosure>
          ) : null}

          <LimitCycleManifoldSection scope={scope} />

          <IsoclineInspectorSections scope={scope} />

          <SceneInspectorSections scope={scope} />

          <AnalysisInspectorSections scope={scope} />

          <DiagramInspectorSections scope={scope} />

            <BranchInspectorSections scope={scope} />
          </div>
        ) : (
          <p className="empty-state">Select a node to inspect details.</p>
        )}
      </div>
    )

}
