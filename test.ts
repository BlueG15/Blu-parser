import { CONFIG } from "./config"
import { Parser } from "./parser"

let P = new Parser()
.group("digit", ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const)
.group("number")
.group("float")
.group("int")
.rule("integer_recurse",       ["int", "digit"] as const,             ["int",   "number"])
.rule("integer_recurse2",      ["digit", "int"] as const,             ["int",   "number"])
.rule("integer_single_digit",  ["digit"] as const,                    ["int",   "number"])
.rule("float_both_side",       ["int", ".", "int"] as const,          ["float", "number"])
.rule("float_right_only",      [ ".", "int" ] as const,               ["float", "number"])
.rule("float_left_only",       [ "int", "." ] as const,               ["float", "number"])

for(let i = 0; i < 10; i++){
    console.log(P.unparse().join(""))
}

CONFIG.VERBOSE = false
console.log("----")
const [r, log] = P.parse("12", {
    "tokenizer" : "char",
    "token_name_key" : undefined,
    "heuristic_filter_relaxing" : 4,
    "recurse_depth" : 50,
})

console.log(`Found ${r.length} matches: `)
console.dir(r, {depth : 10})

console.log("Log Report: ")
if(CONFIG.VERBOSE) log.forEach(l => console.dir(l.message, {depth : 10}));

// test matcher

import { lookup } from "./matcher"
CONFIG.VERBOSE = false
const res = lookup(
    "1234".split(""),
    {
        "int1" : ["int", "digit"] as const,
        "int2" : ["digit", "int"] as const,
        "int3" : ["digit"] as const,
    }, 
    10,
    {
        "int" : ["int1", "int2", "int3"],
        "digit" : ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"],
    },
    true
)
//there should be 2 matches: int1 and int2
console.dir(res, {depth : 10})