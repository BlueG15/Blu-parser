export type AnyNestedArray<T = any> = (T | AnyNestedArray<T>)[]
export type Flatten<T extends AnyNestedArray, cul extends any[] = []> = 
T extends never[] ? cul :
T extends [infer Head, ...infer Tails] ? (
    Head extends any[] ? Flatten<[...Head, ...Tails], cul> : Flatten<Tails, [...cul, Head]>
) : never

export type ObjectValue<T extends Record<any, any>> = T[keyof T]


export type ExcludeWithError<T, O, Error extends string> = T extends O ? {err : Error} & T : T