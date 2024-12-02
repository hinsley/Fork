import React from 'react'
import { Box, Button, Collapse, IconButton, Stack, TextField, Tooltip } from '@mui/material'
import DeleteIcon from '@mui/icons-material/Delete'
import { TransitionGroup } from 'react-transition-group'
import { compile, EvalFunction } from 'mathjs'

interface ODEEditorProps {
  equations: Equation[]
  setEquations: React.Dispatch<React.SetStateAction<Equation[]>>
  parameters: Parameter[]
  setParameters: React.Dispatch<React.SetStateAction<Parameter[]>>
}

export interface Equation {
  variable: string
  expression: string
  compiled?: EvalFunction
}

export interface Parameter {
  name: string
  value: number
}

export default function ODEEditor({ equations, setEquations, parameters, setParameters }: ODEEditorProps) {
  const addEquation = () => {
    setEquations([...equations, { variable: '', expression: '' }])
  }
  
  const removeEquation = (index: number) => {
    setEquations(equations.filter((_, i) => i !== index))
  }

  const updateEquation = (index: number, field: keyof Equation, value: string | EvalFunction) => {
    const newEquations = [...equations]
    if (field === 'variable') {
      newEquations[index].variable = value as string
    } else if (field === 'expression') {
      newEquations[index].expression = value as string
      newEquations[index].compiled = compile(value as string)
    } else if (field === 'compiled') {
      newEquations[index].compiled = value as EvalFunction
    }
    setEquations(newEquations)
  }

  const addParameter = () => {
    setParameters([...parameters, { name: '', value: 0 }])
  }

  const removeParameter = (index: number) => {
    setParameters(parameters.filter((_, i) => i !== index))
  }

  const updateParameter = (index: number, field: keyof Parameter, value: string | number) => {
    const newParameters = [...parameters]
    if (field === "name") {
      newParameters[index].name = value as string
    } else if (field === "value") {
      newParameters[index].value = value as number
    }
    setParameters(newParameters)
  }

  return (
    <Box sx={{ height: "100%", width: "100%", overflow: "auto", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center" }}>
      <Box sx={{ width: "1024px", maxWidth: "100%" }}>
        <h3>ODE System</h3>
          <TransitionGroup component={Stack} spacing={2} sx={{ mb: 2 }}>
            {equations.map((equation, index) => (
              <Collapse key={index}>
                <Box sx={{ display: "flex", alignItems: "center" }}>
                <TextField
                  label="Variable"
                  value={equation.variable}
                  onChange={(e) => updateEquation(index, "variable", e.target.value)}
                  sx={{ width: "100px", mr: 1 }}
                />
                <TextField
                  label="Derivative Expression"
                  value={equation.expression}
                  onChange={(e) => updateEquation(index, "expression", e.target.value)}
                  fullWidth
                  sx={{ mr: 1 }}
                />
                <Tooltip title="Remove this variable">
                  <IconButton onClick={() => removeEquation(index)} color="error">
                    <DeleteIcon />
                  </IconButton>
                </Tooltip>
              </Box>
              </Collapse>
            ))}
          </TransitionGroup>
          <Button variant="contained" onClick={addEquation} fullWidth>
            New Variable
          </Button>
          <h3>Parameters</h3>
          <TransitionGroup component={Stack} spacing={2} sx={{ mb: 2 }}>
            {parameters.map((parameter, index) => (
              <Collapse key={index}>
                <Box sx={{ display: "flex", alignItems: "center" }}>
                <TextField
                  label="Parameter"
                  value={parameters[index].name}
                  onChange={(e) => updateParameter(index, "name", e.target.value)}
                  sx={{ width: "100px", mr: 1 }}
                />
                <TextField
                  label="Value"
                  value={parameters[index].value}
                  onChange={(e) => updateParameter(index, "value", e.target.value)}
                  fullWidth
                  sx={{ mr: 1 }}
                />
                <Tooltip title="Remove this parameter">
                  <IconButton onClick={() => removeParameter(index)} color="error">
                    <DeleteIcon />
                  </IconButton>
                </Tooltip>
              </Box>
              </Collapse>
            ))}
          </TransitionGroup>
          <Button variant="contained" onClick={addParameter} fullWidth>
            New Parameter
          </Button>
      </Box>
    </Box>
  )
}