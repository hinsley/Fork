import { useState } from 'react'
import { Box } from '@mui/material'
import { Array, Axis, Cartesian, ContainedMathbox, Grid, Point } from 'mathbox-react'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { compile } from 'mathjs'

import { Equation } from './ODEEditor'

const SPATIAL_SCALING = 2e-2
const TIME_SCALING = 1e0
const DISTANCE_LIMIT = 1e4

const mathboxOptions = {
	plugins: ["core", "controls", "cursor"],
	controls: {
		klass: OrbitControls
	}
}

export default function StateSpace({ equations }: { equations: Equation[] }) {
	const numberOfPoints = 3e3
	const [points, setPoints] = useState(globalThis.Array.from({ length: numberOfPoints }, (_, i) => [(i+1) * 1e2 / numberOfPoints, 0, 0]))

	const dx = compile(equations[0].expression)
	const dy = compile(equations[1].expression)
	const dz = compile(equations[2].expression)

	// Runge-Kutta 4th order method.
	const rk4 = (x: number, y: number, z: number, dt: number) => {
		const k1x = dx.evaluate({'x': x, 'y': y, 'z': z})
		const k1y = dy.evaluate({'x': x, 'y': y, 'z': z})
		const k1z = dz.evaluate({'x': x, 'y': y, 'z': z})

		const h2x = x + 0.5 * dt * k1x
		const h2y = y + 0.5 * dt * k1y
		const h2z = z + 0.5 * dt * k1z

		const k2x = dx.evaluate({'x': h2x, 'y': h2y, 'z': h2z})
		const k2y = dy.evaluate({'x': h2x, 'y': h2y, 'z': h2z})
		const k2z = dz.evaluate({'x': h2x, 'y': h2y, 'z': h2z})

		const h3x = x + 0.5 * dt * k2x
		const h3y = y + 0.5 * dt * k2y
		const h3z = z + 0.5 * dt * k2z

		const k3x = dx.evaluate({'x': h3x, 'y': h3y, 'z': h3z})
		const k3y = dy.evaluate({'x': h3x, 'y': h3y, 'z': h3z})
		const k3z = dz.evaluate({'x': h3x, 'y': h3y, 'z': h3z})

		const h4x = x + dt * k3x
		const h4y = y + dt * k3y
		const h4z = z + dt * k3z

		const k4x = dx.evaluate({'x': h4x, 'y': h4y, 'z': h4z})
		const k4y = dy.evaluate({'x': h4x, 'y': h4y, 'z': h4z})
		const k4z = dz.evaluate({'x': h4x, 'y': h4y, 'z': h4z})

		const newX = x + (dt / 6) * (k1x + 2 * k2x + 2 * k3x + k4x)
		const newY = y + (dt / 6) * (k1y + 2 * k2y + 2 * k3y + k4y)
		const newZ = z + (dt / 6) * (k1z + 2 * k2z + 2 * k3z + k4z)

		const distance = Math.sqrt(newX * newX + newY * newY + newZ * newZ)

		if (distance > DISTANCE_LIMIT) {
			// Reset to random distance from the origin with Gaussian weighting
			const u = Math.random()
			const v = Math.random()
			const r = Math.sqrt(-2 * Math.log(u))
			const theta = 2 * Math.PI * v
			const phi = Math.acos(2 * Math.random() - 1)

			const gaussianX = r * Math.sin(phi) * Math.cos(theta)
			const gaussianY = r * Math.sin(phi) * Math.sin(theta)
			const gaussianZ = r * Math.cos(phi)

			const scale = DISTANCE_LIMIT * 1e-2 // Adjust this value to control the spread

			return [gaussianX * scale, gaussianY * scale, gaussianZ * scale]
		}

		return [newX, newY, newZ]
	}

	return (
		<Box sx={{ height: '100%', width: '100%', overflow: 'hidden' }}>
			<h3>State Space</h3>
			<ContainedMathbox
				options={mathboxOptions}
				containerStyle={{ height: "100%", width: "100%" }}
			>
				<Cartesian scale={[32 * SPATIAL_SCALING, 32 * SPATIAL_SCALING, 32 * SPATIAL_SCALING]}>
					<Axis axis="x" color="orange" width={64 * SPATIAL_SCALING} />
					<Axis axis="y" color="blue" width={64 * SPATIAL_SCALING} />
					<Axis axis="z" color="green" width={64 * SPATIAL_SCALING} />
					<Grid axes="xz" />
				</Cartesian>
				<Array
					id="points"
					channels={3}
					items={numberOfPoints}
					expr={(emit: (x: number, y: number, z: number) => void, i: number, t: number, dt: number) => {
						setPoints(points.map((point) => rk4(point[0], point[1], point[2], dt * TIME_SCALING)))
						points.forEach(point => emit(point[1] * SPATIAL_SCALING, point[2] * SPATIAL_SCALING, point[0] * SPATIAL_SCALING))
					}}
				/>
				<Point points="#points" shape="sphere" color="red" size={2} />
			</ContainedMathbox>
		</Box>
	)
}