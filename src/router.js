export class Router {
  constructor() {
    this.routes = {
      GET: new Map(),
      POST: new Map(),
      PUT: new Map(),
      PATCH: new Map(),
      DELETE: new Map()
    };

    this.middlewares = [];
  }

  // ---------------------------
  // utils
  // ---------------------------
  normalize(path) {
    if (!path) return "/";

    let p = String(path);

    // buang query + hash
    p = p.split("?")[0].split("#")[0];

    // normalize slash
    p = p.replace(/\/+/g, "/");

    // hapus trailing slash kecuali root
    if (p.length > 1) p = p.replace(/\/+$/, "");

    if (!p.startsWith("/")) p = "/" + p;

    return p || "/";
  }

  // ---------------------------
  // middleware
  // ---------------------------
  use(fn) {
    this.middlewares.push(fn);
  }

  // ---------------------------
  // register routes
  // ---------------------------
  get(path, handler) {
    this.routes.GET.set(this.normalize(path), handler);
  }

  post(path, handler) {
    this.routes.POST.set(this.normalize(path), handler);
  }

  put(path, handler) {
    this.routes.PUT.set(this.normalize(path), handler);
  }

  patch(path, handler) {
    this.routes.PATCH.set(this.normalize(path), handler);
  }

  delete(path, handler) {
    this.routes.DELETE.set(this.normalize(path), handler);
  }

  // ---------------------------
  // resolve route
  // ---------------------------
  resolve(method, pathname) {
    const m = String(method || "GET").toUpperCase();
    const p = this.normalize(pathname);

    return this.routes[m]?.get(p) ?? null;
  }

  // ---------------------------
  // debug helper (optional)
  // ---------------------------
  debug() {
    console.log("=== ROUTES ===");
    for (const method of Object.keys(this.routes)) {
      console.log(method, [...this.routes[method].keys()]);
    }
  }
}
