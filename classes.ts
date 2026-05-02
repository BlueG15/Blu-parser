// export abstract class ResolvedMatch<RuleNames extends string>{}

export class TokenMatch<RuleNames extends string>{
    constructor(
        public token : string
    ){}
}

export class RuleMatch<RuleNames extends string>{
    constructor(
        public matched : (RuleMatch<RuleNames> | TokenMatch<RuleNames>)[],
        public rule_name : RuleNames
    ){}
}

//in progress classes
export class Match<RuleNames extends string>{
    constructor(
        public input_tokens : string[],
        /**
         * ***matched_rules*** : *string[]* The rule names matched with the same layouts
         * */
        public matched_rule : RuleNames,
        public expect_sequence : string[],

        /**
         * **parsed_result** : an object with 2 properties. 
         * @property tokenIndices : *number[][]*, array of "token groups"'s indices, each inner array is a grouping 
         * @property path : *(string | string[])[]*, array of "token groups"'s contents, string is a token and string[] is another rule's tokens
         * */
        public parsed_result : {
            tokenIndices : number[][],
                path : ({
                type : "anchor",
                anchor_name : string,
                value : string
            } | {
                type : "segment",
                expected_rule_or_group : string
                value : string[]
            })[]
        },

        /** 
         * ***anchor_positions** :  *number[]*, the indices of tokens that are classified as "anchors", ussually direct keyword and not other rules's invocation
         */
        public anchor_positions : number[] = [],
    ){}

    /** use to compare if matches overlaps */
    getSignature(){
        if(!this.parsed_result.tokenIndices.length) return `[]`
        return this.parsed_result.tokenIndices.map(group => `[${group.join(",")}]`).join("")
    }
}

export class PartialMatch<RuleNames extends string>{
    constructor(
        public rule_name     : RuleNames,
        public matched_anchors : ReadonlyArray<string>,
        public failed_anchor   : string,
        public failed_tokens   : string,
    ){}

    get score(){
        return this.matched_anchors.length
    }

    getSignature(){
        return `PartialMatch(rule: ${this.rule_name}, matched_anchors: [${this.matched_anchors.join(", ")}], failed_anchor: ${this.failed_anchor}, failed_tokens: ${this.failed_tokens})`
    }
}