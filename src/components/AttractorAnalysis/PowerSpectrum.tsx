import { useState } from 'react'
import Plot from 'react-plotly.js'
import { Button, Box, TextField, Stack } from '@mui/material'
import { Equation, Parameter } from '../ODEEditor'
import { range } from 'mathjs'

import { powerSpectralDensity } from '../../math/powerspectraldensity/psd'

export default function PowerSpectrum({ equations, parameters }: { equations: Equation[], parameters: Parameter[] }) {
  const [dt, setDt] = useState<number>(1e-2)
  const [Ttr, setTtr] = useState<number>(3e2)
  const [integrationSteps, setIntegrationSteps] = useState<number>(2**16)
  const [variable, setVariable] = useState<string>("sqrt(x^2+y^2+z^2)")

  const [powerSpectrum, setPowerSpectrum] = useState<number[]>([])

  function calculate() {
    const _psd = powerSpectralDensity(equations, parameters, variable, dt, Ttr, integrationSteps)
    setPowerSpectrum(_psd.map(component => component.toFixed(3)))
  }

  return <Box>
    <Stack spacing={2} sx={{ mb: 2, alignItems: "center" }}>
      <Box sx={{ display: "flex", alignItems: "center" }}>
        <TextField
          label="Timestep size (dt)"
          value={dt}
          onChange={(e) => setDt(Number(e.target.value))}
          sx={{ width: "fit-content", mr: 1 }}
        />
        <TextField
          label="Transient steps (to discard)"
          value={Ttr}
          onChange={(e) => setTtr(Number(e.target.value))}
          sx={{ width: "fit-content", ml: 1}}
        />
      </Box>
      <Box sx={{ display: "flex", alignItems: "center" }}>
        <TextField
          label="Integration steps"
          value={integrationSteps}
          onChange={(e) => setIntegrationSteps(Number(e.target.value))}
          sx={{ width: "fit-content", ml: 1 }}
        />
      </Box>
      <Box sx={{ display: "flex", alignItems: "center" }}>
        <TextField
          label="Timeseries variable"
          value={variable}
          onChange={(e) => setVariable(e.target.value)}
          sx={{ width: "fit-content" }}
        />
      </Box>
      <Button
        variant="contained"
        onClick={calculate}
        sx={{ width: "fit-content" }}
      >
        Calculate
      </Button>
      <Plot
        data={[{
          x: range(0, Math.ceil(powerSpectrum.length/2)).map(i => i / powerSpectrum.length / dt),
          y: powerSpectrum, type: "scatter"
        }]}
        layout={{
          title: "Power Spectrum",
          xaxis: {
            type: "log",
            title: "Frequency (Hz)"
          },
          yaxis: {
            type: "log",
            title: "Power (x^2/Hz)"
          }
        }}
      />
      <Box sx={{ display: "flex", alignItems: "center" }}>
        <TextField
          label="Power spectrum"
          value={powerSpectrum.join(", ")}
          sx={{ width: "fit-content" }}
          InputProps={{ readOnly: true }}
        />
      </Box>
    </Stack>
  </Box>
}