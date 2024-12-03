import React, { useState } from 'react'
import { Box, TextField } from '@mui/material'
import { Equation, Parameter } from '../ODEEditor'

import LyapunovSpectrum from './LyapunovSpectrum'

interface AttractorAnalysisProps {
  equations: Equation[]
  parameters: Parameter[]
}

export default function AttractorAnalysis({ equations, parameters }: AttractorAnalysisProps) {
  const defaultMode = "lyapunov"
  
  const [mode, setMode] = useState(defaultMode)

  return (
    <Box sx={{ height: "100%", width: "100%", overflow: "auto", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center" }}>
      <Box sx={{ width: "1024px", maxWidth: "100%" }}>
        <h3>Attractor Analysis</h3>
        <Box sx={{ mb: 2 }}>
          <TextField
            select
            label="Analysis mode"
            defaultValue={defaultMode}
            SelectProps={{ native: true }}
            sx={{ mr: 1 }}
            onChange={(e) => setMode(e.target.value)}
          >
            <option value="lyapunov">Lyapunov spectrum</option>
            <option value="power">Power spectrum (not yet implemented)</option>
          </TextField>
        </Box>
        {(() => {
          switch (mode) {
            case "lyapunov":
              return <LyapunovSpectrum equations={equations} parameters={parameters} />
            // case "power":
            //   return <PowerSpectrum equations={equations} parameters={parameters} />
            default:
              return <Box sx={{ mb: 2 }}><h4>Not implemented</h4></Box>
          }
        })()}
      </Box>
    </Box>
  )
}
