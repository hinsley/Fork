import React from 'react'
import { Box } from '@mui/material'
import { ContainedMathbox, Axis, Grid, Cartesian } from 'mathbox-react'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

const mathboxOptions = {
	plugins: ["core", "controls", "cursor"],
	controls: {
		klass: OrbitControls
	}
}

const StateSpace: React.FC = () => (
	<Box sx={{ height: '100%', width: '100%', overflow: 'hidden' }}>
		<h3>State Space</h3>
		<ContainedMathbox
			options={mathboxOptions}
			containerStyle={{ height: "100%", width: "100%" }}
		>
			<Cartesian>
				<Axis axis="x" color="orange" />
				<Axis axis="y" color="blue" />
				<Axis axis="z" color="green" />
				<Grid axes="xz" />
			</Cartesian>
		</ContainedMathbox>
	</Box>
)

export default StateSpace
