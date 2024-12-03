import { useState } from 'react'
import Plot from 'react-plotly.js'
import { Button, Box, Checkbox, FormControlLabel, TextField, Stack } from '@mui/material'
import { Equation, Parameter } from '../ODEEditor'
import { range } from 'mathjs'

import { powerSpectralDensity } from '../../math/powerspectraldensity/psd'

export default function PowerSpectrum({ equations, parameters }: { equations: Equation[], parameters: Parameter[] }) {
  const [dt, setDt] = useState<number>(3e-2)
  const [Ttr, setTtr] = useState<number>(3e2)
  const [integrationSteps, setIntegrationSteps] = useState<number>(19)
  const [variable, setVariable] = useState<string>("sqrt(x^2+y^2+z^2)")

  const [timeseries, setTimeseries] = useState<number[]>([])
  const [powerSpectrum, setPowerSpectrum] = useState<number[]>([])
  const [logX, setLogX] = useState<boolean>(true)
  const [logY, setLogY] = useState<boolean>(true)

  function calculate() {
    const [_timeseries, _psd] = powerSpectralDensity(equations, parameters, variable, dt, Ttr, 2**integrationSteps)
    setTimeseries(_timeseries)
    setPowerSpectrum(_psd)
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
          label="Integration steps (2^n)"
          value={integrationSteps}
          onChange={(e) => setIntegrationSteps(Number(e.target.value))}
          sx={{ width: "fit-content", mr: 1 }}
        />
        <TextField
          label="Timeseries variable"
          value={variable}
          onChange={(e) => setVariable(e.target.value)}
          sx={{ width: "fit-content", ml: 1 }}
        />
      </Box>
      <Button
        variant="contained"
        onClick={calculate}
        sx={{ width: "fit-content" }}
      >
        Calculate
      </Button>
      <Box sx={{ display: "flex", alignItems: "center" }}>
        <FormControlLabel
          control={
            <Checkbox
              checked={logX}
              onChange={(e) => setLogX(e.target.checked)}
            />
          }
          label="Frequency logscale"
        />
        <FormControlLabel
          control={
            <Checkbox
              checked={logY}
              onChange={(e) => setLogY(e.target.checked)}
            />
          }
          label="Power logscale"
        />
      </Box>
      <Plot
        data={[{
          x: Array.from({length: Math.ceil(powerSpectrum.length/2)}, (_, i) => i / powerSpectrum.length / dt),
          y: powerSpectrum, type: "scatter"
        }]}
        layout={{
          title: "Power Spectrum",
          xaxis: {
            type: logX ? "log" : "linear",
            title: "Frequency (Hz)"
          },
          yaxis: {
            type: logY ? "log" : "linear",
            title: "Power (x^2/Hz)"
          }
        }}
      />
      <Plot
        data={[{ x: range(0, timeseries.length).map(i => i * dt), y: timeseries, type: "scatter" }]}
        layout={{ title: "Timeseries" }}
      />
      <h4>Numerical data</h4>
      <Box sx={{ display: "flex", alignItems: "center" }}>
        <TextField
          label="Power spectrum"
          value={powerSpectrum.join(", ")}
          sx={{ width: "fit-content" }}
          InputProps={{ readOnly: true }}
        />
      </Box>
      <Box sx={{ display: "flex", alignItems: "center" }}>
        <TextField
          label="Timeseries"
          value={timeseries.join(", ")}
          sx={{ width: "fit-content" }}
          InputProps={{ readOnly: true }}
        />
      </Box>
    </Stack>
  </Box>
}