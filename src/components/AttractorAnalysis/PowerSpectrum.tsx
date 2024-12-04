import { useState } from 'react'
import Plot from 'react-plotly.js'
import { Button, Box, Checkbox, FormControlLabel, TextField, Stack } from '@mui/material'
import { Equation, Parameter } from '../ODEEditor'
import { range } from 'mathjs'

import { powerSpectralDensity } from '../../math/powerspectraldensity/psd'

export default function PowerSpectrum({ equations, parameters }: { equations: Equation[], parameters: Parameter[] }) {
  const [dt, setDt] = useState<number>(3e-2)
  const [Ttr, setTtr] = useState<number>(3e2)
  const [integrationSteps, setIntegrationSteps] = useState<number>(16)
  const [variable, setVariable] = useState<string>("sqrt(x^2+y^2+z^2)")

  const [timeseries, setTimeseries] = useState<number[]>([])
  const [iterates, setIterates] = useState<number>(0)
  const [powerSpectrum, setPowerSpectrum] = useState<number[]>([])
  const [logX, setLogX] = useState<boolean>(true)
  const [logY, setLogY] = useState<boolean>(true)

  function calculate() {
    const [_timeseries, _psd] = powerSpectralDensity(equations, parameters, variable, dt, 2**integrationSteps, Ttr)
    if (isNaN(_timeseries[_timeseries.length-1])) {
      console.log("NaN in timeseries data.")
      return
    }
    setTimeseries(_timeseries)
    if (iterates === 0) {
      setPowerSpectrum(_psd)
    } else {
      for (var i = 0; i < _psd.length; i++) {
        _psd[i] = (powerSpectrum[i] * iterates + _psd[i]) / (iterates + 1)
      }
      setPowerSpectrum(_psd)
    }
    setIterates(iterates + 1)
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
      <Box sx={{ display: "flex", alignItems: "center" }}>
        <Button
          variant="contained"
          onClick={calculate}
          sx={{ width: "fit-content", mr: 1 }}
        >
          Iterate PSD
        </Button>
        <Button
          variant="contained"
          onClick={() => {
            setIterates(0)
            setTimeseries([])
            setPowerSpectrum([])
          }}
          sx={{ width: "fit-content", ml: 1 }}
        >
          Reset PSD
        </Button>
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", pt: 4 }}>
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
          y: powerSpectrum,
          type: "scatter"
        }]}
        layout={{
          title: "Power Spectrum (" + iterates + " iterates)",
          xaxis: {
            type: logX ? "log" : "linear",
            title: "Frequency (Hz)"
          },
          yaxis: {
            type: logY ? "log" : "linear",
            title: "Power (amp^2/Hz)"
          },
          width: 640
        }}
      />
      <Plot
        data={[{
          x: Array.from({length: timeseries.length}, (_, i) => i * dt),
          y: timeseries,
          type: "scatter"
        }]}
        layout={{
          title: "Timeseries",
          xaxis: { title: "Time (s)" },
          yaxis: { title: variable },
          width: 640
        }}
      />
      <h4>Numerical data</h4>
      <Box sx={{ display: "flex", alignItems: "center" }}>
        <TextField
          label="Power spectrum"
          value={powerSpectrum.join(", ")}
          sx={{ width: "fit-content", mr: 1 }}
          InputProps={{ readOnly: true }}
        />
        <TextField
          label="Timeseries"
          value={timeseries.join(", ")}
          sx={{ width: "fit-content", ml: 1 }}
          InputProps={{ readOnly: true }}
        />
      </Box>
    </Stack>
  </Box>
}