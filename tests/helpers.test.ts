import { describe, expect, it } from "vitest";
import {
  getBlogPostHref,
  getBlogPostPaths,
  getCanonicalBlogId,
  getLocalizedPost,
  type TranslatableBlogPost,
} from "../src/lib/blog-lang";
import {
  calculateYearsOfExperience,
  formatDate,
  formatTimeTo12H,
  trimText,
} from "../src/lib/helpers";

describe("Helper Functions", () => {
  describe("trimText", () => {
    it("should return the original string if length is less than or equal to maxLength", () => {
      const text = "Hello world";
      expect(trimText(text, 20)).toBe("Hello world");
    });

    it("should trim text to exact maxLength including ellipsis when exceeding maxLength", () => {
      const text = "This is a long sentence that needs trimming";
      const trimmed = trimText(text, 15);
      expect(trimmed).toBe("This is a lo...");
      expect(trimmed.length).toBe(15);
    });

    it("should use default maxLength of 100", () => {
      const shortText = "Short text";
      expect(trimText(shortText)).toBe("Short text");

      const longText = "a".repeat(110);
      expect(trimText(longText).length).toBe(100);
      expect(trimText(longText).endsWith("...")).toBe(true);
    });
  });

  describe("formatDate", () => {
    it("should format Date object into a readable month day, year string", () => {
      const date = new Date(2026, 0, 15); // Jan 15, 2026
      expect(formatDate(date)).toBe("January 15, 2026");
    });

    it("formats publication dates in the selected locale", () => {
      const date = new Date(2026, 7, 2);
      expect(formatDate(date, "vi-VN")).toBe("2 tháng 8, 2026");
    });
  });

  describe("formatTimeTo12H", () => {
    it("should format time into 12-hour format with AM/PM for specified timezone", () => {
      const date = new Date(Date.UTC(2026, 0, 1, 14, 30));
      const formatted = formatTimeTo12H(date, "UTC");
      expect(formatted).toMatch(/2:30\s?PM/i);
    });
  });

  describe("calculateYearsOfExperience", () => {
    it("calculates 0 years before first anniversary", () => {
      expect(calculateYearsOfExperience("2023-05-01", new Date("2023-06-01"))).toBe(0);
      expect(calculateYearsOfExperience("2023-05-01", new Date("2024-04-30"))).toBe(0);
    });

    it("calculates 1 year on exactly 1 year milestone", () => {
      expect(calculateYearsOfExperience("2023-05-01", new Date("2024-05-01"))).toBe(1);
    });

    it("calculates 3 years in 2026 after May", () => {
      expect(calculateYearsOfExperience("2023-05-01", new Date("2026-05-01"))).toBe(3);
      expect(calculateYearsOfExperience("2023-05-01", new Date("2026-09-08"))).toBe(3);
    });

    it("automatically turns into 4 years when May 2027 arrives", () => {
      expect(calculateYearsOfExperience("2023-05-01", new Date("2027-04-30"))).toBe(3);
      expect(calculateYearsOfExperience("2023-05-01", new Date("2027-05-01"))).toBe(4);
      expect(calculateYearsOfExperience("2023-05-01", new Date("2027-12-31"))).toBe(4);
    });
  });

  describe("blog locale helpers", () => {
    const posts = [
      {
        id: "agent-handover-architecture-en",
        data: {
          lang: "en",
          translationKey: "agent-handover-architecture",
        },
      },
      {
        id: "agent-handover-architecture-vi",
        data: {
          lang: "vi",
          translationKey: "agent-handover-architecture",
        },
      },
    ] satisfies TranslatableBlogPost[];

    const [englishPost, vietnamesePost] = posts;

    it("builds canonical ids and locale-specific blog URLs", () => {
      expect(getCanonicalBlogId(englishPost)).toBe(
        "agent-handover-architecture",
      );
      expect(getBlogPostHref(englishPost)).toBe(
        "/blog/agent-handover-architecture",
      );
      expect(getBlogPostHref(vietnamesePost)).toBe(
        "/blog/agent-handover-architecture?lang=vi",
      );
    });

    it("selects a requested translation and falls back to English", () => {
      expect(
        getLocalizedPost(posts, "agent-handover-architecture", "vi"),
      ).toBe(vietnamesePost);
      expect(
        getLocalizedPost(posts, "agent-handover-architecture", "en"),
      ).toBe(englishPost);

      const englishOnlyPost = {
        id: "english-only",
        data: { lang: "en", translationKey: "english-only" },
      } satisfies TranslatableBlogPost;

      expect(
        getLocalizedPost([englishOnlyPost], "english-only", "vi"),
      ).toBe(englishOnlyPost);
    });

    it("creates one static path for a translation group", () => {
      expect(getBlogPostPaths(posts)).toEqual([
        { params: { id: "agent-handover-architecture" } },
      ]);
    });
  });
});
