/**
 * Unit tests for QueryExpander
 */

import {
  QueryExpander,
  getQueryExpander,
  getExpansionConfig,
  DEFAULT_EXPANSION_CONFIG,
} from "../../search/QueryExpander.js";

describe("QueryExpander", () => {
  describe("Constructor and Configuration", () => {
    it("should create with default config (disabled)", () => {
      const expander = new QueryExpander();
      const config = expander.getConfig();

      expect(config.enabled).toBe(false);
      expect(config.maxVariants).toBe(DEFAULT_EXPANSION_CONFIG.maxVariants);
    });

    it("should accept custom config", () => {
      const expander = new QueryExpander({
        enabled: true,
        maxVariants: 5,
      });
      const config = expander.getConfig();

      expect(config.enabled).toBe(true);
      expect(config.maxVariants).toBe(5);
    });
  });

  describe("Disabled Expansion", () => {
    it("should return original query when disabled", () => {
      const expander = new QueryExpander({ enabled: false });

      const variants = expander.expand("error in database");

      expect(variants).toEqual(["error in database"]);
    });
  });

  describe("Basic Expansion", () => {
    let expander: QueryExpander;

    beforeEach(() => {
      expander = new QueryExpander({ enabled: true, maxVariants: 5 });
    });

    it("should expand known terms", () => {
      const variants = expander.expand("error");

      expect(variants).toContain("error");
      expect(variants.length).toBeGreaterThan(1);
      // Should include synonyms
      expect(
        variants.some((v) =>
          ["bug", "issue", "problem", "exception", "failure"].includes(v)
        )
      ).toBe(true);
    });

    it("should expand multi-word queries", () => {
      const variants = expander.expand("database error");

      expect(variants).toContain("database error");
      expect(variants.length).toBeGreaterThan(1);
    });

    it("should preserve word order in expansions", () => {
      const variants = expander.expand("api endpoint");

      for (const variant of variants) {
        const words = variant.split(" ");
        expect(words).toHaveLength(2);
      }
    });

    it("should respect maxVariants limit", () => {
      const limitedExpander = new QueryExpander({
        enabled: true,
        maxVariants: 2,
      });

      const variants = limitedExpander.expand("error database api");

      expect(variants.length).toBeLessThanOrEqual(2);
    });
  });

  describe("Domain Synonyms", () => {
    let expander: QueryExpander;

    beforeEach(() => {
      expander = new QueryExpander({ enabled: true, maxVariants: 10 });
    });

    it("should expand error-related terms", () => {
      const synonyms = expander.getSynonyms("error");

      expect(synonyms).toContain("bug");
      expect(synonyms).toContain("issue");
      expect(synonyms).toContain("problem");
    });

    it("should expand API-related terms", () => {
      const synonyms = expander.getSynonyms("api");

      expect(synonyms).toContain("endpoint");
      expect(synonyms).toContain("interface");
    });

    it("should expand database-related terms", () => {
      const synonyms = expander.getSynonyms("database");

      expect(synonyms).toContain("db");
      expect(synonyms).toContain("datastore");
    });

    it("should expand function-related terms", () => {
      const synonyms = expander.getSynonyms("function");

      expect(synonyms).toContain("method");
      expect(synonyms).toContain("handler");
    });

    it("should expand authentication terms", () => {
      const synonyms = expander.getSynonyms("auth");

      expect(synonyms).toContain("authentication");
      expect(synonyms).toContain("login");
    });
  });

  describe("Synonym Lookup", () => {
    let expander: QueryExpander;

    beforeEach(() => {
      expander = new QueryExpander({ enabled: true });
    });

    it("should get synonyms for known word", () => {
      const synonyms = expander.getSynonyms("error");

      expect(synonyms.length).toBeGreaterThan(0);
    });

    it("should return empty array for unknown word", () => {
      const synonyms = expander.getSynonyms("xyznonexistent");

      expect(synonyms).toEqual([]);
    });

    it("should handle case-insensitive lookup", () => {
      const synonyms1 = expander.getSynonyms("Error");
      const synonyms2 = expander.getSynonyms("ERROR");
      const synonyms3 = expander.getSynonyms("error");

      expect(synonyms1).toEqual(synonyms3);
      expect(synonyms2).toEqual(synonyms3);
    });

    it("should check if word has synonyms", () => {
      expect(expander.hasSynonyms("error")).toBe(true);
      expect(expander.hasSynonyms("xyznonexistent")).toBe(false);
    });
  });

  describe("Custom Synonyms", () => {
    it("should merge custom synonyms with defaults", () => {
      const customSynonyms = new Map([["myterm", ["synonym1", "synonym2"]]]);

      const expander = new QueryExpander({
        enabled: true,
        customSynonyms,
      });

      const synonyms = expander.getSynonyms("myterm");
      expect(synonyms).toContain("synonym1");
      expect(synonyms).toContain("synonym2");
    });

    it("should extend existing synonyms", () => {
      const customSynonyms = new Map([["error", ["glitch", "malfunction"]]]);

      const expander = new QueryExpander({
        enabled: true,
        customSynonyms,
      });

      const synonyms = expander.getSynonyms("error");
      // Should have original synonyms
      expect(synonyms).toContain("bug");
      // Should have new synonyms
      expect(synonyms).toContain("glitch");
      expect(synonyms).toContain("malfunction");
    });

    it("should add synonyms dynamically", () => {
      const expander = new QueryExpander({ enabled: true });

      expander.addSynonyms("custom", ["alt1", "alt2"]);

      const synonyms = expander.getSynonyms("custom");
      expect(synonyms).toContain("alt1");
      expect(synonyms).toContain("alt2");
    });

    it("should not duplicate synonyms when adding", () => {
      const expander = new QueryExpander({ enabled: true });

      expander.addSynonyms("error", ["bug", "newterm"]);

      const synonyms = expander.getSynonyms("error");
      const bugCount = synonyms.filter((s) => s === "bug").length;
      expect(bugCount).toBe(1);
    });
  });

  describe("Query Processing", () => {
    let expander: QueryExpander;

    beforeEach(() => {
      expander = new QueryExpander({ enabled: true, maxVariants: 5 });
    });

    it("should handle query with no expandable words", () => {
      const variants = expander.expand("xyz abc 123");

      // Should only return original
      expect(variants).toEqual(["xyz abc 123"]);
    });

    it("should handle single word query", () => {
      const variants = expander.expand("error");

      expect(variants).toContain("error");
      expect(variants.length).toBeGreaterThan(1);
    });

    it("should handle mixed expandable and non-expandable words", () => {
      const variants = expander.expand("critical error found");

      expect(variants).toContain("critical error found");
      // Should have variants with error synonyms
      expect(
        variants.some((v) => v.includes("bug") || v.includes("issue"))
      ).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    let expander: QueryExpander;

    beforeEach(() => {
      expander = new QueryExpander({ enabled: true, maxVariants: 5 });
    });

    it("should handle empty query", () => {
      const variants = expander.expand("");

      expect(variants).toEqual([""]);
    });

    it("should handle whitespace-only query", () => {
      const variants = expander.expand("   ");

      expect(variants.length).toBeGreaterThanOrEqual(1);
    });

    it("should handle query with special characters", () => {
      const variants = expander.expand("error: api/v2");

      // Should not crash
      expect(variants.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Environment Configuration", () => {
    it("should read enabled from environment", () => {
      const original = process.env.CCCMEMORY_QUERY_EXPANSION;
      process.env.CCCMEMORY_QUERY_EXPANSION = "true";

      const config = getExpansionConfig();
      expect(config.enabled).toBe(true);

      // Restore
      if (original !== undefined) {
        process.env.CCCMEMORY_QUERY_EXPANSION = original;
      } else {
        delete process.env.CCCMEMORY_QUERY_EXPANSION;
      }
    });

    it("should read maxVariants from environment", () => {
      const original = process.env.CCCMEMORY_MAX_QUERY_VARIANTS;
      process.env.CCCMEMORY_MAX_QUERY_VARIANTS = "10";

      const config = getExpansionConfig();
      expect(config.maxVariants).toBe(10);

      // Restore
      if (original !== undefined) {
        process.env.CCCMEMORY_MAX_QUERY_VARIANTS = original;
      } else {
        delete process.env.CCCMEMORY_MAX_QUERY_VARIANTS;
      }
    });
  });

  describe("Factory Function", () => {
    it("should create expander with config", () => {
      const expander = getQueryExpander({ enabled: true });
      expect(expander).toBeInstanceOf(QueryExpander);
      expect(expander.getConfig().enabled).toBe(true);
    });

    it("should create expander without config", () => {
      const expander = getQueryExpander();
      expect(expander).toBeInstanceOf(QueryExpander);
    });
  });
});
