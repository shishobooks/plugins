import { parseQuery } from "../filename";
import { describe, expect, it } from "vitest";

describe("parseQuery", () => {
  describe("extension and noise stripping", () => {
    it("strips a .cbz extension", () => {
      expect(parseQuery("One Piece.cbz").seriesTitle).toBe("One Piece");
    });

    it("strips a .cbr extension", () => {
      expect(parseQuery("One Piece.cbr").seriesTitle).toBe("One Piece");
    });

    it("handles strings without an extension", () => {
      expect(parseQuery("One Piece").seriesTitle).toBe("One Piece");
    });

    it("strips a single trailing parenthesized group", () => {
      expect(parseQuery("One Piece (2010)").seriesTitle).toBe("One Piece");
    });

    it("strips multiple trailing parenthesized groups", () => {
      expect(
        parseQuery("One Piece (2023) (Digital) (1r0n)").seriesTitle,
      ).toBe("One Piece");
    });

    it("strips noise that appears before the extension", () => {
      expect(
        parseQuery("One Piece (2023) (Digital) (1r0n).cbz").seriesTitle,
      ).toBe("One Piece");
    });

    it("trims trailing whitespace and dashes", () => {
      expect(parseQuery("One Piece - ").seriesTitle).toBe("One Piece");
    });

    it("returns an empty seriesTitle for an empty input", () => {
      expect(parseQuery("").seriesTitle).toBe("");
    });
  });
});
