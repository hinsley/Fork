import { Equation, Parameter } from '../../../components/ODEEditor'; // Adjust path as needed
import { solveODE, ODESystem } from '../../odesolvers/rk4'; // Adjust path and solver as needed
import { lusolve, matrix, multiply, norm, subtract, Matrix } from 'mathjs';
import { LimitCycle } from './limitcycle_types'; // Import the LimitCycle type

/**
 * Builds the system of equations F(Y) = 0 for multiple shooting.
 * Y = [x_0_0, ..., x_0_{d-1},  // First shooting node
 *      x_1_0, ..., x_1_{d-1},  // Second shooting node
 *      ...,
 *      x_{M-1}_0, ..., x_{M-1}_{d-1}, // Last shooting node
 *      T]                       // Period of the limit cycle
 * where d is dimension, M is numShootingNodes.
 * Total length of Y is M*d + 1.
 *
 * The system F(Y) has M*d + 1 equations:
 * 1. M*d equations for continuity:
 *    For i = 0 to M-2:  phi(x_i, T/M) - x_{i+1} = 0
 *    For i = M-1:       phi(x_{M-1}, T/M) - x_0 = 0 (cyclicity)
 *    where phi is the ODE solution map.
 * 2. One phase condition: f_s(x_0, current_continuation_param_value) = 0
 *    where f_s is the s-th component of the ODE system, and s is fixedPhaseComponentIndex.
 */
export function buildMultipleShootingSystem(
  equations: Equation[], // System of ODEs
  fixedParameters: Parameter[], // Parameters that are fixed during this specific solve
  continuationParameter: Parameter, // The parameter that is being varied in continuation
  numShootingNodes: number, // M
  dimension: number, // d
  fixedPhaseComponentIndex: number // s, index for the phase condition (e.g., 0 for dx_0/dt = 0 at x_0)
): (Y: number[]) => number[] {

  // 1. Prepare the ODE system function for the solver
  // This function will take (t, y, parameterValueForContinuation)
  const odeSystem: ODESystem = (t: number, y: number[], currentContinuationParamValue: number): number[] => {
    const scope: { [key: string]: number } = {};
    equations.forEach((eq, i) => {
      scope[eq.variable] = y[i];
    });
    fixedParameters.forEach(p => {
      scope[p.name] = p.value;
    });
    scope[continuationParameter.name] = currentContinuationParamValue;

    return equations.map(eq => eq.compiled!.evaluate(scope));
  };

  // 2. Return the function F(Y)
  return (Y: number[]): number[] => {
    const M = numShootingNodes;
    const d = dimension;

    if (Y.length !== M * d + 1) {
      throw new Error(`Input vector Y has incorrect length. Expected ${M * d + 1}, got ${Y.length}`);
    }

    const T = Y[M * d]; // Last element is the period T
    // currentContinuationParamValue will be taken from the continuationParameter object,
    // which is updated by the outer continuation algorithm.
    const currentContinuationParamValue = continuationParameter.value; 

    if (T <= 0) {
      // Period must be positive, return large residuals if not.
      // This helps guide the solver away from non-physical solutions.
      return Array(M * d + 1).fill(1e8);
    }

    const dt_interval = T / M; // Time step for each shooting interval (duration of integration)
    const residuals: number[] = [];

    // Extract shooting nodes from Y
    const shootingNodes: number[][] = [];
    for (let i = 0; i < M; ++i) {
      shootingNodes.push(Y.slice(i * d, (i + 1) * d));
    }

    // 2a. Continuity conditions
    for (let i = 0; i < M; ++i) {
      const x_i = shootingNodes[i];
      const x_i_plus_1_target = shootingNodes[(i + 1) % M]; // Handles cyclicity for i = M-1

      // Integrate ODE from x_i for duration dt_interval
      // solveODE expects: odesystem, y0, tstart, tend, dtMax, params_for_odesystem
      // dtMax is the internal step for the solver, not the duration of the interval.
      const integrationResult = solveODE(
        odeSystem,
        x_i,
        0, // tStart for this interval
        dt_interval,  // tEnd for this interval (duration)
        dt_interval / 10, // Internal step for RK4, heuristic. Could be made a parameter.
        currentContinuationParamValue
      );
      const x_i_at_dt_interval = integrationResult.y[integrationResult.y.length - 1];

      for (let j = 0; j < d; ++j) {
        residuals.push(x_i_at_dt_interval[j] - x_i_plus_1_target[j]);
      }
    }

    // 2b. Phase condition: f_s(x_0, currentContinuationParamValue) = 0
    // f_s is the s-th component of the ODE.
    const x_0 = shootingNodes[0];
    const f_s_at_x_0 = odeSystem(0, x_0, currentContinuationParamValue)[fixedPhaseComponentIndex];
    residuals.push(f_s_at_x_0);

    if (residuals.length !== M * d + 1) {
      // Should not happen if logic is correct
      throw new Error(`Residual vector F(Y) has incorrect length. Expected ${M * d + 1}, got ${residuals.length}`);
    }
    return residuals;
  };
}

// Notes from the prompt:
// - Adjust import paths as needed: Using provided paths.
// - solveODE return { t: number[], y: number[][] }: Handled by taking the last point.
// - dtMax for solveODE: Heuristic dt_interval / 10 is used.
// - currentContinuationParamValue: Passed to odeSystem and solveODE.
// - Phase condition: Uses odeSystem directly.
// - Error handling T <= 0: Included.
// - equations.compiled optionality: Using compiled! as per prompt.
// - Variable type: Not directly used in this function body.


/**
 * Performs Newton-Raphson correction for the multiple shooting system Y.
 *
 * @param Y_initial Initial guess for the shooting nodes and period T.
 *                  Y = [x_0_0, ..., x_{M-1}_{d-1}, T]
 * @param shootingSystem The function F(Y) that returns residuals (from buildMultipleShootingSystem).
 * @param dimension d
 * @param numShootingNodes M
 * @param maxIterations Maximum number of Newton iterations.
 * @param tolerance Desired tolerance for the norm of F(Y).
 * @param fd_epsilon Epsilon for finite difference Jacobian approximation.
 * @returns The corrected Y, or null if not converged.
 */
export function newtonCorrectorForLimitCycle(
  Y_initial: number[],
  shootingSystem: (Y: number[]) => number[],
  dimension: number,
  numShootingNodes: number,
  maxIterations: number,
  tolerance: number,
  fd_epsilon: number
): number[] | null {
  let Yk = [...Y_initial]; // Current iterate
  const systemSize = numShootingNodes * dimension + 1;

  if (Yk.length !== systemSize) {
    console.error("Initial guess Y_initial has incorrect length.");
    return null;
  }

  for (let iter = 0; iter < maxIterations; ++iter) {
    const F_Yk = shootingSystem(Yk);
    const currentNorm = norm(F_Yk) as number;

    if (currentNorm < tolerance) {
      return Yk; // Converged
    }

    // Approximate Jacobian J_F(Yk) using finite differences
    const J_F_Yk_cols: number[][] = []; // Stores columns of the Jacobian
    for (let j = 0; j < systemSize; ++j) {
      const Yk_plus_eps = [...Yk];
      Yk_plus_eps[j] += fd_epsilon;
      const F_Yk_plus_eps = shootingSystem(Yk_plus_eps);
      
      const J_col_j: number[] = [];
      for (let i = 0; i < systemSize; ++i) {
        J_col_j.push((F_Yk_plus_eps[i] - F_Yk[i]) / fd_epsilon);
      }
      J_F_Yk_cols.push(J_col_j); // Add column to list of columns
    }
    
    // Transpose J_F_Yk_cols to J_matrix_data (array of rows for mathjs.matrix)
    const J_matrix_data: number[][] = [];
    if (systemSize > 0) {
      for (let i = 0; i < systemSize; i++) {
        J_matrix_data[i] = [];
        for (let j = 0; j < systemSize; j++) {
          J_matrix_data[i][j] = J_F_Yk_cols[j][i]; // Transposing
        }
      }
    }
    const J_matrix = matrix(J_matrix_data);

    // Solve J_F * deltaY = -F_Yk
    const F_Yk_mjs = matrix(F_Yk.map(val => [val])); // Convert F_Yk to a column matrix
    
    let deltaY_mjs: Matrix; // Type from mathjs
    try {
      deltaY_mjs = lusolve(J_matrix, multiply(F_Yk_mjs, -1)) as Matrix;
    } catch (e) {
      console.error("Failed to solve linear system J * deltaY = -F:", e);
      return null; // Singular Jacobian or other error
    }

    // Update Yk: Y_k+1 = Y_k + deltaY
    // deltaY_mjs is a column matrix, convert to flat array
    const deltaY_flat = (deltaY_mjs.valueOf() as number[][]).map(row => row[0]);
    Yk = Yk.map((val, index) => val + deltaY_flat[index]);
  }

  console.warn(`Newton corrector did not converge after ${maxIterations} iterations.`);
  return null; // Not converged
}

/**
 * Performs continuation of a limit cycle using multiple shooting.
 *
 * @param equations ODE system.
 * @param fixedParameters Parameters that are fixed during continuation.
 * @param continuationParameter The parameter to vary. (Initial value is taken from this object)
 * @param initialY Initial guess for the shooting nodes and period T for the first point.
 *                 Y = [x_0_0, ..., x_{M-1}_{d-1}, T].
 * @param numShootingNodes M.
 * @param dimension d.
 * @param fixedPhaseComponentIndex Index for the phase condition component.
 * @param parameterStep Initial step size for the continuation parameter.
 * @param numSteps Number of continuation steps to take.
 * @param newtonMaxIterations Max iterations for Newton corrector.
 * @param newtonTolerance Tolerance for Newton corrector.
 * @param fd_epsilon Epsilon for finite difference Jacobian.
 * @returns An array of LimitCycle objects representing the continued branch, or null if failed.
 */
export function continueLimitCycleMS(
  equations: Equation[],
  fixedParameters: Parameter[],
  continuationParameter: Parameter, // The object itself, its .value will be updated
  initialY: number[],
  numShootingNodes: number,
  dimension: number,
  fixedPhaseComponentIndex: number,
  parameterStep: number,
  numSteps: number,
  newtonMaxIterations: number,
  newtonTolerance: number,
  fd_epsilon: number
): LimitCycle[] | null {
  const branch: LimitCycle[] = [];
  let currentY = [...initialY];
  let currentParamValue = continuationParameter.value;

  for (let i = 0; i < numSteps; ++i) {
    // 1. Update continuation parameter for the current step's attempt
    // (For the first point, use initialParamValue, then step)
    if (i > 0) {
      currentParamValue += parameterStep;
    }
    
    // Create a mutable copy of continuationParameter for this step
    const currentContinuationParam: Parameter = { ...continuationParameter, value: currentParamValue };

    // 2. Build the shooting system for the current parameter value
    const shootingSystem = buildMultipleShootingSystem(
      equations,
      fixedParameters,
      currentContinuationParam, // Pass the updated parameter object
      numShootingNodes,
      dimension,
      fixedPhaseComponentIndex
    );

    // 3. Predictor (zeroth-order: use previous solution as guess)
    // currentY is already the guess from the previous step (or initialY)

    // 4. Corrector
    const correctedY = newtonCorrectorForLimitCycle(
      currentY,
      shootingSystem,
      dimension,
      numShootingNodes,
      newtonMaxIterations,
      newtonTolerance,
      fd_epsilon
    );

    if (correctedY === null) {
      console.error(`Newton corrector failed at step ${i+1}, parameter value ${currentParamValue}.`);
      // Optionally, try reducing step size here in a more advanced implementation
      return branch.length > 0 ? branch : null; // Return what we have if anything, else null
    }

    // 5. Store result
    const period = correctedY[numShootingNodes * dimension];
    const points: number[][] = [];
    for (let j = 0; j < numShootingNodes; ++j) {
      points.push(correctedY.slice(j * dimension, (j + 1) * dimension));
    }
    
    branch.push({
      points: points,
      period: period,
      parameterValue: currentParamValue,
      dimension: dimension,
      numDiscretizationPoints: numShootingNodes
    });

    // Update currentY for the next predictor step
    currentY = correctedY;

    // Basic step size control (very simple: if it failed, we already exited)
    // More advanced: if Newton took many iterations, reduce step size. If few, increase.
  }

  return branch;
}

/**
 * Generates an initial guess (Y vector) for limit cycle continuation starting from a Hopf bifurcation.
 * Y = [xs_0_0, ..., xs_0_{d-1},  // First shooting node
 *      ...,
 *      xs_{M-1}_0, ..., xs_{M-1}_{d-1}, // Last shooting node
 *      T_guess]                       // Guessed period
 *
 * @param hopfEquilibrium The state variables of the equilibrium point at the Hopf bifurcation.
 * @param criticalEigenvector_v_re The real part of the critical eigenvector `v` (associated with +i*omega_0).
 * @param criticalEigenvector_v_im The imaginary part of the critical eigenvector `v`.
 * @param criticalFrequency_omega0 The imaginary part (frequency omega_0) of the critical eigenvalues +/- i*omega_0. Must be > 0.
 * @param numShootingNodes M, the number of shooting nodes to generate.
 * @param dimension d, the dimension of the state space.
 * @param initialAmplitude_epsilon_lc A small amplitude for the initial guess of the limit cycle.
 * @returns The initial Y vector for use in `newtonCorrectorForLimitCycle` or `continueLimitCycleMS`.
 */
export function generateInitialGuessForLCFromHopf(
  hopfEquilibrium: number[],
  criticalEigenvector_v_re: number[],
  criticalEigenvector_v_im: number[],
  criticalFrequency_omega0: number,
  numShootingNodes: number,
  dimension: number,
  initialAmplitude_epsilon_lc: number
): number[] {
  if (hopfEquilibrium.length !== dimension ||
      criticalEigenvector_v_re.length !== dimension ||
      criticalEigenvector_v_im.length !== dimension) {
    throw new Error("Dimension mismatch in input vectors."); // Re-typed
  }
  if (criticalFrequency_omega0 <= 0) {
    throw new Error("Critical frequency omega_0 must be positive."); // Re-typed
  }
  if (numShootingNodes <= 0) {
    throw new Error("Number of shooting nodes must be positive."); // Re-typed
  }

  const M = numShootingNodes;
  const d = dimension;

  // 1. Guess the period
  const T_guess = 2 * Math.PI / criticalFrequency_omega0;

  const initialY: number[] = [];

  // 2. Generate shooting nodes
  for (let j = 0; j < M; ++j) { // For each shooting node xs_j
    const t_j = j * (T_guess / M); // Time for the j-th node
    const cos_omega_t = Math.cos(criticalFrequency_omega0 * t_j);
    const sin_omega_t = Math.sin(criticalFrequency_omega0 * t_j);

    const node_xs_j: number[] = [];
    for (let k = 0; k < d; ++k) { // For each dimension/state variable
      const value = hopfEquilibrium[k] +
                    2 * initialAmplitude_epsilon_lc *
                    (criticalEigenvector_v_re[k] * cos_omega_t - criticalEigenvector_v_im[k] * sin_omega_t);
      node_xs_j.push(value);
    }
    initialY.push(...node_xs_j);
  }

  // 3. Add the guessed period T_guess to the end of Y
  initialY.push(T_guess);

  if (initialY.length !== M * d + 1) {
    // This should not happen if logic is correct
    throw new Error("Internal error: Generated Y vector has incorrect length."); // Re-typed
  }

  return initialY;
}
```
