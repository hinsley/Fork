import React, { Dispatch, SetStateAction, useEffect, useState } from "react"
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Stack,
  TextField
} from "@mui/material"

import StateSpace, { defaultStateSpaceSettings } from "../../../StateSpace"
import { Equation, Parameter } from "../../../ODEEditor"
import { StateEntity } from "../StateEntitiesMenu"

import marchSquares from "../../../../math/stateentitycalculation/march_squares"

export interface IsoclineData {
  stepSizes: number[]
  squaresEndpoints: [number[], number[]][]
}

export interface IsoclineEntity extends StateEntity {
  data: IsoclineData
}

interface EditIsoclineDialogProps {
  equations: Equation[]
  parameters: Parameter[]
  open: boolean
  onClose: (setIsoclineDialogOpen: Dispatch<SetStateAction<boolean>>, updatedStateEntity?: StateEntity) => boolean
  setIsoclineDialogOpen: Dispatch<SetStateAction<boolean>>
  stateEntities: StateEntity[]
  stateEntity: IsoclineEntity | null // The Isocline state entity.
}

export default function EditIsoclineDialog({ equations, parameters, setIsoclineDialogOpen, open, onClose, stateEntities, stateEntity }: EditIsoclineDialogProps) {
  if (stateEntity === null) {
    return null
  }

  const [previewRenderKey, setPreviewRenderKey] = useState(0)
  const [previewShowAllStateEntities, setPreviewShowAllStateEntities] = useState(false)
  const [previewShowRealtimeOrbits, setPreviewShowRealtimeOrbits] = useState(false)
  const [updatedStateEntity, setUpdatedStateEntity] = useState(stateEntity)

  const [isoclineExpression, setIsoclineExpression] = useState(equations.length > 0 ? equations[0].expression : "")
  const [isoclineValue, setIsoclineValue] = useState(0)
  const [resolutions, setResolutions] = useState(equations.map((_, i) => i < 2 ? 21 : 1))
  const [ranges, setRanges] = useState(equations.map((_, i) => i < 2 ? [-10, 10] : [0, 0]))

  useEffect(() => {
    if (open) {
      // Make sure the stateEntity is always populated with the selected state entity.
      setUpdatedStateEntity(stateEntity)
      // Reset state space preview configuration.
      setPreviewShowAllStateEntities(false)
      setPreviewShowRealtimeOrbits(false)
    }
  }, [open])

  useEffect(() => {
    // Update the preview when the state space preview settings are changed.
    setPreviewRenderKey(previewRenderKey + 1)
  }, [previewShowAllStateEntities, previewShowRealtimeOrbits])

  function handleCalculate() {
    const squareTypes = marchSquares(
      equations,
      parameters,
      isoclineExpression,
      isoclineValue,
      ranges,
      resolutions
    )

    // Rasterize squares into endpoints.
    const SPATIAL_SCALING = 2e-2 // TODO: Retrieve this from state space settings.
    const squaresEndpoints: [number[], number[]][] = []
    squareTypes.forEach((square: [number[], number], i: number) => {
      var endPoints: [number[], number[]] = [[], []]
      const coords = [
        [
          (square[0][1] - (updatedStateEntity.data as IsoclineData).stepSizes[1]) * SPATIAL_SCALING,
          square[0][2] * SPATIAL_SCALING,
          (square[0][0] - (updatedStateEntity.data as IsoclineData).stepSizes[0]) * SPATIAL_SCALING
        ],
        [
          (square[0][1] - (updatedStateEntity.data as IsoclineData).stepSizes[1]) * SPATIAL_SCALING,
          square[0][2] * SPATIAL_SCALING,
          square[0][0] * SPATIAL_SCALING
        ],
        [
          square[0][1] * SPATIAL_SCALING,
          square[0][2] * SPATIAL_SCALING,
          square[0][0] * SPATIAL_SCALING
        ],
        [
          square[0][1] * SPATIAL_SCALING,
          square[0][2] * SPATIAL_SCALING,
          (square[0][0] - (updatedStateEntity.data as IsoclineData).stepSizes[0]) * SPATIAL_SCALING
        ]
      ]
      
      function averageCoords(coord1: number[], coord2: number[]) {
        return [(coord1[0] + coord2[0]) / 2, (coord1[1] + coord2[1]) / 2, (coord1[2] + coord2[2]) / 2]
      }

      switch (square[1]) {
        case 1:
        case 14:
          endPoints = [
            averageCoords(coords[0], coords[1]),
            averageCoords(coords[0], coords[3])
          ]
          break
        case 2:
        case 13:
          endPoints = [
            averageCoords(coords[0], coords[1]),
            averageCoords(coords[1], coords[2])
          ]
          break
        case 3:
        case 12:
          endPoints = [
            averageCoords(coords[0], coords[3]),
            averageCoords(coords[1], coords[2])
          ]
          break
        case 4:
        case 11:
          endPoints = [
            averageCoords(coords[1], coords[2]),
            averageCoords(coords[2], coords[3])
          ]
          break
        case 5:
          // Saddle type 1. Not implemented yet.
          break
        case 10:
          // Saddle type 2. Not implemented yet.
          break
        case 6:
        case 9:
          endPoints = [
            averageCoords(coords[0], coords[1]),
            averageCoords(coords[2], coords[3])
          ]
          break
        case 7:
        case 8:
          endPoints = [
            averageCoords(coords[1], coords[2]),
            averageCoords(coords[2], coords[3])
          ]
          break
      }
      squaresEndpoints.push(endPoints)
    })

    updatedStateEntity.data.squaresEndpoints = squaresEndpoints
    setPreviewRenderKey(previewRenderKey + 1)
  }

  function handleCancel() {
    onClose(setIsoclineDialogOpen)
    // Reset form fields in case edit button is clicked again.
    // Should be safe to assume stateEntity isn't null here.
    setUpdatedStateEntity(stateEntity as StateEntity)
  }

  function handleAccept() {
    // Check whether the name of the edited state entity is unique.
    if (updatedStateEntity.name !== (stateEntity as StateEntity).name) { // Should be able to assume stateEntity isn't null here.
      const isNameUnique = stateEntities.every((entity: StateEntity) => entity.name !== updatedStateEntity.name)
      if (!isNameUnique) {
        alert("A state entity with name \"" + updatedStateEntity.name + "\" already exists.")
        return
      }
    }
    if (!onClose(setIsoclineDialogOpen, updatedStateEntity)) {
      alert("Something went wrong; could not update state entity.")
    }
  }

  function handleSetResolution(e: React.ChangeEvent<HTMLInputElement>, index: number) {
    setResolutions([
      ...resolutions.slice(0, index),
      Number(e.target.value),
      ...resolutions.slice(index + 1)
    ])
    setUpdatedStateEntity({...updatedStateEntity, data: {
      ...updatedStateEntity.data,
      stepSizes: [
        ...updatedStateEntity.data.stepSizes.slice(0, index),
        (ranges[index][1] - ranges[index][0]) / Math.max(1, Number(e.target.value) - 1),
        ...updatedStateEntity.data.stepSizes.slice(index + 1)
      ]
    }})
  }

  return updatedStateEntity.type === "Isocline" ? (
    <Dialog open={open}>
      <DialogTitle>Editing isocline "{stateEntity.name}"</DialogTitle>
      <DialogContent dividers>
        <Box>
          <TextField
            label="Name"
            value={updatedStateEntity.name}
            onChange={(e) => setUpdatedStateEntity({ ...updatedStateEntity, name: e.target.value })}
          />
        </Box>
        <Divider sx={{ my: 2 }} />
        <div style={{ fontWeight: "bold", marginBottom: "16px" }}>Isocline evaluation</div>
        <Box sx={{ mb: 2 }}>
          <TextField
            label="Expression"
            value={isoclineExpression}
            onChange={(e) => setIsoclineExpression(e.target.value)}
          />
        </Box>
        <Box>
          <TextField
            label="Value"
            type="number"
            value={isoclineValue}
            onChange={(e) => setIsoclineValue(Number(e.target.value))}
          />
        </Box>
        <Divider sx={{ my: 2 }} />
        <div style={{ fontWeight: "bold", marginBottom: "16px" }}>Variable ranges</div>
        <Stack spacing={2}>
          {equations.map((equation, index) => (
            <>
              <div style={{ fontStyle: "italic", marginBottom: "8px" }}>{equation.variable}</div>
              {index < 3 ? (<>
                <Box key={index * 3}>
                  <TextField
                    label={equation.variable + " minimum"}
                    type="number"
                    value={ranges[index][0]}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRanges([
                      ...ranges.slice(0, index),
                      [Number(e.target.value), ranges[index][1]],
                      ...ranges.slice(index + 1)
                    ])}
                  />
                </Box>
                <Box key={index * 3 + 1}>
                  <TextField
                    label={equation.variable + " maximum"}
                    type="number"
                    value={ranges[index][1]}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRanges([
                      ...ranges.slice(0, index),
                      [ranges[index][0], Number(e.target.value)],
                      ...ranges.slice(index + 1)
                    ])}
                  />
                </Box>
                <Box key={index * 3 + 2}>
                  <TextField
                    label={equation.variable + " resolution"}
                    type="number"
                    value={resolutions[index]}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleSetResolution(e, index)}
                  />
                </Box>
              </>
            ) : (<>
              <Box key={index + 6}>
                <TextField
                  label={equation.variable + " value"}
                  type="number"
                  value={ranges[index][0]}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRanges([
                    ...ranges.slice(0, index),
                    [Number(e.target.value), Number(e.target.value)],
                    ...ranges.slice(index + 1)
                  ])}
                />
              </Box>
            </>)}
            </>
          ))}
        </Stack>
        <Divider sx={{ my: 2 }} />
        <div style={{ fontWeight: "bold", marginBottom: "16px" }}>Isocline</div>
        <Button
          variant="contained"
          fullWidth
          onClick={handleCalculate}
        >
          Calculate
        </Button>
        <Divider sx={{ my: 2 }} />
        <StateSpace key={previewRenderKey} equations={equations} parameters={parameters} stateEntities={
          previewShowAllStateEntities ?
          // Stub in updated data for this state entity for the preview.
          stateEntities.map(entity => 
            entity.name === stateEntity.name ? updatedStateEntity : entity
          ) : [updatedStateEntity]
        } settings={{ ...defaultStateSpaceSettings, realtimeOrbits: previewShowRealtimeOrbits }}/>
        <Box>
          <FormControlLabel
            control={<Checkbox checked={previewShowAllStateEntities} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPreviewShowAllStateEntities(e.target.checked)} />}
            label="Show all state entities"
          />
        </Box>
        <Box>
          <FormControlLabel
            control={<Checkbox checked={previewShowRealtimeOrbits} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPreviewShowRealtimeOrbits(e.target.checked)} />}
            label="Show realtime orbits"
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleCancel}>Cancel</Button>
        <Button onClick={handleAccept}>Save</Button>
      </DialogActions>
    </Dialog>
  ) : (<></>)
}