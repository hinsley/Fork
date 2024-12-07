import React, { useState } from 'react'
import { Box, TextField } from '@mui/material'
import { Equation, Parameter } from '../ODEEditor'

import StateEntitiesMenu, { StateEntity } from './StateEntities/StateEntitiesMenu'

interface ContinuationProps {
  equations: Equation[]
  parameters: Parameter[]
  stateEntities: StateEntity[]
  setStateEntities: (stateEntities: StateEntity[]) => void
}

export default function Continuation({ equations, parameters, stateEntities, setStateEntities }: ContinuationProps) {
  const defaultObjectType = "state-entities"
  
  const [objectType, setObjectType] = useState(defaultObjectType)

  return (
    <Box sx={{ height: "100%", width: "100%", overflow: "auto", display: "flex", flexDirection: "column", alignItems: "center" }}>
      <Box sx={{ mt: 8, mb: 8, width: "1024px", maxWidth: "100%" }}>
        <h3>Continuation</h3>
        <Box sx={{ mb: 2 }}>
          <TextField
            select
            label="Object type"
            value={objectType}
            SelectProps={{ native: true }}
            onChange={(e) => setObjectType(e.target.value)}
          >
            <option value="state-entities">State entities</option>
            <option value="parameter-sets">Parameter sets</option>
          </TextField>
        </Box>
        {(() => {
          switch (objectType) {
            case "state-entities":
              return <StateEntitiesMenu
                equations={equations}
                parameters={parameters}
                stateEntities={stateEntities}
                setStateEntities={setStateEntities}
              />
            // case "parameter-sets":
            //   return <PowerSpectrum equations={equations} parameters={parameters} />
            default:
              return <Box sx={{ mb: 2 }}><h4>Not implemented</h4></Box>
          }
        })()}
      </Box>
    </Box>
  )
}