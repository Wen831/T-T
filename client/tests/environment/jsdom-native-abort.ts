/**
 * Custom Vitest environment that extends jsdom but preserves the native
 * Node.js AbortController and AbortSignal.
 *
 * Problem 1: jsdom replaces globalThis.AbortController and AbortSignal with its
 * own implementations. Node.js's undici-based fetch validates signals via
 * `signal instanceof AbortSignal` against its own native class reference.
 * jsdom's AbortSignal instances fail this check, causing fetch to throw:
 *   TypeError: RequestInit: Expected signal ("AbortSignal {}") to be an
 *   instance of AbortSignal.
 * Fix: after jsdom installs its globals, restore the native AbortController
 * and AbortSignal so fetch works correctly in tests.
 *
 * Problem 2 (Node 22+ experimental Web Storage): Node now exposes its own
 * `localStorage`/`sessionStorage` globals, inert unless `--localstorage-file`
 * is passed. Vitest's global-populate skips any key already present on the
 * global that isn't in its own allow-list, and Storage isn't in it — so
 * jsdom's working Storage never overwrites Node's inert one and every test
 * throws on `localStorage.clear()`. Fix: delete Node's shadow globals before
 * jsdom setup runs, so vitest copies jsdom's Storage across.
 *
 * Problem 3: jsdom's own `Blob` and `File` classes never finish loading inside
 * MSW's XMLHttpRequest interceptor, so every multipart upload request stalls
 * until the test times out instead of resolving. undici reads Node's native
 * Blob/File fine, and jsdom's FormData accepts them, so both are restored the
 * same way the Abort classes are.
 *
 * Problem 4 (side effect of Problem 3): jsdom's `FileReader` keeps its strict
 * `instanceof` check on its own Blob class, so `readAsText(nativeFile)` throws
 * "parameter 1 is not of type 'Blob'". Node has no FileReader to restore, so
 * its three read methods are wrapped to re-wrap a native blob as a jsdom Blob
 * holding the same bytes before handing it over.
 */

import { builtinEnvironments } from 'vitest/environments';

const jsdomEnv = builtinEnvironments.jsdom;

/** A Blob/File from either realm — enough surface for the two async reads. */
type BlobLike = { readonly type: string; arrayBuffer(): Promise<ArrayBuffer> };

/** Reads a jsdom-foreign Blob/File through jsdom's FileReader by re-wrapping it. */
function acceptNativeBlobs(global: typeof globalThis, JsdomBlob: typeof Blob): void {
  const prototype = global.FileReader.prototype as unknown as Record<
    string,
    (blob: BlobLike, ...rest: unknown[]) => void
  >;

  for (const method of ['readAsText', 'readAsArrayBuffer', 'readAsDataURL'] as const) {
    const original = prototype[method];
    prototype[method] = function (this: unknown, blob: BlobLike, ...rest: unknown[]): void {
      if (blob instanceof JsdomBlob) {
        original.call(this, blob, ...rest);
        return;
      }
      void blob
        .arrayBuffer()
        .then((bytes) => original.call(this, new JsdomBlob([bytes], { type: blob.type }), ...rest));
    };
  }
}

export default {
  name: 'jsdom-native-abort',
  transformMode: 'web' as const,

  async setup(global: typeof globalThis, options: Record<string, unknown>) {
    // Capture native AbortController/AbortSignal BEFORE jsdom patches them
    const NativeAbortController = global.AbortController;
    const NativeAbortSignal = global.AbortSignal;
    const NativeBlob = global.Blob;
    const NativeFile = global.File;
    const NativeFormData = global.FormData;

    // Clear Node's inert Web Storage globals so jsdom's win, not this shadow.
    delete (global as { localStorage?: unknown }).localStorage;
    delete (global as { sessionStorage?: unknown }).sessionStorage;

    // Run standard jsdom setup (installs jsdom globals, including its own AbortController)
    const env = await jsdomEnv.setup(global, options as Parameters<typeof jsdomEnv.setup>[1]);

    // Restore native AbortController so Node.js fetch (undici) accepts the signals
    global.AbortController = NativeAbortController;
    global.AbortSignal = NativeAbortSignal;

    // jsdom's own Blob class, still installed at this point — what FileReader accepts
    const JsdomBlob = global.Blob;

    // Restore native Blob/File so MSW can read a multipart request body to the end
    global.Blob = NativeBlob;
    global.File = NativeFile;
    // jsdom's FormData stringifies anything that isn't its own File subclass, so
    // it has to come from the same native family the two above do.
    global.FormData = NativeFormData;

    acceptNativeBlobs(global, JsdomBlob);

    return env;
  },
};
