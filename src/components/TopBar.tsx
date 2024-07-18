import { AppBar, Box, Toolbar } from '@mui/material'
import MenuDrawer from './MenuDrawer'

export default function TopBar({ setCurrentView }: { setCurrentView: (view: string) => void }) {
  return (
    <AppBar position="static" sx={{ backgroundColor: '#1a1a1a' }}>
      <Toolbar>
        <MenuDrawer setCurrentView={setCurrentView} />
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexGrow: 1 }}>
          <img src="/favicon.svg" alt="Fork logo" style={{ height: '2em', marginRight: '0.5em' }} />
          <h1 style={{ margin: 0 }}>Fork</h1>
        </Box>
      </Toolbar>
    </AppBar>
  )
}