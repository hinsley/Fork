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
	let eqs = [...equations]
	while (eqs.length < 3) { // Stub in zero for the extra equations if there are less than three.
		let i = eqs.length
		let varName = `x${i}`
		while (eqs.some(eq => eq.variable === varName)) {
			// Ensure there are no duplicate variable names.
			i++
			varName = `x${i}`
		}
		eqs.push({
			variable: varName,
			expression: '0'
		})
	}
	
	const numberOfPoints = 3e3
	const [points, setPoints] = useState(globalThis.Array.from({ length: numberOfPoints }, (_, i) => [(i+1) * 1e2 / numberOfPoints, ...globalThis.Array(eqs.length - 1).fill(0)]))

	const compiledEquations = eqs.map(eq => compile(eq.expression))

	// Runge-Kutta 4th order method.
	function rk4(point: number[], dt: number) {
		let scope: { [key: string]: number } = {}
		eqs.forEach((eq, i) => {
			scope[eq.variable] = point[i]
		})
		const k1 = compiledEquations.map(eq => eq.evaluate(scope))

		const h2 = point.map((p, i) => p + 0.5 * dt * k1[i])
		equations.forEach((eq, i) => {
			scope[eq.variable] = h2[i]
		})
		const k2 = compiledEquations.map(eq => eq.evaluate(scope))

		const h3 = point.map((p, i) => p + 0.5 * dt * k2[i])
		equations.forEach((eq, i) => {
			scope[eq.variable] = h3[i]
		})
		const k3 = compiledEquations.map(eq => eq.evaluate(scope))

		const h4 = point.map((p, i) => p + dt * k3[i])
		equations.forEach((eq, i) => {
			scope[eq.variable] = h4[i]
		})
		const k4 = compiledEquations.map(eq => eq.evaluate(scope))

		const newPoint = point.map((p, i) => p + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]))

		const distance = Math.sqrt(newPoint.reduce((sum, component) => sum + component * component, 0))

		// If too far from the origin.
		if (distance > DISTANCE_LIMIT) {
			// Rescale point to be a unit distance from the origin.
			const scaleFactor = 1 / distance
			return newPoint.map(component => component * scaleFactor)
		}

		return newPoint
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
						setPoints(points.map((point) => rk4(point, dt * TIME_SCALING)))
						points.forEach(point => emit(point[1] * SPATIAL_SCALING, point[2] * SPATIAL_SCALING, point[0] * SPATIAL_SCALING))
					}}
				/>
				<Point points="#points" shape="sphere" color="red" size={2} />
			</ContainedMathbox>
		</Box>
	)
}