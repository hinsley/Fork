import { Complex, Matrix, eigs } from "mathjs"

import { Equation, Parameter } from "../../ODEEditor"

import jacobian from "../differentiation/jacobian"

export default function equilibriumEigenpairs(
  equations: Equation[],
  parameters: Parameter,
  equilibrium: number[]
): [number[] | Complex[], number[][] | Complex[][]] {
  const jac = jacobian(equations, parameters)(equilibrium)
  const eigenpairs = eigs(jac).eigenvectors
  const eigenvalues = eigenpairs.map((eigenpair: { value: number }) => eigenpair.value)
  const eigenvectors = eigenpairs.map((eigenpair: { vector: Matrix }) => eigenpair.vector.valueOf())

  return [eigenvalues, eigenvectors]
}