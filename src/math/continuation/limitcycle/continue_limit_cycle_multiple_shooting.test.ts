import { 
  generateInitialGuessForLCFromHopf,
  buildMultipleShootingSystem,
  newtonCorrectorForLimitCycle 
} from './continue_limit_cycle_multiple_shooting';
import { Equation, Parameter } from '../../../components/ODEEditor';
import { norm } from 'mathjs';
// Assuming a Jest/Vitest testing environment

// Helper to create a mock compiled function for testing
const createMockCompiledEq = (evalFunc: (scope: any) => number) => ({ evaluate: evalFunc });

describe('generateInitialGuessForLCFromHopf', () => {
  // Stuart-Landau oscillator:
  // dz/dt = (mu + i*omega_sl) * z - (1 + i*beta_sl) * |z|^2 * z
  // where z = x + iy.
  // Real form:
  // dx/dt = mu*x - omega_sl*y - (x^2+y^2)*(x - beta_sl*y)
  // dy/dt = omega_sl*x + mu*y - (x^2+y^2)*(y + beta_sl*x)
  // Hopf bifurcation at mu = 0. Equilibrium is (0,0).
  // Jacobian at (0,0) is [[mu, -omega_sl], [omega_sl, mu]].
  // Eigenvalues are mu +/- i*omega_sl.
  // At mu=0, eigenvalues are +/- i*omega_sl. So criticalFrequency_omega0 = omega_sl.
  // Eigenvector for +i*omega_sl:
  // [[0, -omega_sl], [omega_sl, 0]] [v1; v2] = i*omega_sl [v1; v2]
  // -omega_sl*v2 = i*omega_sl*v1  => v2 = -i*v1.
  // Choose v1 = 1, then v2 = -i. So eigenvector v = [1, -i].
  // v_re = [1, 0], v_im = [0, -1].

  const omega_sl = 1.5; // Example Stuart-Landau parameter
  // beta_sl doesn't affect Hopf point location or linear properties

  const hopfEquilibrium = [0, 0]; // x=0, y=0
  const criticalEigenvector_v_re = [1, 0];
  const criticalEigenvector_v_im = [0, -1];
  const criticalFrequency_omega0 = omega_sl;
  const dimension = 2;

  it('should generate a valid Y vector with correct dimensions', () => {
    const numShootingNodes = 10;
    const initialAmplitude_epsilon_lc = 0.01;

    const Y = generateInitialGuessForLCFromHopf(
      hopfEquilibrium,
      criticalEigenvector_v_re,
      criticalEigenvector_v_im,
      criticalFrequency_omega0,
      numShootingNodes,
      dimension,
      initialAmplitude_epsilon_lc
    );

    expect(Y).toBeInstanceOf(Array);
    expect(Y.length).toBe(numShootingNodes * dimension + 1); // M*d + 1
  });

  it('should calculate the period T_guess correctly', () => {
    const numShootingNodes = 10;
    const initialAmplitude_epsilon_lc = 0.01;

    const Y = generateInitialGuessForLCFromHopf(
      hopfEquilibrium,
      criticalEigenvector_v_re,
      criticalEigenvector_v_im,
      criticalFrequency_omega0,
      numShootingNodes,
      dimension,
      initialAmplitude_epsilon_lc
    );

    const T_guess = Y[Y.length - 1];
    expect(T_guess).toBeCloseTo(2 * Math.PI / omega_sl);
  });

  it('should generate shooting nodes consistent with the Hopf approximation formula', () => {
    const numShootingNodes = 4; // M=4 for simpler manual check if needed
    const initialAmplitude_epsilon_lc = 0.01; // eps_lc

    const Y = generateInitialGuessForLCFromHopf(
      hopfEquilibrium,
      criticalEigenvector_v_re,
      criticalEigenvector_v_im,
      criticalFrequency_omega0,
      numShootingNodes,
      dimension,
      initialAmplitude_epsilon_lc
    );

    const T_guess = 2 * Math.PI / criticalFrequency_omega0;

    // Check node 0: t_0 = 0
    // x(0) = x_0 + 2*eps_lc*(v_re*cos(0) - v_im*sin(0)) = x_0 + 2*eps_lc*v_re
    const expected_xs0_x = hopfEquilibrium[0] + 2 * initialAmplitude_epsilon_lc * criticalEigenvector_v_re[0];
    const expected_xs0_y = hopfEquilibrium[1] + 2 * initialAmplitude_epsilon_lc * criticalEigenvector_v_re[1];
    expect(Y[0]).toBeCloseTo(expected_xs0_x); // x-coord of node 0
    expect(Y[1]).toBeCloseTo(expected_xs0_y); // y-coord of node 0

    // Check node 1: t_1 = T_guess / M
    const t_1 = T_guess / numShootingNodes;
    const cos_omega_t1 = Math.cos(criticalFrequency_omega0 * t_1);
    const sin_omega_t1 = Math.sin(criticalFrequency_omega0 * t_1);
    const expected_xs1_x = hopfEquilibrium[0] + 2 * initialAmplitude_epsilon_lc * 
                           (criticalEigenvector_v_re[0] * cos_omega_t1 - criticalEigenvector_v_im[0] * sin_omega_t1);
    const expected_xs1_y = hopfEquilibrium[1] + 2 * initialAmplitude_epsilon_lc * 
                           (criticalEigenvector_v_re[1] * cos_omega_t1 - criticalEigenvector_v_im[1] * sin_omega_t1);
    expect(Y[dimension * 1 + 0]).toBeCloseTo(expected_xs1_x); // x-coord of node 1
    expect(Y[dimension * 1 + 1]).toBeCloseTo(expected_xs1_y); // y-coord of node 1
  });

  // Add more tests for edge cases or invalid inputs if necessary,
  // though the function itself has some input validation.
});


describe('newtonCorrectorForLimitCycle', () => {
  const mu_val = 0.1;
  const omega_sl_val = 1.5;
  const beta_sl_val = 0.0; // Keep beta_sl = 0 for simplicity

  const stuartLandauEquations: Equation[] = [
    {
      variable: 'x',
      expression: 'mu*x - omega_sl*y - (x*x+y*y)*(x - beta_sl*y)',
      compiled: createMockCompiledEq(scope => 
        scope.mu * scope.x - scope.omega_sl * scope.y - (scope.x*scope.x + scope.y*scope.y)*(scope.x - scope.beta_sl*scope.y)
      ),
    },
    {
      variable: 'y',
      expression: 'omega_sl*x + mu*y - (x*x+y*y)*(y + beta_sl*x)',
      compiled: createMockCompiledEq(scope => 
        scope.omega_sl * scope.x + scope.mu * scope.y - (scope.x*scope.x + scope.y*scope.y)*(scope.y + scope.beta_sl*scope.x)
      ),
    },
  ];

  const fixedTestParameters: Parameter[] = [
    { name: 'omega_sl', value: omega_sl_val, min: 0, max: 3, step: 0.01 },
    { name: 'beta_sl', value: beta_sl_val, min: -2, max: 2, step: 0.01 },
  ];
  const muContinuationParam: Parameter = { name: 'mu', value: mu_val, min: -0.5, max: 0.5, step: 0.01 };

  it('should converge for Stuart-Landau limit cycle', () => {
    const dimension = 2;
    const numShootingNodes = 20; // More nodes for better accuracy
    const initialAmplitude_epsilon_lc = 0.1; // Initial guess amplitude

    // Initial guess from Hopf point (at mu=0) theory
    const hopfEquilibrium_SL = [0, 0];
    const v_re_SL = [1, 0];
    const v_im_SL = [0, -1];
    const omega0_SL = omega_sl_val; // omega at Hopf is omega_sl

    const Y_initial = generateInitialGuessForLCFromHopf(
      hopfEquilibrium_SL, v_re_SL, v_im_SL, omega0_SL,
      numShootingNodes, dimension, initialAmplitude_epsilon_lc
    );

    // Now, build the system for mu = mu_val (cycle exists)
    const shootingSystem = buildMultipleShootingSystem(
      stuartLandauEquations,
      fixedTestParameters, // omega_sl, beta_sl
      muContinuationParam,   // mu, with its value set to mu_val
      numShootingNodes,
      dimension,
      0 // fixedPhaseComponentIndex (e.g., dx/dt = 0 at node 0)
    );

    const Y_corrected = newtonCorrectorForLimitCycle(
      Y_initial,
      shootingSystem,
      dimension,
      numShootingNodes,
      30, // maxIterations
      1e-8, // tolerance
      1e-7  // fd_epsilon
    );

    expect(Y_corrected).not.toBeNull();
    if (Y_corrected) {
      const residuals = shootingSystem(Y_corrected);
      expect(norm(residuals)).toBeCloseTo(0, 7); // Check residuals norm is close to 0

      // Optional: Check period and amplitude
      const T_corrected = Y_corrected[Y_corrected.length - 1];
      expect(T_corrected).toBeCloseTo(2 * Math.PI / omega_sl_val, 2); // Period is approx 2*pi/omega

      // Amplitude: max radius of points. sqrt(mu_val) = sqrt(0.1) approx 0.316
      let max_r_sq = 0;
      for (let i = 0; i < numShootingNodes; ++i) {
        const x = Y_corrected[i * dimension + 0];
        const y = Y_corrected[i * dimension + 1];
        max_r_sq = Math.max(max_r_sq, x*x + y*y);
      }
      expect(Math.sqrt(max_r_sq)).toBeCloseTo(Math.sqrt(mu_val), 2);
    }
  });
});
```
