import { Dispatch, SetStateAction, useEffect, useState } from 'react'
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
} from '@mui/material'

import StateSpace, { defaultStateSpaceSettings } from "../../../StateSpace"
import { Equation, Parameter } from "../../../ODEEditor"
import { StateEntity } from "../StateEntitiesMenu"

import integrateOrbitCurve from "../../../../math/stateentitycalculation/integrate_orbit_curve"

export interface OrbitData {
  curve: number[][]
}

export interface OrbitFormParameters {
  initialConditions: number[]
  integrationTime: number
  timestep: number
}

export interface OrbitEntity extends StateEntity {
  data: OrbitData
  formParameters: OrbitFormParameters
}

interface EditOrbitDialogProps {
  equations: Equation[]
  parameters: Parameter[]
  open: boolean
  onClose: (setOrbitDialogOpen: Dispatch<SetStateAction<boolean>>, updatedStateEntity?: StateEntity) => boolean
  setOrbitDialogOpen: Dispatch<SetStateAction<boolean>>
  stateEntities: StateEntity[]
  stateEntity: OrbitEntity | null // The Orbit state entity.
}

export default function EditOrbitDialog({ equations, parameters, setOrbitDialogOpen, open, onClose, stateEntities, stateEntity }: EditOrbitDialogProps) {
  if (stateEntity === null) {
    return null
  }

  const textFieldWidth = 230 // Pixel width of text fields.

  const [previewRenderKey, setPreviewRenderKey] = useState(0)
  const [previewShowAllStateEntities, setPreviewShowAllStateEntities] = useState(false)
  const [previewShowRealtimeOrbits, setPreviewShowRealtimeOrbits] = useState(false)
  const [updatedStateEntity, setUpdatedStateEntity] = useState(stateEntity)

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

  function handleIntegrate() {
    const curve = integrateOrbitCurve(
      equations,
      parameters,
      updatedStateEntity.formParameters.initialConditions,
      updatedStateEntity.formParameters.integrationTime,
      updatedStateEntity.formParameters.timestep
    )
    updatedStateEntity.data.curve = curve
    setPreviewRenderKey(previewRenderKey + 1)
  }

  function handleCancel() {
    onClose(setOrbitDialogOpen)
    // Reset form fields in case edit button is clicked again.
    // Should be safe to assume stateEntity isn't null here.
    setUpdatedStateEntity(stateEntity as OrbitEntity)
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
    if (!onClose(setOrbitDialogOpen, newUpdatedStateEntity)) {
      alert("Something went wrong; could not update state entity.")
    }
  }

  return updatedStateEntity.type === "Orbit" ? (
    <Dialog open={open}>
      <DialogTitle sx={{ width: textFieldWidth, wordWrap: "break-word" }}>
        Editing orbit "{stateEntity.name}"
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
        <div style={{ fontWeight: "bold", marginBottom: "16px" }}>Initial conditions</div>
        <Stack spacing={2} sx={{ alignItems: "center" }}>
          {equations.map((equation, index) => (
            <Box key={index}>
              <TextField
                label={equation.variable}
                type="number"
                value={updatedStateEntity.formParameters.initialConditions[index]}
                onChange={(e) => setUpdatedStateEntity({ ...updatedStateEntity, formParameters: {
                ...updatedStateEntity.formParameters,
                initialConditions: [
                  ...updatedStateEntity.formParameters.initialConditions.slice(0, index),
                  Number(e.target.value),
                  ...updatedStateEntity.formParameters.initialConditions.slice(index + 1)
                ]
                }})}
                sx={{ width: textFieldWidth }}
              />
            </Box>
          ))}
        </Stack>
        <Divider sx={{ my: 2 }} />
        <div style={{ fontWeight: "bold", marginBottom: "16px" }}>Integration settings</div>
        <Stack spacing={2} sx={{ alignItems: "center" }}>
          <TextField
            label="Integration time"
            type="number"
            value={updatedStateEntity.formParameters.integrationTime}
            onChange={(e) => setUpdatedStateEntity({ ...updatedStateEntity, formParameters: {
              ...updatedStateEntity.formParameters,
              integrationTime: Number(e.target.value)
            }})}
            sx={{ width: textFieldWidth }}
          />
          <TextField
            label="Timestep"
            type="number"
            value={updatedStateEntity.formParameters.timestep}
            onChange={(e) => setUpdatedStateEntity({ ...updatedStateEntity, formParameters: {
              ...updatedStateEntity.formParameters,
              timestep: Number(e.target.value)
            }})}
            sx={{ width: textFieldWidth }}
          />
        </Stack>
        <Divider sx={{ my: 2 }} />
        <div style={{ fontWeight: "bold", marginBottom: "16px" }}>Curve</div>
        <Stack spacing={2} sx={{ alignItems: "center" }}>
          <Button
            variant="contained"
            onClick={handleIntegrate}
            sx={{ width: textFieldWidth }}
          >
            Integrate
          </Button>
        </Stack>
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
            control={<Checkbox checked={previewShowAllStateEntities} onChange={(e) => setPreviewShowAllStateEntities(e.target.checked)} />}
            label="Show all state entities"
          />
        </Box>
        <Box>
          <FormControlLabel
            control={<Checkbox checked={previewShowRealtimeOrbits} onChange={(e) => setPreviewShowRealtimeOrbits(e.target.checked)} />}
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