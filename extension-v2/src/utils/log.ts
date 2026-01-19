export function log(log: any) {
    console.log(log)
}

export function error(error:any){
    console.error(error)
}

export function warn(warning:any){
    console.warn(warning)
}

export function test(condition: boolean, message?: string): boolean {
  console.assert(condition, message);
  return condition;
}
