import { createMockShisho } from "@shisho/plugin-sdk/testing";
import { beforeEach, vi } from "vitest";

const sdkMock = createMockShisho();

globalThis.shisho = {
  dataDir: "/tmp/shisho-mock-data",
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  config: {
    get: vi.fn(),
    getAll: vi.fn(() => ({})),
  },
  http: {
    fetch: vi.fn(),
  },
  url: {
    searchParams: vi.fn((params: Record<string, unknown>) =>
      sdkMock.url.searchParams(params),
    ),
    encodeURIComponent: vi.fn((str: string) => encodeURIComponent(str)),
    decodeURIComponent: vi.fn((str: string) => decodeURIComponent(str)),
    parse: vi.fn((url: string) => sdkMock.url.parse(url)),
  },
  html: sdkMock.html,
  xml: sdkMock.xml,
  fs: sdkMock.fs,
  archive: sdkMock.archive,
  ffmpeg: sdkMock.ffmpeg,
  shell: sdkMock.shell,
} as unknown as typeof shisho;

beforeEach(() => {
  vi.restoreAllMocks();
});
