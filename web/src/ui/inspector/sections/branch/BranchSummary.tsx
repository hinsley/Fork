import { useMemo } from 'react'
import type { InspectorSelectionController } from '../../../InspectorDetailsPanel'
import { bifurcationCode, bifurcationTone } from '../../../../system/stability'
import { fmt } from '../../../../utils/format'
import {
  branchParamNames,
  branchStabilityModel,
  buildBifurcationRows,
  buildStabilityRuns,
  formatRunLabel,
  type BifurcationRow,
  type StabilityRun,
} from './branchInsights'

function runTone(unstable: number | null): string {
  if (unstable === null) return 'unknown'
  if (unstable === 0) return 'stable'
  return unstable === 1 ? 'unstable' : 'unstable-2'
}

function StabilityScrubber({
  runs,
  rows,
  count,
  position,
  showRuns,
  runLabel,
  onScrub,
}: {
  runs: StabilityRun[]
  rows: BifurcationRow[]
  count: number
  position: number
  showRuns: boolean
  runLabel: (unstable: number | null) => string
  onScrub: (position: number) => void
}) {
  const span = Math.max(1, count - 1)
  const toPercent = (value: number) => `${(Math.min(Math.max(value, 0), span) / span) * 100}%`
  const legend = showRuns
    ? Array.from(new Set(runs.map((run) => run.unstable))).map((unstable) => ({
        unstable,
        label: runLabel(unstable),
      }))
    : []
  return (
    <div className="branch-stability" data-testid="branch-stability-bar">
      <div className="branch-stability__track">
        <div className="branch-stability__lane">
        {showRuns
          ? runs.map((run) => (
              <span
                key={`${run.start}-${run.end}`}
                className={`branch-stability__run branch-stability__run--${runTone(run.unstable)}`}
                style={{
                  left: toPercent(run.start - 0.5),
                  width: `calc(${toPercent(run.end + 0.5)} - ${toPercent(run.start - 0.5)})`,
                }}
                title={runLabel(run.unstable)}
              />
            ))
          : null}
        {rows.map((row) =>
          row.sortedPosition >= 0 ? (
            <span
              key={`tick-${row.arrayIndex}`}
              className={`branch-stability__tick branch-stability__tick--${row.tone}`}
              style={{ left: toPercent(row.sortedPosition) }}
            />
          ) : null
        )}
        {position >= 0 ? (
          <span className="branch-stability__thumb" style={{ left: toPercent(position) }} />
        ) : null}
        </div>
        <input
          type="range"
          className="branch-stability__range"
          min={0}
          max={Math.max(0, count - 1)}
          step={1}
          value={Math.max(0, position)}
          onChange={(event) => onScrub(Number(event.target.value))}
          aria-label="Branch point"
          data-testid="branch-point-scrubber"
        />
      </div>
      {legend.length > 0 ? (
        <div className="branch-stability__legend">
          {legend.map((entry) => (
            <span key={String(entry.unstable)} className="branch-stability__legend-item">
              <span
                className={`branch-stability__swatch branch-stability__run--${runTone(entry.unstable)}`}
              />
              {entry.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function BifurcationTable({
  rows,
  selectedArrayIndex,
  param1Name,
  param2Name,
  onSelect,
}: {
  rows: BifurcationRow[]
  selectedArrayIndex: number | null
  param1Name: string
  param2Name: string | null
  onSelect: (arrayIndex: number) => void
}) {
  const hasParam2 = rows.some((row) => row.param2 !== null)
  const hasExtra = rows.some((row) => row.extra || row.candidate)
  return (
    <div className="branch-bif-table">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only">Type</span>
            </th>
            <th scope="col">#</th>
            <th scope="col" className="truncate">{param1Name}</th>
            {hasParam2 ? <th scope="col">{param2Name}</th> : null}
            {hasExtra ? (
              <th scope="col">
                <span className="sr-only">Detail</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const selected = row.arrayIndex === selectedArrayIndex
            return (
              <tr
                key={`bif-${row.arrayIndex}`}
                role="button"
                tabIndex={0}
                aria-pressed={selected}
                className={`${selected ? 'is-selected' : ''}${row.candidate ? ' is-candidate' : ''}`}
                title={`${row.label}${row.candidate ? ' (candidate)' : ''}`}
                onClick={() => onSelect(row.arrayIndex)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onSelect(row.arrayIndex)
                  }
                }}
                data-testid={`branch-bifurcation-${row.arrayIndex}`}
              >
                <td>
                  <span className={`bif bif--${row.tone}`}>{row.code}</span>
                  <span className="sr-only"> {row.fullLabel}</span>
                </td>
                <td>{fmt(row.logicalIndex)}</td>
                <td>{fmt(row.param1)}</td>
                {hasParam2 ? <td>{row.param2 === null ? '—' : fmt(row.param2)}</td> : null}
                {hasExtra ? (
                  <td className="branch-bif-table__extra">
                    {row.candidate ? 'candidate' : row.extra ?? ''}
                  </td>
                ) : null}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Always-visible branch overview: stability runs, bifurcations, abnormal stop, seed. */
export function BranchSummary({ scope }: { scope: InspectorSelectionController }) {
  const {
    branch,
    branchIndices,
    branchPointIndex,
    branchSortedIndex,
    branchSortedOrder,
    branchStateDimension,
    setBranchPoint,
    system,
    systemDraft,
  } = scope
  const systemType = systemDraft.type === 'map' ? 'map' : 'flow'
  const model = branchStabilityModel(branch?.branchType)
  const runs = useMemo(
    () =>
      branch
        ? buildStabilityRuns(branch.data.points, branchSortedOrder, model, systemType)
        : [],
    [branch, branchSortedOrder, model, systemType]
  )
  const rows = useMemo(
    () =>
      branch
        ? buildBifurcationRows({
            branch,
            branchIndices,
            sortedOrder: branchSortedOrder,
            systemType,
            stateDimension: branchStateDimension,
          })
        : [],
    [branch, branchIndices, branchSortedOrder, branchStateDimension, systemType]
  )
  if (!branch || branch.data.points.length === 0) return null
  const names = branchParamNames(branch)
  const showRuns = model !== null && runs.some((run) => run.unstable !== null)
  const seed = branch.data.codim2_seed
  const seedCode = seed ? bifurcationCode(seed.source_type, systemType) : ''
  const seedBranchName = seed
    ? system.branches[seed.source_branch_id]?.name ??
      system.index.branches[seed.source_branch_id]?.name ??
      null
    : null
  const termination = branch.data.termination

  return (
    <section className="branch-summary" data-testid="branch-summary">
      {branchSortedOrder.length > 1 ? (
        <StabilityScrubber
          runs={runs}
          rows={rows}
          count={branchSortedOrder.length}
          position={branchSortedIndex}
          showRuns={showRuns}
          runLabel={(unstable) => formatRunLabel(unstable, model)}
          onScrub={(position) => {
            const arrayIndex = branchSortedOrder[position]
            if (arrayIndex !== undefined && arrayIndex !== branchPointIndex) {
              setBranchPoint(arrayIndex)
            }
          }}
        />
      ) : null}
      {rows.length > 0 ? (
        <BifurcationTable
          rows={rows}
          selectedArrayIndex={branchPointIndex}
          param1Name={names.param1}
          param2Name={names.param2}
          onSelect={(arrayIndex) => setBranchPoint(arrayIndex)}
        />
      ) : null}
      {termination ? (
        <p
          className="branch-summary__line branch-summary__line--warning"
          title={termination.suggestion ?? undefined}
          data-testid="branch-termination"
        >
          <span className="chip chip--warning">stopped</span>
          <span className="branch-summary__text">{termination.message}</span>
        </p>
      ) : null}
      {seed ? (
        <p className="branch-summary__line" data-testid="branch-codim2-seed">
          <span className="muted">from</span>
          <span className={`bif bif--${bifurcationTone(seedCode)}`}>{seedCode}</span>
          <span className="num">#{seed.source_point_index}</span>
          {seedBranchName ? (
            <>
              <span className="muted">on</span>
              <span className="truncate">{seedBranchName}</span>
            </>
          ) : null}
        </p>
      ) : null}
    </section>
  )
}
