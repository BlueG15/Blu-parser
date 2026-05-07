//test usage
import { Parser } from "./lib/parser"

const K = {
    "1" : ["one", "a", "an"],
} as const

const Test = [...K[1], "a"] as const

const P = new Parser()
.rule("test", [...K[1], "a"] as const)

type testType = (typeof P)["__T_FR_DEF"]