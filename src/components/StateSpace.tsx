import { useState } from 'react'
import { Box } from '@mui/material'
import { Array, Axis, Cartesian, ContainedMathbox, Grid, Point } from 'mathbox-react'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { compile } from 'mathjs'

import { Equation } from './ODEEditor'
import rk4 from '../math/odesolvers/rk4'
import euler from '../math/odesolvers/euler'

import jacobian from '../math/differentiation/jacobian'
import LLE from '../math/lyapunovexponents/lle'
import lyapunovSpectrum from '../math/lyapunovexponents/lyapunov_spectrum'

const SPATIAL_SCALING = 2e-2
const TIME_SCALING = 1e-0
const NUMBER_OF_POINTS = 3e3
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
			expression: '0',
			compiled: compile('0')
		})
	}
	
	// Calculate LLE at startup.
	const _lle = useState(() => {
		const value = LLE(eqs)
		console.log(`Leading Lyapunov Exponent (from co-evolution): ${value}`)
		return value
	})[0]

	const _lyapunovSpectrum = useState(() => {
		const value = lyapunovSpectrum(eqs, 3e2)
		console.log(`Lyapunov Spectrum (from tangent integrator): ${value}`)
		console.log("Substituting LLE from co-evolution.")
		value[0] = _lle

		// Replace Lyapunov exponent of smallest magnitude with zero.
		const absLyapunovExponents = value.map(lyapunovExponent => Math.abs(lyapunovExponent))
		const minMagnitude = Math.min(...absLyapunovExponents)
		value[absLyapunovExponents.indexOf(minMagnitude)] = 0

		// Calculate the Lyapunov dimension.
		var spectralSum = 0
		var lyapunovDimensionFloor = 0
		for (var i = 0; i < value.length; i++) {
			spectralSum += value[i]
			if (spectralSum < 0) {
				lyapunovDimensionFloor = i
				spectralSum -= value[i]
				break
			}
		}
		const lyapunovDimension = lyapunovDimensionFloor + spectralSum / Math.abs(value[lyapunovDimensionFloor])
		console.log(`Lyapunov Dimension: ${lyapunovDimension}`)

		return value
	})[0]

	// Initialize trajectories to plot in "realtime".
	const [points, setPoints] = useState(globalThis.Array.from({ length: NUMBER_OF_POINTS }, (_, i) => [(i+1) * 1e2 / NUMBER_OF_POINTS, ...globalThis.Array(eqs.length - 1).fill(0)]))

	// Progress a point forward in time.
	function stepPoint(point: number[], dt: number) {
		const newPoint = rk4(eqs, point, dt)

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
					items={NUMBER_OF_POINTS}
					expr={(emit: (x: number, y: number, z: number) => void, i: number, t: number, dt: number) => {
						setPoints(points.map((point) => stepPoint(point, dt * TIME_SCALING)))
						points.forEach(point => emit(point[1] * SPATIAL_SCALING, point[2] * SPATIAL_SCALING, point[0] * SPATIAL_SCALING))
					}}
				/>
				<Point points="#points" shape="sphere" color="red" size={2} />
			</ContainedMathbox>
		</Box>
	)
}