# Blu's parser implementation

A super basic parser that natively do all_sat and supports both styles of recursion

## Usage

### Install

```bash
npm i blu_parser_implementation
```

### Import

The parser is available from the package's file

```ts
import { Parser } from "blu_parser_implementation"
```

### Benchmark

One can run the default benchmark script on the number ruleset:

```bash
npm run benchmark
```

Or import the benchmark function and run it on your own ruleset:

```ts
import { bench } from "blu_parser_implementation"
bench(
    iter,
    unparse_depth,
    timeout,
    option,
    parser?
)
```

## Create a parser

Parser supports the typical *fragments*, *rules* and also *groups*.

Example:

```ts
const parser = new Parser()
    .group("digit", ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const)
    .rule("digits_recur", ["digit", "digits"] as const, ["digits"])
    .rule("digit_single", ["digit"] as const, ["digits"])
```

+ Rules are contains a sequence of *fragements* and/or *groups* and/or *literal tokens*
+ Fragments are reusable sequences of *literal tokens* or *group names* that can be used in rules but do not participate in matches
+ Groups (*NEW*) are sets of strings that matches any one of the *literal tokens* and/or *rule names* names in the set

Parser **DO NOT SUPPORT** regex and lookahead/lookbehind assertions, however it does supports the following features:

+ Left and right recursion
+ Ambiguous grammars
+ All-sat parsing (returns all possible matches instead of just one)

Parser however, do not support traditional rule construction through OR() or MANY(), instead you **HAVE** to manually list out all possible combinations of paths.

Example:

```ts
const parser = new Parser()
    .rule("optA1", ["a"] as const, ["opt_a"])
    .rule("optA2", [] as const,    ["opt_a"])
```

```ts
const parser = new Parser()
    .rule("a_or_b1", ["a"] as const, ["a_or_b"])
    .rule("a_or_b2", ["b"] as const, ["a_or_b"])
```

```ts
const parser = new Parser()
    .rule("many1", ["a", "a_many"] as const, ["many"])
    .rule("many2", ["a"] as const,           ["many"])
```

This is a design choice to keep the parser simple and straightforward, and also to allow for more flexibility in the grammar design. This hopefully supports all typical grammars.

Note that *as const* is required to let the parser infer the literal token type, which is used for rule checking purposes. Missing *as const* make ts infers the array as string[], which is not helpful and will cause type errors in rule construction.

### Type restriction

The parser's contruction methods is backed by typescript's type inference that should disallow invalid grammar construction. For example, the following code should throw a type error because rule is empty

```ts
const parser = new Parser()
    .rule("empty_rule", [] as const, ["empty_rule"])
```

also this for overlapping names

```ts
const parser = new Parser()
    .rule("a_rule", ["a"] as const, ["a_rule"])
    .rule("a_rule", ["b"] as const, ["a_rule"])
```

### Parsing

The parser's *parse()* method takes in an input string and returns an array of all possible matches via the *RuleMatch* object

Example:

```ts
const parser = new Parser()
    .rule("a_rule", ["a"] as const, ["a_rule"])

const [result, log] = parser.parse("a", { token_name_key : undefined, tokenizer "char" }) // RuleMatch[], LogReport[]
console.log(result) // RuleMatch[]
console.log(log) // LogReport[]
```

Parser *DO NOT* support postprocessing of the match result, so you need to visit the returned *RuleMatch* object and do the postprocessing yourself.

The *log* returned from the *parse()* method is a *LogReport* object that contains the parsing log, which can be used for debugging and analysis purposes, also contain partial matches that can be used for incremental parsing.

The *Parser Option* object passed into the *parse()* method allows you to specify parsing options such as tokenization method and token name access method, which will be explained in the next section.

### Parse Option - Tokenization

The parser defaultly support *character* based and *word* based tokenization, but works with any tokenizer that provides a token name.

One can specify token name access in the *Parser Option* object upon a *parse()* call, for example:

```ts
const parser = new Parser()
    .rule("a_rule", ["a"] as const, ["a_rule"])

const result = parser.parse("a", { 
    token_name_key : "type", 
    tokenizer : {
        tokenize(input: string) {
            return {
                type : //type here
            }
        }
    } 
})
```

### Parse option - Parsing

Asside from tokenization options, the *Parser Option* object also allows you to specify some options for the parsing process, such as:

```ts
/** 
 * Depth of how much of the queue should be exhausted before unsat, 
 * 
 * ~ Roughly how many rules is applied 
 * 
 * Set to **Infinity** to ignore
 * 
 * Default is **10**
 * */
recurse_depth? : number,

/** 
 * By default, the engine prioritizes rules based on *How much anchors* is matched
 * 
 * Set this to a positive number to *relax* this condition so rules even with lesser anchor cound still matched
 * 
 * Around 3 - 4 is reasonable, since the heuristic is not that smart
 *  
 * Set to **0** to only return the very best rule
 * 
 * Set to **-Infinity** to ignore
 *  
 * Default is 4 ( so rule even with anchor count 4 less than the max is still retained )
 */
heuristic_filter_relaxing? : number,

/**
 * By default, matches with the same segmentation is ignored
 * 
 * set to true to still keep those matches, which may be useful for debugging or if different rule with the same segmenation is wanted
 * */
keep_duplicate_match? : boolean, 
```

### Unparsing

*unparse* is a functionality borrowed from **Nearley.js** that generates a random sequence of tokens that matches the grammar, which can be used for testing and benchmarking purposes

```ts
const parser = new Parser()
    .rule("a_rule", ["a"] as const, ["a_rule"])

const input = parser.unparse(max_depth?)
```

## Benchmark results

The parser is benchmarked on a simple number/float ruleset:

```txt
========== BENCHMARK RESULTS ==========
Total iterations requested: 1000
Successful runs: 1000
Timed out: 0
Max unparse depth: 10

Timing metrics:
  Min:     0.90260000 ms
  Max:     16.31010000 ms
  Average: 2.61547250 ms
  Median:  2.07500000 ms
  Std Dev: 1.83735047 ms

Percentiles:
  P95: 5.85370000 ms
  P99: 9.79470000 ms

Throughput Per Run: 382.34 parses/second
Average Tokens Per Run: 6.53
Throughput Per Token: 2495.15 tokens/second
Total time: 2615.47 ms (2.6155 seconds)
```
