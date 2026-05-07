import { CONFIG } from "./config"
import { AnyParser, ParseOption, Parser } from "./parser"

class VarDecl {
    constructor(
        public readonly name : string,
        public readonly value : number,
        public readonly isImmutable : boolean = false
    ){}
}

const K = {
    "1" : ["one", "a", "an"],
} as const

let P = new Parser()
.group("num")

.group("decls", ["var", "const", "let"] as const)

.rule("var_decl_stmt", ["decls", "T+", "=", "num"] as const)

.rule("1", K[1],                ["num"] as const, () => 1)
.rule("2", ["two"] as const,    ["num"] as const, () => 2)
.rule("3", ["three"] as const,  ["num"] as const, () => 3)
.rule("4", ["four"] as const,   ["num"] as const, () => 4)
.rule("5", ["five"] as const,   ["num"] as const, () => 5)
.rule("6", ["six"] as const,    ["num"] as const, () => 6)
.rule("7", ["seven"] as const,  ["num"] as const, () => 7)
.rule("8", ["eight"] as const,  ["num"] as const, () => 8)
.rule("9", ["nine"] as const,   ["num"] as const, () => 9)
.rule("10",["ten"] as const,    ["num"] as const, () => 10)
.rule("11",["eleven"] as const, ["num"] as const, () => 11)
.rule("12",["twelve"] as const, ["num"] as const, () => 12)

//...
.rule("x10_1",   ["num", "ty", "num"] as const,       ["num"] as const)
.rule("x100_1",  ["num", "hundred", "num"] as const,  ["num"] as const)
.rule("x1000_1", ["num", "thousand", "num"] as const, ["num"] as const)

.rule("x10_2",   ["num", "ty"] as const,       ["num"] as const)
.rule("x100_2",  ["num", "hundred"] as const,  ["num"] as const)
.rule("x1000_2", ["num", "thousand"] as const, ["num"] as const)

.addPostProcess("x10_1",   (num1, _, num2) => typeof num1 === "number" && typeof num2 === "number" ? num1 * 10 + num2 : NaN)
.addPostProcess("x100_1",  (num1, _, num2) => typeof num1 === "number" && typeof num2 === "number" ? num1 * 100 + num2 : NaN)
.addPostProcess("x1000_1", (num1, _, num2) => typeof num1 === "number" && typeof num2 === "number" ? num1 * 1000 + num2 : NaN)

.addPostProcess("x10_2",   num => typeof num === "number" ? num * 10 : NaN)
.addPostProcess("x100_2",  num => typeof num === "number" ? num * 100 : NaN)
.addPostProcess("x1000_2", num => typeof num === "number" ? num * 1000 : NaN)

.addPostProcess("var_decl_stmt", (decl, varname, _, value) => {
    if(
        typeof value === "number"
    ){
        return varname.tokens.map(name => new VarDecl(
            name, 
            value, 
            decl.token === "const"
        ))
    }
    
    else return {
        error : "Invalid var decl statement",
        decl, varname, value
    } as const
})

for(let i = 0; i < 10; i++){
    console.log(P.unparse(10, "var_decl_stmt").join(" "))
}

CONFIG.VERBOSE = false
console.log("----")

const Option : ParseOption<undefined> = {
    "tokenizer" : "word",
    "token_name_key" : undefined,
    "heuristic_filter_relaxing" : 0,
    "recurse_depth" : 50,
}

function logParseResult(r : any[], log : {message : string}[]){
    console.log(`Found ${r.length} matches: `)
    console.dir(r, {depth : 10})

    console.log("Log Report: ")
    if(CONFIG.VERBOSE) log.forEach(l => console.dir(l.message, {depth : 10}));
}

// this demonstrates the ambiguous handling of the parser
// theres 2 paths here 
// [(twelve hundred four) ty three] -> (12 * 100 + 4) * 10 + 3
// and (twelve) hundred (four ty three) -> 12 * 100 + (4 * 10 + 3)
// both are valid according to the rules defined, and the parser will return both of them as matches, 
// with the correct post processed values (12403 and 1243 respectively)
const [r, log] = P.parse("twelve hundred four ty three", Option, ["num"] as const)
logParseResult(r, log)

// demonstrate the use of "T*" group
const [r2, log2] = P.parse("const x1 x2 = eleven hundred", Option, ["var_decl_stmt"] as const)
logParseResult(r2, log2)

// test matcher

// import { lookup } from "./matcher"
// CONFIG.VERBOSE = false
// const res = lookup(
//     "1234".split(""),
//     {
//         "int1" : ["int", "digit"] as const,
//         "int2" : ["digit", "int"] as const,
//         "int3" : ["digit"] as const,
//     }, 
//     10,
//     {
//         "int" : ["int1", "int2", "int3"],
//         "digit" : ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"],
//     },
//     true
// )
// //there should be 2 matches: int1 and int2
// console.dir(res, {depth : 10})