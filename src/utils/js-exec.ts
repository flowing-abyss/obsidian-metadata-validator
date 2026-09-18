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
   * This uses the Function constructor to execute JavaScript code provided by
   * the user in their own local vault schema files (manifest.md). This is NOT remote
   * code execution — the code is authored by the vault owner and stored locally.
   * Execution is gated behind an explicit opt-in setting (`enableJsExecution`)
   * which defaults to `false` and shows a security warning in the UI.
   */
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- User-authored vault JS is an explicit opt-in plugin feature.
  const fn = new Function(...paramNames, code) as GenericFn;

  if (fnCache.size >= MAX_CACHE_SIZE) {
    const firstKey = fnCache.keys().next().value as string;
    fnCache.delete(firstKey);
  }
  fnCache.set(key, fn);
  return fn;
}

/** Run user code against a deadline; the timer is cleared as soon as the code settles. */
async function raceTimeout(
  run: () => unknown,
  timeoutMs: number,
  message: string
): Promise<unknown> {
  let timer: number | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(run), timeoutPromise]);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
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
  return raceTimeout(
    () => fn(app, dv, currentFile, currentPage),
    JS_SOURCE_TIMEOUT_MS,
    "JS source timed out"
  );
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
  return raceTimeout(
    () => fn(app, dv, currentFile, currentPage, value),
    JS_VALIDATOR_TIMEOUT_MS,
    "JS validator timed out"
  );
}

/** Generic executor for rule code: named params become function arguments. */
export async function executeJs(
  code: string,
  params: Record<string, unknown>,
  enableJs: boolean,
  timeoutMs = JS_VALIDATOR_TIMEOUT_MS
): Promise<unknown> {
  if (!enableJs) {
    throw new JsDisabledError();
  }

  const names = Object.keys(params);
  const fn = getCachedFn(code, names);
  return raceTimeout(() => fn(...names.map((n) => params[n])), timeoutMs, "JS rule timed out");
}

/** Dataview API and the current page, when the Dataview plugin is present. */
export function dataviewContext(
  app: App,
  file: TFile | null
): { dv: unknown; currentPage: unknown } {
  const appRecord = app as unknown as Record<string, unknown>;
  const pluginManager = appRecord["plugins"] as Record<string, unknown> | undefined;
  const pluginsMap = pluginManager?.["plugins"] as Record<string, unknown> | undefined;
  const dataview = pluginsMap?.["dataview"] as Record<string, unknown> | undefined;
  const dv = dataview?.["api"];
  let currentPage: unknown = null;
  const page = (dv as { page?: unknown } | undefined)?.page;
  if (file && typeof page === "function") {
    try {
      currentPage = (page as (path: string) => unknown).call(dv, file.path);
    } catch {
      currentPage = null;
    }
  }
  return { dv, currentPage };
}
