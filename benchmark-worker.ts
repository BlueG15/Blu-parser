import { parentPort, workerData } from "worker_threads"
import { type ParseOption, Parser, type SerializedParser } from "./parser"

const P = new Parser()
if (parentPort) {
    parentPort.on("message", (msg: { parser : SerializedParser, max_unparse_depth : number, option: ParseOption<undefined> }) => {
        const parser = P.importSerialized(msg.parser)
        
        try {
            const input = parser.unparse(msg.max_unparse_depth)
            const start = performance.now()
            parser.parse(input, msg.option)
            const end = performance.now()
            parentPort!.postMessage({ success: true, time: end - start, input })
        } catch (error) {
            console.error("Error in worker thread:", error)
            parentPort!.postMessage({ success: false, error: (error as Error).message })
        }
    })
}
