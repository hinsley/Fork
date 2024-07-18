import { useState } from 'react'
import { Box } from '@mui/material'
import { Array, Axis, Cartesian, ContainedMathbox, Grid, Point } from 'mathbox-react'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

const mathboxOptions = {
	plugins: ["core", "controls", "cursor"],
	controls: {
		klass: OrbitControls
	}
}

export default function StateSpace() {
	const numberOfPoints = 3e2
	const [points, setPoints] = useState(globalThis.Array.from({ length: numberOfPoints }, (_, i) => [(i+1)/numberOfPoints, 0, 0]))

	const spatialScale = 1e2
	const temporalScale = 3e-3
	const dx = (x: number, y: number, z: number) => temporalScale * (10 * (y * spatialScale - x * spatialScale))
	const dy = (x: number, y: number, z: number) => temporalScale*(x*spatialScale*(28-z*spatialScale)-y*spatialScale)
	const dz = (x: number, y: number, z: number) => temporalScale*(x*spatialScale*y*spatialScale-8/3*z*spatialScale)
	// Runge-Kutta 4th order method.
	const rk4 = (x: number, y: number, z: number, dt: number) => {
		const k1x = dx(x, y, z)
		const k1y = dy(x, y, z)
		const k1z = dz(x, y, z)

		const k2x = dx(x + 0.5 * dt * k1x, y + 0.5 * dt * k1y, z + 0.5 * dt * k1z)
		const k2y = dy(x + 0.5 * dt * k1x, y + 0.5 * dt * k1y, z + 0.5 * dt * k1z)
		const k2z = dz(x + 0.5 * dt * k1x, y + 0.5 * dt * k1y, z + 0.5 * dt * k1z)

		const k3x = dx(x + 0.5 * dt * k2x, y + 0.5 * dt * k2y, z + 0.5 * dt * k2z)
		const k3y = dy(x + 0.5 * dt * k2x, y + 0.5 * dt * k2y, z + 0.5 * dt * k2z)
		const k3z = dz(x + 0.5 * dt * k2x, y + 0.5 * dt * k2y, z + 0.5 * dt * k2z)

		const k4x = dx(x + dt * k3x, y + dt * k3y, z + dt * k3z)
		const k4y = dy(x + dt * k3x, y + dt * k3y, z + dt * k3z)
		const k4z = dz(x + dt * k3x, y + dt * k3y, z + dt * k3z)

		const newX = x + (dt / 6) * (k1x + 2 * k2x + 2 * k3x + k4x)
		const newY = y + (dt / 6) * (k1y + 2 * k2y + 2 * k3y + k4y)
		const newZ = z + (dt / 6) * (k1z + 2 * k2z + 2 * k3z + k4z)

		return [newX, newY, newZ]
	}


	return (
		<Box sx={{ height: '100%', width: '100%', overflow: 'hidden' }}>
			<h3>State Space</h3>
			<ContainedMathbox
				options={mathboxOptions}
				containerStyle={{ height: "100%", width: "100%" }}
			>
				<Cartesian range={[[-5, 5], [-5, 5], [-5, 5]]}>
					<Axis axis="x" color="orange" width={4} />
					<Axis axis="y" color="blue" width={4} />
					<Axis axis="z" color="green" width={4} />
					<Grid axes="xz" />
				</Cartesian>
				<Array
					id="points"
					channels={3}
					items={numberOfPoints}
					expr={(emit: (x: number, y: number, z: number) => void, i: number, t: number, dt: number) => {
						setPoints(points.map((point) => rk4(point[0], point[1], point[2], dt)))
						points.forEach(point => emit(point[0], point[1], point[2]))
					}}
				/>
				<Point points="#points" shape="sphere" color="red" size={2} />
			</ContainedMathbox>
		</Box>
	)
}
