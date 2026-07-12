import { InspectorDetailsPanel } from './InspectorDetailsPanel'
import type { System } from '../system/types'
import type { InspectorActions, InspectorPointSelections } from './inspector/types'

type InspectorPanelProps = {
  system: System
  selectedNodeId: string | null
  theme: 'light' | 'dark'
  actions: InspectorActions
  pointSelections: InspectorPointSelections
}

export function InspectorPanel({
  system,
  selectedNodeId,
  theme,
  actions,
  pointSelections,
}: InspectorPanelProps) {
  return (
    <div className="inspector">
      <div className="inspector__content">
        <InspectorDetailsPanel
          system={system}
          selectedNodeId={selectedNodeId}
          theme={theme}
          view="selection"
          branchPointSelection={pointSelections.branch.value}
          orbitPointSelection={pointSelections.orbit.value}
          limitCyclePointSelection={pointSelections.limitCycle.value}
          onBranchPointSelect={pointSelections.branch.onSelect}
          onOrbitPointSelect={pointSelections.orbit.onSelect}
          onLimitCyclePointSelect={pointSelections.limitCycle.onSelect}
          onRename={actions.renameNode}
          onToggleVisibility={actions.toggleVisibility}
          onUpdateRender={actions.updateRender}
          onUpdateObjectParams={actions.updateObjectParams}
          onUpdateObjectFrozenVariables={actions.updateObjectFrozenVariables}
          onUpdateIsoclineObject={actions.updateIsoclineObject}
          onComputeIsocline={actions.computeIsocline}
          onUpdateScene={actions.updateScene}
          onUpdateAnalysisViewport={actions.updateAnalysisViewport}
          onValidateAnalysisExpression={actions.validateAnalysisExpression}
          onUpdateBifurcationDiagram={actions.updateBifurcationDiagram}
          onSetLimitCycleRenderTarget={actions.setLimitCycleRenderTarget}
          onUpdateSystem={actions.updateSystem}
          onValidateSystem={actions.validateSystem}
          onRunOrbit={actions.runOrbit}
          onComputeLyapunovExponents={actions.computeLyapunovExponents}
          onComputeCovariantLyapunovVectors={actions.computeCovariantLyapunovVectors}
          onSolveEquilibrium={actions.solveEquilibrium}
          onCreateEquilibriumBranch={actions.createEquilibriumBranch}
          onCreateEquilibriumManifold1D={actions.createEquilibriumManifold1D}
          onExtendEquilibriumManifold1D={actions.extendEquilibriumManifold1D}
          onExtendManifold2D={actions.extendManifold2D}
          onCreateEquilibriumManifold2D={actions.createEquilibriumManifold2D}
          onCreateBranchFromPoint={actions.createBranchFromPoint}
          onExtendBranch={actions.extendBranch}
          onCreateFoldCurveFromPoint={actions.createFoldCurveFromPoint}
          onCreateHopfCurveFromPoint={actions.createHopfCurveFromPoint}
          onCreateIsochroneCurveFromPoint={actions.createIsochroneCurveFromPoint}
          onCreateNSCurveFromPoint={actions.createNSCurveFromPoint}
          onCreateLimitCycleFromHopf={actions.createLimitCycleFromHopf}
          onCreateLimitCycleFromOrbit={actions.createLimitCycleFromOrbit}
          onCreateLimitCycleManifold2D={actions.createLimitCycleManifold2D}
          onComputeLimitCycleFloquetModes={actions.computeLimitCycleFloquetModes}
          onCreateCycleFromPD={actions.createCycleFromPD}
          onCreateLimitCycleFromPD={actions.createLimitCycleFromPD}
          onCreateHomoclinicFromLargeCycle={actions.createHomoclinicFromLargeCycle}
          onCreateHomoclinicFromHomoclinic={actions.createHomoclinicFromHomoclinic}
          onCreateHomotopySaddleFromEquilibrium={actions.createHomotopySaddleFromEquilibrium}
          onCreateHomoclinicFromHomotopySaddle={actions.createHomoclinicFromHomotopySaddle}
        />
      </div>
    </div>
  )
}
