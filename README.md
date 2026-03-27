# Nitro 5 — Web Server

<img align="center" src="https://img.shields.io/badge/Open%20Source-GitHub-black?style=for-the-badge&logo=github" />
<img align="center" src="https://img.shields.io/badge/License-BSD%203--Clause-blue?style=for-the-badge&logo=open-source-initiative" />

[![Nitro5](https://img.shields.io/badge/Nitro5-Web%20Server-blue?style=for-the-badge&logo=node.js)](https://nitro5.opendnf.cloud/)
![Performance](https://img.shields.io/badge/Performance-Fast-red?style=for-the-badge&logo=lightning)
![Language](https://img.shields.io/badge/Node.js-C%2B%2B-green?style=for-the-badge&logo=node.js)

![TypeScript](https://img.shields.io/badge/TypeScript-Supported-3178C6?style=for-the-badge&logo=typescript)
![JSX](https://img.shields.io/badge/JSX-TSX-61DAFB?style=for-the-badge&logo=react)
![ESBuild](https://img.shields.io/badge/ESBuild-Bundler-F7DF1E?style=for-the-badge&logo=esbuild)

![Fast](https://img.shields.io/badge/Ultra-Fast-ff4d4d?style=for-the-badge&logo=rocket)
![Low Latency](https://img.shields.io/badge/Low-Latency-brightgreen?style=for-the-badge)
![Scalable](https://img.shields.io/badge/Scalable-Architecture-orange?style=for-the-badge)

---

## Overview

Nitro 5 is a high-performance web server framework built with a hybrid architecture of **Node.js** and **C++**. It is designed to provide fast, predictable, and efficient request handling while maintaining a modern and developer-friendly ecosystem.

At its core, Nitro 5 uses Node.js to manage application-level logic, routing, and server-side JavaScript execution. C++ is reserved for performance-critical components such as low-level networking, request processing, and system-level optimization. This architecture is intended to deliver improved speed, lower latency, and better resource efficiency compared to traditional JavaScript-only server implementations.

Nitro 5 also provides built-in support for **TypeScript** and **JSX/TSX**, making it suitable for modern frontend and backend workflows. With an **ESBuild-powered** bundler, Nitro 5 can compile and transform modern JavaScript and TypeScript code with exceptional speed. This helps developers maintain a rapid development loop while preserving production performance.

In addition, Nitro 5 is designed with predictability and scalability in mind. Its architecture emphasizes consistent behavior under load, making it well suited for real-time applications, REST APIs, microservices, and larger web systems. By separating high-level application logic from low-level optimization, Nitro 5 aims to remain both flexible and highly optimized.

---

## Nitro 5 Delivers

Nitro 5 includes the following capabilities:

- Scalable web server architecture
- TypeScript support
- TypeScript cache
- JSX / TSX support for React
- Vite support
- Hot Module Replacement (HMR)
- Caching
- Watcher mode
- Router
- Dashboard
- Thread workers

---

## Key Highlights

Nitro 5 is intended for developers who want:

- A modern web server foundation
- Strong developer ergonomics
- Fast compilation and rebuild times
- Clean support for TypeScript and TSX
- A system that can evolve into a production-oriented framework
- A balance between productivity and native performance

---

## Architecture

Nitro 5 is organized around several layers of responsibility:

### Application Layer
Handles routing, middleware, application logic, configuration, and framework-level behavior.

### Runtime Layer
Provides the Node.js execution environment and coordinates server operations.

### Performance Layer
Uses C++ bindings for lower-level optimizations, request handling, and performance-sensitive execution paths.

### Build Layer
Uses ESBuild to handle fast transformations for TypeScript, TSX, and modern module workflows.

This layered structure is designed to support both development speed and runtime efficiency.

---

## How to Use

### 1. Install the C/C++ Toolchain

Before installing Nitro 5, make sure a C/C++ compiler is available in your environment.

```bash
apt install clang
```

### 2. Install Nitro 5

```bash
npm install nitro5
```

### 3. Wait for Postinstall

Nitro 5 will automatically build native modules using C++ bindings during the postinstall process.

### 4. Run the Nitro 5 CLI

```bash
nitro5
```

### 5. Open the Local Server

Visit:

```bash
http://localhost:3000/
```

You should then see the Nitro 5 web server running in your browser.

---

## Example Configuration

A typical Nitro 5 project may include a `nitro5.config.js` file like the following:

```js
export default {
  server: {
    port: 3000,
  },
  dev: {
    useVite: false
  },
  cache: {
    enabled: true,
    ttl: 60
  },
  dashboard: true,
  cors: {
    enabled: true,
    origin: "*"
  },
  cacheTs: true
};
```

---

## Example Project Structure

A common project layout may look like this:

```txt
.
|____ nitro5.config.js
|
|__ public
    |___ index.html
    |___ app.tsx
    |___ main.ts
```

---

## Example Frontend Setup

### `public/index.html`

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Nitro 5</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

### `public/app.tsx`

```tsx
import React from "react";

export function App() {
  return (
    <div>
      <h1>Nitro5 + React 19 🚀</h1>
      <p>Web server ready!</p>
    </div>
  );
}
```

### `public/main.ts`

```ts
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";

createRoot(document.getElementById("app")!).render(<App />);
```

---

## Why Nitro 5

Nitro 5 is intended for developers who want:

- High runtime performance
- A TypeScript-first development experience
- React and TSX support
- Fast rebuilds and iteration
- A scalable architecture for real-world applications
- A framework that balances developer productivity with native performance

---

## Contribution

Contributions are welcome.

If you find a bug, please open an issue or submit a pull request in the GitHub repository.

Before contributing, please ensure that your changes are clear, consistent, and aligned with the project’s architecture and style.

---

## Roadmap

Planned and potential future improvements may include:

- Improved developer dashboard
- Enhanced caching controls
- Better TypeScript tooling
- Expanded plugin support
- More advanced HMR integration
- Multi-threaded request optimization
- Additional router features
- Production build optimizations

---

## License

This project is licensed under the **BSD 3-Clause License**.

Copyright (C) 2026 OpenDN Foundation

---

## Project Website

Official website: https://nitro5.opendnf.cloud/
