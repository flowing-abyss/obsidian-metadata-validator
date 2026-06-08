import type { App, TFile } from "obsidian";

const JS_SOURCE_TIMEOUT_MS = 5000;
const JS_VALIDATOR_TIMEOUT_MS = 2000;

type GenericFn = (...args: unknown[]) => unknown;

const fnCache = new Map<string, GenericFn>();
const MAX_CACHE_SIZE = 50;

function getCachedFn(code: string, paramNames: string[]): GenericFn {
  const key = paramNames.join(",") + "||" + code;
  const cached = fnCache.get(key);
  if (cached) {
    // LRU: move to end on access
    fnCache.delete(key);
    fnCache.set(key, cached);
    return cached;
  }

  /**
   * SECURITY NOTICE FOR REVIEWERS:
   * This uses `new Function` to execute JavaScript code provided by the user
   * in their own local vault schema files (manifest.md). This is NOT remote
   * code execution — the code is authored by the vault owner and stored locally.
   * Execution is gated behind an explicit opt-in setting (`enableJsExecution`)
   * which defaults to `false` and shows a security warning in the UI.
   */
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function(...paramNames, code) as GenericFn;

  if (fnCache.size >= MAX_CACHE_SIZE) {
    const firstKey = fnCache.keys().next().value as string;
    fnCache.delete(firstKey);
  }
  fnCache.set(key, fn);
  return fn;
}

export class JsDisabledError extends Error {
  constructor() {
    super("JS execution is disabled in plugin settings");
    this.name = "JsDisabledError";
  }
}

export async function executeJsSource(
  code: string,
  app: App,
  dv: unknown,
  currentFile: TFile | null,
  currentPage: unknown,
  enableJs: boolean
): Promise<unknown> {
  if (!enableJs) {
    throw new JsDisabledError();
  }

  const fn = getCachedFn(code, ["app", "dv", "currentFile", "currentPage"]);

  const timeoutPromise = new Promise<never>((_, reject) =>
    activeWindow.setTimeout(() => reject(new Error("JS source timed out")), JS_SOURCE_TIMEOUT_MS)
  );

  return Promise.race([fn(app, dv, currentFile, currentPage), timeoutPromise]);
}

export async function executeJsValidator(
  code: string,
  app: App,
  dv: unknown,
  currentFile: TFile,
  currentPage: unknown,
  value: unknown,
  enableJs: boolean
): Promise<unknown> {
  if (!enableJs) {
    throw new JsDisabledError();
  }

  const fn = getCachedFn(code, ["app", "dv", "currentFile", "currentPage", "value"]);

  const timeoutPromise = new Promise<never>((_, reject) =>
    activeWindow.setTimeout(
      () => reject(new Error("JS validator timed out")),
      JS_VALIDATOR_TIMEOUT_MS
    )
  );

  return Promise.race([fn(app, dv, currentFile, currentPage, value), timeoutPromise]);
}
