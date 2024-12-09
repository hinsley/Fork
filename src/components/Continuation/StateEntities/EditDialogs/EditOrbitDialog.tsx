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
  initialConditions: number[]
  integrationTime: number
  timestep: number
  curve: number[][]
}

export interface OrbitEntity extends StateEntity {
  data: OrbitData
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
      updatedStateEntity.data.initialConditions,
      updatedStateEntity.data.integrationTime,
      updatedStateEntity.data.timestep
    )
    updatedStateEntity.data.curve = curve
    setPreviewRenderKey(previewRenderKey + 1)
  }

  function handleCancel() {
    onClose(setOrbitDialogOpen)
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
    if (!onClose(setOrbitDialogOpen, updatedStateEntity)) {
      alert("Something went wrong; could not update state entity.")
    }
  }

  return updatedStateEntity.type === "Orbit" ? (
    <Dialog open={open}>
      <DialogTitle>Editing orbit "{stateEntity.name}"</DialogTitle>
      <DialogContent dividers>
        <Box>
          <TextField
            label="Name"
            value={updatedStateEntity.name}
            onChange={(e) => setUpdatedStateEntity({ ...updatedStateEntity, name: e.target.value })}
          />
        </Box>
        <Divider sx={{ my: 2 }} />
        <div style={{ fontWeight: "bold", marginBottom: "16px" }}>Initial conditions</div>
        <Stack spacing={2}>
          {equations.map((equation, index) => (
            <Box key={index}>
              <TextField
                label={equation.variable}
                type="number"
                value={updatedStateEntity.data.initialConditions[index]}
                onChange={(e) => setUpdatedStateEntity({ ...updatedStateEntity, data: {
                ...updatedStateEntity.data,
                initialConditions: [
                  ...updatedStateEntity.data.initialConditions.slice(0, index),
                  Number(e.target.value),
                  ...updatedStateEntity.data.initialConditions.slice(index + 1)
                ]
                }})}
              />
            </Box>
          ))}
        </Stack>
        <Divider sx={{ my: 2 }} />
        <div style={{ fontWeight: "bold", marginBottom: "16px" }}>Integration settings</div>
        <Box>
          <TextField
            label="Integration time"
            type="number"
            value={updatedStateEntity.data.integrationTime}
            onChange={(e) => setUpdatedStateEntity({ ...updatedStateEntity, data: {
              ...updatedStateEntity.data,
              integrationTime: Number(e.target.value)
            }})}
            sx={{ mb: 2 }}
          />
        </Box>
        <Box>
          <TextField
            label="Timestep"
            type="number"
            value={updatedStateEntity.data.timestep}
            onChange={(e) => setUpdatedStateEntity({ ...updatedStateEntity, data: {
              ...updatedStateEntity.data,
              timestep: Number(e.target.value)
            }})}
            sx={{ mb: 2 }}
          />
        </Box>
        <Divider sx={{ my: 2 }} />
        <div style={{ fontWeight: "bold", marginBottom: "16px" }}>Curve</div>
        <Button
          variant="contained"
          fullWidth
          onClick={handleIntegrate}
        >
          Integrate
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