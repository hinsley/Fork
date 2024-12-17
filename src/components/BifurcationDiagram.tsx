import { useState } from "react"
import Plot from "react-plotly.js"
import {
  Box,
  Stack,
  TextField
} from "@mui/material"

import { Equation, Parameter } from "./ODEEditor"

import { ParameterSet } from "./Continuation/ParameterSets/ParameterSetsMenu"

interface BifurcationDiagramProps {
  equations: Equation[]
  parameters: Parameter[]
  parameterSets: ParameterSet[]
}

export default function BifurcationDiagram({ equations, parameters, parameterSets }: BifurcationDiagramProps) {
  const [horizontalAxis, setHorizontalAxis] = useState(0)
  const [verticalAxis, setVerticalAxis] = useState(parameters.length)

  function horizontalAxisData() {
    if (horizontalAxis < parameters.length) {
      return 
    } else {
      return equations[horizontalAxis - parameters.length].variable
    }
  }

  function verticalAxisData() {
    if (verticalAxis < parameters.length) {
      return parameters[verticalAxis].name
    } else {
      return equations[verticalAxis - parameters.length].variable
    }
  }

  function horizontalAxisTitle() {
    if (horizontalAxis < parameters.length) {
      return parameters[horizontalAxis].name
    } else {
      return equations[horizontalAxis - parameters.length].variable
    }
  }

  function verticalAxisTitle() {
    if (verticalAxis < parameters.length) {
      return parameters[verticalAxis].name
    } else {
      return equations[verticalAxis - parameters.length].variable
    }
  }

  return (
    <Box sx={{ height: "100%", width: "100%", overflow: "auto", alignItems: "center" }}>
      <Box sx={{ mt: 8, mb: 8, maxWidth: "100%", alignItems: "center" }}>
        <h3>Bifurcation Diagram</h3>
        <Stack spacing={2} direction="column" sx={{ mb: 2, alignItems: "center" }}>
          <Box>
            <TextField
              select
              label="Horizontal axis"
              value={horizontalAxis}
              SelectProps={{ native: true }}
              onChange={(event) => {setHorizontalAxis(Number(event.target.value))}}
            >
              {parameters.map((parameter, index) => (
                <option value={index}>Parameter: {parameter.name}</option>
              ))}
              {equations.map((equation, index) => (
                <option value={index + parameters.length}>Variable: {equation.variable}</option>
              ))}
            </TextField>
          </Box>
          <Box>
            <TextField
              select
              label="Vertical axis"
              value={verticalAxis}
              SelectProps={{ native: true }}
              onChange={(event) => {setVerticalAxis(Number(event.target.value))}}
            >
              {parameters.map((parameter, index) => (
                <option value={index}>Parameter: {parameter.name}</option>
              ))}
              {equations.map((equation, index) => (
                <option value={index + parameters.length}>Variable: {equation.variable}</option>
              ))}
            </TextField>
          </Box>
        </Stack>
        <Plot
          data={[
            // Continuation curves.
            ...parameterSets.filter(parameterSet => parameterSet.data.continuationCurve.length > 0)
            .map((parameterSet) => ({
              x: parameterSet.data.continuationCurve.map(
                (continuationPoint) => continuationPoint[horizontalAxis]
              ),
              y: parameterSet.data.continuationCurve.map(
                (continuationPoint) => continuationPoint[verticalAxis]
              ),
              type: "scatter",
              mode: "lines",
              line: {
                color: "black"
              },
              name: parameterSet.name
            })),
            // Beginnings of continuation curves.
            ...parameterSets.filter(parameterSet => parameterSet.data.continuationCurve.length > 0)
            .map((parameterSet) => ({
              x: [parameterSet.data.continuationCurve[0][horizontalAxis]],
              y: [parameterSet.data.continuationCurve[0][verticalAxis]],
              type: "scatter",
              mode: "markers",
              marker: {
                size: 5,
                color: "red"
              },
              showlegend: false,
              name: `${parameterSet.name} start`
            })),
            // Ends of continuation curves.
            ...parameterSets.filter(parameterSet => parameterSet.data.continuationCurve.length > 0)
            .map((parameterSet) => ({
              x: [parameterSet.data.continuationCurve[parameterSet.data.continuationCurve.length - 1][horizontalAxis]],
              y: [parameterSet.data.continuationCurve[parameterSet.data.continuationCurve.length - 1][verticalAxis]],
              type: "scatter",
              mode: "markers",
              marker: {
                size: 5,
                color: "blue"
              },
              showlegend: false,
              name: `${parameterSet.name} end`
            })),
          ]}
          layout={{
            xaxis: { title: horizontalAxisTitle() },
            yaxis: { title: verticalAxisTitle() },
            width: 600
          }}
        />
      </Box>
    </Box>
  )
}