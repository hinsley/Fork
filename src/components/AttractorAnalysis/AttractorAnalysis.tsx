import React, { useState } from 'react'
import { Box, TextField } from '@mui/material'
import { Equation, Parameter } from '../ODEEditor'

import LyapunovSpectrum from './LyapunovSpectrum'
import PowerSpectrum from './PowerSpectrum'

interface AttractorAnalysisProps {
  equations: Equation[]
  parameters: Parameter[]
}

export default function AttractorAnalysis({ equations, parameters }: AttractorAnalysisProps) {
  const defaultMode = "lyapunov"
  
  const [mode, setMode] = useState(defaultMode)

  return (
    <Box sx={{ height: "100%", width: "100%", overflow: "auto", display: "flex", flexDirection: "column", alignItems: "center" }}>
      <Box sx={{ mt: 8, mb: 8, width: "1024px", maxWidth: "100%" }}>
        <h3>Attractor Analysis</h3>
        <Box sx={{ mb: 2 }}>
          <TextField
            select
            label="Analysis mode"
            value={mode}
            SelectProps={{ native: true }}
            onChange={(e) => setMode(e.target.value)}
          >
            <option value="lyapunov">Lyapunov spectrum</option>
            <option value="power">Power spectrum</option>
          </TextField>
        </Box>
        {(() => {
          switch (mode) {
            case "lyapunov":
              return <LyapunovSpectrum equations={equations} parameters={parameters} />
            case "power":
              return <PowerSpectrum equations={equations} parameters={parameters} />
            default:
              return <Box sx={{ mb: 2 }}><h4>Not implemented</h4></Box>
          }
        })()}
      </Box>
    </Box>
  )
}
