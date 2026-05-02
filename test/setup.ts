import { createMockShisho } from "@shisho/plugin-sdk/testing";
import { beforeEach, vi } from "vitest";

const sdkMock = createMockShisho();

globalThis.shisho = {
  dataDir: "/tmp/shisho-mock-data",
  sleep: vi.fn(),
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
  vi.resetAllMocks();
  vi.mocked(shisho.config.getAll).mockReturnValue({});
  vi.mocked(shisho.url.searchParams).mockImplementation((params) =>
    sdkMock.url.searchParams(params),
  );
  vi.mocked(shisho.url.encodeURIComponent).mockImplementation((str) =>
    encodeURIComponent(str),
  );
  vi.mocked(shisho.url.decodeURIComponent).mockImplementation((str) =>
    decodeURIComponent(str),
  );
  vi.mocked(shisho.url.parse).mockImplementation((url) =>
    sdkMock.url.parse(url),
  );
});
