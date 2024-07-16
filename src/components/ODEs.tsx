import React from 'react'
import { Box, TextField } from '@mui/material'

const ODEs: React.FC = () => (
    <Box sx={{ height: '100%', width: '80%', overflow: 'auto', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <h3>ODE System</h3>
      <Box sx={{ '& > :not(style)': { mb: 2 } }}>
        <TextField label="x'" fullWidth />
        <TextField label="y'" fullWidth />
        <TextField label="z'" fullWidth />
      </Box>
    </Box>
)

export default ODEs