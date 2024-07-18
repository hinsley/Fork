import React from 'react'
import { Box, Stack, TextField } from '@mui/material'

const ODEs: React.FC = () => (
    <Box sx={{ height: '100%', width: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
      <Box sx={{ width: '1024px', maxWidth: '100%' }}>
        <h3>ODE System</h3>
        <Stack sx={{ '& > :not(style)': { mb: 2 } }}>
          <TextField label="x'" fullWidth />
          <TextField label="y'" fullWidth />
          <TextField label="z'" fullWidth />
        </Stack>
      </Box>
    </Box>
)

export default ODEs