import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { convertUnixDates, convertToCSV } from '../src/helper_functions';

// Mock the logger to avoid console output during tests
jest.mock('../src/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('Helper Functions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('convertUnixDates', () => {
    it('should convert Unix timestamps to ISO date strings', () => {
      const testDocument = {
        id: 1,
        name: 'Test Vessel',
        purchaseRequisitionDate: 1640995200, // 2022-01-01 00:00:00 UTC
        purchaseOrderIssuedDate: 1641081600, // 2022-01-02 00:00:00 UTC
        orderReadinessDate: 1641168000, // 2022-01-03 00:00:00 UTC
        date: 1641254400, // 2022-01-04 00:00:00 UTC
        poDate: 1641340800, // 2022-01-05 00:00:00 UTC
        expenseDate: 1641427200, // 2022-01-06 00:00:00 UTC
        inspectionTargetDate: 1641513600, // 2022-01-07 00:00:00 UTC
        reportDate: 1641600000, // 2022-01-08 00:00:00 UTC
        closingDate: 1641686400, // 2022-01-09 00:00:00 UTC
        targetDate: 1641772800, // 2022-01-10 00:00:00 UTC
        nextDueDate: 1641859200, // 2022-01-11 00:00:00 UTC
        extendedDate: 1641945600, // 2022-01-12 00:00:00 UTC
        nonDateField: 'should remain unchanged',
        nullField: null,
        undefinedField: undefined,
      };

      const result = convertUnixDates(testDocument);

      expect(result.id).toBe(1);
      expect(result.name).toBe('Test Vessel');
      expect(result.purchaseRequisitionDate).toBe('2022-01-01T00:00:00.000Z');
      expect(result.purchaseOrderIssuedDate).toBe('2022-01-02T00:00:00.000Z');
      expect(result.orderReadinessDate).toBe('2022-01-03T00:00:00.000Z');
      expect(result.date).toBe('2022-01-04T00:00:00.000Z');
      expect(result.poDate).toBe('2022-01-05T00:00:00.000Z');
      expect(result.expenseDate).toBe('2022-01-06T00:00:00.000Z');
      expect(result.inspectionTargetDate).toBe('2022-01-07T00:00:00.000Z');
      expect(result.reportDate).toBe('2022-01-08T00:00:00.000Z');
      expect(result.closingDate).toBe('2022-01-09T00:00:00.000Z');
      expect(result.targetDate).toBe('2022-01-10T00:00:00.000Z');
      expect(result.nextDueDate).toBe('2022-01-11T00:00:00.000Z');
      expect(result.extendedDate).toBe('2022-01-12T00:00:00.000Z');
      expect(result.nonDateField).toBe('should remain unchanged');
      expect(result.nullField).toBeNull();
      expect(result.undefinedField).toBeUndefined();
    });

    it('should handle documents with no date fields', () => {
      const testDocument = {
        id: 1,
        name: 'Test Vessel',
        description: 'A test vessel',
        status: 'active',
      };

      const result = convertUnixDates(testDocument);

      expect(result).toEqual(testDocument);
    });

    it('should handle documents with non-numeric date values', () => {
      const testDocument = {
        id: 1,
        purchaseRequisitionDate: '2022-01-01',
        purchaseOrderIssuedDate: 'not a number',
        date: null,
        poDate: undefined,
      };

      const result = convertUnixDates(testDocument);

      expect(result.purchaseRequisitionDate).toBe('2022-01-01');
      expect(result.purchaseOrderIssuedDate).toBe('not a number');
      expect(result.date).toBeNull();
      expect(result.poDate).toBeUndefined();
    });

    it('should handle empty objects', () => {
      const result = convertUnixDates({});
      expect(result).toEqual({});
    });

    it('should handle null and undefined inputs', () => {
      expect(() => convertUnixDates(null as any)).toThrow();
      expect(() => convertUnixDates(undefined as any)).toThrow();
    });
  });

  describe('convertToCSV', () => {
    it('should convert array of objects to CSV format', () => {
      const data = [
        { name: 'Vessel A', imo: 123456789, status: 'active' },
        { name: 'Vessel B', imo: 987654321, status: 'inactive' },
        { name: 'Vessel C', imo: 555666777, status: 'maintenance' },
      ];

      const result = convertToCSV(data);

      const expected = `name,imo,status
Vessel A,123456789,active
Vessel B,987654321,inactive
Vessel C,555666777,maintenance`;

      expect(result).toBe(expected);
    });

    it('should handle empty array', () => {
      const result = convertToCSV([]);
      expect(result).toBe('');
    });

    it('should handle array with empty objects', () => {
      const data = [{}, {}, {}];
      const result = convertToCSV(data);
      expect(result).toBe('\n\n');
    });

    it('should escape special characters in CSV', () => {
      const data = [
        { name: 'Vessel "A"', description: 'Contains, comma', status: 'active\nwith newline' },
        { name: 'Vessel B', description: 'Normal text', status: 'inactive' },
      ];

      const result = convertToCSV(data);

      const expected = `name,description,status
"Vessel ""A""","Contains, comma","active
with newline"
Vessel B,Normal text,inactive`;

      expect(result).toBe(expected);
    });

    it('should handle null and undefined values', () => {
      const data = [
        { name: 'Vessel A', imo: null, status: undefined },
        { name: 'Vessel B', imo: 123456789, status: 'active' },
      ];

      const result = convertToCSV(data);

      const expected = `name,imo,status
Vessel A,,active
Vessel B,123456789,active`;

      expect(result).toBe(expected);
    });

    it('should handle objects with different keys', () => {
      const data = [
        { name: 'Vessel A', imo: 123456789 },
        { name: 'Vessel B', status: 'active' },
        { name: 'Vessel C', imo: 555666777, status: 'inactive', extra: 'field' },
      ];

      const result = convertToCSV(data);

      const expected = `name,imo,status,extra
Vessel A,123456789,,
Vessel B,,active,
Vessel C,555666777,inactive,field`;

      expect(result).toBe(expected);
    });
  });

  describe('Error handling', () => {
    it('should handle invalid Unix timestamps gracefully', () => {
      const testDocument = {
        id: 1,
        purchaseRequisitionDate: NaN,
        purchaseOrderIssuedDate: Infinity,
        date: -Infinity,
      };

      const result = convertUnixDates(testDocument);

      expect(result.purchaseRequisitionDate).toBeNaN();
      expect(result.purchaseOrderIssuedDate).toBe(Infinity);
      expect(result.date).toBe(-Infinity);
    });

    it('should handle very large Unix timestamps', () => {
      const testDocument = {
        date: 9999999999999, // Very large timestamp
      };

      const result = convertUnixDates(testDocument);

      // Should convert to a valid date string
      expect(typeof result.date).toBe('string');
      expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });
}); 