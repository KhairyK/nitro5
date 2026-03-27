import ms from "ms";

export class MemoryCache {
  constructor() {
    this.store = new Map();
  }
  
  set(key, value, ttl) {
    const ttlMs = typeof ttl === "string" ? ms(ttl) : ttl;
    const expiresAt = Date.now() + ttlMs;
    
    this.store.set(key, {
      value,
      expiresAt
    });
  }
  
  get(key) {
    const item = this.store.get(key);
    if (!item) return null;
    
    if (Date.now() > item.expiresAt) {
      this.store.delete(key);
      return null;
    }
    
    return item.value;
  }
  
  delete(key) {
    this.store.delete(key);
  }
  
  clear() {
    this.store.clear();
  }
}

export function matchesCacheRule(filePath, patterns = []) {
  const lower = filePath.toLowerCase();
  
  return patterns.some((pattern) => {
    const p = pattern.toLowerCase();
    
    if (p === "*.css") return lower.endsWith(".css");
    if (p === "*.js") return lower.endsWith(".js");
    if (p === "*.svg") return lower.endsWith(".svg");
    if (p === "*.webp") return lower.endsWith(".webp");
    if (p === "*.html") return lower.endsWith(".html");
    
    return false;
  });
}