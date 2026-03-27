export async function createNitroViteBridge(enabled) {
  if (!enabled) return null;
  
  try {
    const vite = await import("vite");
    return await vite.createServer({
      server: {
        middlewareMode: true
      },
      appType: "custom"
    });
  } catch {
    return null;
  }
}