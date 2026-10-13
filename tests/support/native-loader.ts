/** Keep the owning native runner's loader and fence; never resolve a CLI loader. */
export function nativePreloadArguments(args:readonly string[]):string[] {
 const imports:string[]=[],specifiers:string[]=[];
 for(let index=0;index<args.length;index++) {
  const argument=args[index]!;
  if(argument==='--import') {
   const value=args[++index];
   if(!value||value.startsWith('--'))throw new Error('Original native import value is required.');
   imports.push(argument,value);specifiers.push(value);
  }else if(argument.startsWith('--import=')) {
   const value=argument.slice('--import='.length);
   if(!value||value.startsWith('--'))throw new Error('Original native import value is required.');
   imports.push(argument);specifiers.push(value);
  }
 }
 if(!specifiers.some(value=>value==='tsx'||/[/\\]tsx[/\\]/u.test(value)))
  throw new Error('Original owning TypeScript loader is required.');
 return imports;
}
