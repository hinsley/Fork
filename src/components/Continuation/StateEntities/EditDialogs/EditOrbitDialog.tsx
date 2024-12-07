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

import StateSpace from "../../../StateSpace"
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
  open: boolean
  onClose: (setOrbitDialogOpen: Dispatch<SetStateAction<boolean>>, updatedStateEntity?: StateEntity) => boolean
  parameters: Parameter[]
  setOrbitDialogOpen: Dispatch<SetStateAction<boolean>>
  stateEntities: StateEntity[]
  stateEntity: StateEntity | null // The Orbit state entity.
}

export default function EditOrbitDialog({ equations, parameters, setOrbitDialogOpen, open, onClose, stateEntities, stateEntity }: EditOrbitDialogProps) {
  if (stateEntity === null) {
    return null
  }

  const [curve, setCurve] = useState<number[][]>([])
  const [previewRenderKey, setPreviewRenderKey] = useState(0)
  const [previewShowAllStateEntities, setPreviewShowAllStateEntities] = useState(false)
  const [updatedStateEntity, setUpdatedStateEntity] = useState(stateEntity)

  useEffect(() => {
    if (open) {
      // Make sure the stateEntity is always populated with the selected state entity.
      setUpdatedStateEntity(stateEntity)
      // Reset state space preview configuration.
      setPreviewShowAllStateEntities(false)
    }
  }, [open])

  // Handle changes in the number of equations.
  useEffect(() => {
    const oldInitialConditions = updatedStateEntity.data.initialConditions
    if (oldInitialConditions.length < equations.length) {
      // New system is higher dimensional.
      updatedStateEntity.data.initialConditions = [
        ...updatedStateEntity.data.initialConditions,
        ...Array(equations.length - oldInitialConditions.length).fill(0)
      ]
    } else if (oldInitialConditions.length > equations.length) {
      // New system is lower dimensional.
      updatedStateEntity.data.initialConditions = updatedStateEntity.data.initialConditions.slice(0, equations.length)
    }
  }, [equations])

  function handleIntegrate() {
    const curve = integrateOrbitCurve(
      equations,
      parameters,
      updatedStateEntity.data.initialConditions,
      updatedStateEntity.data.integrationTime,
      updatedStateEntity.data.timestep
    )
    setCurve(curve)
    console.log(updatedStateEntity.data.initialConditions)
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
      const isNameUnique = stateEntities.every((entity) => entity.name !== updatedStateEntity.name)
      if (!isNameUnique) {
        alert("A state entity with name \"" + updatedStateEntity.name + "\" already exists.")
        return
      }
    }
    if (!onClose(setOrbitDialogOpen, updatedStateEntity)) {
      alert("Something went wrong; could not update state entity.")
    }
  }

  return (
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
                value={updatedStateEntity.data.initialConditions[index]} // Need to make separate fields for each state variable.
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
        }/>
        <FormControlLabel control={<Checkbox checked={previewShowAllStateEntities} onChange={(e) => setPreviewShowAllStateEntities(e.target.checked)} />} label="Show all state entities" />
        {/* TODO: Add a toggle for points flowing in state space. */}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleCancel}>Cancel</Button>
        <Button onClick={handleAccept}>Accept</Button>
      </DialogActions>
    </Dialog>
  )
}