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
      expect(parseQuery("One Piece (2023) (Digital) (1r0n)").seriesTitle).toBe(
        "One Piece",
      );
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

  describe("volume number extraction", () => {
    it("extracts v01 style", () => {
      const result = parseQuery("Bleach v01 (2021).cbz");
      expect(result.seriesTitle).toBe("Bleach");
      expect(result.volumeNumber).toBe(1);
    });

    it("extracts v03 style", () => {
      const result = parseQuery("Chihayafuru v03 (2017).cbz");
      expect(result.seriesTitle).toBe("Chihayafuru");
      expect(result.volumeNumber).toBe(3);
    });

    it("extracts 'Vol. 03' style", () => {
      const result = parseQuery("Some Manga Vol. 03.cbz");
      expect(result.seriesTitle).toBe("Some Manga");
      expect(result.volumeNumber).toBe(3);
    });

    it("extracts 'Volume 001' style", () => {
      const result = parseQuery("20th Century Boys - Volume 001.cbr");
      expect(result.seriesTitle).toBe("20th Century Boys");
      expect(result.volumeNumber).toBe(1);
    });

    it("extracts '#001' style", () => {
      const result = parseQuery("Bakuman #001 (2010).cbz");
      expect(result.seriesTitle).toBe("Bakuman");
      expect(result.volumeNumber).toBe(1);
    });

    it("does not treat a 4-digit trailing number as a volume", () => {
      // A bare 4-digit number is more likely to be a year than a volume.
      const result = parseQuery("Some Series 2023.cbz");
      expect(result.volumeNumber).toBeUndefined();
    });

    it("extracts a bare trailing 2-3 digit number as last resort", () => {
      const result = parseQuery("Some Series 003.cbz");
      expect(result.seriesTitle).toBe("Some Series");
      expect(result.volumeNumber).toBe(3);
    });

    it("leaves volumeNumber undefined when none is present", () => {
      const result = parseQuery("One Piece.cbz");
      expect(result.volumeNumber).toBeUndefined();
    });

    it("removes the volume marker from the series title", () => {
      const result = parseQuery("Chained Soldier v01 (2022) (Digital).cbz");
      expect(result.seriesTitle).toBe("Chained Soldier");
    });
  });
});
