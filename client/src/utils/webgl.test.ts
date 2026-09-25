import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasWebGL, resetWebGLProbe } from './webgl';

const realGetContext = HTMLCanvasElement.prototype.getContext;

function fakeContext() {
  const loseContext = vi.fn();
  return { ctx: { getExtension: vi.fn(() => ({ loseContext })) }, loseContext };
}

beforeEach(() => {
  resetWebGLProbe();
  vi.restoreAllMocks();
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = realGetContext;
  resetWebGLProbe();
});

describe('hasWebGL', () => {
  it('returns true when the browser provides a context', () => {
    const { ctx } = fakeContext();
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx) as unknown as typeof realGetContext;

    expect(hasWebGL()).toBe(true);
  });

  it('returns false when WebGL is disabled', () => {
    HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as unknown as typeof realGetContext;

    expect(hasWebGL()).toBe(false);
  });

  it('falls back from WebGL2 to WebGL1', () => {
    const { ctx } = fakeContext();
    const getContext = vi.fn((type: string) => (type === 'webgl2' ? null : ctx));
    HTMLCanvasElement.prototype.getContext = getContext as unknown as typeof realGetContext;

    expect(hasWebGL()).toBe(true);
    expect(getContext.mock.calls.map((call) => call[0])).toEqual(['webgl2', 'webgl']);
  });

  it('releases the probe context immediately', () => {
    const { ctx, loseContext } = fakeContext();
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx) as unknown as typeof realGetContext;

    hasWebGL();

    expect(ctx.getExtension).toHaveBeenCalledWith('WEBGL_lose_context');
    expect(loseContext).toHaveBeenCalledOnce();
  });

  it('probes once and caches the result', () => {
    const { ctx } = fakeContext();
    const getContext = vi.fn(() => ctx);
    HTMLCanvasElement.prototype.getContext = getContext as unknown as typeof realGetContext;

    hasWebGL();
    hasWebGL();
    hasWebGL();

    expect(getContext).toHaveBeenCalledOnce();
  });

  it('returns false when getContext throws', () => {
    HTMLCanvasElement.prototype.getContext = vi.fn(() => {
      throw new Error('WebGL is disabled by policy');
    }) as unknown as typeof realGetContext;

    expect(hasWebGL()).toBe(false);
  });
});
