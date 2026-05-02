import { Parser, ParseOption } from "./parser"
import { Worker } from "worker_threads"
import path from "path"

const DefaultParser = new Parser()
    .group("digit", ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const)
    .group("hex_digit", ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "a", "b", "c", "d", "e", "f", "A", "B", "C", "D", "E", "F"] as const)
    .group("exp_indicator", ["e", "E"] as const)
    .group("sign", ["+", "-"] as const)
    .group("frag_x", ["x", "X"] as const)

    .group("digits")
    .group("hex_digits")
    .group("number")

    .rule("digits_recur",                     ["digit", "digits"] as const,           ["digits"]        )
    .rule("digit_single",                     ["digit"] as const,                     ["digits"]        )
    .rule("hex_digits_recur",                 ["hex_digit", "hex_digits"] as const,   ["hex_digits"]    )
    .rule("hex_digit_single",                 ["hex_digit"] as const,                 ["hex_digits"]    )
    .rule("hex_literal",                      ["0", "frag_x", "hex_digits"] as const, ["number"]        )
    .rule("decimal_integer",                  ["digits"] as const,                    ["number"]        )
    .rule("decimal_with_fraction",            ["digits", ".", "digits"] as const,     ["number"]        )
    .rule("decimal_fraction_only",            [".", "digits"] as const,               ["number"]        )
    .rule("decimal_with_exponent",            ["digits", "exp_indicator", "digits"] as const, ["number"])
    .rule("decimal_with_exponent_signed",     ["digits", "exp_indicator", "sign", "digits"] as const, ["number"])
    .rule("decimal_fraction_exponent",        ["digits", ".", "digits", "exp_indicator", "digits"] as const, ["number"])
    .rule("decimal_fraction_exponent_signed", ["digits", ".", "digits", "exp_indicator", "sign", "digits"] as const, ["number"])

// Run parse in worker thread with hard timeout
function runParseInWorker(
    max_unparse_depth: number,
    option: ParseOption<undefined>, 
    timeoutMs: number,
    parser: Parser //= DefaultParser as any
): Promise<{
    time : number,
    input : string[]
}> {
    return new Promise((resolve, reject) => {
        const worker = new Worker(path.join(__dirname, "benchmark-worker"))
        let resolved = false
        
        const timer = setTimeout(() => {
            if (!resolved) {
                resolved = true
                worker.terminate()
                reject(new Error(`Timeout after ${timeoutMs}ms`))
            }
        }, timeoutMs)
        
        worker.on("message", (msg: { success: boolean, time?: number, error?: string, input? : string[] }) => {
            if (!resolved) {
                resolved = true
                clearTimeout(timer)
                worker.terminate()
                if (msg.success && msg.time !== undefined && msg.input !== undefined) {
                    resolve({
                        time: msg.time,
                        input: msg.input
                    })
                } else {
                    reject(new Error(msg.error || "Parse failed"))
                }
            }
        })
        
        worker.on("error", (error) => {
            if (!resolved) {
                resolved = true
                clearTimeout(timer)
                reject(error)
            }
        })
        
        worker.on("exit", (code) => {
            if (!resolved) {
                resolved = true
                clearTimeout(timer)
                reject(new Error(`Worker exited with code ${code}`))
            }
        })
        
        worker.postMessage({ parser : parser.serialize(), max_unparse_depth, option })
    })
}

export async function bench(
    iter : number = 1e3,
    max_unparse_depth : number = 20,
    maximum_wait_ms_per_iter : number = 400,
    option : ParseOption<undefined> = {
        "token_name_key" : undefined,
        "tokenizer" : "char",
        "heuristic_filter_relaxing" : 4,
        "recurse_depth" : 50,
    },
    parser : Parser = DefaultParser as any
){
    console.log(typeof parser["unparse"])

    console.time(`Parsing ${iter} iterations of input with max unparse depth ${max_unparse_depth}`)
    
    console.log(`Benchmarking with ${iter} iterations of parsing`)
    
    let totalTime = 0
    let runs : [string[], number][] = []
    let iterTime = -1
    let skipped = 0
    
    for(let i = 0; i < iter; i++){
        //print progress bar
        if(i % 10 === 0){
            const progress = Math.round((i / iter) * 100)
            const barLength = 30
            const filledLength = Math.round((i / iter) * barLength)
            const bar = "█".repeat(filledLength) + "░".repeat(barLength - filledLength)

            let str = `\r[${bar}] ${progress}% (${i}/${iter}) - Last iteration time: ${iterTime.toFixed(4)} ms`
            str += " ".repeat(Math.max(0, process.stdout.columns - str.length - 1)) // Clear remaining chars
            process.stdout.write(str)
        }
        
        let timedOut = false
        let input : string[] = []

        
        try {
            const out = await runParseInWorker(max_unparse_depth, option, maximum_wait_ms_per_iter, parser)
            input = out.input
            iterTime = out.time 
        } catch (e) {
            timedOut = true
            iterTime = Infinity
        }

        if (timedOut || !isFinite(iterTime)) {
            // process.stdout.write(`\r[${bar}] ${progress}% (${i}/${iter}) - TIMEOUT (>${maximum_wait_ms_per_iter} ms)\n`)
            skipped++
            continue
        }
        
        totalTime += iterTime
        runs.push([input, iterTime])
    }

    console.log()
    console.log(`========== BENCHMARK RESULTS ==========`)
    console.log(`Total iterations requested: ${iter}`)
    console.log(`Successful runs: ${runs.length}`)
    console.log(`Timed out: ${skipped}`)
    console.log(`Max unparse depth: ${max_unparse_depth}`)
    console.log()

    if(runs.length === 0) runs.push([[], Infinity]); // to avoid empty array issues in stats calculation
    
    // Calculate statistics
    const times = runs.map(r => r[1])
    const sortedTimes = [...times].sort((a, b) => a - b)
    const minTime = sortedTimes[0]
    const maxTime = sortedTimes[sortedTimes.length - 1]
    const avgTime = totalTime / runs.length
    const medianTime = sortedTimes[Math.floor(sortedTimes.length / 2)]
    
    // Calculate standard deviation
    const variance = times.reduce((sum, time) => sum + Math.pow(time - avgTime, 2), 0) / runs.length
    const stdDev = Math.sqrt(variance)
    
    // Calculate percentiles
    const p95Index = Math.floor(runs.length * 0.95)
    const p99Index = Math.floor(runs.length * 0.99)
    const p95 = sortedTimes[p95Index]
    const p99 = sortedTimes[p99Index]
    
    console.log(`Timing metrics:`)
    console.log(`  Min:     ${minTime.toFixed(8)} ms`)
    console.log(`  Max:     ${maxTime.toFixed(8)} ms`)
    console.log(`  Average: ${avgTime.toFixed(8)} ms`)
    console.log(`  Median:  ${medianTime.toFixed(8)} ms`)
    console.log(`  Std Dev: ${stdDev.toFixed(8)} ms`)
    console.log()
    console.log(`Percentiles:`)
    console.log(`  P95: ${p95.toFixed(8)} ms`)
    console.log(`  P99: ${p99.toFixed(8)} ms`)
    console.log()
    console.log(`Throughput Per Run: ${(runs.length / (totalTime / 1000)).toFixed(2)} parses/second`)
    
    const totalTokens = runs.reduce((sum, run) => sum + run[0].length, 0)
    console.log(`Average Tokens Per Run: ${(totalTokens / runs.length).toFixed(2)}`)
    console.log(`Throughput Per Token: ${(totalTokens / (totalTime / 1000)).toFixed(2)} tokens/second`)

    console.log(`Total time: ${totalTime.toFixed(2)} ms (${(totalTime / 1000).toFixed(4)} seconds)`)
    console.log(`======================================`)
}