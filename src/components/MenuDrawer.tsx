import { useState } from 'react'
import { Box, IconButton, List, ListItem, ListItemButton, ListItemText, SwipeableDrawer } from '@mui/material'
import { Menu } from '@mui/icons-material'

export default function MenuDrawer({ setCurrentView }: { setCurrentView: (view: string) => void }) {
  const [open, setOpen] = useState(false)

  const toggleDrawer = (newOpen: boolean) => () => {
    setOpen(newOpen)
  }

  const DrawerList = (
    <Box sx={{ width: '100%' }} role="presentation">
      <List>
        {[
          // Menu drawer items.
          {
            text: 'State space',
            view: 'state-space'
          },
          {
            text: 'System equations',
            view: 'equations'
          },
          {
            text: 'Continuation',
            view: 'continuation'
          },
          {
            text: 'Systems',
            view: 'systems'
          },
          {
            text: 'Settings',
            view: 'settings'
          }
        ].map((item) => (
          <ListItem key={item.text} disablePadding>
            <ListItemButton
              onClick={() => {
                setCurrentView(item.view)
                setOpen(false)
              }}
            >
              <ListItemText primary={item.text} sx={{ textAlign: 'center' }} />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    </Box>
  )

  return (
    <Box>
      <IconButton
        size="large"
        edge="start"
        color="inherit"
        aria-label="menu"
        sx={{ mr: 2 }}
        onClick={toggleDrawer(true)}
      >
        <Menu />
      </IconButton>
      <SwipeableDrawer
        open={open}
        onClose={toggleDrawer(false)}
        onOpen={toggleDrawer(true)}
        keepMounted
      >
        {DrawerList}
      </SwipeableDrawer>
    </Box>
  )
}