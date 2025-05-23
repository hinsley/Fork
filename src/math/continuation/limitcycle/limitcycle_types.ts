/**
 * Represents a discretized limit cycle.
 */
export interface LimitCycle {
  /**
   * An array of points representing the limit cycle in state space.
   * Each point is an array of numbers, e.g., [x1, x2, ..., xd].
   * These points are typically ordered in time over one period.
   */
  points: number[][];

  /**
   * The period (T) of the limit cycle.
   */
  period: number;

  /**
   * The value of the continuation parameter at which this limit cycle exists.
   */
  parameterValue: number;

  /**
   * Optional: The number of state variables (dimension of the system).
   * Can be inferred from points[0].length if points is not empty.
   */
  dimension?: number;

  /**
   * Optional: The number of discretization points used to represent the cycle.
   * Can be inferred from points.length.
   */
  numDiscretizationPoints?: number;
}
