/**
 * Unit tests for ExtractionValidator
 */

import {
  ExtractionValidator,
  getDecisionValidator,
  getMistakeValidator,
  DEFAULT_DECISION_VALIDATION_CONFIG,
  DEFAULT_MISTAKE_VALIDATION_CONFIG,
} from "../../parsers/ExtractionValidator.js";

describe("ExtractionValidator", () => {
  describe("Decision Validation", () => {
    let validator: ExtractionValidator;

    beforeEach(() => {
      validator = getDecisionValidator();
    });

    describe("Valid Decisions", () => {
      it("should accept well-formed decisions", () => {
        const decision = "We decided to use PostgreSQL for the database because it has better JSON support.";
        const result = validator.validateDecision(decision);

        expect(result.isValid).toBe(true);
        expect(result.confidence).toBeGreaterThan(0.5);
      });

      it("should accept decisions with actionable keywords", () => {
        const decisions = [
          "Implement caching using Redis for better performance.",
          "Choose TypeScript over JavaScript for type safety.",
          "Create a new service layer for business logic.",
          "Configure the API to use rate limiting.",
        ];

        for (const decision of decisions) {
          const result = validator.validateDecision(decision);
          expect(result.isValid).toBe(true);
        }
      });
    });

    describe("Invalid Decisions", () => {
      it("should reject too short text", () => {
        const decision = "Use TypeScript";
        const result = validator.validateDecision(decision);

        expect(result.isValid).toBe(false);
        expect(result.reasons.some((r) => r.includes("Too short"))).toBe(true);
        expect(result.confidence).toBeLessThan(0.5);
      });

      it("should reject too long text", () => {
        const decision = "a".repeat(600);
        const result = validator.validateDecision(decision);

        expect(result.reasons.some((r) => r.includes("Too long"))).toBe(true);
      });

      it("should reject session summary artifacts", () => {
        const summaries = [
          "Session summary: We worked on several features today.",
          "In this session, we implemented the login flow.",
          "Recap: Multiple bugs were fixed.",
          "Here's what we accomplished today.",
        ];

        for (const summary of summaries) {
          const result = validator.validateDecision(summary);
          expect(result.isValid).toBe(false);
          expect(result.reasons.some((r) => r.includes("summary artifact"))).toBe(true);
        }
      });

      it("should reject noise patterns", () => {
        const noiseItems = [
          "Yes",
          "Ok",
          "Thanks!",
          "Hi there",
          "Goodbye",
          "1.",
          "a)",
        ];

        for (const noise of noiseItems) {
          const result = validator.validateDecision(noise);
          expect(result.isValid).toBe(false);
        }
      });

      it("should reject text without actionable keywords", () => {
        const decision = "The weather is nice today and the sun is shining brightly.";
        const result = validator.validateDecision(decision);

        expect(result.reasons.some((r) => r.includes("Missing actionable keywords"))).toBe(true);
      });

      it("should reject text without proper structure", () => {
        const decision = "PostgreSQL Redis TypeScript React Node.js";
        const result = validator.validateDecision(decision);

        expect(result.reasons.some((r) => r.includes("Lacks proper sentence structure"))).toBe(true);
      });
    });

    describe("Source Verification", () => {
      it("should verify content exists in source", () => {
        const decision = "We decided to use PostgreSQL for better JSON support.";
        const source = "After discussion, we decided to use PostgreSQL for better JSON support and scalability.";

        const result = validator.validateDecision(decision, source);
        expect(result.isValid).toBe(true);
      });

      it("should penalize content not in source", () => {
        const decision = "We decided to use MongoDB for the database layer.";
        const source = "After discussion, we chose PostgreSQL for better JSON support.";

        const result = validator.validateDecision(decision, source);
        expect(result.reasons.some((r) => r.includes("Content not found in source"))).toBe(true);
      });
    });

    describe("Confidence Scoring", () => {
      it("should have high confidence for perfect decisions", () => {
        const decision = "We decided to implement caching using Redis because it provides fast in-memory storage.";
        const result = validator.validateDecision(decision);

        expect(result.confidence).toBeGreaterThan(0.7);
      });

      it("should have lower confidence for borderline decisions", () => {
        const decision = "Maybe we should consider using something else later.";
        const result = validator.validateDecision(decision);

        expect(result.confidence).toBeLessThan(0.7);
      });
    });

    describe("Suggestions", () => {
      it("should provide suggestions for invalid decisions", () => {
        const decision = "short";
        const result = validator.validateDecision(decision);

        expect(result.suggestions).toBeDefined();
        expect(result.suggestions?.length).toBeGreaterThan(0);
      });

      it("should not provide suggestions for valid decisions", () => {
        const decision = "We decided to use React for the frontend because of its component-based architecture.";
        const result = validator.validateDecision(decision);

        expect(result.suggestions).toBeUndefined();
      });
    });
  });

  describe("Mistake Validation", () => {
    let validator: ExtractionValidator;

    beforeEach(() => {
      validator = getMistakeValidator();
    });

    describe("Valid Mistakes", () => {
      it("should accept well-formed mistakes", () => {
        const mistakes = [
          "The error occurred because the database connection was not closed properly.",
          "The bug was caused by incorrect null handling in the API response.",
          "The issue stemmed from a missing await keyword in async function.",
          "We fixed the crash by adding proper error handling.",
        ];

        for (const mistake of mistakes) {
          const result = validator.validateMistake(mistake);
          expect(result.isValid).toBe(true);
        }
      });

      it("should accept mistakes with error keywords", () => {
        const mistake = "The exception was thrown due to invalid input validation.";
        const result = validator.validateMistake(mistake);

        expect(result.isValid).toBe(true);
        expect(result.confidence).toBeGreaterThan(0.5);
      });
    });

    describe("Invalid Mistakes", () => {
      it("should reject too short text", () => {
        const mistake = "Bug found";
        const result = validator.validateMistake(mistake);

        expect(result.isValid).toBe(false);
        expect(result.reasons.some((r) => r.includes("Too short"))).toBe(true);
      });

      it("should reject session summary artifacts", () => {
        const summary = "Session summary: Several errors were encountered.";
        const result = validator.validateMistake(summary);

        expect(result.isValid).toBe(false);
      });

      it("should reject noise patterns", () => {
        const noise = "Ok, thanks!";
        const result = validator.validateMistake(noise);

        expect(result.isValid).toBe(false);
      });
    });

    describe("Different Thresholds", () => {
      it("should have lower min confidence than decisions", () => {
        expect(DEFAULT_MISTAKE_VALIDATION_CONFIG.minConfidence).toBeLessThan(
          DEFAULT_DECISION_VALIDATION_CONFIG.minConfidence
        );
      });

      it("should allow slightly shorter mistakes", () => {
        expect(DEFAULT_MISTAKE_VALIDATION_CONFIG.minLength).toBeLessThan(
          DEFAULT_DECISION_VALIDATION_CONFIG.minLength
        );
      });
    });
  });

  describe("Custom Configuration", () => {
    it("should accept custom actionable keywords", () => {
      const validator = getDecisionValidator({
        actionableKeywords: ["deploy", "launch", "release"],
      });

      const decision = "We will deploy the application to production on Friday.";
      const result = validator.validateDecision(decision);

      expect(result.isValid).toBe(true);
    });

    it("should accept custom min length", () => {
      const validator = getDecisionValidator({
        minLength: 10,
      });

      const decision = "Use TypeScript for safety.";
      const result = validator.validateDecision(decision);

      expect(result.isValid).toBe(true);
    });

    it("should accept custom confidence threshold", () => {
      const validator = getDecisionValidator({
        minConfidence: 0.9,
      });

      // Even good decisions may not pass very high threshold
      const decision = "Use React for the frontend.";
      const result = validator.validateDecision(decision);

      // Result validity depends on whether confidence exceeds 0.9
      expect(result.confidence).toBeDefined();
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty text", () => {
      const validator = getDecisionValidator();
      const result = validator.validateDecision("");

      expect(result.isValid).toBe(false);
    });

    it("should handle whitespace-only text", () => {
      const validator = getDecisionValidator();
      const result = validator.validateDecision("   \n\t   ");

      expect(result.isValid).toBe(false);
    });

    it("should handle unicode characters", () => {
      const validator = getDecisionValidator();
      const decision = "我们决定使用 PostgreSQL 数据库因为它支持 JSON。Use the database.";
      const result = validator.validateDecision(decision);

      // Should still check for actionable keywords
      expect(result.reasons).toBeDefined();
    });

    it("should handle special characters", () => {
      const validator = getDecisionValidator();
      const decision = "We chose to implement the /api/v2/* endpoints using the new architecture.";
      const result = validator.validateDecision(decision);

      expect(result).toBeDefined();
    });
  });

  describe("Factory Functions", () => {
    it("should create decision validator", () => {
      const validator = getDecisionValidator();
      expect(validator).toBeInstanceOf(ExtractionValidator);
    });

    it("should create mistake validator", () => {
      const validator = getMistakeValidator();
      expect(validator).toBeInstanceOf(ExtractionValidator);
    });

    it("should allow config overrides", () => {
      const validator = getDecisionValidator({ minLength: 5 });
      const result = validator.validateDecision("Use Redis cache.");

      // With lower min length, this should pass
      expect(result.reasons.some((r) => r.includes("Too short"))).toBe(false);
    });
  });
});
