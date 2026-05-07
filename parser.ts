import { ClusterMatch, Match, PartialMatch, RuleMatch, TokenMatch } from "./classes"
import { lookup } from "./matcher"
import { ExcludeWithError, Flatten, ObjectValue, Writable } from "./utils"
import * as ERR from "./parser_errors"
import { CONFIG } from "./config"

class RecursiveError extends Error {}

type DefaultTokenizeTypes = "word" | "char"

export type ParseOption<Token_name_key extends string | undefined | never> = {
    token_name_key : Token_name_key,
    tokenizer : Token_name_key extends string ? DefaultTokenizeTypes | {
        tokenize(s : string) : {
            [K in Token_name_key] : string 
        }[]
    } : DefaultTokenizeTypes,
    

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
}

type LogReport<RuleName extends string, IsError extends boolean> = {
    isError : IsError,
    message : string,
    start_sequence : string[],
    matches : PartialMatch<RuleName>[] | Match<RuleName>[]
}

export class SerializedParser {
    constructor(
        public rules : Record<string, string[]>,
        public groups : Record<string, string[]>
    ){}
}

// changes version 1.1.0 : added post processings

export type AnyParser = Parser<any, any, any, any, any, any, any, any>

// helper types for post processing
type InferPostProcessorInputSingle<
    P extends AnyParser,
    SymbolName extends string
> = 
    // rule name
    SymbolName extends P["__T_RL_NAME"] ? (
        SymbolName extends keyof P["__T_PP_DEF"] 
        ? (
            //has post processor
            P["__T_PP_DEF"][SymbolName] extends never ?
            RuleMatch :
            P["__T_PP_DEF"][SymbolName]
        )
        : RuleMatch //no post processor, return default match type
    ) : 
    //group name
    // union of memberss
    SymbolName extends "T"  ? TokenMatch   : //early terminate
    SymbolName extends "T+" ? ClusterMatch : //early terminate

    SymbolName extends P["__T_GR_NAME"] ?
    ObjectValue<{
        [K in P["__T_GR_DEF"][SymbolName]] : InferPostProcessorInputSingle<P, K>
    }>
    :
    //token
    SymbolName extends P["__T_TK_NAME"] ? TokenMatch :
    ERR.PostProcessorInputTypeCannotBeInfered<{symbol_name : SymbolName, symbol_type : "unknown"}>

type InferPostProcessorInput<
    P extends AnyParser,
    SymbolSequence extends string[]
> = {
    [K in keyof SymbolSequence] : InferPostProcessorInputSingle<P, SymbolSequence[K]>
}

// there are no "ret con" names, if a rule uses "a", "a"'s type (rule/group/...) is infered as time of use
// there cant be a use of "a" then a declare using the same name "a" later
// this simplify type inferences
export class Parser<
    RuleDefinitions extends Record<string, string[]> = {},
    FragmentDefinitions extends Record<string, string[]> = {},
    GroupDefinitions extends Record<string, string> = {
        "T" :  never, //default group that captures any token
        "T+" : never, //default group that captures at least 1 token
    },
    
    PostProcessors extends Record<string, any> = {}, //rule name -> post processor return type

    // infered
    FragmentNames extends string = keyof FragmentDefinitions & string,
    GroupNames  extends string = keyof GroupDefinitions & string,
    RuleNames extends string = keyof RuleDefinitions & string,
    TokenNames extends string = GroupDefinitions["T"]
>{
    #rules     : RuleDefinitions = {} as RuleDefinitions
    #fragments : FragmentDefinitions = {} as FragmentDefinitions
    #groups    : Record<string, string[]> = {}
    #post_processors : Record<string, (...p : any) => any> = {}

    #static_checked = false

    serialize() : SerializedParser {
        return new SerializedParser(this.#rules, this.#groups)
    }

    importSerialized(sp : SerializedParser){
        this.#rules = sp.rules as RuleDefinitions
        this.#groups = sp.groups
        this.#static_checked = false
        return this
    }

    static deserialize(sp : SerializedParser) : Parser {
        const p = new Parser()
        p.#groups = sp.groups
        p.#rules = sp.rules
        p.#static_checked = false
        return p
    }

    tokenize(input : string, mode : DefaultTokenizeTypes = "word"){
        switch(mode){
            case "word":
                return input.trim().split(/\s+/)
            case "char":
                return input.split("")
            default:
                throw new Error(`Unknown tokenization mode: ${mode}`)
        }
    }

    /** 
     * Rules are a sequence of tokens, fragments or groups,
     * 
     * 
     * Rules can be assigned to already existing groups
     * 
     * 
     * ***NOTE*** : The infered post processing input type of this method CAN be inaccurate for groups (only groups, anything else is fine)
     * 
     * 
     * since groups rule can "back refrenced" to an already defined group, what infered here can be outdated
     * 
     * 
     * see @method Parser.addPostProcess for a more accurate alternative
     * */
    rule<
        RuleName extends string, 
        SequenceType extends ReadonlyArray<string>,
        IsOfGroup extends GroupNames[] | undefined = undefined,

        IsOfGroupInfered extends GroupNames[] = IsOfGroup extends GroupNames[] ? IsOfGroup : [],
        
        SequenceTypeStrs extends string[] = 
            Flatten<
                Writable<{
                    [K in keyof SequenceType] 
                    : SequenceType[K] extends FragmentNames ? FragmentDefinitions[SequenceType[K]]
                    : SequenceType[K]
                }>
            >,
        
        PostProcessorReturn = never,

        NewRuleDefinitions extends Record<string, string[]> =
        RuleDefinitions & { [K in RuleName] : SequenceTypeStrs },

        NewGroupDefinitions extends Record<string, string> =
        Omit<
            GroupDefinitions, 
            IsOfGroupInfered[number] |
            "T"
        > & { 
            [K in IsOfGroupInfered[number]] : GroupDefinitions[K] | RuleName
        } & {
            // add to T
            "T" : Exclude<
                GroupDefinitions["T"] | SequenceTypeStrs[number],
                RuleName | FragmentNames | GroupNames | RuleNames
            >
        },

        NewPostProcessors extends Record<string, any> =
        PostProcessors & { [K in RuleName] : PostProcessorReturn },

        NewParserType extends AnyParser = Parser<
            //rules
            {
                [K in keyof NewRuleDefinitions] : NewRuleDefinitions[K]
            },
            FragmentDefinitions,
            //groups
            {
                [K in keyof NewGroupDefinitions] : NewGroupDefinitions[K]
            },
            //post processors
            {
                [K in keyof NewPostProcessors] : NewPostProcessors[K]
            }
        >,

        PostProcessorInput extends any[] = InferPostProcessorInput<NewParserType, SequenceTypeStrs>,
    >(
        name : RuleName &
            ExcludeWithError<
                RuleName, RuleNames,
                ERR.AlreadyDefined<{symbol_name : RuleName, symbol_type : "rule", defined_type : "rule"}>
            > &
            ExcludeWithError<
                RuleName, FragmentNames,
                ERR.AlreadyDefined<{symbol_name : RuleName, symbol_type : "rule", defined_type : "fragment"}>
            > &
            ExcludeWithError<
                RuleName, GroupNames,
                ERR.AlreadyDefined<{symbol_name : RuleName, symbol_type : "rule", defined_type : "group"}>
            > &
            ExcludeWithError<
                RuleName, TokenNames,
                ERR.AlreadyDefined<{symbol_name : RuleName, symbol_type : "rule", defined_type : "token"}>
            >,

        seq  : SequenceType &
            SequenceTypeStrs extends never[] 
            ? ERR.EmptyDefinition<{symbol_name : RuleName, symbol_type : "rule"}>
            : SequenceType,

        sameGroupAs : IsOfGroup = undefined as IsOfGroup,
        postProcessor : (...p : PostProcessorInput) => PostProcessorReturn = undefined as any
    ){
        (this.#rules as any)[name] = (seq as SequenceType).flatMap(s => {
            if(s in this.#fragments) return this.#fragments[s];
            return [s]
        })

        //add name to the group's variant
        if(Array.isArray(sameGroupAs)){
            for(const g of sameGroupAs){
                const arr = this.#groups[g] || []
                this.#groups[g] = Array.from(new Set([...arr, name]))
            }
        } else if(typeof sameGroupAs === "string"){
            const arr = this.#groups[sameGroupAs] || []
            this.#groups[sameGroupAs] = Array.from(new Set([...arr, name]))
        }

        if(postProcessor){
            this.#post_processors[name] = postProcessor
        }

        this.#static_checked = false

        return this as unknown as NewParserType
    }

    /**
     * Fragments are partial rules and can only be used in other rule definitions
     * Essentially just the same as rules, just store as fragments and
     * 1. no post processor
     * 2. no groups
     * 3. cannot be self referential
     */
    fragment<
        FragmentName extends string, 
        SequenceType extends ReadonlyArray<string>,
        
        SequenceTypeStrs extends string[] = 
            Flatten<
                Writable<{
                    [K in keyof SequenceType] 
                    : SequenceType[K] extends FragmentNames ? FragmentDefinitions[SequenceType[K]]
                    : SequenceType[K]
                }>
            >,

        NewFragmentDefinitions extends Record<string, string[]> = 
        FragmentDefinitions & { [K in FragmentName] : SequenceTypeStrs },

        NewGroupDefinitions extends Record<string, string> =
        Omit<GroupDefinitions, "T"> & {
            // add to T
            "T" : Exclude<
                GroupDefinitions["T"] | SequenceTypeStrs[number],
                FragmentName | FragmentNames | GroupNames | RuleNames
            >
        },

        NewParserType extends AnyParser = Parser<
            RuleDefinitions,
            //flatten
            {
                [K in keyof NewFragmentDefinitions] : NewFragmentDefinitions[K]
            },
            {
                [K in keyof NewGroupDefinitions] : NewGroupDefinitions[K]
            },
            PostProcessors
        >
    >(
        name : FragmentName &
            ExcludeWithError<
                FragmentName, RuleNames,
                ERR.AlreadyDefined<{symbol_name : FragmentName, symbol_type : "fragment", defined_type : "rule"}>
            > &
            ExcludeWithError<
                FragmentName, FragmentNames,
                ERR.AlreadyDefined<{symbol_name : FragmentName, symbol_type : "fragment", defined_type : "fragment"}>
            > &
            ExcludeWithError<
                FragmentName, GroupNames,
                ERR.AlreadyDefined<{symbol_name : FragmentName, symbol_type : "fragment", defined_type : "group"}>
            > &
            ExcludeWithError<
                FragmentName, TokenNames,
                ERR.AlreadyDefined<{symbol_name : FragmentName, symbol_type : "fragment", defined_type : "token"}>
            >,

        seq  :  SequenceType &
                ExcludeWithError<
                    SequenceType, never[], 
                    ERR.EmptyDefinition<{symbol_name : FragmentName, symbol_type : "rule"}>
                > & (
                    FragmentName extends SequenceTypeStrs[number] 
                    ? ERR.CannotBeSelfReferential<{symbol_name : FragmentName, symbol_type : "fragment"}> 
                    : SequenceType
                ),
    ){
        (this.#fragments as any)[name] = (seq as SequenceType).flatMap(s => {
            if(s in this.#fragments) return this.#fragments[s];
            return [s]
        })

        this.#static_checked = false

        return this as unknown as NewParserType
    }

    /**
     * Group are collection of rules/groups or token names
     * Notably cannot contain fragments
     * 
     * Can contain an empty definition
     * Cannot be self refrential
     */
    group<
        GroupName extends string,
        GroupContent extends ReadonlyArray<string> = [],

        NewGroupDefinitions extends Record<string, string> = 
        Omit<GroupDefinitions, "T"> 
            & { [K in GroupName] : GroupContent[number] } 
            & { 
                "T" : Exclude<
                    GroupDefinitions["T"] | GroupContent[number], 
                    GroupName | FragmentNames | GroupNames | RuleNames
                >
            },

        NewParserType extends AnyParser = Parser<
            RuleDefinitions,
            FragmentDefinitions,
            {
                //flatten
                [K in keyof NewGroupDefinitions] : NewGroupDefinitions[K]
            },
            PostProcessors
        >
    >(
        name : GroupName &
            ExcludeWithError<
                GroupName, RuleNames,
                ERR.AlreadyDefined<{symbol_name : GroupName, symbol_type : "group", defined_type : "rule"}>
            > &
            ExcludeWithError<
                GroupName, FragmentNames,
                ERR.AlreadyDefined<{symbol_name : GroupName, symbol_type : "group", defined_type : "fragment"}>
            > &
            ExcludeWithError<
                GroupName, GroupNames,
                ERR.AlreadyDefined<{symbol_name : GroupName, symbol_type : "group", defined_type : "group"}>
            > &
            ExcludeWithError<
                GroupName, TokenNames,
                ERR.AlreadyDefined<{symbol_name : GroupName, symbol_type : "group", defined_type : "token"}>
            >,

        contents? : {
            [K in keyof GroupContent] 
                : GroupContent[K] extends GroupName 
                ? ERR.CannotBeSelfReferential<{symbol_name : GroupName, symbol_type : "group"}> 
                : GroupContent[K] extends FragmentNames
                ? ERR.SymbolTypeCannotBeUsedHere<{symbol_name : GroupContent[K], symbol_type : "fragment", scope_type : "group"}>
                : GroupContent[K] extends "T" | "T+"
                ? ERR.SymbolTypeCannotBeUsedHere<{symbol_name : GroupContent[K], symbol_type : "group", scope_type : "group"}>
                : GroupContent[K]
        }
    ){
        let flatContent = (contents || []) as string[]

        flatContent = flatContent.flatMap(s => {
            if(this.isGroupName(s)) return this.#groups[s];
            return s;
        })

        this.#groups[name] = Array.from(new Set([...(this.#groups[name] || []), ...flatContent]))
        this.#static_checked = false

        return this as unknown as NewParserType
    }

    addPostProcess<
        RuleName extends RuleNames, 
        PostProcessorReturn,

        NewParserType extends AnyParser = Parser<
            RuleDefinitions,
            FragmentDefinitions,
            GroupDefinitions,
            Omit<PostProcessors, RuleName> & { [K in RuleName] : PostProcessorReturn }
        >,

        SequenceType extends string[] = RuleDefinitions[RuleName],
        PostProcessorInput extends any[] = InferPostProcessorInput<this, SequenceType>,
    >(
        name : RuleName,
        postProcessor : (...p : PostProcessorInput) => PostProcessorReturn
    ){
        this.#post_processors[name] = postProcessor
        return this as unknown as NewParserType
    }

    isRuleName(s : RuleNames) : true;
    isRuleName(s : GroupNames) : false;
    isRuleName(s : FragmentNames) : false;
    isRuleName(s : any) : s is RuleNames;
    isRuleName(s : any) : s is RuleNames {
        return s in this.#rules
    }

    isGroupName(s : string) : s is GroupNames {
        return s in this.#groups || s === "T+" || s === "T";
    }

    isFragmentName(s : string) : s is FragmentNames {
        return s in this.#fragments
    }

    isTokenName(s : string) : s is TokenNames {
        return !this.isRuleName(s) && !this.isGroupName(s) && !this.isFragmentName(s)
    }

    isInGroup(s : string, group_name : string) : boolean {
        if(group_name === "T") return true;
        return this.#groups[group_name]?.includes(s);
    }

    /**
     * Check against the following condition and throws if not met
     * 1. A ruleset is impossible to parse if no rules has anchors
     * 2. A fragment is unreferenced if no rule reference it directly
     */
    private staticCheckRuleSet(){
        
        // check posibility
        const hasMap : Record<string, string> = {}
        let is_valid = true
        for(const [name, seq] of Object.entries(this.#rules)){
            const rule_ref_another_rule = seq.find(s => this.isRuleName(s))
            if(rule_ref_another_rule){
                hasMap[name] = rule_ref_another_rule
                is_valid = false
                continue;
            }
            else break;
        }

        if(!is_valid){
            throw new Error(
                `Rule set unparsable every rule references another rule, see below:\n\n${Object.entries(hasMap).map(([a, b]) => `rule ${a} ref -> ${b}`).join("\n")}`
            )
        }

        // check unreferenced fragment
        const unreferencedFragments = new Set(Object.keys(this.#fragments))
        for(const seq of Object.values(this.#rules))
            for(const s of seq) 
                if(this.isFragmentName(s)) unreferencedFragments.delete(s)

        if(unreferencedFragments.size > 0)
            throw new Error(
                `Fragment(s) ${Array.from(unreferencedFragments).join(", ")} is/are defined but not referenced by any rule, which is likely an error.`
            );
    
        this.#static_checked = true
    }

    getRuleSet(
        rules? : (RuleNames | GroupNames)[]
    ) : Record<string, string[]> {

        if(!rules) return this.#rules;
        let res : Record<string, string[]> = {}

        //flatten the rules array
        //group
        rules = rules.flatMap(r => {
            if(this.isGroupName(r)) return this.#groups[r].filter(r => this.isRuleName(r));
            return this.isRuleName(r) ? [r] : []
        }) as RuleNames[]

        for(const r of rules){
            res[r] = this.#rules[r]
        }

        return res
    }

    protected recursive_descend(
        input : string[],
        log : (LogReport<RuleNames, true> | LogReport<RuleNames, false>)[],
        option : ParseOption<string | undefined>,
        use_rule? : (RuleNames | GroupNames)[],
        depth = 0
    ) : RuleMatch<RuleNames>[] | never {
        log.push({
            isError : false,
            message : `Trying to match sequence ${input.join(" ")} using rules ${use_rule ? use_rule.join(", ") : "all rules"}`,
            matches : [],
            start_sequence : input
        })

        if(option.recurse_depth && depth > option.recurse_depth){
            log.push({
                isError : true,
                message : `Depth of ${depth} is reached, haling`,
                matches : [],
                start_sequence : input
            })
            throw new RecursiveError()
        }

        const [m, p] = lookup<RuleNames>(
            this,
            this.getRuleSet(use_rule),
            input,
            option.heuristic_filter_relaxing,
            option.keep_duplicate_match,
        )

        //each match is a path
        if(!m.length){
            log.push({
                isError : true,
                message : `No matching rule found for sequence ${input.join(" ")}`,
                matches : p,
                start_sequence : input
            })
            throw new RecursiveError()
        }

        log.push({
            isError : false,
            message : `Found ${m.length} possible matches for sequence ${input.join(" ")}`,
            matches : m,
            start_sequence : input
        })

        const res : RuleMatch<RuleNames>[] = []

        m.forEach(
            match => {
                log.push({
                    isError : false,
                    message : `Exploring match with rule ${match.matched_rule}, path : ${match.parsed_result.path.map(r => JSON.stringify(r.value, null, 0))}`,
                    matches : [match],
                    start_sequence : input
                })

                const matchedTopRule = match.matched_rule
                let currentPath : (TokenMatch | RuleMatch<RuleNames> | ClusterMatch)[][] = []

                if(CONFIG.VERBOSE) console.log(`[MATCH START] Processing match: rule="${matchedTopRule}", path length=${match.parsed_result.path.length}`);

                path_iter: for(const r of match.parsed_result.path){

                    log.push({
                        isError : false,
                        message : `Exploring path element ${JSON.stringify(r.value, null, 0)} of matched rule ${matchedTopRule}`,
                        matches : [],
                        start_sequence : input
                    })

                    if(CONFIG.VERBOSE) console.log(`  [BEFORE ELEMENT] type="${r.type}", value="${r.value}", currentPath.length=${currentPath.length}`);

                    if(r.type === "anchor") {
                        log.push({
                            isError : false,
                            message : `Path element is an anchor with value "${r.value}" and anchor name "${r.anchor_name}"`,
                            matches : [],
                            start_sequence : input
                        })
                        if(!currentPath.length){
                            //first explored
                            currentPath = [[new TokenMatch(r.value)]]
                            if(CONFIG.VERBOSE) console.log(`    [ANCHOR FIRST] Created first anchor: "${r.value}", currentPath.length=1`);
                        }
                        else {
                            currentPath.forEach(path => path.push(new TokenMatch(r.value)));
                            if(CONFIG.VERBOSE) console.log(`    [ANCHOR APPEND] Appended anchor: "${r.value}" to ${currentPath.length} paths`);
                        }

                    } else if(r.type === "segment"){
                        if(CONFIG.VERBOSE) console.log(`  [SEGMENT DEBUG] r.value.length=${r.value.length}, r.value=${JSON.stringify(r.value)}, expected_rule_or_group="${r.expected_rule_or_group}"`);
                        //quick check

                        // NOTE : without this, tail recurson rule stop working somehow
                        if(
                            r.value.length === 1 && 
                            r.expected_rule_or_group in this.#groups &&
                            // this.isGroupName(r.expected_rule_or_group) &&
                            this.isTokenName(r.value[0]) &&
                            this.#groups[r.expected_rule_or_group].includes(r.value[0])
                        ){
                            log.push({
                                isError : false,
                                message : `Segment with single token "${r.value[0]}" matches group ${r.expected_rule_or_group} directly, skipping recursion`,
                                matches : [match],
                                start_sequence : input
                            })
                            if(!currentPath.length){
                                //first explored
                                currentPath = [[new TokenMatch(r.value[0])]]
                                if(CONFIG.VERBOSE) console.log(`    [QUICK GROUP FIRST] Created first token match: "${r.value[0]}", currentPath.length=1`);
                            }
                            else {
                                currentPath.forEach(path => path.push(new TokenMatch(r.value[0])));
                                if(CONFIG.VERBOSE) console.log(`    [QUICK GROUP APPEND] Appended token: "${r.value[0]}" to ${currentPath.length} paths`);
                            }
                            continue path_iter
                        }

                        if(
                            r.value.length >= 1 &&
                            r.expected_rule_or_group === "T+"
                        ){
                            log.push({
                                isError : false,
                                message : `Segment with tokens "${r.value.join(" ")}" matches wild card group T+ directly, skipping recursion`,
                                matches : [],
                                start_sequence : input
                            })
                            if(!currentPath.length){
                                //first explored
                                currentPath = [[new ClusterMatch(r.value)]]
                                if(CONFIG.VERBOSE) console.log(`    [QUICK T+ FIRST] Created first cluster match: "${r.value.join(" ")}", currentPath.length=1`);
                            }
                            else {
                                currentPath.forEach(path => path.push(new ClusterMatch(r.value)));
                                if(CONFIG.VERBOSE) console.log(`    [QUICK T+ APPEND] Appended cluster: "${r.value.join(" ")}" to ${currentPath.length} paths`);
                            }
                            continue path_iter
                        } else if(r.expected_rule_or_group === "T+"){
                            //T+ anyway
                            log.push({
                                isError : true,
                                message : `Segment with value "${r.value.join(" ")}" does not match wild card group T+ since it has no tokens, this path is invalid`,
                                matches : [],
                                start_sequence : input
                            })
                            currentPath = [] //reset current path since this path is invalid
                            break path_iter
                        }

                        if(
                            r.value.length === 1 &&
                            r.expected_rule_or_group === "T"
                        ){
                            log.push({
                                isError : false,
                                message : `Segment with single token "${r.value[0]}" matches wild card group directly, skipping recursion`,
                                matches : [],
                                start_sequence : input
                            })
                            if(!currentPath.length){
                                //first explored
                                currentPath = [[new TokenMatch(r.value[0])]]
                                if(CONFIG.VERBOSE) console.log(`    [QUICK T FIRST] Created first token match: "${r.value[0]}", currentPath.length=1`);
                            }
                            else {
                                currentPath.forEach(path => path.push(new TokenMatch(r.value[0])));
                                if(CONFIG.VERBOSE) console.log(`    [QUICK T APPEND] Appended token: "${r.value[0]}" to ${currentPath.length} paths`);
                            }
                            continue path_iter
                        } else if(r.expected_rule_or_group === "T"){
                            //T anyway
                            log.push({
                                isError : true,
                                message : `Segment with value "${r.value.join(" ")}" does not match wild card group T since it has more than 1 token, this path is invalid`,
                                matches : [],
                                start_sequence : input
                            })
                            currentPath = [] //reset current path since this path is invalid
                            break path_iter
                        }

                        log.push({
                            isError : false,
                            message : `Path element is a non quick handle-able segment with value "${r.value.join(" ")}" and expected rule/group "${r.expected_rule_or_group}"`,
                            matches : [],
                            start_sequence : input
                        })

                        //recurse 
                        try {
                            if(
                                this.isGroupName(r.expected_rule_or_group) ||
                                this.isRuleName(r.expected_rule_or_group)
                            ){
                                log.push({
                                    isError : false,
                                    message : `Recursing into expected rule/group ${r.expected_rule_or_group} for segment [${r.value.join(" ")}]`,
                                    matches : [],
                                    start_sequence : r.value
                                })
                                
                                const Paths = this.recursive_descend(r.value, log, option, [r.expected_rule_or_group], depth + 1);
                                
                                if(CONFIG.VERBOSE) console.log(`    [RECURSE RESULT] Got ${Paths.length} paths from recursion, currentPath.length=${currentPath.length} before merge`);

                                log.push({
                                    isError : false,
                                    message : `Found ${Paths.length} paths for expected rule/group ${r.expected_rule_or_group} for segment [${r.value.join(" ")}], current paths : ${currentPath.length ? JSON.stringify(currentPath, null, 0) : "<empty>"}`,
                                    matches : [],
                                    start_sequence : r.value
                                })

                                if(Paths.length === 0){
                                    log.push({
                                        isError : true,
                                        message : `Current path has ${currentPath.length} paths but recursion found no paths for expected rule/group ${r.expected_rule_or_group} for segment [${r.value.join(" ")}], this path is invalid`,
                                        matches : [],
                                        start_sequence : r.value
                                    })
                                    if(CONFIG.VERBOSE) console.log(`    [RECURSE FAILED] No paths found from recursion but current path has ${currentPath.length} paths, breaking path_iter`);
                                    currentPath = [] //reset current path since this path is invalid
                                    break path_iter
                                }

                                if(currentPath.length){
                                    const newMatchElems = [] as typeof currentPath
                                    for(const continuation of Paths){
                                        for(const currentPaths of currentPath){
                                            newMatchElems.push([...currentPaths, continuation])
                                        }
                                    }
                                    currentPath = newMatchElems
                                    if(CONFIG.VERBOSE) console.log(`    [RECURSE MERGE] Merged with existing paths: newLength=${currentPath.length}`);
                                } else {
                                    currentPath = Paths.map(p => [p])
                                    if(CONFIG.VERBOSE) console.log(`    [RECURSE INIT] Created initial paths from recursion: ${currentPath.length}`);
                                }
                                
                            }

                            else {
                                log.push({
                                    isError : true,
                                    message : `Expected rule/group ${r.expected_rule_or_group} for segment [${r.value.join(" ")}] is not found in the rule set, cannot recurse`,
                                    matches : [],
                                    start_sequence : r.value
                                })
                                throw new RecursiveError(`Expected rule/group ${r.expected_rule_or_group} for segment [${r.value.join(" ")}] is not found in the rule set, cannot recurse`)
                            }

                        } catch(e){
                            if(!(e instanceof RecursiveError)){
                                //unexpected error, rethrow
                                //safety check for when I forgor to handle a new error type in the recursion
                                log.push({
                                    isError : true,
                                    message : `Unexpected error during recursion for segment [${r.value.join(" ")}] with expected rule/group ${r.expected_rule_or_group}, error: ${(e as any).toString()}`,
                                    matches : [],
                                    start_sequence : r.value
                                })
                                throw e;
                            }
                            //ignore, this path is invalid
                            log.push({
                                isError : true,
                                message : `Path invalid, failed to match expected rule/group ${r.expected_rule_or_group} for segment [${r.value.join(" ")}]`,
                                matches : [],
                                start_sequence : r.value
                            })
                            if(CONFIG.VERBOSE) console.log(`    [SEGMENT FAILED] Breaking path_iter. currentPath before reset: length=${currentPath.length}, after reset will be 0`);
                            currentPath = [] //reset current path since this path is invalid
                            break path_iter
                        }
                    }

                }
                if(CONFIG.VERBOSE) console.log(`[MATCH END] rule="${matchedTopRule}", pushing ${currentPath.length} paths to res. Path element counts: ${currentPath.map(p => p.length).join(", ")}`);
                res.push(...currentPath.map(path => new RuleMatch(path, matchedTopRule)))
            }
        )

        return res
    }

    parse<
        TopRulesTypeArr extends (RuleNames | GroupNames)[] = [RuleNames],
        TopRuleType extends RuleNames = Flatten<{
            [K in keyof TopRulesTypeArr] :
                TopRulesTypeArr[K] extends RuleNames ? TopRulesTypeArr[K] :
                TopRulesTypeArr[K] extends GroupNames ? (
                    [GroupDefinitions[TopRulesTypeArr[K]][number] & RuleNames]
                ) : []
        }>[number]
    >(
        input : string | string[],
        parse_option : ParseOption<string | undefined>,
        starting_rules? : TopRulesTypeArr
    ) : [
            (
                TopRuleType extends keyof PostProcessors ? PostProcessors[TopRuleType] : RuleMatch<TopRuleType>
            )[],
            LogReport<RuleNames, true | false>[]
        ]
    {
        if(!this.#static_checked) this.staticCheckRuleSet();

        let recurse_depth = parse_option.recurse_depth ?? 10
        const token_name_key = parse_option.token_name_key
        const tokenizer = parse_option.tokenizer

        let tokenArr : string[]

        if(typeof input === "string"){
            if(typeof tokenizer === "string"){
                tokenArr = this.tokenize(input, tokenizer)
                console.log(`Tokenized input ${input} using default tokenizer "${tokenizer}":`, tokenArr)
            } else if (token_name_key !== undefined) {
                tokenArr = tokenizer.tokenize(input).map(tok => tok[token_name_key])
            } else {
                throw new Error("Invalid parse option: Token name key is undefined when tokenizer if not one of the defaults")
            }

            if(!Number.isFinite(recurse_depth)){
                console.warn(`Warning: recurse_depth is set to Infinite, which may cause infinite recursion. Please ensure this is intentional.`)
            }

            if(recurse_depth <= 0){
                throw new Error(`recurse_depth must be a positive number.`)
            } 
        } else tokenArr = input;

        const log : (LogReport<RuleNames, true> | LogReport<RuleNames, false>)[] = []

        try{
            const M = this.recursive_descend(tokenArr, log, parse_option, starting_rules) as RuleMatch<RuleNames>[]
            const P = this.postProcess<TopRuleType>(M)
            return [
                P as any,
                log
            ]
        } catch(e) {
            return [
                [] as any,
                log
            ]
        }
    }

    protected postProcess<TopRuleType extends RuleNames>(
        matches : RuleMatch<RuleNames>[],
    ) : (TopRuleType extends keyof PostProcessors ? PostProcessors[TopRuleType] : RuleMatch<TopRuleType>)[] 
    {
        if(CONFIG.VERBOSE){
            console.log("Post processing matches...")
        }

        if(matches.length === 0) return [] as any;

        const res : any[] = []
        for(const m of matches){
            if(CONFIG.VERBOSE){
                console.log(`Post processing match with rule ${m.rule_name} and matched elements :`, m.matched)
            }

            const finalProcessor = this.#post_processors[m.rule_name]
            if(finalProcessor === undefined) {
                res.push(m);
                continue;
            }
            const params : any[] = []
            for(const child of m.matched){
                if(child instanceof RuleMatch) params.push(this.postProcess([child])[0]);
                else params.push(child);
            }
            res.push(finalProcessor(...params));
        }
        return res
    }

    private choose<T>(arr : T[]) : T {
        return arr[Math.floor(Math.random() * arr.length)]
    }

    private randStr(len : number = this.randInt(10, 20)) : string {
        const chars = "abcdefghijklmnopqrstuvwxyz"
        let res = ""
        for(let i = 0; i < len; i++){
            res += chars[Math.floor(Math.random() * chars.length)]
        }
        return res
    }

    private randInt(min : number, max : number) : number {
        return Math.floor(Math.random() * (max - min + 1)) + min
    }

    /**
     * Inspired by Nearley, get a random string[] that conforms to the rule set
     */
    unparse(
        maxDepth : number = 10,
        rule? : RuleNames | GroupNames,
        cul : string[] = [],
        depth : number = 0,
    ) : string[] {
        if(depth > maxDepth) return cul;

        // default cases
        if(rule === undefined)
            rule = this.choose(Object.keys(this.#rules) as RuleNames[])
        else if(this.isGroupName(rule)){
            if(rule === "T") return [...cul, this.randStr(this.randInt(1, 5))];
            if(rule === "T+"){
                const times = this.randInt(1, 5)
                const tokens = Array.from({length : times}, () => this.randStr(this.randInt(1, 5)))
                return [...cul, ...tokens]
            }

            const group_members = this.#groups[rule]!
            const random_chosen_member = this.choose(group_members)
            if(this.isRuleName(random_chosen_member) || this.isGroupName(random_chosen_member)){
                return this.unparse(maxDepth, random_chosen_member, cul, depth + 1)
            }
            return [...cul, random_chosen_member]
        }

        // recurse further

        const seq = this.#rules[rule]
        if(!seq) throw new Error(`Rule ${rule} not found`);
        
        const arr = [] as typeof cul
        cul.push(...seq.flatMap(s => {
            if(this.isRuleName(s)){
                return this.unparse(maxDepth, s, arr, depth + 1)
            } else if(this.isGroupName(s)){
                return this.unparse(maxDepth, s, arr, depth + 1)
            } else return [s] //token
        }))

        return cul
    }


    // type params

    /** DO NOT READ THIS VARIABLE, this is only used for type storage */
    readonly __T_RL_DEF : RuleDefinitions = 0 as any
    /** DO NOT READ THIS VARIABLE, this is only used for type storage */
    readonly __T_FR_DEF : FragmentDefinitions = 0 as any
    /** DO NOT READ THIS VARIABLE, this is only used for type storage */
    readonly __T_GR_DEF : GroupDefinitions = 0 as any
    /** DO NOT READ THIS VARIABLE, this is only used for type storage */
    readonly __T_PP_DEF : PostProcessors = 0 as any

    /** DO NOT READ THIS VARIABLE, this is only used for type storage */
    readonly __T_RL_NAME  : RuleNames = 0 as any
    /** DO NOT READ THIS VARIABLE, this is only used for type storage */
    readonly __T_FR_NAME  : FragmentNames = 0 as any
    /** DO NOT READ THIS VARIABLE, this is only used for type storage */
    readonly __T_GR_NAME  : GroupNames = 0 as any
    /** DO NOT READ THIS VARIABLE, this is only used for type storage */
    readonly __T_TK_NAME  : TokenNames = 0 as any

    // end type params
}