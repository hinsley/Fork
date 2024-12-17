import { Dispatch, MouseEvent, SetStateAction, useState } from "react"
import { Box, Button, List, ListItemButton, ListItemText } from "@mui/material"
// import { FixedSizeList, ListChildComponentProps } from "react-window" // TODO: Work this in so huge lists are handled efficiently. See "virtualized lists" in the MUI docs.

import EditEquilibriumParameterSetDialog, {
  EquilibriumParameterSet,
  EquilibriumParameterSetData,
  EquilibriumParameterSetFormParameters
} from "./EditEquilibriumParameterSetDialog"
import { Equation, Parameter } from "../../ODEEditor"
import { StateEntity } from "../StateEntities/StateEntitiesMenu"
import NewParameterSetDialog from "./NewParameterSetDialog"

export interface ParameterSet {
  data: EquilibriumParameterSetData,
  formParameters: EquilibriumParameterSetFormParameters,
  name: string,
  sourceEntity: StateEntity,
  type: string
}

interface ParameterSetsMenuProps {
  equations: Equation[]
  parameters: Parameter[]
  parameterSets: ParameterSet[]
  setParameterSets: (parameterSets: ParameterSet[]) => void
  stateEntities: StateEntity[]
}

export default function ParameterSetsMenu({ equations, parameters, parameterSets, setParameterSets, stateEntities }: ParameterSetsMenuProps) {
  const [editEquilibriumParameterSetDialogOpen, setEditEquilibriumParameterSetDialogOpen] = useState(false)
  const [newParameterSetDialogOpen, setNewParameterSetDialogOpen] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState<number|null>(null)

  function handleDeleteParameterSetButtonClick() {
    if (selectedIndex === null) {
      alert("You must select a parameter set to delete.")
      return
    }
    if (confirm("Are you sure you want to delete \"" + parameterSets[selectedIndex].name + "\"?")) {
      // Delete the parameter set.
      setParameterSets([
        ...parameterSets.slice(0, selectedIndex),
        ...parameterSets.slice(selectedIndex + 1)
      ])
      // Deselect the parameter set.
      setSelectedIndex(null)
    }
  }

  function handleDuplicateParameterSetButtonClick() {
    if (selectedIndex === null) {
      alert("You must select a parameter set to duplicate.")
      return
    }
    const newParameterSet = { ...parameterSets[selectedIndex] }

    // Generate a unique name by adding (copy N) where N increments
    // until unique.
    let baseName = newParameterSet.name
    let copyNum = 2
    let newName = baseName + " (copy)"

    while (parameterSets.some(set => set.name === newName)) {
      newName = baseName + ` (copy ${copyNum})`
      copyNum++
    }

    newParameterSet.name = newName

    // Add the new parameter set to the list.
    setParameterSets([newParameterSet, ...parameterSets])
    // Select the new parameter set.
    setSelectedIndex(0)
  }

  function handleEditParameterSet(
    editParameterSetDialogOpen: Dispatch<SetStateAction<boolean>>,
    updatedParameterSet: ParameterSet
  ): boolean {
    editParameterSetDialogOpen(false)

    if (updatedParameterSet) {
      // Update the appropriate parameter set, searching by index of selectedIndex.
      setParameterSets([
        ...parameterSets.slice(0, selectedIndex as number),
        updatedParameterSet,
        ...parameterSets.slice(selectedIndex as number + 1)
      ])
      return true
    }

    return false
  }

  function handleEditParameterSetButtonClick(): boolean {
    if (selectedIndex === null) {
      alert("You must select a parameter set to edit.")
      return false
    }

    switch (parameterSets[selectedIndex].type) {
      case "Equilibrium":
        setEditEquilibriumParameterSetDialogOpen(true)
        return true
      default:
        alert("Editing parameter sets of type \"" + parameterSets[selectedIndex].type + "\" is not yet supported.")
        return false
    }
  }

  function handleListItemClick(_: MouseEvent, index: number) {
    setSelectedIndex(index)
  }

  function handleNewParameterSetButtonClick() {
    setNewParameterSetDialogOpen(true)
  }

  function handleNewParameterSet(newParameterSet?: ParameterSet): boolean {
    if (newParameterSet) {
      // Trim whitespace from beginning and end of name.
      newParameterSet.name = newParameterSet.name.trim()
      // Ensure the name isn't empty.
      if (newParameterSet.name === "") {
        alert("The new parameter set's name cannot be empty.")
        return false
      }
      // Ensure the type field isn't empty.
      if (newParameterSet.type === "") {
        alert("You must select a parameter set type.")
        return false
      }
      // Make sure the name is unique.
      if (parameterSets.some(parameterSet => parameterSet.name === newParameterSet.name)) {
        alert("A parameter set with name \"" + newParameterSet.name + "\" already exists. Please choose a different name.")
        return false
      }
      // Add the new parameter set to the list.
      setParameterSets([newParameterSet, ...parameterSets])
      // Select the new parameter set.
      setSelectedIndex(0)
    }
    setNewParameterSetDialogOpen(false)
    return true
  }

  return <Box sx={{ height: "100%", width: "100%", overflow: "auto", display: "flex", flexDirection: "column", alignItems: "center" }}>
    <Box sx={{ display: "flex", flexDirection: "row", gap: "16px" }}>
      <Button variant="contained" color="primary" onClick={handleNewParameterSetButtonClick}>New Branch</Button>
      <Button variant="contained" color="primary" onClick={handleEditParameterSetButtonClick}>Edit</Button>
      <Button variant="contained" color="primary" onClick={handleDuplicateParameterSetButtonClick}>Duplicate</Button>
      <Button variant="contained" color="primary" onClick={handleDeleteParameterSetButtonClick}>Delete</Button>
    </Box>
    <Box sx={{ width: "480px", maxWidth: "100%", height: "100%", pt: "0" }}>
      <List>
        {parameterSets.map((parameterSet, index) => (
          <ListItemButton
            key={index}
            selected={selectedIndex === index}
            onClick={(e) => handleListItemClick(e, index)}
          >
            <ListItemText
              primary={parameterSet.name}
              secondary={"(" + parameterSet.type + ") " + parameterSet.sourceEntity.name}
            />
          </ListItemButton>
        ))}
      </List>
      <EditEquilibriumParameterSetDialog
        equations={equations}
        parameters={parameters}
        open={editEquilibriumParameterSetDialogOpen}
        onClose={handleEditParameterSet}
        setEditEquilibriumParameterSetDialogOpen={setEditEquilibriumParameterSetDialogOpen}
        parameterSet={selectedIndex !== null ? parameterSets[selectedIndex] as EquilibriumParameterSet : null}
        parameterSets={parameterSets}
      />
      <NewParameterSetDialog
        parameters={parameters}
        parameterSets={parameterSets}
        stateEntities={stateEntities}
        open={newParameterSetDialogOpen}
        onClose={handleNewParameterSet}
      />
    </Box>
  </Box>
}