import { logger } from './logger.js';
import { DatabaseManager } from './mongodb.js';
import { getConfig } from './config.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

/**
 * Fetch IMO numbers for a specific company from MongoDB
 * @param companyName The name of the company to fetch IMO numbers for
 * @returns Array of IMO numbers as strings
 */
export async function fetchCompanyImoNumbers(companyName: string, dbName: string, mongoUri: string, collectionName: string = 'common_group_details'): Promise<string[]> {
  const databaseManager = new DatabaseManager();
  
  try {
    logger.info(`Fetching IMO numbers for company: ${companyName}`);
    
    if (!dbName || !mongoUri || !collectionName) {
      throw new Error('Database name, MongoDB URI, and collection name are required');
    }
    
    // Get ETL Dev MongoDB client
    await databaseManager.initializeDatabase(dbName, mongoUri);
    const db = databaseManager.getDb();
    
    // Query the common_group_details collection for IMO numbers belonging to the company
    const collection = db.collection(collectionName);
    
    const result = await collection.findOne(
      { groupName: companyName },
      { projection: { imoList: 1, _id: 0 } }
    );

    logger.info(`Result: ${JSON.stringify(result)}`);
    
    if (!result || !result.imoList) {
      logger.warn(`No IMO numbers found for company: ${companyName}`);
      return [];
    }
    
    // Extract IMO numbers from the query result
    const imoNumbers = result.imoList;
    
    logger.info(`Found ${imoNumbers.length} IMO numbers for company: ${companyName}`);
    
    return imoNumbers;
  } catch (error) {
    logger.error(`Error fetching IMO numbers for company ${companyName}:`, error);
    throw error;
  } finally {
    await databaseManager.closeDatabase();
  }
}

/**
 * Check if IMO filtering should be bypassed for admin companies
 * @param companyName - Name of the company to check
 * @returns True if filtering should be bypassed
 */
export function shouldBypassImoFiltering(companyName: string): boolean {
  const adminCompanies = ['admin', 'administrator', 'superadmin', 'syia'];
  return adminCompanies.some(admin => 
    companyName.toLowerCase().includes(admin.toLowerCase())
  );
}

/**
 * Validate if an IMO number is valid for the current company
 * @param imoNumber - IMO number to validate (string or number)
 * @param companyName - Company name to fetch IMO numbers for
 * @returns Promise that resolves to boolean indicating if IMO is valid
 */
export async function isValidImoForCompany(imoNumber: string | number, companyName: string, dbName?: string, mongoUri?: string): Promise<boolean> {
  try {
    // Convert to string for consistent comparison
    const imoStr = String(imoNumber);
    
    // Basic IMO number validation (7 digits)
    if (!/^\d{7}$/.test(imoStr)) {
      return false;
    }
    
    // Check if IMO is in company's authorized list
    if (!dbName || !mongoUri) {
      // If no database parameters provided, allow all valid IMO numbers
      return true;
    }
    
    const companyImos = await fetchCompanyImoNumbers(companyName, dbName, mongoUri, 'common_group_details');
    if (companyImos.length === 0) {
      // If no company IMOs are set, allow all valid IMO numbers
      return true;
    }
    
    return companyImos.includes(imoStr);
  } catch (error) {
    logger.error('Error validating IMO number:', error);
    return false;
  }
}

/**
 * Initialize IMO cache for a company
 * @param companyName - Name of the company to initialize cache for
 */
export async function initializeImoCache(companyName: string, dbName?: string, mongoUri?: string): Promise<void> {
  try {
    logger.info(`Initializing IMO cache for company: ${companyName}`);
    
    if (!dbName || !mongoUri) {
      logger.warn('Database parameters not provided, skipping IMO cache initialization');
      return;
    }
    
    // Fetch company IMOs and cache them
    const imos = await fetchCompanyImoNumbers(companyName, dbName, mongoUri, 'common_group_details');
    
    // For now, just log the IMOs found
    // In a production system, you might want to store this in memory or a cache
    logger.info(`IMO cache initialized with ${imos.length} IMO numbers for company: ${companyName}`);
    
    if (imos.length > 0) {
      logger.debug(`Sample IMOs: ${imos.slice(0, 5).join(', ')}${imos.length > 5 ? '...' : ''}`);
    }
  } catch (error) {
    logger.error(`Error initializing IMO cache for company ${companyName}:`, error);
    // Don't throw error, just log it - cache initialization failure shouldn't stop the server
  }
}

// ============================================================================
// CACHE MANAGEMENT FUNCTIONS (for backward compatibility)
// ============================================================================

/**
 * Companies that should skip validation entirely
 */
const SKIP_VALIDATION_COMPANIES = ['synergy', 'development', 'test'];

// File path setup
const DATA_DIR = join(process.cwd(), 'data');
const CACHE_FILENAME = 'company-imos.json';
const CACHE_FILE = join(DATA_DIR, CACHE_FILENAME);

// Types
interface CacheData {
  companyName: string;
  imoNumbers: string[];
  lastUpdated: string;
}

// In-memory storage
let companyImoCache: CacheData | null = null;

/**
 * Ensure data directory exists
 */
function ensureDataDirectory(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
    logger.debug('Created data directory for IMO cache');
  }
}

/**
 * Get cached company IMO numbers from memory
 */
function getCompanyImoNumbers(): string[] {
  return companyImoCache?.imoNumbers || [];
}

/**
 * Load cached IMO numbers from file
 */
export function loadCachedImos(): string[] {
  try {
    if (!existsSync(CACHE_FILE)) {
      logger.debug('IMO cache file does not exist');
      return [];
    }
    
    const data = readFileSync(CACHE_FILE, 'utf8');
    const cacheData: CacheData = JSON.parse(data);
    
    // Validate cache structure
    if (!cacheData?.imoNumbers || !Array.isArray(cacheData.imoNumbers)) {
      logger.warn('Invalid cache file structure, ignoring cached data');
      return [];
    }
    
    // Update in-memory cache if valid
    companyImoCache = cacheData;
    
    logger.debug(`Loaded ${cacheData.imoNumbers.length} IMO numbers from cache file`);
    return cacheData.imoNumbers;
    
  } catch (error) {
    logger.warn('Failed to load cached IMOs, cache file may be corrupted:', error);
    return [];
  }
}

/**
 * Save IMO numbers to cache file
 */
export function saveCachedImos(imos: string[], companyName: string): void {
  try {
    ensureDataDirectory();
    
    const cacheData: CacheData = {
      companyName,
      imoNumbers: imos,
      lastUpdated: new Date().toISOString()
    };
    
    writeFileSync(CACHE_FILE, JSON.stringify(cacheData, null, 2), 'utf8');
    logger.info(`Successfully cached ${imos.length} IMO numbers to file`);
    
  } catch (error) {
    logger.error('Failed to save IMO cache to file:', error);
  }
}

/**
 * Check if company should skip IMO validation (e.g., for development/testing)
 */
export function shouldSkipImoValidation(companyName: string): boolean {
  return SKIP_VALIDATION_COMPANIES.includes(companyName.toLowerCase());
}

/**
 * Get company IMOs with intelligent fallback strategy
 */
export function getCompanyImosWithFallback(): string[] {
  // Try in-memory cache first (fastest)
  let imos = getCompanyImoNumbers();
  
  // Fallback to file cache if memory is empty
  if (imos.length === 0) {
    imos = loadCachedImos();
    if (imos.length > 0) {
      logger.info(`Using cached IMO numbers from file (${imos.length} IMOs)`);
    }
  }
  
  return imos;
}

/**
 * Clear all cached data (for testing/reset purposes)
 */
export function clearCache(): void {
  companyImoCache = null;
  logger.debug('Cleared in-memory IMO cache');
} 