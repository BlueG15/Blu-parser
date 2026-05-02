import { CONFIG } from "./config";
import { Match, PartialMatch } from "./classes";

function match<RuleNames extends string = never>(
    rule_name         : RuleNames,
    input_sequence    : ReadonlyArray<string>, 
    expected_sequence : ReadonlyArray<string>, 
    
    isRuleName  : (s : string) => s is RuleNames,

    // group controls
    isGroupName? : (s : string) => boolean,
    isInGroup?   : (s : string, group_name : string) => boolean,

    early_stop_anchor_count = 0, //returns early if matched anchors strictly below this count,
){
    if(CONFIG.VERBOSE) 
        console.log(
            `Attempting to match input sequence "${input_sequence.join(" ")}" with expected sequence "${expected_sequence.join(" ")}" for action(s) ${rule_name}`
        );

    const anchors = expected_sequence.filter(t => !isRuleName(t))

    if(!anchors.length){
        if(CONFIG.VERBOSE) console.log(`Action ${rule_name} with pattern ${expected_sequence.join(", ")} has no anchors, skipping.`);
        return [];
    };

    const potentialMatchesForAnchors : number[][] = []
    const isFlexibleAnchor: Record<string, boolean> = {} //anchor name -> is flexible
    const hardAnchorIndices: number[] = [] // Indices of hard anchors in the anchors array
    let i = 0

    // Collect potential matches for each anchor, including flexible classifications
   for(const anchor of anchors){
        const matches: number[] = []
        for(let j = 0; j < input_sequence.length; j++) {
            // Try exact token type match
            if(input_sequence[j] === anchor) {
                matches.push(j)
            }
            // Try synonyms
            else if(
                isGroupName && isInGroup && 
                isGroupName(anchor) && isInGroup(input_sequence[j], anchor)
            ) {
                matches.push(j)
            }
        }
        
        // Check if this is a group anchor
        const isGroup = isGroupName?.(anchor)
        
        if(matches.length === 0){
            if(isGroup) {
                // Group anchor with no token matches - mark as flexible, don't fail
                isFlexibleAnchor[anchor] = true
                potentialMatchesForAnchors[i] = []
                if(CONFIG.VERBOSE) console.log(`  [FLEXIBLE] Anchor "${anchor}" in index ${i} is a group with no token matches`)
            } else {
                if(CONFIG.VERBOSE) 
                    console.log(`  [FAILED ANCHOR] Anchor "${anchor}" in index ${i} has no matches and is not a group, failing this pattern.`);
                // Hard anchor with no matches - fail
                return new PartialMatch<RuleNames>(
                    rule_name,
                    anchors.slice(0, i),
                    anchor,
                    input_sequence.join(" ")
                )
            }
        } else {
            isFlexibleAnchor[anchor] = false
            hardAnchorIndices.push(i)
            potentialMatchesForAnchors[i] = matches
            if(CONFIG.VERBOSE) console.log(`  [HARD] Anchor "${anchor}" found at positions: ${matches.join(", ")}`)
        }
        i++;
    }

    if(anchors.length < early_stop_anchor_count){
        if(CONFIG.VERBOSE) 
            console.log(`  [EARLY STOP] Only ${anchors.length} anchors found, below early stop threshold of ${early_stop_anchor_count}, skipping detailed matching.`)
        return []
    }

    const validPaths : number[][] = []
    const path : number[] = []
    const hard_anchor_names : string[] = []

    // Travel only on hard anchors
    function travel(hard_anchor_index : number){
        if(hard_anchor_index >= hardAnchorIndices.length){
            validPaths.push([...path]);
            return;
        }

        const anchor_index = hardAnchorIndices[hard_anchor_index]
        hard_anchor_names[hard_anchor_index] = anchors[anchor_index]
        const current_anchor_indices = potentialMatchesForAnchors[anchor_index]
        const max_index_in_path = path.length > 0 ? path[path.length - 1] : -1

        for(const index of current_anchor_indices){
            if(index <= max_index_in_path) continue;
            path.push(index)
            travel(hard_anchor_index + 1)
            path.pop()
        }
    }

    travel(0)

    if(CONFIG.VERBOSE) 
        //logs isFlexible
        console.log(isFlexibleAnchor)

    // Optimize: reconstruct matches more efficiently
    return validPaths.map(hardAnchorPath => {
        hardAnchorPath.push(input_sequence.length)
        const segmentedPath: Match<RuleNames>["parsed_result"]["path"] = []
        const tokenIndices: number[][] = []
        let prevIdx = -1

        if(CONFIG.VERBOSE)
            console.log("Hard anchors: ", hardAnchorPath)

        for(
            let path_traversal_idx = 0; 
            path_traversal_idx < hardAnchorPath.length; 
            path_traversal_idx++
        ){
            const anchorTokenIndex = hardAnchorPath[path_traversal_idx]

            const anchor_type_index = segmentedPath.length
            const anchorName = hard_anchor_names[anchor_type_index]
            const isFlexible = isFlexibleAnchor[anchorName]

            if(CONFIG.VERBOSE) {
                console.log(`Processing anchor "${anchorName || "<EOF>"}" at input index ${anchorTokenIndex}, expected index ${anchor_type_index} (flexible: ${!!isFlexible})`)
            }
            
            if(isFlexible) {
                // For flexible anchors, span from prevIdx+1 to the start of next hard anchor
                // There is always a hard anchor at end of input
                const endIdx = hardAnchorPath[i + 1]

                // Add flexible section from prevIdx+1 to endIdx
                if(endIdx !== undefined && endIdx >= prevIdx + 1) {
                    const indices: number[] = []
                    for(let idx = prevIdx + 1; idx <= endIdx; idx++) {
                        indices.push(idx)
                    }

                    if(indices.length !== 0){
                        if(CONFIG.VERBOSE) console.log(`  [FLEX PATH] Group "${anchorName}" section: ${indices.map(idx => input_sequence[idx]).join(" ")} (indices ${indices.join(", ")})`)
                            segmentedPath.push({
                            type : "segment",
                            expected_rule_or_group : anchorName,
                            value : indices.map(idx => input_sequence[idx] as string)
                        })
                        tokenIndices.push(indices)
                        prevIdx = endIdx
                    }
                }
            } else {
                // Add segment before anchor if any
                const segment: string[] = []
                const indices: number[] = []
                for(let idx = prevIdx + 1; idx < anchorTokenIndex; idx++) {
                    segment.push(input_sequence[idx] as string)
                    indices.push(idx)
                }
                const currentExpectedIndex = segmentedPath.length
                if(segment.length !== 0 && expected_sequence[currentExpectedIndex] !== undefined){
                    if(CONFIG.VERBOSE) 
                        console.log(`  [HARD PATH] Before anchor ${anchorName || "<EOF>"} segment: ${segment.join(" ")} (indices ${indices.join(", ")})`);
                    segmentedPath.push({
                        type : "segment",
                        expected_rule_or_group : expected_sequence[currentExpectedIndex] ?? "aaaaaaaaaaaaaaaaaaa",
                        value : segment
                    })
                    tokenIndices.push(indices)
                }
                
                if(anchorName !== undefined){ 
                    // Add anchor
                    if(CONFIG.VERBOSE) 
                        console.log(`  [HARD PATH] Anchor "${anchorName}": ${input_sequence[anchorTokenIndex]} (index ${anchorTokenIndex})`);
                    // segmentedPath.push(input_sequence[anchorPos] as string)
                    segmentedPath.push({
                        type : "anchor",
                        anchor_name : anchorName,
                        value : input_sequence[anchorTokenIndex]
                    })
                    tokenIndices.push([anchorTokenIndex])
                    prevIdx = anchorTokenIndex
                }
            }  
        }

        hardAnchorPath.pop() //pop the artificially added end index

        const last_consumed_index = tokenIndices.at(-1)?.at(-1) ?? -1

        if(CONFIG.VERBOSE) {
            console.log(`  [MATCH RESULT] Pattern: ${JSON.stringify(segmentedPath, null, 4)}`)
            console.log(`    token indices: ${JSON.stringify(tokenIndices)}`)
            console.log(`    last consumed index: ${last_consumed_index}, input length: ${input_sequence.length}`)
        }

        //check if not full match

        if(last_consumed_index === input_sequence.length - 1 && segmentedPath.length === expected_sequence.length){
            if(CONFIG.VERBOSE) console.log(`  [FULL MATCH] All input tokens consumed.`);

            return new Match(
                input_sequence as string[],
                rule_name, 
                expected_sequence as string[],
                {
                    tokenIndices,
                    path : segmentedPath,
                }, 
                hardAnchorPath
            )
        } else if(CONFIG.VERBOSE){
            if(segmentedPath.length === expected_sequence.length){
                console.log(`    [PARTIAL MATCH] rejected cause segment not match expected's length: got ${segmentedPath.length}, expected ${expected_sequence.length}`)
            }
            else console.log(`    [PARTIAL MATCH: rejected cause this is not a full match, ends at index ${last_consumed_index}]`)
        }

        return undefined
    }).filter(m => m) as Match<RuleNames>[]
}

export function lookup<
    RuleNames extends string = never
>(
    token_name_sequence : string[], 
    rules : Record<RuleNames, string[]>,
    heuristic_filter_cutoff = 4,

    // synonym controls
    groups : Record<string, string[]> = {},
    keep_duplicate_match = false,
){
    const seen = new Map<string, Match<RuleNames>>()
    let best_matches : Match<RuleNames>[] = []
    let best_anchor_count = 0

    // For error reporting: track patterns that got furthest before failing
    let best_failed_patterns : PartialMatch<RuleNames>[] = []
    let best_failed_anchor_count = 0

    function isRuleName(s : any) : s is RuleNames {
        return s in rules
    }

    function isGroupName(s : string) : boolean {
        return s in groups
    }

    //only called after isGroupName check, so we can be sure group_name exists in groups
    function isInGroup(s : string, group_name : string) : boolean {
        return groups[group_name]!.includes(s)
    }

    for(const rule_name in rules){
        const seq = rules[rule_name]
        const matches = match(
            rule_name, 
            token_name_sequence, 
            seq, 
            isRuleName,
            isGroupName,
            isInGroup,
            best_anchor_count - heuristic_filter_cutoff,
        )

        if(matches instanceof PartialMatch){
            if(matches.score > best_failed_anchor_count){
                best_failed_patterns = [matches]
                best_failed_anchor_count = matches.score
            } else if(matches.score === best_failed_anchor_count){
                best_failed_patterns.push(matches)
            }
            continue;
        }

        if(CONFIG.VERBOSE) {
            console.log(`Matches for pattern ${seq.join(", ")}:`)
            console.log(`Found ${matches.length} matches for action(s) ${rule_name} wih anchor lengths : ${matches.map(m => m.anchor_positions.length).join(", ")}`)
        }

        for(const m of matches){
            const matchSignature = m.getSignature()
            const oldMatch = seen.get(matchSignature)
            if(
                oldMatch &&
                (
                    !keep_duplicate_match ||
                    m.matched_rule === oldMatch.matched_rule // still skip if its the same rule
                ) 
            ){
                if(CONFIG.VERBOSE) console.log(`    [FILTER] Match "${matchSignature}" REJECTED: duplicate match already seen`);
                continue
            }
            seen.set(matchSignature, m)
            
            const anchorCount = m.anchor_positions.length

            const tolerance = best_anchor_count - heuristic_filter_cutoff
            const ofAcceptableTolerance = anchorCount >= tolerance

            if(CONFIG.VERBOSE) {
                console.log(`    [FILTER] Match "${matchSignature}" has ${anchorCount} anchors. best=${best_anchor_count}, tolerance_check=${anchorCount}>=(${best_anchor_count}-${heuristic_filter_cutoff})=${ofAcceptableTolerance}`)
            }

            if(ofAcceptableTolerance){
                if(anchorCount > best_anchor_count){
                    best_anchor_count = anchorCount
                    const newTolerance = best_anchor_count - heuristic_filter_cutoff
                    best_matches = best_matches.filter(x => {
                        const current_score = x.anchor_positions.length
                        return current_score >= newTolerance
                    })
                    best_matches.push(m)
                } else {
                    best_matches.push(m)
                }
            } else if(CONFIG.VERBOSE) 
                console.log(`    [FILTERED OUT] Match "${matchSignature}" rejected by heuristic filter with ${anchorCount} anchors, below tolerance ${tolerance}.`)
        }
    }

    if(CONFIG.VERBOSE) {
        console.log(`\n[FINAL RESULTS]`)
        console.log(`Best matches count: ${best_matches.length}`)
        console.log(`Best anchor count threshold: ${best_anchor_count}`)
        console.log(`Heuristic filter cutoff: ${heuristic_filter_cutoff}`)
        best_matches.forEach((m, idx) => {
            console.log(`  Match ${idx + 1}: rule="${m.matched_rule}", anchors=${m.anchor_positions.length}, pattern="${m.expect_sequence.join(", ")}"`)
        })
    }

    return [best_matches, best_failed_patterns] as const
}