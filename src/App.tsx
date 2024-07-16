import './App.css'
import { Box } from '@mui/material'

import ODEs from './components/ODEs.tsx'
import StateSpace from './components/StateSpace.tsx'

function App() {
  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <h1>Fork</h1>
      <Box sx={{ display: 'flex', flexGrow: 1, overflow: 'hidden' }}>
        <Box sx={{ flex: 2, overflow: 'auto', pr: 2 }}>
          <StateSpace />
        </Box>
        <Box sx={{ flex: 1, overflow: 'auto', pl: 2 }}>
          <ODEs />
        </Box>
      </Box>
    </Box>
  )
}

export default App