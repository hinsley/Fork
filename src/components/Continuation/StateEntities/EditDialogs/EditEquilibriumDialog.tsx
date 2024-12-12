import { Dispatch, SetStateAction, useEffect, useState } from 'react'
import Plot from 'react-plotly.js'
import { Complex3, isComplex } from 'mathjs'
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

import equilibriumEigenpairs from "../../../../math/stateentitycalculation/equilibrium_eigenpairs"
import solveEquilibrium from "../../../../math/stateentitycalculation/solve_equilibrium"

export interface EquilibriumData {
  point: number[]
  eigenvalues: number[] | Complex3[]
  eigenvectors: number[][] | Complex3[][]
}

export interface EquilibriumFormParameters {
  initialGuess: number[]
  maxSteps: number
  dampingFactor: number
}

export interface EquilibriumEntity extends StateEntity {
  data: EquilibriumData
  formParameters: EquilibriumFormParameters
}

interface EditEquilibriumDialogProps {
  equations: Equation[]
  parameters: Parameter[]
  open: boolean
  onClose: (setEquilibriumDialogOpen: Dispatch<SetStateAction<boolean>>, updatedStateEntity?: StateEntity) => boolean
  setEquilibriumDialogOpen: Dispatch<SetStateAction<boolean>>
  stateEntities: StateEntity[]
  stateEntity: EquilibriumEntity | null // The Equilibrium state entity.
}

export default function EditEquilibriumDialog({ equations, parameters, setEquilibriumDialogOpen, open, onClose, stateEntities, stateEntity }: EditEquilibriumDialogProps) {
  if (stateEntity === null) {
    return null
  }

  const textFieldWidth = 230 // Pixel width of text fields.

  const [previewRenderKey, setPreviewRenderKey] = useState(0)
  const [previewShowAllStateEntities, setPreviewShowAllStateEntities] = useState(false)
  const [previewShowRealtimeOrbits, setPreviewShowRealtimeOrbits] = useState(false)
  const [updatedStateEntity, setUpdatedStateEntity] = useState<EquilibriumEntity>(stateEntity)

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

  function handleSolveEquilibrium() {
    const newPoint = solveEquilibrium(
      equations,
      parameters,
      updatedStateEntity.formParameters.initialGuess,
      updatedStateEntity.formParameters.maxSteps,
      updatedStateEntity.formParameters.dampingFactor
    )
    updatedStateEntity.data.point = newPoint
    setPreviewRenderKey(previewRenderKey + 1)

    if (newPoint.some(isNaN)) {
      updatedStateEntity.data.eigenvalues = equations.map(() => NaN)
      updatedStateEntity.data.eigenvectors = equations.map(() => equations.map(() => NaN))
      alert("Equilibrium solver failed to converge. Try a different initial guess, increase maximum steps, or decrease damping factor.")
      return
    } else {
      try {
        const [eigenvalues, eigenvectors] = equilibriumEigenpairs(equations, parameters, newPoint)
        updatedStateEntity.data.eigenvalues = eigenvalues
        updatedStateEntity.data.eigenvectors = eigenvectors
      } catch (error) {
        alert((error as Error).message)
        return
      }
    }
  }

  function handleCancel() {
    onClose(setEquilibriumDialogOpen)
    // Reset form fields in case edit button is clicked again.
    // Should be safe to assume stateEntity isn't null here.
    setUpdatedStateEntity(stateEntity as EquilibriumEntity)
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
        <Stack spacing={2} sx={{ alignItems: "center" }}>
          <TextField
            label="Name"
            value={updatedStateEntity.name}
            onChange={(e) => setUpdatedStateEntity({ ...updatedStateEntity, name: e.target.value })}
            sx={{ width: textFieldWidth }}
          />
        </Stack>
        <Divider sx={{ my: 2 }} />
        <div style={{ fontWeight: "bold", marginBottom: "16px" }}>Initial guess</div>
        <Stack spacing={2} sx={{ alignItems: "center" }}>
          {equations.map((equation, index) => (
            <Box key={index}>
              <TextField
                label={equation.variable}
                type="number"
                value={updatedStateEntity.formParameters.initialGuess[index]}
                onChange={(e) => setUpdatedStateEntity({ ...updatedStateEntity, formParameters: {
                  ...updatedStateEntity.formParameters,
                  initialGuess: [
                    ...updatedStateEntity.formParameters.initialGuess.slice(0, index),
                    Number(e.target.value),
                    ...updatedStateEntity.formParameters.initialGuess.slice(index + 1)
                  ]
                }})}
                sx={{ width: textFieldWidth }}
              />
            </Box>
          ))}
        </Stack>
        <Divider sx={{ my: 2 }} />
        <div style={{ fontWeight: "bold", marginBottom: "16px" }}>Iteration settings</div>
        <Stack spacing={2} sx={{ alignItems: "center" }}>
          <TextField
            label="Maximum steps"
            type="number"
            value={updatedStateEntity.formParameters.maxSteps}
            onChange={(e) => setUpdatedStateEntity({ ...updatedStateEntity, formParameters: {
              ...updatedStateEntity.formParameters,
              maxSteps: Number(e.target.value)
            }})}
            sx={{ width: textFieldWidth }}
          />
          <TextField
            label="Damping factor"
            type="number"
            value={updatedStateEntity.formParameters.dampingFactor}
            onChange={(e) => setUpdatedStateEntity({ ...updatedStateEntity, formParameters: {
              ...updatedStateEntity.formParameters,
              dampingFactor: Number(e.target.value)
            }})}
            sx={{ width: textFieldWidth }}
          />
        </Stack>
        <Divider sx={{ my: 2 }} />
        <div style={{ fontWeight: "bold", marginBottom: "16px" }}>Point</div>
        <Stack spacing={2} sx={{ mb: 2, alignItems: "center" }}>
          {equations.map((equation, index) => (
            <TextField
              label={equation.variable}
              value={isNaN(updatedStateEntity.data.point[index]) ? "NaN" : updatedStateEntity.data.point[index]}
              key={index}
              InputProps={{ readOnly: true }}
              sx={{ width: textFieldWidth }}
            />
          ))}
          <Button
            variant="contained"
            onClick={handleSolveEquilibrium}
            sx={{ width: textFieldWidth }}
          >
            Solve
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
        <Divider sx={{ my: 2 }} />
        <div style={{ fontWeight: "bold", marginBottom: "16px" }}>Eigenvalues</div>
        <Plot
          data={[
            {
              x: updatedStateEntity.data.eigenvalues.map((eigenvalue: number | Complex3) => isComplex(eigenvalue) ? eigenvalue.re : eigenvalue),
              y: updatedStateEntity.data.eigenvalues.map((eigenvalue: number | Complex3) => isComplex(eigenvalue) ? eigenvalue.im : 0),
              mode: "markers",
              type: "scatter"
            }
          ]}
          layout={{
            title: "Eigenvalues",
            width: 300,
            height: 300,
            xaxis: { title: "Real part" },
            yaxis: { title: "Imaginary part" },
          }}
        />
        <Stack spacing={2} sx={{ alignItems: "center" }}>
          {updatedStateEntity.data.eigenvalues.map((eigenvalue: number | Complex3, index: number) => (
            <TextField
              label={`Eigenvalue ${index + 1}`}
              value={isNaN(eigenvalue) && !isComplex(eigenvalue) ? "NaN" : eigenvalue.toString()}
              key={index}
              InputProps={{ readOnly: true }}
              sx={{ width: textFieldWidth }}
            />
          ))}
        </Stack>
        <Divider sx={{ my: 2 }} />
        <div style={{ fontWeight: "bold", marginBottom: "16px" }}>Eigenvectors</div>
        <Stack spacing={2} sx={{ alignItems: "center" }}>
          {updatedStateEntity.data.eigenvectors.map((eigenvector: number[] | Complex3[], index: number) => (
            <TextField
              label={`Eigenvector ${index + 1}`}
              value={"[" + eigenvector.map((value: number | Complex3) => value.toString()).join(", ") + "]"}
              key={index}
              InputProps={{ readOnly: true }}
              sx={{ width: textFieldWidth }}
            />
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleCancel}>Cancel</Button>
        <Button onClick={handleAccept}>Save</Button>
      </DialogActions>
    </Dialog>
  ) : (<></>)
}