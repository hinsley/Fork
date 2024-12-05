import React, { useState } from 'react'
import { Box, Button, TextField } from '@mui/material'
import { Equation, Parameter } from './ODEEditor'

interface SystemsProps {
  equations: Equation[]
  setEquations: React.Dispatch<React.SetStateAction<Equation[]>>
  parameters: Parameter[]
  setParameters: React.Dispatch<React.SetStateAction<Parameter[]>>
}

export default function Systems({ setEquations, setParameters }: SystemsProps) {
  const defaultSystem = "lorenz"

  const [selectedSystem, setSelectedSystem] = useState(defaultSystem)

  const setSystem = () => {
    switch (selectedSystem) {
      case "fitzhugh-nagumo":
        setEquations([
          { variable: "v", expression: "v-v^3/3-w+R*I" },
          { variable: "w", expression: "(v+a-b*w)/tau" }
        ])
        setParameters([
          { name: "a", value: 0.7 },
          { name: "b", value: 0 },
          { name: "I", value: 5.393 },
          { name: "R", value: 0.1 },
          { name: "tau", value: 12.5 }
        ])
        break
      case "langford":
        setEquations([
          { variable: "x", expression: "(z-b)*x-d*y" },
          { variable: "y", expression: "d*x+(z-b)*y" },
          { variable: "z", expression: "c+a*z-z^3/3-(x^2+y^2)*(1+e*z)-f*z*x^3" }
        ])
        setParameters([
          { name: "a", value: 0.95 },
          { name: "b", value: 0.7 },
          { name: "c", value: 0.6 },
          { name: "d", value: 3.5 },
          { name: "e", value: 0.25 },
          { name: "f", value: 0.1 }
        ])
        break
      case "lorenz":
        setEquations([
          { variable: "x", expression: "s*(y-x)" },
          { variable: "y", expression: "x*(r-z)-y" },
          { variable: "z", expression: "x*y-b*z" }
        ])
        setParameters([
          { name: "s", value: 10 },
          { name: "b", value: 8/3 },
          { name: "r", value: 28 }
        ])
        break
      case "lorenz-84":
        setEquations([
          { variable: "x", expression: "-y^2-z^2-a*x+a*F" },
          { variable: "y", expression: "x*y-b*x*z-y+G" },
          { variable: "z", expression: "b*x*y+x*z-z" }
        ])
        setParameters([
          { name: "a", value: 0.25 },
          { name: "b", value: 4 },
          { name: "F", value: 8 },
          { name: "G", value: 1 }
        ])
        break
      case "rossler":
        setEquations([
          { variable: "x", expression: "-y-z" },
          { variable: "y", expression: "x+a*y" },
          { variable: "z", expression: "b+z*(x-c)" }
        ])
        setParameters([
          { name: "a", value: 0.1 },
          { name: "b", value: 0.1 },
          { name: "c", value: 14 }
        ])
        break
      case "thomas":
        setEquations([
          { variable: "x", expression: "sin(y)-b*x" },
          { variable: "y", expression: "sin(z)-b*y" },
          { variable: "z", expression: "sin(x)-b*z" }
        ])
        setParameters([
          { name: "b", value: 0.208186 }
        ])
        break
    }
  }

  return (
    <Box sx={{ height: "100%", width: "100%", overflow: "auto", display: "flex", flexDirection: "column", alignItems: "center" }}>
      <Box sx={{ mt: 8, mb: 8, width: "1024px", maxWidth: "100%" }}>
        <h3>Systems</h3>
        <Box sx={{ mb: 2 }}>
          <TextField
            select
            label="System"
            value={selectedSystem}
            SelectProps={{ native: true }}
            onChange={(e) => setSelectedSystem(e.target.value)}
            fullWidth
          >
            <option value="fitzhugh-nagumo">FitzHugh-Nagumo</option>
            <option value="langford">Langford</option>
            <option value="lorenz">Lorenz</option>
            <option value="lorenz-84">Lorenz 84</option>
            <option value="rossler">R&ouml;ssler</option>
            <option value="thomas">Thomas</option>
          </TextField>
        </Box>
        <Box sx={{ mb: 2 }}>
          <Button
            variant="contained"
            onClick={setSystem}
          >
            Load system
          </Button>
        </Box>
      </Box>
    </Box>
  )
}