// Reversible doubly linked list node.
class RDLLNode<T> {
  val: T
  rev: boolean // If true, reverses gets and sets for next and prev.
  _next: RDLLNode<T> | null
  _prev: RDLLNode<T> | null

  constructor(value: T) {
    this.val = value
    this.rev = false
    this._next = null
    this._prev = null
  }

  get next(): RDLLNode<T> | null {
    return this.rev ? this._prev : this._next
  }

  set next(node: RDLLNode<T> | null) {
    if (this.rev) {
      this._prev = node
    } else {
      this._next = node
    }
  }

  get prev(): RDLLNode<T> | null {
    return this.rev ? this._next : this._prev
  }

  set prev(node: RDLLNode<T> | null) {
    if (this.rev) {
      this._next = node
    } else {
      this._prev = node
    }
  }
}

// Reverse a doubly linked list, supplied any node therein.
function reverseRDLL(node: RDLLNode<number[]>) {
  let currentNode = node.next
  while (currentNode !== null) {
    // Reverse ahead.
    const nextNode: RDLLNode<number[]> | null = currentNode.next
    currentNode.rev = !currentNode.rev
    currentNode = nextNode
  }
  currentNode = node
  while (currentNode !== null) {
    // Reverse here and behind.
    const prevNode: RDLLNode<number[]> | null = currentNode.prev
    currentNode.rev = !currentNode.rev
    currentNode = prevNode
  }
}

// Use this if more than first two coordinates can differ.
// function pointsEqual(p1: number[], p2: number[]): boolean {
//   return p1.map((coord, i) => coord === p2[i]).every(Boolean)
// }

function pointsEqual(p1: number[], p2: number[]): boolean {
  const EPSILON = 1e-10
  return Math.abs(p1[0] - p2[0]) < EPSILON && Math.abs(p1[2] - p2[2]) < EPSILON
}

export default function conjoinLineSegments(
  segments: [number[], number[]][]
): number[][][] {
  // Lines are stored by the nodes of a doubly linked list
  // corresponding to their endpoints.
  let lines: [RDLLNode<number[]>, RDLLNode<number[]>][] = []

  // Collect segments into lines.
  for (const [p1, p2] of segments) {
    const node1 = new RDLLNode(p1)
    const node2 = new RDLLNode(p2)

    let newLine: [RDLLNode<number[]>, RDLLNode<number[]>]

    // Check if either node is already an endpoint of a line.
    const node1LineStart = lines.findIndex(([start, _]) =>
      pointsEqual(start.val, p1)
    )
    const node1LineEnd = lines.findIndex(([_, end]) =>
      pointsEqual(end.val, p1)
    )
    const node2LineStart = lines.findIndex(([start, _]) =>
      pointsEqual(start.val, p2)
    )
    const node2LineEnd = lines.findIndex(([_, end]) =>
      pointsEqual(end.val, p2)
    )

    if (node1LineStart !== -1) {
      // node1 is the start of an existing line (line1).
      if (node2LineStart !== -1) {
        // node2 is the start of an existing line (line2).
        // New line should be reverse-line1 concatenated by line2.
        // Reverse line1.
        reverseRDLL(lines[node1LineStart][0])
        // Conjoin the two lines at the new segment.
        lines[node1LineStart][0].next = lines[node2LineStart][0]
        lines[node2LineStart][0].prev = lines[node1LineStart][0]
        // Specify endpoints for new line.
        newLine = [lines[node1LineStart][1], lines[node2LineEnd][1]]
        // Remove line1 and line2 from lines.
        lines.splice(node1LineStart, 1)
        lines.splice(node2LineStart, 1)
        // Add new line to lines.
        lines.push(newLine)
      } else if (node2LineEnd !== -1) {
        // node2 is the end of an existing line (line2).
        // New line should be line2 concatenated by line1.
        // Conjoin the two lines at the new segment.
        lines[node1LineStart][0].prev = lines[node2LineEnd][1]
        lines[node2LineEnd][1].next = lines[node1LineStart][0]
        // Specify endpoints for new line.
        newLine = [lines[node2LineStart][0], lines[node1LineEnd][1]]
        // Remove line1 and line2 from lines.
        lines.splice(node1LineStart, 1)
        lines.splice(node2LineEnd, 1)
        // Add new line to lines.
        lines.push(newLine)
      } else {
        // node2 is not an endpoint of any line.
        // Prepend node2 to line1.
        node2.next = lines[node1LineStart][0]
        lines[node1LineStart][0].prev = node2
        // Update starting endpoint for line1.
        lines[node1LineStart][0] = node2
      }
    } else if (node1LineEnd !== -1) {
      // node1 is the end of an existing line (line1).
      if (node2LineStart !== -1) {
        // node2 is the start of an existing line (line2).
        // New line should be line1 concatenated by line2.
        // Conjoin the two lines at the new segment.
        lines[node1LineEnd][1].next = lines[node2LineStart][0]
        lines[node2LineStart][0].prev = lines[node1LineEnd][1]
        // Specify endpoints for new line.
        newLine = [lines[node1LineEnd][0], lines[node2LineStart][1]]
        // Remove line1 and line2 from lines.
        lines.splice(node1LineEnd, 1)
        lines.splice(node2LineStart, 1)
        // Add new line to lines.
        lines.push(newLine)
      } else if (node2LineEnd !== -1) {
        // node2 is the end of an existing line (line2).
        // New line should be line1 concatenated by reverse-line2.
        // Reverse line2.
        reverseRDLL(lines[node2LineEnd][0])
        // Conjoin the two lines at the new segment.
        lines[node1LineEnd][1].next = lines[node2LineEnd][1]
        lines[node2LineEnd][1].prev = lines[node1LineEnd][1]
        // Specify endpoints for new line.
        newLine = [lines[node1LineEnd][0], lines[node2LineEnd][0]]
        // Remove line1 and line2 from lines.
        lines.splice(node1LineEnd, 1)
        lines.splice(node2LineEnd, 1)
        // Add new line to lines.
        lines.push(newLine)
      } else {
        // node2 is not an endpoint of any line.
        // Append node2 to line1.
        node2.prev = lines[node1LineEnd][1]
        lines[node1LineEnd][1].next = node2
        // Update tail endpoint for line1.
        lines[node1LineEnd][1] = node2
      }
    } else {
      // node1 is not an endpoint of any line.
      if (node2LineStart !== -1) {
        // node2 is the start of an existing line (line2).
        // Prepend node1 to line2.
        node1.next = lines[node2LineStart][0]
        lines[node2LineStart][0].prev = node1
        // Update starting endpoint for line2.
        lines[node2LineStart][0] = node1
      } else if (node2LineEnd !== -1) {
        // node2 is the end of an existing line (line2).
        // Append node1 to line2.
        node1.prev = lines[node2LineEnd][1]
        lines[node2LineEnd][1].next = node1
        // Update tail endpoint for line2.
        lines[node2LineEnd][1] = node1
      } else {
        // Segment does not meet any existing line.
        // Conjoin nodes within segment.
        node1.next = node2
        node2.prev = node1
        // Add segment as a new line.
        lines.push([node1, node2])
      }
    }
  }

  // Convert lines into arrays of points.
  const linesOfPoints = lines.map(([start, _]) => {
    const points = []
    let currentNode: RDLLNode<number[]> | null = start
    while (currentNode !== null) {
      points.push(currentNode.val)
      currentNode = currentNode.next
    }
    return points
  })

  return linesOfPoints
}