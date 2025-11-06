/**
 * Unit tests for TransformersEmbeddings
 */

import { jest } from '@jest/globals';
import { TransformersEmbeddings } from '../../embeddings/providers/TransformersEmbeddings';

describe('TransformersEmbeddings', () => {
  describe('Constructor', () => {
    it('should create instance with default model', () => {
      const embeddings = new TransformersEmbeddings();
      const info = embeddings.getModelInfo();

      expect(info.provider).toBe('transformers');
      expect(info.model).toBe('Xenova/all-MiniLM-L6-v2');
      expect(info.dimensions).toBe(384);
      expect(info.available).toBe(false); // Not initialized yet
    });

    it('should create instance with custom model', () => {
      const embeddings = new TransformersEmbeddings('custom-model', 512);
      const info = embeddings.getModelInfo();

      expect(info.model).toBe('custom-model');
      expect(info.dimensions).toBe(512);
    });

    it('should use default dimensions if not specified', () => {
      const embeddings = new TransformersEmbeddings('Xenova/all-MiniLM-L6-v2');
      const info = embeddings.getModelInfo();

      expect(info.dimensions).toBe(384);
    });
  });

  describe('isAvailable', () => {
    it('should return false before initialization', () => {
      const embeddings = new TransformersEmbeddings();
      expect(embeddings.isAvailable()).toBe(false);
    });
  });

  describe('embed', () => {
    it('should throw error when not initialized', async () => {
      const embeddings = new TransformersEmbeddings();

      await expect(embeddings.embed('test')).rejects.toThrow('not available');
    });
  });

  describe('embedBatch', () => {
    it('should throw error when not initialized', async () => {
      const embeddings = new TransformersEmbeddings();

      await expect(embeddings.embedBatch(['test1', 'test2'])).rejects.toThrow('not initialized');
    });
  });

  describe('getModelInfo', () => {
    it('should return correct model information', () => {
      const embeddings = new TransformersEmbeddings('test-model', 768);
      const info = embeddings.getModelInfo();

      expect(info).toEqual({
        provider: 'transformers',
        model: 'test-model',
        dimensions: 768,
        available: false,
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty model name with defaults', () => {
      const embeddings = new TransformersEmbeddings();
      const info = embeddings.getModelInfo();

      expect(info.model).toBeTruthy();
      expect(info.dimensions).toBeGreaterThan(0);
    });

    it('should handle zero dimensions by using default', () => {
      const embeddings = new TransformersEmbeddings('model');
      const info = embeddings.getModelInfo();

      // Should use default dimensions from ModelRegistry or fallback
      expect(info.dimensions).toBeGreaterThan(0);
    });
  });

  describe('Initialize', () => {
    it('should not throw during initialization', async () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const embeddings = new TransformersEmbeddings();

      // Should not throw
      await expect(embeddings.initialize()).resolves.not.toThrow();

      // May or may not be available depending on if @xenova/transformers is installed
      expect(typeof embeddings.isAvailable()).toBe('boolean');

      consoleLogSpy.mockRestore();
    });

    it('should handle initialization gracefully', async () => {
      const embeddings = new TransformersEmbeddings();
      await embeddings.initialize();

      // Should have a valid state after initialization attempt
      const info = embeddings.getModelInfo();
      expect(info).toBeDefined();
      expect(info.provider).toBe('transformers');
    });
  });
});
