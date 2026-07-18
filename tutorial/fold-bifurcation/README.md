# Continue a fold bifurcation in a one-variable ODE

> **Note:** This tutorial was written by GPT-5.6 Sol. It is intended to adhere to the ASD-STE100 Simplified Technical English writing standard.

This tutorial uses the live Fork application at [forkdynamics.com](https://forkdynamics.com).

You will make a small mathematical model. You will calculate an orbit and an equilibrium. Then, you will continue the equilibrium through a fold bifurcation.

This tutorial was checked with the live application on 2026-07-18.

## Terms that you must know

An **ordinary differential equation**, or **ODE**, is a rule for a rate of change.

A **state variable** is a quantity that can change with time. This tutorial uses one state variable, `x`.

A **parameter** is a value that controls the ODE. This tutorial uses one parameter, `mu`.

An **orbit** is the calculated history of a state variable. Fork shows the orbit as a curve.

An **equilibrium** is a state that does not change. It is also called a fixed point.

A **bifurcation** is a change in the number or the stability of solutions.

A **continuation** calculation follows a solution while a parameter changes.

A **fold bifurcation** is a point where two equilibria meet and disappear. A fold is also called a saddle-node bifurcation.

## Learn the Fork layout

Open [forkdynamics.com](https://forkdynamics.com).

![Fork start page](images/01-start-workspace.png)

The top bar shows the active system and the calculation status.

After you open a system, the main area has three parts:

- The **Objects** panel is on the left. It contains orbits, equilibria, and continuation branches.
- The viewport area is in the center. It contains plots.
- The **Inspector** is on the right. It contains the controls for the selected item.

The following image shows the three parts in an empty system.

![Empty Fork system layout](images/04-new-system-layout.png)

## 1. Create the ODE system

1. Click **Systems** in the top bar.

   The Systems dialog contains controls to create, open, import, export, and delete systems.

   ![Systems dialog](images/02-systems-menu.png)

2. Replace `NewSystem` with `FoldNormalForm`.

   ![System name field](images/03-system-name.png)

3. Click **Create**.

4. Click **System Settings** in the Inspector.

   Fork starts with two state variables. The default equations are only a template.

   ![Default system settings](images/05-system-settings-empty.png)

5. Click the second **Remove** button.

   One variable named `x` remains.

   ![One state variable](images/06-single-variable.png)

6. Enter `mu - x^2` in the `x` equation field.

   Fork shows a temporary warning because `mu` does not exist yet.

   ![Fold equation](images/07-fold-equation.png)

7. Click **+ Parameter**.

   ![New parameter row](images/08-parameter-row.png)

8. Replace `p1` with `mu`.

9. Set the value of `mu` to `1`.

   ![Complete fold model](images/09-configured-fold-system.png)

10. Click **Apply changes**.

    The temporary warning disappears.

    ![Applied system definition](images/10-applied-system.png)

11. Close the System Settings dialog.

The ODE is

$$
\frac{dx}{dt} = \mu - x^2.
$$

Do not try to interpret the equation yet. First, calculate an orbit.

## 2. Calculate the first orbit

1. Click **Object**.

   The Object menu contains **Orbit**, **Equilibrium**, and **Isocline**.

   ![Object menu](images/11-object-menu.png)

2. Click **Orbit**.

   Fork creates `Orbit_1` and selects it.

   ![New orbit Inspector](images/12-new-orbit-inspector.png)

3. Click **Run orbit** in the Inspector.

   ![Run orbit controls](images/13-run-orbit-panel.png)

4. Set the initial value of `x` to `0`.

5. Set **Initial time** to `0`.

6. Set **Duration** to `10`.

7. Set **Step size** to `0.01`.

   ![First orbit values](images/14-orbit-inputs.png)

8. Click **Run Orbit**.

   Fork calculates 1,001 points. The **Extend** control becomes available.

   ![Completed orbit calculation](images/15-orbit-computed.png)

## 3. Show the orbit in a State Space Scene

1. Click the **+** button in the center viewport area.

   The viewport menu contains **State Space Scene**, **Event Map**, and **Bifurcation Diagram**.

   ![Viewport menu](images/16-viewport-menu.png)

2. Click **State Space Scene**.

   Because this system has one state variable, Fork plots `x` against time `t`.

   ![First state-space scene](images/17-state-space-scene-default.png)

3. Click the `Scene_1` header.

   The Inspector now shows the scene controls. A scene can show all visible items or only selected items.

   ![State-space scene Inspector](images/18-state-space-scene-inspector.png)

The curve starts at `x = 0`. The curve approaches `x = 1`.

## 4. Calculate the equilibrium at the end of the orbit

1. Click **Object**.

2. Click **Equilibrium**.

   ![Equilibrium item in the Object menu](images/19-equilibrium-menu.png)

3. Select the new equilibrium.

   Fork reports **Not solved**.

   ![New equilibrium Inspector](images/20-new-equilibrium-inspector.png)

4. Click **Solve Equilibrium**.

   ![Solve Equilibrium controls](images/21-solve-equilibrium-panel.png)

5. Set the initial value of `x` to `1`.

   Use `1` because the orbit plot approaches this value.

   ![Equilibrium starting value](images/22-equilibrium-guess.png)

6. Keep **Max steps** at `25`.

7. Keep **Damping** at `1`.

8. Click **Solve Equilibrium**.

   Fork reports a zero residual and a successful result.

   ![Successful equilibrium solve](images/23-equilibrium-solved.png)

9. Click **Back**.

   The equilibrium now has the status **Solved**.

   ![Solved equilibrium actions](images/24-equilibrium-stability.png)

10. Click **View Data**.

    ![Equilibrium data sections](images/25-equilibrium-data.png)

11. Open **Coordinates**, **Parameters**, and **Eigenpairs**.

    Fork reports `x = 1`, `mu = 1`, and the eigenvalue `-2`.

    ![Stable equilibrium coordinate and eigenvalue](images/26-equilibrium-coordinate-eigenvalue.png)

### Why the first orbit approaches this equilibrium

At `mu = 1`, an equilibrium must satisfy

$$
0 = 1 - x^2.
$$

Thus, the two equilibria are

$$
x = 1 \quad \text{and} \quad x = -1.
$$

The eigenvalue is the derivative of the right side with respect to `x`:

$$
\lambda = -2x.
$$

At `x = 1`, the eigenvalue is `-2`. A negative eigenvalue makes a nearby orbit move toward the equilibrium. Thus, `x = 1` is stable.

The first orbit starts at `x = 0`. Between `-1` and `1`, the rate `1 - x^2` is positive. Thus, the orbit moves to the right. It approaches the stable equilibrium at `x = 1`.

This is the reason for the parameter value and the initial value in the first calculation.

## 5. Create the Bifurcation Diagram

1. Click the **+** button below the State Space Scene.

   ![Bifurcation viewport menu](images/27-bifurcation-viewport-menu.png)

2. Click **Bifurcation Diagram**.

   The new viewport is empty because no axes or branches are available.

   ![Empty Bifurcation Diagram](images/28-bifurcation-diagram-empty.png)

3. Click the `Bifurcation_Diagram_1` header.

   ![Bifurcation Diagram settings](images/29-bifurcation-diagram-settings.png)

4. Set **Abscissa** to **Parameter: mu**.

5. Set **Ordinate** to **State space variable: x**.

   The abscissa is the horizontal axis. The ordinate is the vertical axis.

   ![Bifurcation axes](images/30-bifurcation-axes.png)

## 6. Use colors that separate the visible items

Use a different color for items that appear together in one plot.

1. Select the first orbit.

2. Click **Appearance**.

   The Appearance page contains the visibility, color, line-width, and point-size controls.

   ![Appearance controls](images/31-orbit-appearance-menu.png)

3. Set the first orbit color to black.

4. Keep the equilibrium color orange.

5. Rename the orbit `Stable_Approach_Orbit`.

6. Rename the equilibrium `Stable_Equilibrium`.

   Fork names can contain letters, numbers, and underscores. Do not use spaces.

   ![Black orbit and orange equilibrium](images/33-distinct-stable-orbit-clean.png)

The black curve is the orbit. The orange horizontal mark is the equilibrium. The colors separate the two visible items.

## 7. Continue the equilibrium through the fold

1. Select `Stable_Equilibrium`.

2. Click **Continue Equilibrium**.

   ![Equilibrium continuation controls](images/34-equilibrium-continuation-panel.png)

3. Set **Branch name** to `Fold_Branch`.

4. Keep **Continuation parameter** at `mu`.

5. Set **Direction** to **Backward (Decreasing Param)**.

6. Keep **Initial step size** at `0.01`.

7. Set **Max points** to `100`.

8. Keep **Min step size** at `1e-5`.

9. Set **Max step size** to `0.05`.

10. Keep the other corrector values at their defaults.

    ![Continuation settings](images/35-continuation-settings.png)

11. Click **Create Branch**.

    Fork calculates 101 branch points and finds one fold.

    ![New fold branch](images/36-fold-branch-created.png)

### Important display note

An equilibrium continuation branch is not a time history. The branch point index is also not time.

The current State Space Scene can draw this branch against a time axis. That display is a known bug. Do not use that trace to interpret the continuation direction or the fold.

Use the Bifurcation Diagram for all branch conclusions in this tutorial.

## 8. Resize the Bifurcation Diagram

1. Put the pointer on the small horizontal resize handle below the Bifurcation Diagram.

2. Drag the handle down.

3. Stop when the plot area is approximately square.

   This shape makes the two sides of the fold easy to compare.

   ![Resized Bifurcation Diagram](images/37-bifurcation-diagram-resized.png)

The diagram shows `mu` on the horizontal axis and `x` on the vertical axis. The two sides meet near `(mu, x) = (0, 0)`.

## 9. Inspect the fold and the two equilibria at one parameter value

1. Select `Fold_Branch`.

2. Click **View Data**.

   The navigation controls select one continuation point at a time.

   ![Branch data controls](images/38-branch-data-panel.png)

3. Click **Index -35 - Fold**.

   Fork reports `mu` close to zero and an eigenvalue equal to zero.

   ![Fold point data](images/39-fold-point.png)

4. Click **End** to select branch point `0`.

5. Open **Point Details**.

   Fork reports the following values:

   - `mu = 1.00000`
   - `x = 1.00000`
   - eigenvalue `-2.00000`

   ![Stable branch point](images/42-stable-branch-details.png)

6. Enter `-64` in **Point index**.

7. Click **Jump**.

   Fork reports the following numerical values:

   - `mu = 1.00107`
   - `x = -1.00053`
   - eigenvalue `+2.00107`

   These values are close to the exact values at `mu = 1`.

   ![Unstable branch point](images/41-unstable-branch-point.png)

### Two correct interpretations of the fold

The first interpretation uses the augmented coordinates `(x, mu)`.

In this view, continuation follows one connected equilibrium family. The stable point and the unstable point are two points on the same family. The fold connects the two sides. The eigenvalue changes from negative to zero and then to positive.

The second interpretation fixes one parameter value.

At `mu = 1`, there are two separate equilibria. They are `x = 1` and `x = -1`. When `mu` decreases, the two equilibria move toward each other. They meet at `mu = 0`. For `mu < 0`, there is no real equilibrium. Thus, the two equilibria annihilate at the fold.

Both interpretations describe the same calculation.

## 10. Start orbits on the two sides of the unstable equilibrium

The continuation predicts an unstable equilibrium near `x = -1` at the original parameter value `mu = 1`.

Choose two initial values at the same distance from this equilibrium:

$$
x_{\text{right}} = -0.95, \qquad x_{\text{left}} = -1.05.
$$

Each value is `0.05` from `-1`.

### Calculate the right-side orbit

1. Click **Object** and then click **Orbit**.

   ![Final orbit Object menu](images/43-final-orbit-menu.png)

2. Rename the orbit `Right_of_Unstable`.

3. Click **Run orbit**.

4. Set the initial value of `x` to `-0.95`.

5. Set **Duration** to `5`.

6. Keep **Step size** at `0.01`.

   ![Right-side orbit values](images/44-right-side-orbit-inputs.png)

7. Click **Run Orbit**.

8. Keep this orbit orange.

### Calculate the left-side orbit

1. Click **Object** and then click **Orbit**.

2. Rename the orbit `Left_of_Unstable`.

3. Click **Run orbit**.

4. Set the initial value of `x` to `-1.05`.

5. Set **Duration** to `1.5`.

6. Keep **Step size** at `0.01`.

   ![Left-side orbit values](images/46-left-side-orbit-inputs.png)

7. Click **Run Orbit**.

8. Open **Appearance**.

9. Set this orbit color to black.

The shorter duration keeps the rapidly decreasing orbit in a readable range.

### Show only the two comparison orbits

1. Click the `Scene_1` header.

   The scene list contains all objects and branches.

   ![Scene object list](images/48-final-scene-object-list.png)

2. Select `Left_of_Unstable`.

3. Select `Right_of_Unstable`.

4. Clear the other scene selections.

   The scene now shows only the two comparison orbits.

   ![Two selected orbits](images/49-two-orbits-selected.png)

5. Collapse the Bifurcation Diagram.

6. Drag the State Space Scene resize handle down.

   The enlarged plot makes the two directions easy to see.

   ![Final nearby-orbit comparison](images/50-final-nearby-orbits.png)

The orange orbit starts at `x = -0.95`. It moves to the right and approaches `x = 1`.

The black orbit starts at `x = -1.05`. It moves to the left and decreases rapidly.

The signs of the ODE give the same prediction:

$$
1 - (-0.95)^2 = 0.0975 > 0,
$$

so the right-side orbit increases, and

$$
1 - (-1.05)^2 = -0.1025 < 0,
$$

so the left-side orbit decreases.

The two starts are on opposite sides of the unstable equilibrium. Thus, the final orbit calculation confirms the stability information from the continuation.
