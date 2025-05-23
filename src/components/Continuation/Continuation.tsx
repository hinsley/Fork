import React, { useState } from "react"
import { Box, TextField } from "@mui/material"
import { Equation, Parameter } from "../ODEEditor"

import { StateSpaceSettings } from "../StateSpace"
import StateEntitiesMenu, { StateEntity } from "./StateEntities/StateEntitiesMenu"
import ParameterSetsMenu, { ParameterSet } from "./ParameterSets/ParameterSetsMenu"

// Imports for Limit Cycle Continuation from Hopf
import { generateInitialGuessForLCFromHopf, continueLimitCycleMS } from "../../math/continuation/limitcycle/continue_limit_cycle_multiple_shooting"
import { LimitCycle } from "../../math/continuation/limitcycle/limitcycle_types"
import { BifurcationPoint } from "../../math/continuation/equilibrium/continue_equilibrium"
import { Complex, Matrix } from "mathjs" // Assuming mathjs.Complex and mathjs.Matrix


interface ContinuationProps {
  equations: Equation[]
  parameters: Parameter[]
  stateSpaceSettings: StateSpaceSettings
  stateEntities: StateEntity[]
  setStateEntities: (stateEntities: StateEntity[]) => void
  parameterSets: ParameterSet[]
  setParameterSets: (parameterSets: ParameterSet[]) => void
}

/**
 * Helper function to start limit cycle continuation from a Hopf bifurcation point.
 */
const handleStartLimitCycleContinuationFromHopf = (
  hopfBifurcationPoint: BifurcationPoint,
  equations: Equation[],
  fixedParameters: Parameter[], // Parameters not being continued
  continuationParameter: Parameter, // The parameter that was varied for equilibrium continuation
  numShootingNodes: number,
  initialAmplitude_epsilon_lc: number,
  lcParameterStep: number,
  lcNumSteps: number,
  newtonMaxIterations: number,
  newtonTolerance: number,
  fd_epsilon: number
): LimitCycle[] | null => {
  // a. Validate Input
  if (hopfBifurcationPoint.type !== "Andronov-Hopf") {
    console.error("Bifurcation point is not of type 'Andronov-Hopf'.");
    return null;
  }
  if (!hopfBifurcationPoint.eigenvalues || !hopfBifurcationPoint.eigenvectors) {
    console.error("Eigenvalue or eigenvector data missing from Hopf bifurcation point.");
    return null;
  }

  // b. Find Critical Eigenvalue and Eigenvector
  let omega_0: number | null = null;
  let criticalEigenvalue: Complex | null = null;

  const eigenValTol = 1e-5; // Tolerance for real part being zero and for matching
  for (const lambda of hopfBifurcationPoint.eigenvalues) {
    if (Math.abs(lambda.re) < eigenValTol && lambda.im > eigenValTol) { // Ensure omega_0 is positive
      omega_0 = lambda.im;
      criticalEigenvalue = lambda;
      break;
    }
  }

  if (omega_0 === null || criticalEigenvalue === null) {
    console.error("Could not find a suitable critical eigenvalue (re~0, im>0) for Hopf point.");
    return null;
  }

  let critEigenvectorEntry: { value: Complex, vector: Matrix } | null = null;
  for (const evEntry of hopfBifurcationPoint.eigenvectors) {
    // Compare complex numbers with tolerance
    if (Math.abs(evEntry.value.re - criticalEigenvalue.re) < eigenValTol &&
        Math.abs(evEntry.value.im - criticalEigenvalue.im) < eigenValTol) {
      critEigenvectorEntry = evEntry;
      break;
    }
  }
  
  if (critEigenvectorEntry === null) {
    console.error("Could not find the critical eigenvector corresponding to the critical eigenvalue.");
    return null;
  }

  // c. Extract v_re and v_im
  const dimension = hopfBifurcationPoint.point.length - 1;
  const v_re: number[] = [];
  const v_im: number[] = [];

  if (critEigenvectorEntry.vector.size().length < 1 || critEigenvectorEntry.vector.size()[0] !== dimension) {
      console.error(`Critical eigenvector dimension mismatch. Expected ${dimension}, got ${critEigenvectorEntry.vector.size()}`);
      return null;
  }

  for (let k = 0; k < dimension; ++k) {
    // Assuming eigenvector is a column vector, hence .get([k,0])
    const complexVal = critEigenvectorEntry.vector.get([k, 0]) as Complex;
    if (!complexVal || typeof complexVal.re === 'undefined' || typeof complexVal.im === 'undefined') {
        console.error(`Invalid complex value in eigenvector at index ${k}`);
        return null;
    }
    v_re.push(complexVal.re);
    v_im.push(complexVal.im);
  }

  // d. Get Hopf Equilibrium State
  const hopfEquilibrium = hopfBifurcationPoint.point.slice(1);

  // e. Call generateInitialGuessForLCFromHopf
  const initialY_LC = generateInitialGuessForLCFromHopf(
    hopfEquilibrium,
    v_re,
    v_im,
    omega_0,
    numShootingNodes,
    hopfEquilibrium.length, // dimension
    initialAmplitude_epsilon_lc
  );

  // f. Call continueLimitCycleMS
  // Set the continuation parameter for LC continuation to start from the Hopf point's parameter value
  const lcContinuationParam: Parameter = { ...continuationParameter, value: hopfBifurcationPoint.point[0] };

  const limitCycleBranch = continueLimitCycleMS(
    equations,
    fixedParameters,
    lcContinuationParam,
    initialY_LC,
    numShootingNodes,
    hopfEquilibrium.length, // dimension
    0, // fixedPhaseComponentIndex (default to 0 for now)
    lcParameterStep,
    lcNumSteps,
    newtonMaxIterations,
    newtonTolerance,
    fd_epsilon
  );

  // g. Return limitCycleBranch
  if (limitCycleBranch === null || limitCycleBranch.length === 0) {
      console.log("Limit cycle continuation did not yield any points.");
      return null;
  }
  
  console.log("Limit cycle continuation successful:", limitCycleBranch);
  return limitCycleBranch;
};

export default function Continuation({
  equations,
  parameters,
  stateSpaceSettings,
  stateEntities,
  setStateEntities,
  parameterSets,
  setParameterSets
}: ContinuationProps) {
  const defaultObjectType = "state-entities"
  
  const [objectType, setObjectType] = useState(defaultObjectType)

  return (
    <Box sx={{ height: "100%", width: "100%", overflow: "auto", display: "flex", flexDirection: "column", alignItems: "center" }}>
      <Box sx={{ mt: 8, mb: 8, width: "1024px", maxWidth: "100%" }}>
        <h3>Continuation</h3>
        <Box sx={{ mb: 2 }}>
          <TextField
            select
            label="Object type"
            value={objectType}
            SelectProps={{ native: true }}
            onChange={(e) => setObjectType(e.target.value)}
          >
            <option value="state-entities">State entities</option>
            <option value="parameter-sets">Parameter sets</option>
          </TextField>
        </Box>
        {(() => {
          switch (objectType) {
            case "state-entities":
              return <StateEntitiesMenu
                equations={equations}
                parameters={parameters}
                stateSpaceSettings={stateSpaceSettings}
                stateEntities={stateEntities}
                setStateEntities={setStateEntities}
                parameterSets={parameterSets}
                setParameterSets={setParameterSets}
              />
            case "parameter-sets":
              return <ParameterSetsMenu
                equations={equations}
                parameters={parameters}
                parameterSets={parameterSets}
                setParameterSets={setParameterSets}
                stateEntities={stateEntities}
              />
            default:
              return <Box sx={{ mb: 2 }}><h4>Not implemented</h4></Box>
          }
        })()}
      </Box>
    </Box>
  )
}