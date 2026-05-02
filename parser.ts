import { Match, PartialMatch, RuleMatch, TokenMatch } from "./classes"
import { lookup } from "./matcher"
import { ExcludeWithError, Flatten } from "./utils"

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

type RawTokenType = string

type OverlappedDefinitionError<NewName extends string, allNames extends string> = 
    `Type error: Name --> ${NewName} <--" cannot be used as it overlaps with an existing rule or fragment name or group member, Existing names : ${allNames}` & Error 

export class SerializedParser {
    constructor(
        public rules : Record<string, string[]>,
        public groups : Record<string, string[]>
    ){}
}

// group cannot contain circular definition byu construction...hopefully
export class Parser<
    RuleDefinitions extends Record<string, string[]> = {},
    FragmentDefinitions extends Record<string, string[]> = {},
    
    GroupNames  extends string = never,
    TokenNames extends string = never,

    RuleNames extends string = keyof RuleDefinitions & string,
    FragmentNames extends string = keyof FragmentDefinitions & string,
>{
    #rules     : RuleDefinitions = {} as RuleDefinitions
    #fragments : FragmentDefinitions = {} as FragmentDefinitions
    #groups    : Record<string, string[]> = {}

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
     * Rules can be assigned to already existing groups
     * */
    rule<
        NewRuleName extends string, 
        TokenTypeOrRuleOrFragment extends ( RawTokenType | RuleNames | FragmentNames )[],
        IsOfGroup extends GroupNames | GroupNames[] | undefined,
    >(
        //trick to disallow duplicate rule names
        name : ExcludeWithError<
            NewRuleName, RuleNames | FragmentNames | GroupNames | TokenNames,
            OverlappedDefinitionError<NewRuleName, RuleNames | FragmentNames | GroupNames | TokenNames>, 
            this
        >,

        seq  : ExcludeWithError<
            TokenTypeOrRuleOrFragment, never[], 
            `Type error: Rule --> ${NewRuleName} <--" cannot have an empty definition`, 
            this
        >,

        sameGroupAs : IsOfGroup = undefined as IsOfGroup
    ){
        (this.#rules as any)[name] = (seq as TokenTypeOrRuleOrFragment).flatMap(s => {
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

        this.#static_checked = false

        //flatten fragments
        type NewArr = Flatten<{
            [K in keyof TokenTypeOrRuleOrFragment] : 
                TokenTypeOrRuleOrFragment[K] extends FragmentNames 
                ? FragmentDefinitions[TokenTypeOrRuleOrFragment[K]]
                : TokenTypeOrRuleOrFragment[K]
        }>

        type NewRuleDefs = {
            [K in NewRuleName] : NewArr
        } & RuleDefinitions

        type NewTokenNames = Exclude<
            Extract<TokenTypeOrRuleOrFragment[number], string> | TokenNames,
            GroupNames | RuleNames | FragmentNames
        >

        return this as unknown as Parser<{
            [K in keyof NewRuleDefs] : NewRuleDefs[K] //flatten the type
        }, FragmentDefinitions, GroupNames, NewTokenNames>
    }

    /**
     * Fragments are partial rules and can only be used in other rule definitions
     */
    fragment<
        NewFragmentName extends string,
        TokenTypeOrOtherFragmentNameArr extends ( RawTokenType | FragmentNames | RuleNames )[],
    >(
        //trick to disallow duplicate rule names
        name : ExcludeWithError<
            NewFragmentName, RuleNames | FragmentNames | GroupNames | TokenNames,
            OverlappedDefinitionError<NewFragmentName, RuleNames | FragmentNames | GroupNames | TokenNames>,
            this
        >,

        //disallow empty [] and disallow rule names (only allow fragment names and token names)
        seq : ExcludeWithError<
            TokenTypeOrOtherFragmentNameArr, never[], 
            `Type error: Fragment --> ${NewFragmentName} <--" cannot have an empty definition`,
            this
        >   & {
            [K in keyof TokenTypeOrOtherFragmentNameArr] : ExcludeWithError<
                TokenTypeOrOtherFragmentNameArr[K],
                RuleNames,
                `Type error: Fragment --> ${NewFragmentName} <--" cannot reference rule --> ${TokenTypeOrOtherFragmentNameArr[K]} <--"`,
                this
            >
        }
    ){
        (this.#fragments as any)[name] = seq.flatMap(s => {
            if(s in this.#fragments) return this.#fragments[s];
            return s;
        })

        //flatten fragments
        type NewArr = Flatten<{
            [K in keyof TokenTypeOrOtherFragmentNameArr] : 
                TokenTypeOrOtherFragmentNameArr[K] extends FragmentNames
                ? FragmentDefinitions[TokenTypeOrOtherFragmentNameArr[K]]
                : TokenTypeOrOtherFragmentNameArr[K]
        }>

        type NewFragmentDefs = {
            [K in NewFragmentName] : NewArr
        } & FragmentDefinitions

        type NewTokenNames = Exclude<
            Extract<TokenTypeOrOtherFragmentNameArr[number], string> | TokenNames,
            GroupNames | RuleNames | FragmentNames
        >

        return this as unknown as Parser<RuleDefinitions, {
            [K in keyof NewFragmentDefs] : NewFragmentDefs[K] //flatten the type
        }, GroupNames, NewTokenNames>
    }

    group<
        GroupName extends string,
        GroupContent extends string[] = []
    >(
        name : ExcludeWithError<
            GroupName, RuleNames | FragmentNames | GroupNames | TokenNames,
            OverlappedDefinitionError<GroupName, RuleNames | FragmentNames | GroupNames | TokenNames>,
            this
        >,
        contents? : GroupContent & {
            [K in keyof GroupContent] : ExcludeWithError<
                GroupContent[K],
                FragmentNames,
                `Type error: Group --> ${GroupName} <--" cannot reference fragment --> ${GroupContent[K]} <--"`,
                this
            >
        }
    ){
        let flatContent = (contents || []) as string[]

        flatContent = flatContent.flatMap(s => {
            if(this.isGroupName(s)) return this.#groups[s];
            return s;
        })

        this.#groups[name] = Array.from(new Set([...(this.#groups[name] || []), ...flatContent]))
        this.#static_checked = false

        type NewGroupDefs = GroupNames | GroupName
        type NewTokenNames = Exclude<
            GroupContent[number] | TokenNames,
            GroupNames | RuleNames | FragmentNames
        >

        return this as unknown as Parser<RuleDefinitions, FragmentDefinitions, NewGroupDefs, NewTokenNames>
    }



    isRuleName(s : RuleNames) : true;
    isRuleName(s : GroupNames) : false;
    isRuleName(s : FragmentNames) : false;
    isRuleName(s : any) : s is RuleNames;
    isRuleName(s : any) : s is RuleNames {
        return s in this.#rules
    }

    isGroupName(s : string) : s is GroupNames {
        return s in this.#groups
    }

    isFragmentName(s : string) : s is FragmentNames {
        return s in this.#fragments
    }

    isTokenName(s : string) : s is TokenNames {
        return !this.isRuleName(s) && !this.isGroupName(s) && !this.isFragmentName(s)
    }

    isInGroup(s : string, group_name : string) : boolean {
        return this.#groups[group_name]?.includes(s)
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

    protected getRuleSet(
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
            throw log
        }

        const [m, p] = lookup<RuleNames>(
            input,
            this.getRuleSet(use_rule),
            option.heuristic_filter_relaxing,
            this.#groups,
            option.keep_duplicate_match
        )

        //each match is a path
        if(!m.length){
            log.push({
                isError : true,
                message : `No matching rule found for sequence ${input.join(" ")}`,
                matches : p,
                start_sequence : input
            })
            throw log
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
                let currentPath : (TokenMatch<RuleNames> | RuleMatch<RuleNames>)[][] = []

                path_iter: for(const r of match.parsed_result.path){

                    log.push({
                        isError : false,
                        message : `Exploring path element ${JSON.stringify(r.value, null, 0)} of matched rule ${matchedTopRule}`,
                        matches : [match],
                        start_sequence : input
                    })


                    if(r.type === "anchor") {
                        log.push({
                            isError : false,
                            message : `Path element is an anchor with value "${r.value}" and anchor name "${r.anchor_name}"`,
                            matches : [match],
                            start_sequence : input
                        })
                        if(!currentPath.length){
                            //first explored
                            currentPath = [[new TokenMatch(r.value)]]
                        }
                        else currentPath.forEach(path => path.push(new TokenMatch(r.value)));
                    } else if(r.type === "segment"){
                        //quick check

                        // NOTE : without this, tail recurson rule stop working somehow
                        if(
                            r.value.length === 1 && 
                            this.isGroupName(r.expected_rule_or_group) &&
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
                            }
                            else currentPath.forEach(path => path.push(new TokenMatch(r.value[0])));
                            continue path_iter
                        }

                        //recurse 
                        try {
                            if(
                                this.isGroupName(r.expected_rule_or_group) ||
                                this.isRuleName(r.expected_rule_or_group)
                            ){
                                log.push({
                                    isError : false,
                                    message : `Recursing into expected rule/group ${r.expected_rule_or_group} for segment [${r.value.join(" ")}]`,
                                    matches : [match],
                                    start_sequence : r.value
                                })
                                
                                const Paths = this.recursive_descend(r.value, log, option, [r.expected_rule_or_group], depth + 1);
                                
                                log.push({
                                    isError : false,
                                    message : `Found ${Paths.length} paths for expected rule/group ${r.expected_rule_or_group} for segment [${r.value.join(" ")}], current paths : ${currentPath.length ? JSON.stringify(currentPath, null, 0) : "<empty>"}`,
                                    matches : [],
                                    start_sequence : r.value
                                })

                                if(currentPath.length){
                                    const newMatchElems = [] as typeof currentPath
                                    for(const continuation of Paths){
                                        for(const currentPaths of currentPath){
                                            newMatchElems.push([...currentPaths, continuation])
                                        }
                                    }
                                    currentPath = newMatchElems
                                } else {
                                    currentPath = Paths.map(p => [p])
                                }
                                
                            }

                            else {
                                log.push({
                                    isError : true,
                                    message : `Expected rule/group ${r.expected_rule_or_group} for segment [${r.value.join(" ")}] is not found in the rule set, cannot recurse`,
                                    matches : [match],
                                    start_sequence : r.value
                                })
                                throw 0
                            }

                        } catch(e){
                            //ignore, this path is invalid
                            log.push({
                                isError : true,
                                message : `Path invalid, failed to match expected rule/group ${r.expected_rule_or_group} for segment [${r.value.join(" ")}]`,
                                matches : [],
                                start_sequence : r.value
                            })
                            currentPath = [] //reset current path since this path is invalid
                            break path_iter
                        }
                    }

                }
                res.push(...currentPath.map(path => new RuleMatch(path, matchedTopRule)))
            }
        )

        return res
    }

    parse(
        input : string | string[],
        parse_option : ParseOption<string | undefined>,
        starting_rules? : RuleNames[]
    ) : [RuleMatch<RuleNames>[], LogReport<RuleNames, true | false>[]] | never {
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
            return [
                this.recursive_descend(tokenArr, log, parse_option, starting_rules) as RuleMatch<RuleNames>[],
                log
            ]
        } catch(e) {
            return [
                [],
                log
            ]
        }
    }

    private choose<T>(arr : T[]) : T {
        return arr[Math.floor(Math.random() * arr.length)]
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

        if(rule === undefined)
            rule = this.choose(Object.keys(this.#rules) as RuleNames[])
        else if(this.isGroupName(rule)){
            const group_members = this.#groups[rule]!
            const random_chosen_member = this.choose(group_members)
            if(this.isRuleName(random_chosen_member) || this.isGroupName(random_chosen_member)){
                return this.unparse(maxDepth, random_chosen_member, cul, depth + 1)
            }
            return [...cul, random_chosen_member]
        }

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
}

