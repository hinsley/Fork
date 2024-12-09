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

import solveEquilibrium from "../../../../math/stateentitycalculation/solve_equilibrium"

export interface EquilibriumData {
  initialGuess: number[]
  maxSteps: number
  dampingFactor: number
  point: number[]
}

export interface EquilibriumEntity extends StateEntity {
  data: EquilibriumData
}

interface EditEquilibriumDialogProps {
  equations: Equation[]
  open: boolean
  onClose: (setEquilibriumDialogOpen: Dispatch<SetStateAction<boolean>>, updatedStateEntity?: StateEntity) => boolean
  parameters: Parameter[]
  setEquilibriumDialogOpen: Dispatch<SetStateAction<boolean>>
  stateEntities: StateEntity[]
  stateEntity: EquilibriumEntity | null // The Equilibrium state entity.
}

export default function EditEquilibriumDialog({ equations, parameters, setEquilibriumDialogOpen, open, onClose, stateEntities, stateEntity }: EditEquilibriumDialogProps) {
  if (stateEntity === null) {
    return null
  }

  const [point, setPoint] = useState(stateEntity.data.point)
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

  useEffect(() => {
    // Update the preview when the state space preview settings are changed.
    setPreviewRenderKey(previewRenderKey + 1)
  }, [previewShowAllStateEntities])

  function handleSolveEquilibrium() {
    console.log("equations:", equations)
    console.log("parameters:", parameters)
    console.log("initial guess:", updatedStateEntity.data.initialGuess)
    console.log("max steps:", updatedStateEntity.data.maxSteps)
    console.log("damping factor:", updatedStateEntity.data.dampingFactor)
    const newPoint = solveEquilibrium(
      equations,
      parameters,
      updatedStateEntity.data.initialGuess,
      updatedStateEntity.data.maxSteps,
      updatedStateEntity.data.dampingFactor
    )
    setPoint(newPoint)
    if (newPoint.some(isNaN)) {
      alert("Equilibrium solver failed to converge. Try a different initial guess, increase maximum steps, or decrease damping factor.")
      return
    }
    updatedStateEntity.data.point = newPoint
    setPreviewRenderKey(previewRenderKey + 1)
  }

  function handleCancel() {
    onClose(setEquilibriumDialogOpen)
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
    if (!onClose(setEquilibriumDialogOpen, updatedStateEntity)) {
      alert("Something went wrong; could not update state entity.")
    }
  }

  return updatedStateEntity.type === "Equilibrium" ? (
    <Dialog open={open}>
      <DialogTitle>Editing equilibrium "{stateEntity.name}"</DialogTitle>
      <DialogContent dividers>
        <Box>
          <TextField
            label="Name"
            value={updatedStateEntity.name}
            onChange={(e) => setUpdatedStateEntity({ ...updatedStateEntity, name: e.target.value })}
          />
        </Box>
        <Divider sx={{ my: 2 }} />
        <div style={{ fontWeight: "bold", marginBottom: "16px" }}>Initial guess</div>
        <Stack spacing={2}>
          {equations.map((equation, index) => (
            <Box key={index}>
              <TextField
                label={equation.variable}
                type="number"
                value={updatedStateEntity.data.initialGuess[index]}
                onChange={(e) => setUpdatedStateEntity({ ...updatedStateEntity, data: {
                  ...updatedStateEntity.data,
                  initialGuess: [
                    ...updatedStateEntity.data.initialGuess.slice(0, index),
                    Number(e.target.value),
                    ...updatedStateEntity.data.initialGuess.slice(index + 1)
                  ]
                }})}
              />
            </Box>
          ))}
        </Stack>
        <Divider sx={{ my: 2 }} />
        <div style={{ fontWeight: "bold", marginBottom: "16px" }}>Iteration settings</div>
        <Box>
          <TextField
            label="Maximum steps"
            type="number"
            value={updatedStateEntity.data.maxSteps}
            onChange={(e) => setUpdatedStateEntity({ ...updatedStateEntity, data: {
              ...updatedStateEntity.data,
              maxSteps: Number(e.target.value)
            }})}
            sx={{ mb: 2 }}
          />
        </Box>
        <Box>
          <TextField
            label="Damping factor"
            type="number"
            value={updatedStateEntity.data.dampingFactor}
            onChange={(e) => setUpdatedStateEntity({ ...updatedStateEntity, data: {
              ...updatedStateEntity.data,
              dampingFactor: Number(e.target.value)
            }})}
            sx={{ mb: 2 }}
          />
        </Box>
        <Divider sx={{ my: 2 }} />
        <div style={{ fontWeight: "bold", marginBottom: "16px" }}>Point</div>
        <Stack spacing={2} sx={{ mb: 2 }}>
          {equations.map((equation, index) => (
            <TextField
              label={equation.variable}
              type="number"
              value={isNaN(point[index]) ? "NaN" : point[index]}
              key={index}
            />
          ))}
        </Stack>
        <Button
          variant="contained"
          fullWidth
          onClick={handleSolveEquilibrium}
        >
          Solve
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
  ) : (<></>)
}