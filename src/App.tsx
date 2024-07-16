import './App.css'
import { Box } from '@mui/material'

import ODEs from './components/ODEs.tsx'
import StateSpace from './components/StateSpace.tsx'

function App() {
  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', mb: 2, mt: 2 }}>
        <img src="/favicon.svg" alt="Fork logo" style={{ height: '2em', marginRight: '0.5em' }} />
        <h1 style={{ margin: 0 }}>Fork</h1>
      </Box>
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