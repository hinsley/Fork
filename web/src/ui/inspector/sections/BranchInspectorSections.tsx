import type { InspectorSelectionController } from '../../InspectorDetailsPanel'
import { BranchDataSections } from './branch/BranchDataSections'
import { BranchManifoldExtensionWorkflow } from './branch/BranchManifoldExtensionWorkflow'
import { BranchExtensionWorkflow } from './branch/BranchExtensionWorkflow'
import { BranchContinueWorkflow } from './branch/BranchContinueWorkflow'
import { Codim1CurveWorkflow } from './branch/Codim1CurveWorkflow'
import { IsoperiodicCurveWorkflow } from './branch/IsoperiodicCurveWorkflow'
import { LimitCycleCodim1CurveWorkflow } from './branch/LimitCycleCodim1CurveWorkflow'
import { LimitCycleFromHopfWorkflow } from './branch/LimitCycleFromHopfWorkflow'
import { LimitCycleFromPDWorkflow } from './branch/LimitCycleFromPDWorkflow'
import { HomoclinicFromLargeCycleWorkflow } from './branch/HomoclinicFromLargeCycleWorkflow'
import { HomoclinicRestartWorkflow } from './branch/HomoclinicRestartWorkflow'
import { HomotopySaddleWorkflow } from './branch/HomotopySaddleWorkflow'
import { HomoclinicFromHomotopySaddleWorkflow } from './branch/HomoclinicFromHomotopySaddleWorkflow'
import { NormalFormWorkflow } from './branch/NormalFormWorkflow'

export function BranchInspectorSections({
  scope,
}: {
  scope: InspectorSelectionController
}) {
  const {
    branch,
  } = scope
  return <>
{branch ? (
              <>
                <BranchDataSections scope={scope} />

                <NormalFormWorkflow scope={scope} />

                <BranchManifoldExtensionWorkflow scope={scope} />

                <BranchExtensionWorkflow scope={scope} />

                <BranchContinueWorkflow scope={scope} />

                <Codim1CurveWorkflow scope={scope} />

                <LimitCycleCodim1CurveWorkflow scope={scope} />

                <IsoperiodicCurveWorkflow scope={scope} />

                <LimitCycleFromHopfWorkflow scope={scope} />

                <LimitCycleFromPDWorkflow scope={scope} />

                <HomoclinicFromLargeCycleWorkflow scope={scope} />

                <HomoclinicRestartWorkflow scope={scope} />

                <HomotopySaddleWorkflow scope={scope} />

                <HomoclinicFromHomotopySaddleWorkflow scope={scope} />
              </>
            ) : null}
  </>
}
