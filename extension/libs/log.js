
export function log(log) {
    console.log(log);
}

export function error(error){
    console.error(error);
}

export function warn(warning){
    console.warn(warning);
}

export function test(condition, message) {
  console.assert(condition, message);
  return condition;
}