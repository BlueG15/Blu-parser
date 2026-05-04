type SymbolType = "rule" | "fragment" | "group" | "token" | "unknown"

interface ErrorInfo {
    symbol_name : string
    symbol_type : SymbolType
}

interface ErrorInfoAlreadyDefined extends ErrorInfo {
    defined_type : SymbolType
}

interface ErrorInfoTypeCannotBeUsed extends ErrorInfo {
    scope_type : SymbolType
}

export type AlreadyDefined<Info extends ErrorInfoAlreadyDefined> = Error &
    `Type error: ${Info["symbol_type"]} '${Info["symbol_name"]}' is already defined as a/an ${Info["defined_type"]}`

export type EmptyDefinition<Info extends ErrorInfo> = Error &
    `Type error: ${Info["symbol_type"]} '${Info["symbol_name"]}' cannot be defined using a/an empty sequence list`

export type SymbolTypeCannotBeUsedHere<Info extends ErrorInfoTypeCannotBeUsed> = Error &
    `Type error: Symbol type ${Info["symbol_type"]} '${Info["symbol_name"]}' cannot be used in a/an ${Info["scope_type"]} scope's sequence`

export type PostProcessorInputTypeCannotBeInfered<Info extends ErrorInfo> = Error &
    `Type error: The input type of post processor '${Info["symbol_name"]}' cannot be infered, please report this error to the github address in the README of this project`

export type CannotBeSelfReferential<Info extends ErrorInfo> = Error &
    `Type error: ${Info["symbol_type"]} '${Info["symbol_name"]}' cannot be used in its own definition sequence`