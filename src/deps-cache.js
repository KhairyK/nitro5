const depGraph = new Map(); // file -> [deps]
const reverseGraph = new Map(); // dep -> [files]

const cache = new Map(); // file -> code

export function setCache(file, code) {
  cache.set(file, code);
}

export function getCache(file) {
  return cache.get(file);
}

export function hasCache(file) {
  return cache.has(file);
}

export function setDeps(file, deps = []) {
  depGraph.set(file, deps);

  for (const dep of deps) {
    if (!reverseGraph.has(dep)) reverseGraph.set(dep, []);
    reverseGraph.get(dep).push(file);
  }
}

export function invalidate(file) {
  cache.delete(file);

  const dependents = reverseGraph.get(file) || [];

  for (const dep of dependents) {
    cache.delete(dep);
  }

  cache.delete(file);
}
