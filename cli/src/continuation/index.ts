/**
 * Continuation Module
 * 
 * This is the main entry point for continuation analysis functionality.
 * The module provides:
 * - Main continuation menu UI (continuationMenu from ../continuation)
 * - Branch creation (create.ts)
 * - Branch extension (extend.ts)
 * - Branch inspection/browsing (inspect.ts)
 * - LC initiation from Hopf points (initiate-lc.ts)
 * - Equilibrium branch initiation (initiate-eq.ts)
 * - LC metrics calculations (metrics.ts)
 * - Serialization utilities (serialization.ts)
 * - Shared utility functions (utils.ts)
 */

// Re-export main menu from legacy location
export { continuationMenu } from '../continuation';

// Re-export branch creation
export { createBranch } from './create';

// Re-export branch extension
export { extendBranch } from './extend';

// Re-export branch inspection
export {
  inspectBranch,
  hydrateEigenvalues,
  browseBranchSummary,
  browseBranchPoints,
  showPointDetails
} from './inspect';

// Re-export LC initiation functions
export {
  initiateLCFromHopf,
  initiateLCBranchFromPoint
} from './initiate-lc';

// Re-export equilibrium branch initiation
export { initiateEquilibriumBranchFromPoint } from './initiate-eq';

// Re-export metrics utilities
export {
  type LimitCycleMetrics,
  extractLCProfile,
  computeLCMetrics,
  interpretLCStability
} from './metrics';

// Re-export serialization utilities
export {
  serializeBranchDataForWasm,
  normalizeBranchEigenvalues,
  normalizeEigenvalueArray
} from './serialization';

// Re-export shared utilities
export {
  isValidName,
  getBranchParams,
  ensureBranchIndices,
  buildSortedArrayOrder,
  formatNumber,
  formatNumberSafe,
  formatArray,
  summarizeEigenvalues
} from './utils';

