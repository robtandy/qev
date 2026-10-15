// Resolve against the application, not the domain root: / locally, /qev/ on
// project Pages, or any other static subdirectory. Workers use the same tree.
const root = new URL("../", import.meta.url).href;
export function appURL(path, base = root) {
  if (typeof path !== "string" || !path || path.startsWith("/") || path.includes("\\") ||
      path.split("/").some(part => !part || part === "." || part === "..") || /[:?#%\s]/.test(path)) throw new Error("Expected an application-relative asset path.");
  return new URL(path, base).href;
}
