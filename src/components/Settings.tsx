import React from "react"
import {
  Box,
  Checkbox,
  Divider,
  FormControlLabel,
  Stack,
  TextField
} from "@mui/material"

import { StateSpaceSettings } from "./StateSpace"
import { Equation } from "./ODEEditor"

interface SettingsProps{
  equations: Equation[]
  stateSpaceSettings: StateSpaceSettings
  setStateSpaceSettings: React.Dispatch<React.SetStateAction<StateSpaceSettings>>
}

export default function Settings({
  equations,
  stateSpaceSettings,
  setStateSpaceSettings
}: SettingsProps) {
  return (
    <Box sx={{ height: "100%", width: "100%", overflow: "auto", display: "flex", flexDirection: "column", alignItems: "center" }}>
      <Box sx={{ mt: 8, mb: 8, width: "1024px", maxWidth: "100%" }}>
        <h3>Settings</h3>
        
        <div style={{ marginTop: "32px", fontWeight: "bold", marginBottom: "16px" }}>
          State space
        </div>
        <Stack spacing={2} sx={{ alignItems: "center" }}>
          <TextField
            label="Time scale"
            type="number"
            value={stateSpaceSettings.timeScale}
            onChange={(e) => {
              if (e.target.value > 0) {
                setStateSpaceSettings({
                  ...stateSpaceSettings,
                  timeScale: Number(e.target.value)
                })
              }
            }}
          />
          {equations.slice(0, 3).map((equation, index) => (
            <TextField
              label={`${equation.variable} scale`}
              key={index}
              type="number"
              value={[
                stateSpaceSettings.xScale,
                stateSpaceSettings.yScale,
                stateSpaceSettings.zScale
              ][index]}
              onChange={(e) => {
                if (e.target.value > 0) {
                  switch (index) {
                    case 0:
                      setStateSpaceSettings({
                        ...stateSpaceSettings,
                        xScale: Number(e.target.value)
                      })
                      break
                    case 1:
                      setStateSpaceSettings({
                        ...stateSpaceSettings,
                        yScale: Number(e.target.value)
                      })
                      break
                    case 2:
                      setStateSpaceSettings({
                        ...stateSpaceSettings,
                        zScale: Number(e.target.value)
                      })
                      break
                  }
                }
              }}
            />
          ))}
          <FormControlLabel
            control={<Checkbox
              checked={stateSpaceSettings.realtimeOrbits}
              onChange={(e) => setStateSpaceSettings({
                ...stateSpaceSettings,
                realtimeOrbits: e.target.checked
              })}
            />}
            label="Realtime orbits"
          />
        </Stack>
      </Box>
    </Box>
  )
}