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

  describe("edition variant detection", () => {
    it("detects Collector's Edition", () => {
      const result = parseQuery(
        "Fruits Basket Collector's Edition v01 (2016).cbz",
      );
      expect(result.seriesTitle).toBe("Fruits Basket");
      expect(result.edition).toBe("Collector's Edition");
      expect(result.volumeNumber).toBe(1);
    });

    it("detects Omnibus Edition", () => {
      const result = parseQuery("One Piece Omnibus Edition v05 (2020).cbz");
      expect(result.seriesTitle).toBe("One Piece");
      expect(result.edition).toBe("Omnibus Edition");
      expect(result.volumeNumber).toBe(5);
    });

    it("detects bare Omnibus", () => {
      const result = parseQuery("Some Series Omnibus v02.cbz");
      expect(result.seriesTitle).toBe("Some Series");
      expect(result.edition).toBe("Omnibus");
    });

    it("detects Deluxe Edition", () => {
      const result = parseQuery("Berserk Deluxe Edition v01.cbz");
      expect(result.seriesTitle).toBe("Berserk");
      expect(result.edition).toBe("Deluxe Edition");
    });

    it("detects Fullmetal Edition", () => {
      const result = parseQuery(
        "Fullmetal Alchemist Fullmetal Edition v01.cbz",
      );
      expect(result.seriesTitle).toBe("Fullmetal Alchemist");
      expect(result.edition).toBe("Fullmetal Edition");
    });

    it("detects 3-in-1 Edition", () => {
      const result = parseQuery("Naruto 3-in-1 Edition v01.cbz");
      expect(result.seriesTitle).toBe("Naruto");
      expect(result.edition).toBe("3-in-1 Edition");
    });

    it("detects Digital Colored Comics", () => {
      const result = parseQuery(
        "Bleach - Digital Colored Comics v01 (2021).cbz",
      );
      expect(result.seriesTitle).toBe("Bleach");
      expect(result.edition).toBe("Digital Colored Comics");
    });

    it("leaves edition undefined when none is present", () => {
      const result = parseQuery("One Piece v01.cbz");
      expect(result.edition).toBeUndefined();
    });

    it("is case-insensitive", () => {
      const result = parseQuery("some series OMNIBUS EDITION v01.cbz");
      expect(result.edition).toBe("Omnibus Edition");
      expect(result.seriesTitle).toBe("some series");
    });
  });
});
