import type { InspectorSelectionController } from '../../InspectorDetailsPanel'
import { OpacityPercentInput } from '../../OpacityPercentInput'
import { fmt, fmtComplex, fmtCount, fmtRelativeTime } from '../../../utils/format'
import { CopyButton, DataDetails, DataPager, InlineSection, KeyValues } from '../InspectorChrome'

export function LimitCycleInspectorSections({
  scope,
}: {
  scope: InspectorSelectionController
}) {
  const {
    InspectorDisclosure,
    PlotlyViewport,
    formatPointValues,
    handleComputeLimitCycleFloquetModes,
    handleLimitCycleFloquetColorChange,
    handleLimitCycleFloquetOpacityChange,
    handleLimitCycleFloquetVisibilityChange,
    handleLimitCyclePreviewJump,
    isRealEigenvalue,
    limitCycle,
    limitCycleDisplayParams,
    limitCycleFloquetBackend,
    limitCycleFloquetColors,
    limitCycleFloquetIndices,
    limitCycleFloquetModePointCount,
    limitCycleFloquetModes,
    limitCycleFloquetModesAvailable,
    limitCycleFloquetModesError,
    limitCycleFloquetModesMatchMesh,
    limitCycleFloquetOpacities,
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
    onLimitCyclePointSelect,
    runDisabled,
    selectedLimitCyclePoint,
    selectedLimitCyclePointIndex,
    selectedNodeId,
    selectionKey,
    setLimitCycleFloquetBackend,
    setLimitCyclePreviewError,
    setLimitCyclePreviewInput,
    setLimitCyclePreviewPageIndex,
    systemDraft,
    updateLimitCycleFloquetRender,
    writeClipboardText,
  } = scope
  if (!limitCycle) return null
  const isFlow = systemDraft.type === 'flow'

  return (
    <>
      {limitCycleDisplayParams.length > 0 ? (
        <InlineSection
          title="Parameters"
          testId="limit-cycle-data-parameters"
          actions={
            <CopyButton
              label="Copy parameters"
              onCopy={() => void writeClipboardText(formatPointValues(limitCycleDisplayParams))}
            />
          }
        >
          <KeyValues
            columns={2}
            rows={limitCycleDisplayParams.map((value, index) => ({
              label: systemDraft.paramNames[index] || `p${index + 1}`,
              value: fmt(value),
            }))}
          />
        </InlineSection>
      ) : null}

      {limitCycleProfilePoints.length > 0 ? (
        <DataDetails
          title={`Profile · ${fmtCount(limitCycleProfilePoints.length)} points`}
          testId="limit-cycle-data-preview-toggle"
        >
          <DataPager
            page={limitCyclePreviewPage}
            pageCount={limitCyclePreviewPageCount}
            onPage={setLimitCyclePreviewPageIndex}
            jumpValue={limitCyclePreviewInput}
            onJumpChange={(value) => {
              setLimitCyclePreviewInput(value)
              setLimitCyclePreviewError(null)
            }}
            onJump={handleLimitCyclePreviewJump}
            error={limitCyclePreviewError}
            summary={`${limitCyclePreviewStart + 1}–${limitCyclePreviewEnd} of ${fmtCount(
              limitCycleProfilePoints.length
            )}`}
            testIdPrefix="limit-cycle-preview"
          />
          {selectedLimitCyclePoint ? (
            <div className="inspector-selected-point">
              <span className="chip">{`Selected point #${selectedLimitCyclePointIndex}`}</span>
              <CopyButton
                label="Copy state"
                onCopy={() => void writeClipboardText(formatPointValues(selectedLimitCyclePoint))}
              />
              {onLimitCyclePointSelect ? (
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => onLimitCyclePointSelect(null)}
                >
                  Clear
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="inspector-table-scroll" role="region" aria-label="Limit cycle data preview">
            <table className="data-table">
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
                      className={`is-clickable${isSelected ? ' is-selected' : ''}`}
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
                          {fmt(point[varIndex] ?? Number.NaN)}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </DataDetails>
      ) : null}

      {limitCycleModeMultipliers.length > 0 || limitCycleFloquetModes ? (
        <DataDetails title="Floquet" testId="limit-cycle-data-floquet-toggle">
          {limitCycleModeMultipliers.length > 0 ? (
            <div className="inspector-split">
              {limitCycleMultiplierPlot ? (
                <div className="inspector-plot inspector-plot--compact">
                  <PlotlyViewport
                    plotId="limit-cycle-multiplier-plot"
                    data={limitCycleMultiplierPlot.data}
                    layout={limitCycleMultiplierPlot.layout}
                    testId="limit-cycle-multiplier-plot"
                  />
                </div>
              ) : null}
              <table className="data-table" data-testid="limit-cycle-multiplier-table">
                <thead>
                  <tr>
                    <th>μ</th>
                    <th>value</th>
                    <th>|μ|</th>
                  </tr>
                </thead>
                <tbody>
                  {limitCycleModeMultipliers.map((value, index) => (
                    <tr key={`limit-cycle-multiplier-${index}`}>
                      <td>{index + 1}</td>
                      <td>{fmtComplex(value)}</td>
                      <td>{fmt(Math.hypot(value.re, value.im))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {isFlow && limitCycleFloquetModes ? (
            <>
              {!limitCycleFloquetModesMatchMesh ? (
                <div className="field-warning">
                  Modes use mesh {limitCycleFloquetModes.ntst}×{limitCycleFloquetModes.ncol}; cycle
                  uses {limitCycle.ntst}×{limitCycle.ncol}. Recompute.
                </div>
              ) : null}
              <KeyValues
                columns={2}
                rows={[
                  { label: 'Samples', value: fmtCount(limitCycleFloquetModePointCount) },
                  {
                    label: 'Backend',
                    value:
                      limitCycleFloquetModes.backend === 'periodic_schur'
                        ? 'Periodic Schur'
                        : limitCycleFloquetModes.backend === 'block_cyclic'
                          ? 'Block-cyclic'
                          : 'Legacy',
                  },
                  {
                    label: 'Computed',
                    value: (
                      <span title={limitCycleFloquetModes.computedAt}>
                        {fmtRelativeTime(limitCycleFloquetModes.computedAt)}
                      </span>
                    ),
                  },
                ]}
              />
            </>
          ) : null}
          {isFlow && limitCycleFloquetModesAvailable ? (
            <div className="inspector-section inspector-render-controls">
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
              <div className="inspector-form-grid">
                <label title="Plot every Nth mesh point">
                  Stride
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
                <label title="Eigenline length as a fraction of the scene">
                  Line length
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
                <label title="Eigenline thickness in pixels">
                  Line px
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
                <label title="Eigenspace disc radius as a fraction of the scene">
                  Disc radius
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
                <label title="Eigenspace disc thickness in pixels">
                  Disc px
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
              </div>
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
                      <div className="clv-control-row" key={`limit-cycle-floquet-color-${index}`}>
                        <span className="clv-control-row__label">{label}</span>
                        <input
                          type="checkbox"
                          checked={visible}
                          onChange={(event) =>
                            handleLimitCycleFloquetVisibilityChange(index, event.target.checked)
                          }
                          aria-label={`Show ${label.toLowerCase()}`}
                          data-testid={`limit-cycle-floquet-show-${index}`}
                        />
                        <input
                          type="color"
                          value={limitCycleFloquetColors[idx]}
                          onChange={(event) =>
                            handleLimitCycleFloquetColorChange(index, event.target.value)
                          }
                          disabled={!visible}
                          aria-label={`${label} color`}
                          data-testid={`limit-cycle-floquet-color-${index}`}
                        />
                        <OpacityPercentInput
                          value={limitCycleFloquetOpacities[idx]}
                          onChange={(opacity) =>
                            handleLimitCycleFloquetOpacityChange(index, opacity)
                          }
                          disabled={!visible}
                          ariaLabel={`${label} opacity percentage`}
                          testId={`limit-cycle-floquet-opacity-${index}`}
                        />
                      </div>
                    )
                  })}
                </div>
              ) : null}
            </div>
          ) : null}
        </DataDetails>
      ) : null}

      {isFlow ? (
        <InspectorDisclosure
          key={`${selectionKey}-limit-cycle-floquet`}
          title="Compute Floquet modes"
          testId="limit-cycle-floquet-toggle"
          actionOnly
        >
          <div className="inspector-section">
            <label>
              Backend
              <select
                value={limitCycleFloquetBackend}
                onChange={(event) =>
                  setLimitCycleFloquetBackend(
                    event.target.value as typeof limitCycleFloquetBackend
                  )
                }
                disabled={runDisabled}
                data-testid="limit-cycle-floquet-backend"
              >
                <option value="auto">Automatic</option>
                <option value="periodic_schur">Periodic Schur</option>
                <option value="block_cyclic">Block-cyclic reference</option>
              </select>
            </label>
            {limitCycleFloquetModesError ? (
              <div className="field-error">{limitCycleFloquetModesError}</div>
            ) : null}
            <button
              className="inspector-primary-action"
              type="button"
              onClick={() => void handleComputeLimitCycleFloquetModes()}
              disabled={runDisabled}
              data-testid="limit-cycle-floquet-modes-compute"
            >
              Compute Floquet modes
            </button>
          </div>
        </InspectorDisclosure>
      ) : null}
    </>
  )
}
