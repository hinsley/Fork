from pathlib import Path


protocol_path = Path('web/src/compute/computeProtocol.ts')
protocol = protocol_path.read_text()
anchor = """export type ComputeHandlerMap = {
  [K in ComputeOperationKind]: ComputeHandler<K>
}

export function createWorkerRequest"""
replacement = """export type ComputeHandlerMap = {
  [K in ComputeOperationKind]: ComputeHandler<K>
}

export function getComputeHandler<K extends ComputeOperationKind>(
  handlers: ComputeHandlerMap,
  kind: K
): ComputeHandler<K> {
  return handlers[kind]
}

export function createWorkerRequest"""
if protocol.count(anchor) != 1:
    raise RuntimeError('Expected one compute handler map anchor')
protocol_path.write_text(protocol.replace(anchor, replacement, 1))

worker_path = Path('web/src/compute/worker/forkCoreWorker.ts')
worker = worker_path.read_text()
worker = worker.replace(
    "import { createWorkerSuccessResponse } from '../computeProtocol'",
    "import { createWorkerSuccessResponse, getComputeHandler } from '../computeProtocol'",
    1,
)
worker = worker.replace('  ComputeHandler,\n', '', 1)
lookup = '  const handler = handlers[message.kind] as ComputeHandler<K>'
if worker.count(lookup) != 1:
    raise RuntimeError('Expected one asserted handler lookup')
worker_path.write_text(
    worker.replace(lookup, '  const handler = getComputeHandler(handlers, message.kind)', 1)
)
