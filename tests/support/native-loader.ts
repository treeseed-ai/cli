/** Existing native verifier preload selection, extracted before its regression. */
export function nativePreloadArguments(_args:readonly string[]):string[] {
 return ['--import',import.meta.resolve('tsx')];
}
