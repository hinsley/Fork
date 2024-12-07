import { useRef, useState } from 'react'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Radio,
  RadioGroup,
  TextField
} from '@mui/material'

import { Equation } from '../../ODEEditor'
import { StateEntity } from './StateEntitiesMenu'
import { OrbitData } from './EditDialogs/EditOrbitDialog'

interface NewStateEntityDialogProps {
  equations: Equation[]
  open: boolean
  onClose: (newStateEntity?: StateEntity) => boolean
}

export default function NewStateEntityDialog({ equations, open, onClose }: NewStateEntityDialogProps) {
  const [name, setName] = useState("")
  const [type, setType] = useState("")
  const radioGroupRef = useRef<HTMLElement>(null)

  function handleCancel() {
    onClose()
    setName("")
    setType("")
  }

  function handleCreate() {
    var stateEntityData: OrbitData
    switch (type) {
      case "Orbit":
        stateEntityData = {
          initialConditions: equations.map(() => 0),
          integrationTime: 1e3,
          timestep: 1e-2,
          curve: []
        }
        break
      default:
        // This shouldn't ever happen.
        alert("Creating state entities of type \"" + type + "\" is not yet supported.")
        return false
    }
    if (onClose({ name: name, type: type, data: stateEntityData })) {
      setName("")
      setType("")
    }
  }

  return (
    <Dialog open={open}>
      <DialogTitle>Create State Entity</DialogTitle>
      <DialogContent dividers>
        <TextField
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value) }
          sx={{ mb: 2 }}
        />
        <RadioGroup
          ref={radioGroupRef}
          aria-label="type"
          name="type"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <div style={{ fontWeight: "bold", marginBottom: "8px" }}>Entity Type:</div>
          <FormControlLabel value="Orbit" control={<Radio />} label="Orbit" />
          <FormControlLabel value="Equilibrium" control={<Radio />} label="Equilibrium" />
          <FormControlLabel value="Limit cycle" control={<Radio />} label="Limit cycle" />
        </RadioGroup>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleCancel}>Cancel</Button>
        <Button onClick={handleCreate}>Create</Button>
      </DialogActions>
    </Dialog>
  )
}