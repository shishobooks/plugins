import { beforeEach, vi } from "vitest";

// Mock the shisho global that is injected by the goja runtime at execution time.
globalThis.shisho = {
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  http: {
    fetch: vi.fn(),
  },
  url: {
    searchParams: vi.fn((params: Record<string, string | number>) => {
      return new URLSearchParams(
        Object.entries(params).map(([k, v]) => [k, String(v)]),
      ).toString();
    }),
  },
} as unknown as typeof shisho;

beforeEach(() => {
  vi.restoreAllMocks();
});
