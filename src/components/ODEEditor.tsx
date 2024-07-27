import React from 'react'
import { Box, Button, Collapse, IconButton, Stack, TextField, Tooltip } from '@mui/material'
import DeleteIcon from '@mui/icons-material/Delete'
import { TransitionGroup } from 'react-transition-group'
import { compile, EvalFunction } from 'mathjs'

interface ODEEditorProps {
  equations: Equation[]
  setEquations: React.Dispatch<React.SetStateAction<Equation[]>>
}

export interface Equation {
  variable: string
  expression: string
  compiled?: EvalFunction
}

export default function ODEEditor({equations, setEquations }: ODEEditorProps) {
  const addEquation = () => {
    setEquations([...equations, { variable: '', expression: '' }])
  }
  
  const removeEquation = (index: number) => {
    setEquations(equations.filter((_, i) => i !== index))
  }

  const updateEquation = (index: number, field: keyof Equation, value: string | EvalFunction) => {
    const newEquations = [...equations]
    newEquations[index][field] = value as any
    if (field === 'expression') {
      newEquations[index].compiled = compile(value as string)
    }
    setEquations(newEquations)
  }

  return (
    <Box sx={{ height: '100%', width: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
      <Box sx={{ width: '1024px', maxWidth: '100%' }}>
        <h3>ODE System</h3>
          <TransitionGroup component={Stack} spacing={2} sx={{ mb: 2 }}>
            {equations.map((equation, index) => (
              <Collapse key={index}>
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <TextField
                  label="Variable"
                  value={equation.variable}
                  onChange={(e) => updateEquation(index, 'variable', e.target.value)}
                  sx={{ width: '100px', mr: 1 }}
                />
                <TextField
                  label="Derivative Expression"
                  value={equation.expression}
                  onChange={(e) => updateEquation(index, 'expression', e.target.value)}
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
      </Box>
    </Box>
  )
}