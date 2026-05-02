export type AnyNestedArray<T = any> = (T | AnyNestedArray<T>)[]
export type Flatten<T extends AnyNestedArray, cul extends any[] = []> = 
T extends never[] ? cul :
T extends [infer Head, ...infer Tails] ? (
    Head extends any[] ? Flatten<[...Head, ...Tails], cul> : Flatten<Tails, [...cul, Head]>
) : never

export type ObjectValue<T extends Record<any, any>> = T[keyof T]

interface BrandedI<T> {
    "#__brand" : T; //technicaly private but ts is funny
}

export type Branded<T, O> = T

export type ExcludeWithError<T, O, Error extends string, Branding> = T extends O ? Branded<Error, Branding> : T
export type ExcludeWithErrorMany<T, OArr extends any[], ErrorArr extends string[], Branding> = 
    OArr extends never[] ? T : //base case or no error
    OArr extends [infer OHead, ...infer OTails] ? (
        ErrorArr extends [infer EHead, ...infer ETails extends string[]] ? (
            T extends OHead ? Branded<EHead, Branding> : ExcludeWithErrorMany<T, OTails, ETails, Branding>
        ) : Branded<`Error: ExcludeWithErrorMany requires ErrorArr to have the same length as OArr`, Branding>
    ) : Branded<`Error: ExcludeWithErrorMany requires OArr to have the same length as ErrorArr`, Branding>