import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

// Load test configuration first
require('./test-config');

// Mock the logger to avoid console output during tests
jest.mock('../src/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('getDataLink Integration Test', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('should get data link with real credentials', async () => {
    // Import the function
    const { getDataLink } = require('../src/helper_functions');

    // Test data
    const testData = [
      { id: 1, name: 'Test Vessel', imo: 123456789 },
      { id: 2, name: 'Test Vessel 2', imo: 987654321 },
    ];

    try {
      const result = await getDataLink(testData);
      
      // Verify we got a result
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
      
      console.log('✅ getDataLink test passed');
      console.log('Result:', result);
    } catch (error) {
      console.error('❌ getDataLink test failed:', error);
      throw error;
    }
  });

  it('should handle empty data array', async () => {
    const { getDataLink } = require('../src/helper_functions');

    try {
      const result = await getDataLink([]);
      
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
      
      console.log('✅ Empty data array test passed');
      console.log('Result:', result);
    } catch (error) {
      console.error('❌ Empty data array test failed:', error);
      throw error;
    }
  });

  it('should handle large data array', async () => {
    const { getDataLink } = require('../src/helper_functions');

    // Create a larger dataset
    const largeData = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      name: `Vessel ${i + 1}`,
      imo: 100000000 + i,
      status: i % 2 === 0 ? 'active' : 'inactive',
      createdAt: Date.now(),
    }));

    try {
      const result = await getDataLink(largeData);
      
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
      
      console.log('✅ Large data array test passed');
      console.log('Result:', result);
    } catch (error) {
      console.error('❌ Large data array test failed:', error);
      throw error;
    }
  });
}); 