import React, { Dispatch, SetStateAction, useEffect, useState } from "react"
import {
  Autocomplete,
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

import StateSpace, { StateSpaceSettings } from "../../../StateSpace"
import { Equation, Parameter } from "../../../ODEEditor"
import { StateEntity } from "../StateEntitiesMenu"

import conjoinLineSegments from "../../../../math/stateentitycalculation/conjoin_line_segments"
import marchSquares from "../../../../math/stateentitycalculation/march_squares"

export interface IsoclineData {
  lines: number[][][]
  ranges: [number, number][]
  stepSizes: number[]
}

export interface IsoclineFormParameters {
  expression: string
  value: number
  resolutions: number[]
}

export interface IsoclineEntity extends StateEntity {
  data: IsoclineData
  formParameters: IsoclineFormParameters
}

interface EditIsoclineDialogProps {
  equations: Equation[]
  parameters: Parameter[]
  stateSpaceSettings: StateSpaceSettings
  open: boolean
  onClose: (setIsoclineDialogOpen: Dispatch<SetStateAction<boolean>>, updatedStateEntity?: StateEntity) => boolean
  setIsoclineDialogOpen: Dispatch<SetStateAction<boolean>>
  stateEntities: StateEntity[]
  stateEntity: IsoclineEntity | null // The Isocline state entity.
}

export default function EditIsoclineDialog({
  equations,
  parameters,
  stateSpaceSettings,
  setIsoclineDialogOpen,
  open,
  onClose,
  stateEntities,
  stateEntity
}: EditIsoclineDialogProps) {
  if (stateEntity === null) {
    return null
  }

  const textFieldWidth = 230 // Pixel width of text fields.

  const [previewRenderKey, setPreviewRenderKey] = useState(0)
  const [previewShowAllStateEntities, setPreviewShowAllStateEntities] = useState(false)
  const [previewShowRealtimeOrbits, setPreviewShowRealtimeOrbits] = useState(false)
  const [updatedStateEntity, setUpdatedStateEntity] = useState({...stateEntity})

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
      updatedStateEntity.formParameters.expression,
      updatedStateEntity.formParameters.value,
      updatedStateEntity.data.ranges,
      updatedStateEntity.formParameters.resolutions
    )

    // Rasterize squares into endpoints.
    const squaresEndpoints: number[][][] = []
    squareTypes.forEach((square: [number[], number, number, number, number, number], _: number) => {
      let endPoints: number[][] = []
      const coords = [
        [ // Bottom right.
          square[0][1] - (updatedStateEntity.data as IsoclineData).stepSizes[1],
          square[0][2],
          square[0][0]
        ],
        [ // Bottom left.
          square[0][1] - (updatedStateEntity.data as IsoclineData).stepSizes[1],
          square[0][2],
          square[0][0] - (updatedStateEntity.data as IsoclineData).stepSizes[0]
        ],
        [ // Top left.
          square[0][1],
          square[0][2],
          square[0][0] - (updatedStateEntity.data as IsoclineData).stepSizes[0]
        ],
        [ // Top right.
          square[0][1],
          square[0][2],
          square[0][0]
        ]
      ]
      
      // Lerp between two coordinates. t should be in the interval [0, 1].
      function lerpCoords(coord1: number[], coord2: number[], t: number) {
        return [
          coord1[0] + t * (coord2[0] - coord1[0]),
          coord1[1] + t * (coord2[1] - coord1[1]),
          coord1[2] + t * (coord2[2] - coord1[2])
        ]
      }

      // Points on each edge of the square.
      const bottomEdge = lerpCoords(coords[0], coords[1], square[2])
      const leftEdge = lerpCoords(coords[1], coords[2], square[3])
      const topEdge = lerpCoords(coords[2], coords[3], square[4])
      const rightEdge = lerpCoords(coords[3], coords[0], square[5])

      switch (square[1]) {
        case 1:
        case 14:
          endPoints = [
            topEdge,
            leftEdge
          ]
          break
        case 2:
        case 13:
          endPoints = [
            topEdge,
            rightEdge
          ]
          break
        case 3:
        case 12:
          endPoints = [
            leftEdge,
            rightEdge
          ]
          break
        case 4:
        case 11:
          endPoints = [
            rightEdge,
            bottomEdge
          ]
          break
        case 5:
          // Saddle type 1. Union of types 2 and 7 (or 13 and 8).
          endPoints = [
            topEdge, // First line, first endpoint.
            rightEdge, // First line, second endpoint.
            leftEdge, // Second line, first endpoint.
            bottomEdge // Second line, second endpoint.
          ]
          break
        case 10:
          // Saddle type 2. Union of types 1 and 4 (or 14 and 11).
          endPoints = [
            topEdge, // First line, first endpoint.
            leftEdge, // First line, second endpoint.
            rightEdge, // Second line, first endpoint.
            bottomEdge // Second line, second endpoint.
          ]
          break
        case 6:
        case 9:
          endPoints = [
            topEdge,
            bottomEdge
          ]
          break
        case 7:
        case 8:
          endPoints = [
            leftEdge,
            bottomEdge
          ]
          break
      }
      for (let i = 0; i < endPoints.length; i += 2) {
        squaresEndpoints.push([endPoints[i], endPoints[i + 1]])
      }
    })

    // Collect line segments into lines based on agreeing endpoints.
    let lines: number[][][] = []

    // Get indices where each isocline layer begins.
    const isoclineLayerIndices: number[] = [0]
    for (let i = 1; i < squaresEndpoints.length; i++) {
      if (squaresEndpoints[i][0][1] !== squaresEndpoints[i - 1][0][1]) {
        isoclineLayerIndices.push(i)
      }
    }

    // For each isocline layer, store lines as maximal chains of segments which
    // meet at endpoints.
    for (let i = 0; i < isoclineLayerIndices.length; i++) {
      const layer = squaresEndpoints.slice(isoclineLayerIndices[i], isoclineLayerIndices[i + 1])
      const layerLines = conjoinLineSegments(layer as [number[], number[]][])
      lines = [...lines, ...layerLines]
    }

    // Save lines.
    setUpdatedStateEntity({
      ...updatedStateEntity,
      data: {
        ...updatedStateEntity.data,
        lines: lines
      }
    })
    setPreviewRenderKey(previewRenderKey + 1)
  }

  function handleCancel() {
    onClose(setIsoclineDialogOpen)
    // Reset form fields in case edit button is clicked again.
    // Should be safe to assume stateEntity isn't null here.
    setUpdatedStateEntity(stateEntity as IsoclineEntity)
  }

  function handleAccept() {
    // Trim name.
    const trimmedName = updatedStateEntity.name.trim()
    const newUpdatedStateEntity = {
      ...updatedStateEntity,
      name: trimmedName
    }
    setUpdatedStateEntity(newUpdatedStateEntity)
    // Check whether the name of the edited state entity is unique.
    if (trimmedName !== (stateEntity as StateEntity).name) { // Should be able to assume stateEntity isn't null here.
      const isNameUnique = stateEntities.every((entity: StateEntity) => entity.name !== trimmedName)
      if (!isNameUnique) {
        alert("A state entity with name \"" + trimmedName + "\" already exists.")
        return
      }
    }
    // Check whether the name of the edited state entity is empty.
    if (trimmedName === "") {
      alert("State entity name cannot be empty.")
      return
    }
    if (!onClose(setIsoclineDialogOpen, newUpdatedStateEntity)) {
      alert("Something went wrong; could not update state entity.")
    }
  }

  function handleSetResolution(e: React.ChangeEvent<HTMLInputElement>, index: number) {
    setUpdatedStateEntity({...updatedStateEntity, 
      formParameters: {
        ...updatedStateEntity.formParameters,
        resolutions: [
          ...updatedStateEntity.formParameters.resolutions.slice(0, index),
          Number(e.target.value),
          ...updatedStateEntity.formParameters.resolutions.slice(index + 1)
        ]
      },
      data: {
        ...updatedStateEntity.data,
        stepSizes: [
          ...updatedStateEntity.data.stepSizes.slice(0, index),
          (updatedStateEntity.data.ranges[index][1] - updatedStateEntity.data.ranges[index][0]) / Math.max(1, Number(e.target.value) - 1),
          ...updatedStateEntity.data.stepSizes.slice(index + 1)
        ]
      }
    })
  }

  return updatedStateEntity.type === "Isocline" ? (
    <Dialog open={open}>
      <DialogTitle sx={{ width: textFieldWidth, wordWrap: "break-word" }}>
        Editing isocline "{stateEntity.name}"
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ alignItems: "center" }}>
          <TextField
            label="Name"
            value={updatedStateEntity.name}
            onChange={(e) => setUpdatedStateEntity({ ...updatedStateEntity, name: e.target.value })}
            sx={{ width: textFieldWidth }}
          />
        </Stack>
        <Divider sx={{ my: 2 }} />
        <div style={{ fontWeight: "bold", marginBottom: "16px" }}>Isocline evaluation</div>
        <Stack spacing={2} sx={{ alignItems: "center" }}>
          <Autocomplete
            freeSolo
            disableClearable
            options={equations.map(equation => equation.expression)}
            value={updatedStateEntity.formParameters.expression}
            onChange={(_, newValue) => setUpdatedStateEntity({...updatedStateEntity, formParameters: {
                ...updatedStateEntity.formParameters,
                expression: newValue === null ? "" : newValue
              }})}
            inputValue={updatedStateEntity.formParameters.expression}
            onInputChange={(_, newValue) => setUpdatedStateEntity({...updatedStateEntity, formParameters: {
                ...updatedStateEntity.formParameters,
                expression: newValue === null ? "" : newValue
              }})}
            renderInput={(params) => <TextField {...params} sx={{ width: textFieldWidth }} label="Expression" />}
          />
          <TextField
            label="Value"
            type="number"
            value={updatedStateEntity.formParameters.value}
            onChange={(e) => setUpdatedStateEntity({...updatedStateEntity, formParameters: {
              ...updatedStateEntity.formParameters,
              value: Number(e.target.value)
            }})}
            sx={{ width: textFieldWidth }}
          />
        </Stack>
        <Divider sx={{ my: 2 }} />
        <div style={{ fontWeight: "bold", marginBottom: "16px" }}>Variable ranges</div>
        <Stack spacing={2} sx={{ alignItems: "center" }}>
          {equations.map((equation, index) => (
            <>
              <div style={{ fontStyle: "italic", marginBottom: "8px" }}>{equation.variable}</div>
              {index < 3 ? (<>
                <Box key={index * 3}>
                  <TextField
                    label={equation.variable + " minimum"}
                    type="number"
                    value={updatedStateEntity.data.ranges[index][0]}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUpdatedStateEntity({...updatedStateEntity, data: {
                      ...updatedStateEntity.data,
                      ranges: [
                        ...updatedStateEntity.data.ranges.slice(0, index),
                        [Number(e.target.value), updatedStateEntity.data.ranges[index][1]],
                        ...updatedStateEntity.data.ranges.slice(index + 1)
                      ]
                    }})}
                    sx={{ width: textFieldWidth }}
                  />
                </Box>
                <Box key={index * 3 + 1}>
                  <TextField
                    label={equation.variable + " maximum"}
                    type="number"
                    value={updatedStateEntity.data.ranges[index][1]}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUpdatedStateEntity({...updatedStateEntity, data: {
                      ...updatedStateEntity.data,
                      ranges: [
                        ...updatedStateEntity.data.ranges.slice(0, index),
                        [updatedStateEntity.data.ranges[index][0], Number(e.target.value)],
                        ...updatedStateEntity.data.ranges.slice(index + 1)
                      ]
                    }})}
                    sx={{ width: textFieldWidth }}
                  />
                </Box>
                <Box key={index * 3 + 2}>
                  <TextField
                    label={equation.variable + " resolution"}
                    type="number"
                    value={updatedStateEntity.formParameters.resolutions[index]}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleSetResolution(e, index)}
                    sx={{ width: textFieldWidth }}
                  />
                </Box>
              </>
            ) : (<>
              <Box key={index + 6}>
                <TextField
                  label={equation.variable + " value"}
                  type="number"
                  value={updatedStateEntity.data.ranges[index][0]}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUpdatedStateEntity({...updatedStateEntity, data: {
                    ...updatedStateEntity.data,
                    ranges: [
                      ...updatedStateEntity.data.ranges.slice(0, index),
                      [Number(e.target.value), Number(e.target.value)],
                      ...updatedStateEntity.data.ranges.slice(index + 1)
                    ]
                  }})}
                  sx={{ width: textFieldWidth }}
                />
              </Box>
            </>)}
            </>
          ))}
        </Stack>
        <Divider sx={{ my: 2 }} />
        <div style={{ fontWeight: "bold", marginBottom: "16px" }}>Isocline</div>
        <Stack spacing={2} sx={{ alignItems: "center" }}>
          <Button
            variant="contained"
            onClick={handleCalculate}
            sx={{ width: textFieldWidth }}
          >
            Calculate
          </Button>
        </Stack>
        <Divider sx={{ my: 2 }} />
        <StateSpace key={previewRenderKey} equations={equations} parameters={parameters} stateEntities={
          previewShowAllStateEntities ?
          // Stub in updated data for this state entity for the preview.
          stateEntities.map(entity => 
            entity.name === stateEntity.name ? updatedStateEntity : entity
          ) : [updatedStateEntity]
        } settings={{ ...stateSpaceSettings, realtimeOrbits: previewShowRealtimeOrbits }}/>
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