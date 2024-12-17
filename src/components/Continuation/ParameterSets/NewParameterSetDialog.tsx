import { useState } from "react"
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  List,
  ListItemButton,
  ListItemText,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField
} from "@mui/material"

import { Parameter } from "../../ODEEditor"
import { ParameterSet } from "./ParameterSetsMenu"
import { StateEntity } from "../StateEntities/StateEntitiesMenu"
import {
  EquilibriumParameterSetData,
  EquilibriumParameterSetFormParameters
} from "./EditEquilibriumParameterSetDialog"

interface NewParameterSetDialogProps {
  parameters: Parameter[]
  parameterSets: ParameterSet[]
  stateEntities: StateEntity[]
  open: boolean
  onClose: (newParameterSet?: ParameterSet) => boolean
}

export default function NewParameterSetDialog({ parameters, parameterSets, stateEntities, open, onClose }: NewParameterSetDialogProps) {
  const [name, setName] = useState("")
  const [type, setType] = useState("")
  const [selectedStateEntityIndex, setSelectedStateEntityIndex] = useState<number | null>(null)

  function handleCancel() {
    setName("")
    setType("")
    setSelectedStateEntityIndex(null)
    onClose()
  }

  function handleCreate() {
    // Ensure a source entity is selected.
    if (selectedStateEntityIndex === null) {
      alert("You must select a source entity.")
      return false
    }
    // Handle each type of parameter set.
    let data: EquilibriumParameterSetData
    let formParameters: EquilibriumParameterSetFormParameters
    switch (type) {
      case "Equilibrium":
        data = {
          continuationCurve: []
        }
        formParameters = {
          continuationParameterIndex: null,
          initialStepSize: 1e-2,
          minimumStepSize: 1e-5,
          maximumStepSize: 3e-2,
          stepSizeDecrement: 0.8,
          stepSizeIncrement: 1.2,
          correctorStepsStepSizeIncrementThreshold: 3,
          predictorMaxPoints: 1e2,
          correctorMaxSteps: 5,
          eps0: 1e-6,
          eps1: 1e-6
        }
        break
      default:
        // This shouldn't ever happen.
        alert("Creating parameter sets of type \"" + type + "\" is not yet supported.")
        return false
    }
    // Create the new parameter set.
    const newParameterSet: ParameterSet = {
      name: name,
      type: type,
      data: data,
      formParameters: formParameters,
      sourceEntity: stateEntities[selectedStateEntityIndex as number] // Can assume not null here.
    }
    // Validate the new parameter set and close the dialog if successful.
    if (onClose(newParameterSet)) {
      setName("")
      setType("")
      setSelectedStateEntityIndex(null)
    }
  }

  return <Dialog open={open}>
    <DialogTitle>Create New Branch</DialogTitle>
    <DialogContent dividers>
      <Stack spacing={2} sx={{ alignItems: "center" }}>
        <TextField
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          sx={{ mb: 2 }}
        />
      </Stack>
      <Divider sx={{ my: 2 }} />
      <Stack spacing={2} sx={{ alignItems: "center" }}>
        <FormControl fullWidth>
          <InputLabel>Branch Type</InputLabel>
          <Select
            label="Branch Type"
            value={type}
            onChange={(e) => {
              setType(e.target.value)
              // Make sure the user doesn't select a state entity then
              // change the type before submitting the dialog form.
              setSelectedStateEntityIndex(null)
            }}
          >
            <MenuItem value="Equilibrium">Equilibrium</MenuItem>
          </Select>
        </FormControl>
      </Stack>
      {type === "Equilibrium" && (
        <>
          <div style={{ fontWeight: "bold", marginBottom: "8px", marginTop: "16px" }}>Select an equilibrium point:</div>
          <List component="nav">
            {
              stateEntities
                .map((entity, index) => 
                  entity.type === "Equilibrium" ? (
                    <ListItemButton
                      key={index}
                      selected={selectedStateEntityIndex === index}
                      onClick={() => setSelectedStateEntityIndex(index)}
                    >
                      <ListItemText primary={entity.name} />
                    </ListItemButton>
                  ) : <></>
                )
            }
          </List>
        </>
      )}
    </DialogContent>
    <DialogActions>
      <Button onClick={handleCancel}>Cancel</Button>
      <Button onClick={handleCreate}>Create</Button>
    </DialogActions>
  </Dialog>
}