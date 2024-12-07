import { useState } from 'react'
import { Box, Button, TextField, Stack } from '@mui/material'
import { Equation, Parameter } from '../ODEEditor'

// import lle from '../../math/lyapunovexponents/lle' // Comment this out.
import lyapunovSpectrum from '../../math/lyapunovexponents/lyapunov_spectrum'

export default function LyapunovSpectrum({ equations, parameters }: { equations: Equation[], parameters: Parameter[] }) {
  // TODO: Show the initial conditions used for reproducibility.

  const [dt, setDt] = useState(1e-2)
  const [Ttr, setTtr] = useState(3e2)
  const [stepsBetweenRescaling, setStepsBetweenRescaling] = useState(3e1)
  const [integrationSteps, setIntegrationSteps] = useState(3e2)

  const [_lyapunovSpectrum, setLyapunovSpectrum] = useState("Not calculated")
  const [lyapunovDimension, setLyapunovDimension] = useState("Not calculated")

  const calculate = () => {
    // const _lle = lle(equations, parameters, dt, stepsBetweenRescaling, integrationSteps, Ttr) // Comment this out.
    const __lyapunovSpectrum = lyapunovSpectrum(equations, parameters, dt, stepsBetweenRescaling, integrationSteps, Ttr)
    // __lyapunovSpectrum[0] = _lle // Comment this out.

    const absLyapunovExponents = __lyapunovSpectrum.map((lyapunovExponent: number) => Math.abs(lyapunovExponent))
    const minMagnitude = Math.min(...absLyapunovExponents)
    const minIndex = absLyapunovExponents.indexOf(minMagnitude)
    __lyapunovSpectrum[minIndex] = 0
    setLyapunovSpectrum([...__lyapunovSpectrum]
      .sort((a, b) => b - a)
      .map(lyapunovExponent => lyapunovExponent.toFixed(4))
      .join(", "))

    var spectralSum = 0
    var lyapunovDimensionFloor = 0
    for (let i = 0; i < __lyapunovSpectrum.length; i++) {
      spectralSum += __lyapunovSpectrum[i]
      if (spectralSum < 0) {
        lyapunovDimensionFloor = i
        spectralSum -= __lyapunovSpectrum[i]
        break
      }
    }
    const _lyapunovDimension = lyapunovDimensionFloor + spectralSum / Math.abs(__lyapunovSpectrum[lyapunovDimensionFloor])
    setLyapunovDimension(_lyapunovDimension.toFixed(4))
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
          label="Steps between rescaling"
          value={stepsBetweenRescaling}
          onChange={(e) => setStepsBetweenRescaling(Number(e.target.value))}
          sx={{ width: "fit-content", mr: 1 }}
        />
        <TextField
          label="Integration steps"
          value={integrationSteps}
          onChange={(e) => setIntegrationSteps(Number(e.target.value))}
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
        <TextField
          label="Lyapunov spectrum"
          value={_lyapunovSpectrum}
          sx={{ width: "fit-content", mr: 1 }}
          InputProps={{ readOnly: true }}
        />
        <TextField
          label="Lyapunov (attractor) dimension"
          value={lyapunovDimension}
          sx={{ width: "fit-content", ml: 1 }}
          InputProps={{ readOnly: true }}
        />
      </Box>
    </Stack>
  </Box>
}