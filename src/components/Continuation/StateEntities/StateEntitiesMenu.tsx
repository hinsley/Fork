import { Dispatch, MouseEvent, SetStateAction, useState } from 'react'
import { Box, Button, Container, Divider, List, ListItemButton, ListItemText } from '@mui/material'
// import { FixedSizeList, ListChildComponentProps } from 'react-window' // TODO: Work this in so huge lists are handled efficiently. See "virtualized lists" in the MUI docs.

import EditOrbitDialog, { OrbitData } from './EditDialogs/EditOrbitDialog'
import NewStateEntityDialog from './NewStateEntityDialog'
import { Equation, Parameter } from '../../../ODEEditor'

export interface StateEntity {
  name: string
  type: string
  data: OrbitData
}

interface StateEntitiesMenuProps {
  equations: Equation[]
  parameters: Parameter[]
  stateEntities: StateEntity[]
  setStateEntities: (stateEntities: StateEntity[]) => void
}

export default function StateEntitiesMenu({ equations, parameters, stateEntities, setStateEntities }: StateEntitiesMenuProps) {
  const [editOrbitDialogOpen, setEditOrbitDialogOpen] = useState(false)
  const [newStateEntityDialogOpen, setNewStateEntityDialogOpen] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState<number|null>(null)

  function handleDeleteStateEntityButtonClick() {
    if (selectedIndex === null) {
      alert("You must select a state entity to delete.")
      return
    }
    if (confirm("Are you sure you want to delete " + stateEntities[selectedIndex].name + "?")) {
      setStateEntities(stateEntities.filter((_, index) => index !== selectedIndex))
      setSelectedIndex(null)
    }
  }

  function handleEditStateEntityButtonClick(_: MouseEvent) {
    if (selectedIndex === null) {
      alert("You must select a state entity to edit.")
      return
    }

    switch (stateEntities[selectedIndex].type) {
      case "Orbit":
        setEditOrbitDialogOpen(true)
        break
      default:
        alert("Editing state entities of type \"" + stateEntities[selectedIndex].type + "\" is not yet supported.")
        return
    }
  }

  function handleListItemClick(_: MouseEvent, index: number) {
    setSelectedIndex(index)
  }

  function handleNewStateEntityButtonClick() {
    setNewStateEntityDialogOpen(true)
  }

  function handleEditStateEntity(editStateEntityDialogOpen: Dispatch<SetStateAction<boolean>>, updatedStateEntity?: StateEntity) {
    /* Commented out because it should be safe to assume selectedIndex isn't null when this is called.
    if (selectedIndex === null) {
      alert("You must select a state entity to edit.")
      return
    }
    */
  
    editStateEntityDialogOpen(false)

    if (updatedStateEntity) {
      // Update the appropriate state entity, searching by index of selected state entity in the menu.
      setStateEntities(stateEntities.map((entity, index) => index === selectedIndex ? updatedStateEntity : entity))
      return true
    }

    return false
  }

  function handleNewStateEntity(newStateEntity?: StateEntity) {
    if (newStateEntity) {
      // Trim whitespace from beginning and end of name.
      newStateEntity.name = newStateEntity.name.trim()
      // Ensure the name isn't empty.
      if (newStateEntity.name === "") {
        alert("The new state entity's name cannot be empty.")
        return false
      }
      // Ensure the type field isn't empty.
      if (newStateEntity.type === "") {
        alert("You must select a state entity type.")
        return false
      }
      // Make sure the name is unique.
      if (stateEntities.some(entity => entity.name === newStateEntity.name)) {
        alert("A state entity with name \"" + newStateEntity.name + "\" already exists. Please choose a different name.")
        return false
      }
      setStateEntities([newStateEntity, ...stateEntities])
      setSelectedIndex(0)
    }
    setNewStateEntityDialogOpen(false)
    return true
  }

  return <Box sx={{ height: "100%", width: "100%", overflow: "auto", display: "flex", flexDirection: "column", alignItems: "center" }}>
    <Box sx={{ display: "flex", flexDirection: "row", gap: "16px" }}>
      <Button variant="contained" color="primary" onClick={handleNewStateEntityButtonClick}>New</Button>
      <Button variant="contained" color="primary" onClick={handleEditStateEntityButtonClick}>Edit</Button>
      <Button variant="contained" color="primary" onClick={handleDeleteStateEntityButtonClick}>Delete</Button>
    </Box>
    <Box sx={{ width: "480px", height: "100%", pt: "0" }}>
      <List component="nav" >
        {stateEntities.map((entity, index) => (
          <Container key={index}>
            <ListItemButton
              selected={selectedIndex === index}
              onClick={(e) => handleListItemClick(e, index)}
            >
              <ListItemText primary={entity.name} secondary={entity.type} />
            </ListItemButton>
            {index < stateEntities.length - 1 && <Divider />}
          </Container>
        ))}
        <EditOrbitDialog
          equations={equations}
          open={editOrbitDialogOpen}
          onClose={handleEditStateEntity}
          parameters={parameters}
          setOrbitDialogOpen={setEditOrbitDialogOpen}
          stateEntities={stateEntities}
          stateEntity={selectedIndex !== null ? stateEntities[selectedIndex] : null}
        />
        <NewStateEntityDialog
          equations={equations}
          open={newStateEntityDialogOpen}
          onClose={handleNewStateEntity}
        />
      </List>
    </Box>
  </Box>
}