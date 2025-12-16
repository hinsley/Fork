---
description: How to use the Fork CLI for dynamical systems analysis
---

# Fork CLI Workflow

The Fork CLI is an interactive menu-driven application for analyzing dynamical systems. It uses numbered menus (rawlist) that can be navigated by typing numbers.

## Starting the CLI

```bash
cd cli
npm start
```

// turbo

## Menu Navigation

All menus display numbered options. To select an option, type the number and press Enter.

Example menu:
```
? Select a system
  1) Create New System
   ──────────────
  2) Lorenz (flow)
  3) Henon (map)
   ──────────────
  4) Exit
  Answer: 
```

To select "Lorenz", type `2` and press Enter.

## Menu Structure

```
Main Menu
├── Create New System
├── [System List]
│   └── System Menu
│       ├── Objects
│       │   ├── Create New Object (Orbit/Equilibrium)
│       │   └── [Object List]
│       │       └── Object Actions (Inspect, Extend, Solver, etc.)
│       ├── Continuation
│       │   ├── Create New Branch
│       │   └── [Branch List]
│       │       └── Branch Actions (Inspect, Extend, Delete)
│       ├── Edit System
│       ├── Duplicate System
│       └── Delete System
└── Exit
```

## Common Workflows

### Creating a New System

1. Start CLI: `npm start`
2. Select `1` (Create New System)
3. Enter system name (alphanumeric + underscores only)
4. Configure system type (Flow for ODEs, Map for iterated functions)
5. Enter variables (comma-separated, e.g., `x,y,z`)
6. Enter parameters (comma-separated, e.g., `r,s,b`)
7. Select `Continue` to proceed to equations
8. Define each equation
9. Set parameter default values
10. System is saved

### Creating an Orbit (Trajectory Simulation)

1. Navigate to a system
2. Select `1` (Objects)
3. Select `1` (Create New Object)
4. Select `1` (Orbit)
5. Enter orbit name
6. Set initial conditions for each variable
7. Set simulation duration/iterations
8. Set step size (for flows)
9. Select `Continue` to run simulation

### Finding an Equilibrium

1. Navigate to a system's Objects menu
2. Select `1` (Create New Object)
3. Select `2` (Equilibrium)
4. Enter equilibrium name
5. After creation, select the equilibrium from the list
6. Select `2` (Equilibrium Solver)
7. Configure initial guess and solver parameters
8. Run the Newton-Raphson solver

### Running Continuation Analysis

1. First, create and solve an equilibrium (see above)
2. Navigate to system menu
3. Select `2` (Continuation)
4. Select `1` (Create New Branch)
5. Select starting equilibrium
6. Select continuation parameter
7. Enter branch name
8. Configure step sizes and tolerances
9. Select `Continue` to run

### Initiating Limit Cycle from Hopf Bifurcation

1. Run equilibrium continuation (see above)
2. Inspect the branch to find Hopf bifurcation points
3. Select a Hopf point (marked with * or labeled "Hopf")
4. Select `1` (Initiate Limit Cycle Continuation)
5. Configure amplitude, discretization (ntst, ncol), and continuation settings
6. Select `Continue` to compute limit cycle branch

## Text Input Prompts

Some prompts require text input rather than menu selection:
- System/object names: Type the name and press Enter
- Numerical values: Type the number and press Enter
- Confirm prompts (y/n): Type `y` or `n` and press Enter

## Tips for AI Agent Usage

1. **Wait for menu to render**: After sending input, wait for the next menu to appear before sending the next command
2. **Read menu numbers carefully**: Menu items may shift based on dynamic content (object lists, etc.)
3. **Use `command_status` to read output**: Check what menu is currently displayed
4. **Separators indicate groups**: 
   - Primary actions at top
   - List items in middle  
   - Destructive actions (Delete, etc.) before navigation
   - Back/Exit at bottom
5. **Handle "Press enter to return" prompts**: Some detail views require pressing Enter to continue
