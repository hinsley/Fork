import { describe, it, expect } from 'vitest'
import {
  DEFAULT_NAME_MAX_LENGTH,
  isCliSafeName,
  suggestDefaultName,
  toCliSafeName,
} from './naming'

describe('naming utils', () => {
  it('validates CLI-safe names', () => {
    expect(isCliSafeName('Alpha_123')).toBe(true)
    expect(isCliSafeName('')).toBe(false)
    expect(isCliSafeName('bad-name')).toBe(false)
    expect(isCliSafeName('has space')).toBe(false)
  })

  it('normalizes names into CLI-safe slugs', () => {
    expect(toCliSafeName(' Hello   world! ')).toBe('Hello_world_')
    expect(toCliSafeName('a/b\\c')).toBe('a_b_c')
    expect(toCliSafeName('Already_OK')).toBe('Already_OK')
  })

  it('handles whitespace-only input', () => {
    expect(toCliSafeName('   ')).toBe('')
    expect(isCliSafeName(toCliSafeName('   '))).toBe(false)
  })

  it('chooses sensible indexed names for root entities', () => {
    expect(suggestDefaultName('orbit')).toBe('Orbit_1')
    expect(
      suggestDefaultName('equilibrium', {
        entityLabel: 'Fixed Point',
        existingNames: ['Fixed_Point_1', 'Fixed_Point_2'],
      })
    ).toBe('Fixed_Point_3')
    expect(suggestDefaultName('folder', { existingNames: ['Folder_1'] })).toBe('Folder_2')
    expect(suggestDefaultName('scene')).toBe('Scene_1')
    expect(suggestDefaultName('bifurcationDiagram')).toBe('Bifurcation_Diagram_1')
    expect(suggestDefaultName('analysisViewport')).toBe('Event_Map_1')
  })

  it('builds semantic names for objects and branches from source context', () => {
    expect(
      suggestDefaultName('equilibriumContinuation', {
        sourceName: 'Equilibrium_1',
        parameterName: 'mu',
      })
    ).toBe('Equilibrium_1_mu')
    expect(
      suggestDefaultName('manifold2d', { sourceName: 'Equilibrium_1' })
    ).toBe('manifold_Equilibrium_1_2d')
    expect(
      suggestDefaultName('limitCycle', { sourceName: 'hopf_curve_Equilibrium_1_mu' })
    ).toBe('LC_Equilibrium_1_mu')
    expect(
      suggestDefaultName('continuationBranch', {
        sourceName: 'LC_Equilibrium_1_mu',
        parameterName: 'beta',
      })
    ).toBe('LC_Equilibrium_1_mu_beta')
    expect(
      suggestDefaultName('branchContinuation', {
        sourceName: 'isoperiodic_LC_Equilibrium_1_mu',
        parameterName: 'beta',
      })
    ).toBe('isoperiodic_LC_Equilibrium_1_mu_beta')
    expect(suggestDefaultName('lpcCurve', { sourceName: 'lc_branch_mu' })).toBe(
      'lpc_lc_branch_mu'
    )
    expect(suggestDefaultName('pdCurve', { sourceName: 'lc_branch_mu' })).toBe(
      'pd_lc_branch_mu'
    )
  })

  it('removes inherited operation noise from derived branch names', () => {
    expect(
      suggestDefaultName('homoclinicRestart', {
        sourceName: 'homoc_LC_Equilibrium_1_mu',
      })
    ).toBe('homoc_LC_Equilibrium_1_mu_restart')
    expect(
      suggestDefaultName('homoclinicStageD', {
        sourceName: 'homotopy_saddle_fold_curve_Equilibrium_1_mu',
      })
    ).toBe('homoc_Equilibrium_1_mu_stageD')
  })

  it('keeps generated names bounded, CLI-safe, and deterministically unique', () => {
    const first = suggestDefaultName('isoperiodicCurve', {
      sourceName:
        'hopf_curve_an_extremely_long_but_still_descriptive_equilibrium_name_with_context_mu',
    })
    const second = suggestDefaultName('isoperiodicCurve', {
      sourceName:
        'hopf_curve_an_extremely_long_but_still_descriptive_equilibrium_name_with_context_mu',
      existingNames: [first],
    })

    expect(first.length).toBeLessThanOrEqual(DEFAULT_NAME_MAX_LENGTH)
    expect(first).toMatch(/^isoperiodic_/)
    expect(first).toMatch(/context_mu$/)
    expect(isCliSafeName(first)).toBe(true)
    expect(second).not.toBe(first)
    expect(second).toMatch(/^isoperiodic_.*_2$/)
    expect(isCliSafeName(second)).toBe(true)
    expect(second.length).toBeLessThanOrEqual(DEFAULT_NAME_MAX_LENGTH)
  })

  it('retains period-doubling source-point context', () => {
    expect(
      suggestDefaultName('periodDoubledCycle', {
        entityLabel: 'Cycle',
        sourceName: 'Cycle_1_mu',
        pointIndex: 12,
      })
    ).toBe('Cycle_PD_Cycle_1_mu_pt12')
    expect(
      suggestDefaultName('periodDoubledCycle', {
        sourceName: 'lc pd',
        pointIndex: 1,
      })
    ).toBe('LC_PD_pt1')
  })
})
