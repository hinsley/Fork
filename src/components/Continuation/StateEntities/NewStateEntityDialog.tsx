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
import { EquilibriumData, EquilibriumFormParameters } from './EditDialogs/EditEquilibriumDialog'
import { IsoclineData, IsoclineFormParameters } from './EditDialogs/EditIsoclineDialog'
import { OrbitData, OrbitFormParameters } from './EditDialogs/EditOrbitDialog'

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
    let stateEntityData: EquilibriumData | IsoclineData | OrbitData
    let stateEntityFormParameters: EquilibriumFormParameters | IsoclineFormParameters | OrbitFormParameters
    switch (type) {
      case "Equilibrium":
        stateEntityData = {
          point: equations.map(() => NaN),
          eigenvalues: equations.map(() => NaN),
          eigenvectors: equations.map(() => equations.map(() => NaN))
        }
        stateEntityFormParameters = {
          initialGuess: equations.map(() => 0),
          maxSteps: 1e2,
          dampingFactor: 1
        }
        break
      case "Isocline":
        stateEntityData = {
          lines: [],
          ranges: equations.map(() => [-30, 30]),
          stepSizes: equations.map(() => (30 - (-30)) / (100 - 1))
        }
        stateEntityFormParameters = {
          expression: equations.length > 0 ? equations[0].expression : "",
          value: 0,
          resolutions: equations.map(() => 100)
        }
        break
      case "Orbit":
        stateEntityData = {
          curve: []
        }
        stateEntityFormParameters = {
          initialConditions: equations.map(() => 0),
          integrationTime: 1e2,
          timestep: 1e-2
        }
        break
      default:
        // This shouldn't ever happen.
        alert("Creating state entities of type \"" + type + "\" is not yet supported.")
        return false
    }
    if (onClose({ name: name, type: type, data: stateEntityData, formParameters: stateEntityFormParameters })) {
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
          <FormControlLabel value="Equilibrium" control={<Radio />} label="Equilibrium" />
          <FormControlLabel value="Isocline" control={<Radio />} label="Isocline" />
          <FormControlLabel value="Orbit" control={<Radio />} label="Orbit" />
        </RadioGroup>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleCancel}>Cancel</Button>
        <Button onClick={handleCreate}>Create</Button>
      </DialogActions>
    </Dialog>
  )
}