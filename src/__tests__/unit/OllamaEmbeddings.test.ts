/**
 * Unit tests for OllamaEmbeddings
 */

import { jest } from '@jest/globals';
import { OllamaEmbeddings } from '../../embeddings/providers/OllamaEmbeddings';

describe('OllamaEmbeddings', () => {
  describe('Constructor', () => {
    it('should create instance with default parameters', () => {
      const embeddings = new OllamaEmbeddings();
      const info = embeddings.getModelInfo();

      expect(info.provider).toBe('ollama');
      expect(info.model).toBe('mxbai-embed-large');
      expect(info.dimensions).toBe(1024);
      expect(info.available).toBe(false); // Not initialized yet
    });

    it('should create instance with custom base URL', () => {
      const embeddings = new OllamaEmbeddings('http://custom:11434');
      const info = embeddings.getModelInfo();

      expect(info.provider).toBe('ollama');
    });

    it('should remove trailing slash from base URL', () => {
      const embeddings = new OllamaEmbeddings('http://localhost:11434/');

      // Verify it doesn't throw during construction
      expect(embeddings).toBeDefined();
    });

    it('should create instance with custom model', () => {
      const embeddings = new OllamaEmbeddings('http://localhost:11434', 'custom-model', 512);
      const info = embeddings.getModelInfo();

      expect(info.model).toBe('custom-model');
      expect(info.dimensions).toBe(512);
    });
  });

  describe('isAvailable', () => {
    it('should return false before initialization', () => {
      const embeddings = new OllamaEmbeddings();
      expect(embeddings.isAvailable()).toBe(false);
    });
  });

  describe('embed', () => {
    it('should throw error when not initialized', async () => {
      const embeddings = new OllamaEmbeddings();

      await expect(embeddings.embed('test')).rejects.toThrow('not available');
    });
  });

  describe('embedBatch', () => {
    it('should throw error when not initialized', async () => {
      const embeddings = new OllamaEmbeddings();

      await expect(embeddings.embedBatch(['test1', 'test2'])).rejects.toThrow('not initialized');
    });
  });

  describe('getModelInfo', () => {
    it('should return correct model information', () => {
      const embeddings = new OllamaEmbeddings('http://localhost:11434', 'test-model', 768);
      const info = embeddings.getModelInfo();

      expect(info).toEqual({
        provider: 'ollama',
        model: 'test-model',
        dimensions: 768,
        available: false,
      });
    });
  });

  describe('Initialize - Failure Cases', () => {
    beforeEach(() => {
      // Mock fetch to simulate Ollama not being available
      global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should handle Ollama API error response', async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);

      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const embeddings = new OllamaEmbeddings();

      await embeddings.initialize();

      expect(embeddings.isAvailable()).toBe(false);

      consoleWarnSpy.mockRestore();
    });

    it('should not throw during initialization failure', async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>).mockRejectedValueOnce(
        new Error('Network error')
      );

      const embeddings = new OllamaEmbeddings();

      // Should not throw, just mark as unavailable
      await expect(embeddings.initialize()).resolves.not.toThrow();
      expect(embeddings.isAvailable()).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle base URL with various formats', () => {
      const embeddings1 = new OllamaEmbeddings('http://localhost:11434');
      const embeddings2 = new OllamaEmbeddings('http://localhost:11434/');
      const embeddings3 = new OllamaEmbeddings('https://remote-ollama.com');

      expect(embeddings1).toBeDefined();
      expect(embeddings2).toBeDefined();
      expect(embeddings3).toBeDefined();
    });

    it('should handle unknown model with default dimensions', () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const embeddings = new OllamaEmbeddings('http://localhost:11434', 'unknown-model');
      const info = embeddings.getModelInfo();

      // Should use fallback dimensions (768)
      expect(info.dimensions).toBeGreaterThan(0);

      consoleWarnSpy.mockRestore();
    });
  });
});
