import { useState } from 'react'
import { Box } from '@mui/material'
import { Array, Axis, Cartesian, ContainedMathbox, Grid, Label, Line, Point, Text } from 'mathbox-react'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { compile } from 'mathjs'

import { Equation, Parameter } from './ODEEditor'
import rk4 from '../math/odesolvers/rk4'
import { StateEntity } from './Continuation/StateEntities/StateEntitiesMenu'

import { EquilibriumData } from './Continuation/StateEntities/EditDialogs/EditEquilibriumDialog'
import { OrbitData } from './Continuation/StateEntities/EditDialogs/EditOrbitDialog'

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

interface StateSpaceProps {
	equations: Equation[]
	parameters: Parameter[]
	stateEntities: StateEntity[]
}

export default function StateSpace({ equations, parameters, stateEntities }: StateSpaceProps) {
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

	// Initialize trajectories to plot in "realtime".
	const [points, setPoints] = useState(globalThis.Array.from({ length: NUMBER_OF_POINTS }, (_, i) => [(i+1) * 1e2 / NUMBER_OF_POINTS, ...globalThis.Array(eqs.length - 1).fill((Math.random() - 0.5) * 1e-6)]))

	// Progress a point forward in time.
	function stepPoint(point: number[], dt: number) {
		const newPoint = rk4(eqs, parameters, point, dt)

		const distance = Math.sqrt((newPoint as number[]).reduce((sum, component) => sum + component * component, 0))

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
					<Axis axis="x" color="orange" width={64 * SPATIAL_SCALING} visible={equations.length >= 2} />
					<Axis axis="y" color="blue" width={64 * SPATIAL_SCALING} visible={equations.length >= 3} />
					<Axis axis="z" color="green" width={64 * SPATIAL_SCALING} visible={equations.length >= 1} />
					<Grid axes="xz" />
				</Cartesian>
				<Array
					id="y-label-array"
					channels={3}
					items={1}
					expr={(emit: (x: number, y: number, z: number) => void, i: number, t: number, dt: number) => {
						emit(36 * SPATIAL_SCALING, 3 * SPATIAL_SCALING, 0)
					}}
				/>
				<Text id="y-label" data={[equations.length >= 2 ? equations[1].variable : '']} width={32 * SPATIAL_SCALING} />
				<Label text="#y-label" />
				<Array
					id="z-label-array"
					channels={3}
					items={1}
					expr={(emit: (x: number, y: number, z: number) => void, i: number, t: number, dt: number) => {
						emit(0, 39 * SPATIAL_SCALING, 0)
					}}
				/>
				<Text id="z-label" data={[equations.length >= 3 ? equations[2].variable : '']} width={32 * SPATIAL_SCALING} />
				<Label text="#z-label" />
				<Array
					id="x-label-array"
					channels={3}
					items={1}
					expr={(emit: (x: number, y: number, z: number) => void, i: number, t: number, dt: number) => {
						emit(0, 3 * SPATIAL_SCALING, 36 * SPATIAL_SCALING)
					}}
				/>
				<Text id="x-label" data={[equations.length >= 1 ? equations[0].variable : '']} width={32 * SPATIAL_SCALING} />
				<Label text="#x-label" />
				<Array
					id="points"
					channels={3}
					items={NUMBER_OF_POINTS}
					realtime={true}
					expr={(emit: (x: number, y: number, z: number) => void, i: number, t: number, dt: number) => {
						setPoints(points.map((point) => stepPoint(point, dt * TIME_SCALING)))
						points.forEach(point => emit(point[1] * SPATIAL_SCALING, point[2] * SPATIAL_SCALING, point[0] * SPATIAL_SCALING))
					}}
				/>
				<Point points="#points" shape="sphere" color="red" size={2} />
				{ // Render state entities.
				stateEntities.map((entity, i) => {
					switch (entity.type) {
						case "Equilibrium":
							return (<>
								<Array
									id={"Equilibrium-" + i}
									channels={3}
									items={1}
									expr={(emit: (x: number, y: number, z: number) => void, i: number, t: number, dt: number) => {
										emit(
											(entity.data as EquilibriumData).point.length >= 2 ? (entity.data as EquilibriumData).point[1] * SPATIAL_SCALING : 0,
											(entity.data as EquilibriumData).point.length >= 3 ? (entity.data as EquilibriumData).point[2] * SPATIAL_SCALING : 0,
											(entity.data as EquilibriumData).point.length >= 1 ? (entity.data as EquilibriumData).point[0] * SPATIAL_SCALING : 0
										)
									}}
								/>
								<Point points={"#Equilibrium-" + i} shape="sphere" color="green" size={6} />
							</>)
						case "Orbit":
							var curveCoordinatesReordered: number[][] = []
							if ((entity.data as OrbitData).curve.length > 1) {
								curveCoordinatesReordered = (entity.data as OrbitData).curve.map(point => [
									point.length >= 2 ? point[1] * SPATIAL_SCALING : 0,
									point.length >= 3 ? point[2] * SPATIAL_SCALING : 0,
									point.length >= 1 ? point[0] * SPATIAL_SCALING : 0
								])
								return (<>
									<Array
										id={"Orbit-" + i}
										live={false}
										channels={(entity.data as OrbitData).curve.length == 0 ? 0 : 3}
										items={1}
										data={curveCoordinatesReordered}
									/>
									<Line points={"#Orbit-" + i} color="blue" start={false} end={false} width={1} />
								</>)
							}
							break
					}
					return <></>
				})}
			</ContainedMathbox>
		</Box>
	)
}