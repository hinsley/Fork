import { Dispatch, SetStateAction, useEffect, useState } from "react"
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
  Radio,
  RadioGroup,
  Stack,
  TextField
} from "@mui/material"

import { Equation, Parameter } from "../../ODEEditor"
import { ParameterSet } from "./ParameterSetsMenu"
import { EquilibriumEntity } from "../StateEntities/EditDialogs/EditEquilibriumDialog"
import continueEquilibrium, { BifurcationPoint } from "../../../math/continuation/equilibrium/continue_equilibrium"

import BifurcationDiagram from "../../BifurcationDiagram"

export interface EquilibriumParameterSetData {
  continuationCurve: number[][] // In cartesian product of parameter space and state space.
  bifurcationPoints: BifurcationPoint[]
}

export interface EquilibriumParameterSetFormParameters {
  continuationParameterIndex: number | null
  initialStepSize: number
  minimumStepSize: number
  maximumStepSize: number
  stepSizeDecrement: number
  stepSizeIncrement: number
  correctorStepsStepSizeIncrementThreshold: number
  predictorMaxPoints: number
  correctorMaxSteps: number
  eps0: number
  eps1: number
}

export interface EquilibriumParameterSet extends ParameterSet {
  type: "Equilibrium"
  data: EquilibriumParameterSetData
}

interface EditEquilibriumParameterSetDialogProps {
  open: boolean
  onClose: (setEquilibriumParameterSetDialogOpen: Dispatch<SetStateAction<boolean>>, updatedParameterSet?: ParameterSet) => boolean
  setEditEquilibriumParameterSetDialogOpen: Dispatch<SetStateAction<boolean>>
  equations: Equation[]
  parameters: Parameter[]
  parameterSets: ParameterSet[]
  parameterSet: EquilibriumParameterSet | null
}

export default function EditEquilibriumParameterSetDialog({
  open,
  onClose,
  setEditEquilibriumParameterSetDialogOpen,
  equations,
  parameters,
  parameterSets,
  parameterSet
}: EditEquilibriumParameterSetDialogProps) {
  if (parameterSet === null) {
    return <></>
  }

  const textFieldWidth = 230 // Pixel width of text fields.

  const [previewShowAllParameterSets, setPreviewShowAllParameterSets] = useState(false)
  const [updatedParameterSet, setUpdatedParameterSet] = useState<EquilibriumParameterSet>(parameterSet)

  useEffect(() => {
    // Make sure the parameterSet is always populated with the selected parameter set.
    setUpdatedParameterSet(parameterSet)
  }, [open])

  function handleCancel() {
    onClose(setEditEquilibriumParameterSetDialogOpen)
    // Reset form fields in case edit button is clicked again.
    // Should be safe to assume parameterSet isn't null here.
    setUpdatedParameterSet(parameterSet as EquilibriumParameterSet)
  }

  function handleAccept(): boolean {
    // Trim name.
    const trimmedName = updatedParameterSet.name.trim()
    const newUpdatedParameterSet = {
      ...updatedParameterSet,
      name: trimmedName,
      formParameters: {
        ...updatedParameterSet.formParameters,
        continuationParameterIndex: updatedParameterSet.formParameters.continuationParameterIndex
      }
    }
    setUpdatedParameterSet(newUpdatedParameterSet)
    // Check whether the name of the edited parameter set is unique.
    if (trimmedName !== (parameterSet as ParameterSet).name) { // Should be able to assume parameterSet isn't null here.
      const isNameUnique = parameterSets.every((set) => set.name !== trimmedName)
      if (!isNameUnique) {
        alert("A parameter set with name \"" + trimmedName + "\" already exists.")
        return false
      }
    }
    // Check whether the name of the edited parameter set is empty.
    if (trimmedName === "") {
      alert("Parameter set name cannot be empty.")
      return false
    }
    if (!onClose(setEditEquilibriumParameterSetDialogOpen, newUpdatedParameterSet)) {
      alert("Something went wrong; could not update parameter set.")
      return false
    }
    return true
  }

  function handleContinuation(forward: boolean): boolean {
    if (updatedParameterSet.formParameters.continuationParameterIndex === null) {
      alert("You must select a continuation parameter.")
      return false
    }
    const [points, codim1Bifurcations] = continueEquilibrium(
      equations,
      parameters,
      parameters[updatedParameterSet.formParameters.continuationParameterIndex],
      (updatedParameterSet.sourceEntity as EquilibriumEntity).data.point,
      forward,
      updatedParameterSet.formParameters.initialStepSize,
      updatedParameterSet.formParameters.minimumStepSize,
      updatedParameterSet.formParameters.maximumStepSize,
      updatedParameterSet.formParameters.stepSizeDecrement,
      updatedParameterSet.formParameters.stepSizeIncrement,
      updatedParameterSet.formParameters.correctorStepsStepSizeIncrementThreshold,
      updatedParameterSet.formParameters.predictorMaxPoints,
      updatedParameterSet.formParameters.correctorMaxSteps,
      updatedParameterSet.formParameters.eps0,
      updatedParameterSet.formParameters.eps1
    )
    setUpdatedParameterSet({
      ...updatedParameterSet,
      data: {
        continuationCurve: points.map(continuationPoint => [
          ...parameters.slice(
            0,
            updatedParameterSet.formParameters.continuationParameterIndex as number // Can assume index not null.
          ).map(parameter => parameter.value),
          continuationPoint[0],
          ...parameters.slice(
            updatedParameterSet.formParameters.continuationParameterIndex as number + 1 // Can assume index not null.
          ).map(parameter => parameter.value),
          ...continuationPoint.slice(1)
        ]),
        bifurcationPoints: codim1Bifurcations.map(bifurcation => ({
          point: [
            ...parameters.slice(
              0,
              updatedParameterSet.formParameters.continuationParameterIndex as number // Can assume index not null.
            ).map(parameter => parameter.value),
            bifurcation.point[0],
            ...parameters.slice(
              updatedParameterSet.formParameters.continuationParameterIndex as number + 1 // Can assume index not null.
            ).map(parameter => parameter.value),
            ...bifurcation.point.slice(1)
          ],
          type: bifurcation.type
        }))
      }
    })
    return true
  }

  return parameterSet.type === "Equilibrium" ? (
    <Dialog open={open}>
      <DialogTitle sx={{ width: textFieldWidth, wordWrap: "break-word" }}>
        Editing Equilibrium branch "{parameterSet.name}"
      </DialogTitle>
      <DialogContent dividers>
        <TextField
          label="Name"
          value={updatedParameterSet.name}
          onChange={(event) => {
            setUpdatedParameterSet({
              ...updatedParameterSet,
              name: event.target.value
            })
          }}
        />
        <Divider sx={{ my: 2 }} />
        {(updatedParameterSet.sourceEntity as EquilibriumEntity).data.point.some(isNaN) ? (
          <div style={{ width: textFieldWidth }}>Equilibrium point not computed. Please compute one in the state entity editor first.</div>
        ) : (
          <>
            <div style={{ width: textFieldWidth, fontWeight: "bold", marginBottom: "16px" }}>Initial parameters</div>
            <Stack spacing={2} sx={{ alignItems: "center" }}>
              {(updatedParameterSet.sourceEntity as EquilibriumEntity).data.parameters.map((parameter, index) => (
                <Box key={index}>
                  <TextField
                    label={parameter.name}
                    value={parameter.value}
                    InputProps={{ readOnly: true }}
                    sx={{ width: textFieldWidth }}
                  />
                </Box>
              ))}
            </Stack>
            <Divider sx={{ my: 2 }} />
            <div style={{ width: textFieldWidth, fontWeight: "bold", marginBottom: "16px" }}>Continuation parameter</div>
            <RadioGroup
              sx={{ width: textFieldWidth, alignItems: "center" }}
              value={updatedParameterSet.formParameters.continuationParameterIndex ?? ""}
              onChange={(event) => {
                setUpdatedParameterSet({
                  ...updatedParameterSet,
                  formParameters: {
                    ...updatedParameterSet.formParameters,
                    continuationParameterIndex: Number(event.target.value)
                  }
                })
              }}
            >
              {(updatedParameterSet.sourceEntity as EquilibriumEntity).data.parameters.map((parameter, index) => (
                <FormControlLabel
                  key={index}
                  value={index}
                  control={<Radio />}
                  label={parameter.name}
                  checked={updatedParameterSet.formParameters.continuationParameterIndex === index}
                  onChange={() => setUpdatedParameterSet({
                    ...updatedParameterSet,
                    formParameters: {
                      ...updatedParameterSet.formParameters,
                      continuationParameterIndex: index
                    }
                  })}
                />
              ))}
            </RadioGroup>
            <Divider sx={{ my: 2 }} />
            <div style={{ width: textFieldWidth, fontWeight: "bold", marginBottom: "16px" }}>
              Predictor settings
            </div>
            <Stack spacing={2} sx={{ alignItems: "center" }}>
              <TextField
                label="Maximum number of points"
                type="number"
                value={updatedParameterSet.formParameters.predictorMaxPoints}
                onChange={(event) => {
                  setUpdatedParameterSet({
                    ...updatedParameterSet,
                    formParameters: {
                      ...updatedParameterSet.formParameters,
                      predictorMaxPoints: Number(event.target.value)
                    }
                  })
                }}
              />
              <TextField
                label="Initial step size"
                type="number"
                value={updatedParameterSet.formParameters.initialStepSize}
                onChange={(event) => {
                  setUpdatedParameterSet({
                    ...updatedParameterSet,
                    formParameters: {
                      ...updatedParameterSet.formParameters,
                      initialStepSize: Number(event.target.value)
                    }
                  })
                }}
              />
              <TextField
                label="Minimum step size"
                type="number"
                value={updatedParameterSet.formParameters.minimumStepSize}
                onChange={(event) => {
                  setUpdatedParameterSet({
                    ...updatedParameterSet,
                    formParameters: {
                      ...updatedParameterSet.formParameters,
                      minimumStepSize: Number(event.target.value)
                    }
                  })
                }}
              />
              <TextField
                label="Max. step size"
                type="number"
                value={updatedParameterSet.formParameters.maximumStepSize}
                onChange={(event) => {
                  setUpdatedParameterSet({
                    ...updatedParameterSet,
                    formParameters: {
                      ...updatedParameterSet.formParameters,
                      maximumStepSize: Number(event.target.value)
                    }
                  })
                }}
              />
              <TextField
                label="Step size decrement"
                type="number"
                value={updatedParameterSet.formParameters.stepSizeDecrement}
                onChange={(event) => {
                  setUpdatedParameterSet({
                    ...updatedParameterSet,
                    formParameters: {
                      ...updatedParameterSet.formParameters,
                      stepSizeDecrement: Number(event.target.value)
                    }
                  })
                }}
              />
              <TextField
                label="Step size increment"
                type="number"
                value={updatedParameterSet.formParameters.stepSizeIncrement}
                onChange={(event) => {
                  setUpdatedParameterSet({
                    ...updatedParameterSet,
                    formParameters: {
                      ...updatedParameterSet.formParameters,
                      stepSizeIncrement: Number(event.target.value)
                    }
                  })
                }}
              />
            </Stack>
            <Divider sx={{ my: 2 }} />
            <div style={{ width: textFieldWidth, fontWeight: "bold", marginBottom: "16px" }}>
              Corrector settings
            </div>
            <Stack spacing={2} sx={{ alignItems: "center" }}>
              <TextField
                label="Max. corrector steps"
                type="number"
                value={updatedParameterSet.formParameters.correctorMaxSteps}
                onChange={(event) => {
                  setUpdatedParameterSet({
                    ...updatedParameterSet,
                    formParameters: {
                      ...updatedParameterSet.formParameters,
                      correctorMaxSteps: Number(event.target.value)
                    }
                  })
                }}
              />
              <TextField
                label="Speedup threshold steps"
                type="number"
                value={updatedParameterSet.formParameters.correctorStepsStepSizeIncrementThreshold}
                onChange={(event) => {
                  setUpdatedParameterSet({
                    ...updatedParameterSet,
                    formParameters: {
                      ...updatedParameterSet.formParameters,
                      correctorStepsStepSizeIncrementThreshold: Number(event.target.value)
                    }
                  })
                }}
              />
              <TextField
                label="Residual tolerance"
                type="number"
                value={updatedParameterSet.formParameters.eps0}
                onChange={(event) => {
                  setUpdatedParameterSet({
                    ...updatedParameterSet,
                    formParameters: {
                      ...updatedParameterSet.formParameters,
                      eps0: Number(event.target.value)
                    }
                  })
                }}
              />
              <TextField
                label="Search step tolerance"
                type="number"
                value={updatedParameterSet.formParameters.eps1}
                onChange={(event) => {
                  setUpdatedParameterSet({
                    ...updatedParameterSet,
                    formParameters: {
                      ...updatedParameterSet.formParameters,
                      eps1: Number(event.target.value)
                    }
                  })
                }}
              />
            </Stack>
            <Divider sx={{ my: 2 }} />
            <Stack spacing={2} sx={{ alignItems: "center" }}>
              <Button
                fullWidth
                variant="contained"
                color="primary"
                onClick={(_) => handleContinuation(true)}
              >
                Continue forward (+)
              </Button>
              <Button
                fullWidth
                variant="contained"
                color="primary"
                onClick={(_) => handleContinuation(false)}
              >
                Continue backward (-)
              </Button>
            </Stack>
            <Divider sx={{ mt: 2, mb: -6 }} />
            <Box sx={{
              mb: 2,
              width: textFieldWidth,
              overflow: "hidden"
            }}>
              <BifurcationDiagram
                equations={equations}
                parameters={parameters}
                parameterSets={
                  previewShowAllParameterSets ?
                  // Stub in updated parameter set for the preview.
                  parameterSets.map(pS =>
                    pS.name === parameterSet.name ? updatedParameterSet : pS
                  ) : [updatedParameterSet]
                }
              />
            </Box>
            <Box sx={{ mb: 2 }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={previewShowAllParameterSets}
                    onChange={(e) => setPreviewShowAllParameterSets(e.target.checked)}
                  />
                }
                label="Show all parameter sets"
              />
            </Box>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleCancel}>Cancel</Button>
        <Button onClick={handleAccept}>Save</Button>
      </DialogActions>
    </Dialog>
  ) : <></>
}