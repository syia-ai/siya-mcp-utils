/**
 * Company Name Filtering Utilities
 * Helper functions for filtering data based on company IMO numbers
 *
 * This implementation includes:
 * - In-memory caching with TTL (5 minutes)
 * - MongoDB connection pooling
 * - Set-based IMO lookups (O(1) instead of O(n))
 * - Cached environment variables
 */

import { MongoClient } from 'mongodb';

/**
 * Check if IMO filtering should be bypassed for admin companies
 */
function shouldBypassImoFiltering(companyName: string): boolean {
  const adminCompanies = ['admin', 'administrator', 'superadmin', 'syia'];
  return adminCompanies.some(admin =>
    companyName.toLowerCase().includes(admin.toLowerCase())
  );
}

/**
 * Optimized Company Filter Manager with caching and connection pooling
 */
class CompanyFilterManager {
  // Cache structure: Map<"companyName:dbName", { fleetImos: Set<string>, vesselImos: Set<string>, allImos: Set<string>, timestamp: number }>
  private imoCache = new Map<string, { fleetImos: Set<string>, vesselImos: Set<string>, allImos: Set<string>, timestamp: number }>();

  // Connection pool: Map<"mongoUri", MongoClient>
  private mongoClients = new Map<string, MongoClient>();

  // Cache TTL: 5 minutes
  private readonly CACHE_TTL = 5 * 60 * 1000;

  // Cached config values
  private cachedCompanyName: string | null = null;
  private cachedDbConfig: { dbName: string, mongoUri: string } | null = null;

  /**
   * Get company name (cached)
   */
  private getCompanyName(): string {
    if (this.cachedCompanyName === null) {
      this.cachedCompanyName = process.env.COMPANY_NAME || '';
    }
    return this.cachedCompanyName || '';
  }

  /**
   * Get database configuration (cached)
   */
  private getDbConfig(): { dbName: string, mongoUri: string } {
    if (this.cachedDbConfig === null) {
      this.cachedDbConfig = {
        dbName: process.env.GROUP_DETAILS_DB_NAME || process.env.FLEET_DISTRIBUTION_DB_NAME || process.env.COMPANY_DB_NAME || '',
        mongoUri: process.env.GROUP_DETAILS_MONGO_URI || process.env.FLEET_DISTRIBUTION_MONGO_URI || process.env.COMPANY_DB_URI || ''
      };
    }
    return this.cachedDbConfig;
  }

  /**
   * Get or create MongoDB client (connection pooling)
   */
  private async getMongoClient(mongoUri: string): Promise<MongoClient> {
    if (!this.mongoClients.has(mongoUri)) {
      const client = new MongoClient(mongoUri, {
        maxPoolSize: 10,
        minPoolSize: 2,
        maxIdleTimeMS: 30000
      });
      await client.connect();
      this.mongoClients.set(mongoUri, client);
    }
    return this.mongoClients.get(mongoUri)!;
  }

  /**
   * Get company IMO sets with caching (returns separate fleet and vessel IMO sets)
   * Extracts both 'imo' (fleet IMOs) and 'imoList' (vessel IMOs) from all matching documents
   */
  async getCompanyImoSets(
    companyName: string,
    dbName: string,
    mongoUri: string,
    collectionName: string = 'common_group_details'
  ): Promise<{ fleetImos: Set<string>, vesselImos: Set<string>, allImos: Set<string> }> {
    const cacheKey = `${companyName}:${dbName}`;
    const cached = this.imoCache.get(cacheKey);

    // Return from cache if valid
    if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) {
      return {
        fleetImos: cached.fleetImos,
        vesselImos: cached.vesselImos,
        allImos: cached.allImos
      };
    }

    // Fetch from MongoDB
    if (!dbName || !mongoUri || !companyName) {
      const emptySet = new Set<string>();
      return { fleetImos: emptySet, vesselImos: emptySet, allImos: emptySet };
    }

    try {
      const client = await this.getMongoClient(mongoUri);
      const db = client.db(dbName);
      const collection = db.collection(collectionName);

      // Query for ALL documents matching companyName or groupName
      const results = await collection.find(
        { $or: [{ companyName: companyName }, { groupName: companyName }] },
        { projection: { imo: 1, imoList: 1, _id: 0 } }
      ).toArray();

      // Separate fleet IMOs (imo field) and vessel IMOs (imoList arrays)
      const fleetImos = new Set<string>();
      const vesselImos = new Set<string>();

      // Extract fleet IMOs (imo field) and vessel IMOs (imoList array) from each document
      for (const doc of results) {
        // Add fleet IMO (imo field) if present - these are valid fleet IMOs
        if (doc.imo) {
          fleetImos.add(String(doc.imo));
        }

        // Add vessel IMOs (imoList array) if present - these are valid vessel IMOs
        if (doc.imoList && Array.isArray(doc.imoList)) {
          for (const imo of doc.imoList) {
            vesselImos.add(String(imo));
          }
        }
      }

      // Combine both for backward compatibility
      const allImos = new Set<string>([...fleetImos, ...vesselImos]);

      // Update cache
      this.imoCache.set(cacheKey, {
        fleetImos,
        vesselImos,
        allImos,
        timestamp: Date.now()
      });

      return { fleetImos, vesselImos, allImos };
    } catch (error) {
      // Removed console.error to avoid interfering with MCP JSON-RPC protocol
      const emptySet = new Set<string>();
      return { fleetImos: emptySet, vesselImos: emptySet, allImos: emptySet };
    }
  }

  /**
   * Get company IMO set with caching (returns combined Set for backward compatibility)
   * Extracts both 'imo' (fleet IMOs) and 'imoList' (vessel IMOs) from all matching documents
   */
  async getCompanyImoSet(
    companyName: string,
    dbName: string,
    mongoUri: string,
    collectionName: string = 'common_group_details'
  ): Promise<Set<string>> {
    const { allImos } = await this.getCompanyImoSets(companyName, dbName, mongoUri, collectionName);
    return allImos;
  }

  /**
   * Validate if a vessel IMO belongs to the company (validates against vessel IMO list from imoList arrays)
   */
  async isValidVesselImoForCompany(
    imo: string | number,
    companyName?: string,
    dbName?: string,
    mongoUri?: string
  ): Promise<boolean> {
    const finalCompanyName = companyName || this.getCompanyName();

    if (!finalCompanyName) {
      // Removed console.warn to avoid interfering with MCP JSON-RPC protocol
      return false; // Deny access if no company name for security
    }

    // Bypass validation for "Synergy" company
    if (finalCompanyName === "Synergy") {
      return true;
    }

    // Bypass validation for admin companies
    if (shouldBypassImoFiltering(finalCompanyName)) {
      return true;
    }

    // Use provided dbName/mongoUri or fallback to cached config values
    const configValues = this.getDbConfig();
    const finalDbName = dbName || configValues.dbName;
    const finalMongoUri = mongoUri || configValues.mongoUri;

    if (!finalDbName || !finalMongoUri) {
      // Removed console.warn to avoid interfering with MCP JSON-RPC protocol
      return false; // Deny access if config is missing for security
    }

    try {
      const { vesselImos } = await this.getCompanyImoSets(finalCompanyName, finalDbName, finalMongoUri);
      return vesselImos.has(String(imo));
    } catch (error) {
      // Removed console.error to avoid interfering with MCP JSON-RPC protocol
      return false; // Deny access on error for security
    }
  }

  /**
   * Validate if a fleet IMO belongs to the company (validates against fleet IMO list from imo field)
   */
  async isValidFleetImoForCompany(
    fleetImo: string | number,
    companyName?: string,
    dbName?: string,
    mongoUri?: string
  ): Promise<boolean> {
    const finalCompanyName = companyName || this.getCompanyName();

    if (!finalCompanyName) {
      return true; // If no company name, allow all
    }

    // Bypass validation for "Synergy" company
    if (finalCompanyName === "Synergy") {
      return true;
    }

    // Bypass validation for admin companies
    if (shouldBypassImoFiltering(finalCompanyName)) {
      return true;
    }

    // Use provided dbName/mongoUri or fallback to cached config values
    const configValues = this.getDbConfig();
    const finalDbName = dbName || configValues.dbName;
    const finalMongoUri = mongoUri || configValues.mongoUri;

    if (!finalDbName || !finalMongoUri) {
      // Removed console.warn to avoid interfering with MCP JSON-RPC protocol
      return true; // Allow if config is missing
    }

    try {
      const { fleetImos } = await this.getCompanyImoSets(finalCompanyName, finalDbName, finalMongoUri);
      return fleetImos.has(String(fleetImo));
    } catch (error) {
      // Removed console.error to avoid interfering with MCP JSON-RPC protocol
      return true; // Allow on error to prevent blocking
    }
  }

  /**
   * Validate if an IMO belongs to the company (backward compatibility - validates against vessel IMOs)
   * @deprecated Use isValidVesselImoForCompany or isValidFleetImoForCompany instead
   */
  async isValidImoForCompany(
    imo: string | number,
    companyName?: string,
    dbName?: string,
    mongoUri?: string
  ): Promise<boolean> {
    // Default to vessel IMO validation for backward compatibility
    return this.isValidVesselImoForCompany(imo, companyName, dbName, mongoUri);
  }

  /**
   * Update Typesense filter with company IMO numbers (optimized)
   */
  async updateTypesenseFilterWithCompanyImos(
    filter: string,
    dbName?: string,
    mongoUri?: string
  ): Promise<string> {
    const companyName = this.getCompanyName();

    if (!companyName) {
      return filter;
    }

    // Bypass filtering for "Synergy" company
    if (companyName === "Synergy") {
      return filter;
    }

    // Bypass filtering for admin companies
    if (shouldBypassImoFiltering(companyName)) {
      return filter;
    }

    // Use provided dbName/mongoUri or fallback to cached config values
    const configValues = this.getDbConfig();
    const finalDbName = dbName || configValues.dbName;
    const finalMongoUri = mongoUri || configValues.mongoUri;

    if (!finalDbName || !finalMongoUri) {
      // Removed console.warn to avoid interfering with MCP JSON-RPC protocol
      return filter;
    }

    try {
      const imoSet = await this.getCompanyImoSet(companyName, finalDbName, finalMongoUri);

      if (imoSet.size === 0) {
        // Removed console.warn to avoid interfering with MCP JSON-RPC protocol
        // If no company IMO numbers found, return a filter that matches nothing for security
        // This prevents access to all data when company configuration is missing
        return filter ? `${filter} && imo:0` : 'imo:0';
      }

      const imoFilter = `imo:[${Array.from(imoSet).join(",")}]`;

      if (filter && filter.trim()) {
        return `${filter} && ${imoFilter}`;
      } else {
        return imoFilter;
      }
    } catch (error) {
      // Removed console.error to avoid interfering with MCP JSON-RPC protocol
      return filter; // Return original filter on error
    }
  }

  /**
   * Get company IMO numbers as array (for backward compatibility)
   */
  async getCompanyImoNumbers(
    companyName: string,
    dbName: string,
    mongoUri: string,
    collectionName: string = 'common_group_details'
  ): Promise<string[]> {
    const imoSet = await this.getCompanyImoSet(companyName, dbName, mongoUri, collectionName);
    return Array.from(imoSet);
  }

  /**
   * Clear cache (useful for testing or forced refresh)
   */
  clearCache(): void {
    this.imoCache.clear();
    this.cachedCompanyName = null;
    this.cachedDbConfig = null;
  }

  /**
   * Close all MongoDB connections (cleanup)
   */
  async closeConnections(): Promise<void> {
    const closePromises = Array.from(this.mongoClients.values()).map(client => client.close());
    await Promise.all(closePromises);
    this.mongoClients.clear();
  }
}

// Singleton instance
export const companyFilter = new CompanyFilterManager();

// Export functions for backward compatibility
export async function fetchCompanyImoNumbers(
  companyName: string,
  dbName: string,
  mongoUri: string,
  collectionName: string = 'common_group_details'
): Promise<string[]> {
  return companyFilter.getCompanyImoNumbers(companyName, dbName, mongoUri, collectionName);
}

export async function isValidImoForCompany(
  imo: string | number,
  companyName?: string,
  dbName?: string,
  mongoUri?: string
): Promise<boolean> {
  return companyFilter.isValidImoForCompany(imo, companyName, dbName, mongoUri);
}

export async function isValidVesselImoForCompany(
  imo: string | number,
  companyName?: string,
  dbName?: string,
  mongoUri?: string
): Promise<boolean> {
  return companyFilter.isValidVesselImoForCompany(imo, companyName, dbName, mongoUri);
}

export async function isValidFleetImoForCompany(
  fleetImo: string | number,
  companyName?: string,
  dbName?: string,
  mongoUri?: string
): Promise<boolean> {
  return companyFilter.isValidFleetImoForCompany(fleetImo, companyName, dbName, mongoUri);
}

export async function updateTypesenseFilterWithCompanyImos(
  filter: string,
  dbName?: string,
  mongoUri?: string
): Promise<string> {
  return companyFilter.updateTypesenseFilterWithCompanyImos(filter, dbName, mongoUri);
}

/**
 * Filter IMO list to only include IMOs that belong to the company
 */
export async function filterImoListByCompany(
  imoList: (string | number)[],
  dbName?: string,
  mongoUri?: string
): Promise<number[]> {
  const companyName = process.env.COMPANY_NAME || '';

  if (!companyName) {
    return imoList.map(imo => typeof imo === 'number' ? imo : parseInt(String(imo), 10));
  }

  // Bypass filtering for "Synergy" company
  if (companyName === "Synergy") {
    return imoList.map(imo => typeof imo === 'number' ? imo : parseInt(String(imo), 10));
  }

  // Bypass filtering for admin companies
  if (shouldBypassImoFiltering(companyName)) {
    return imoList.map(imo => typeof imo === 'number' ? imo : parseInt(String(imo), 10));
  }

  // Get company IMO set
  const configValues = {
    dbName: dbName || process.env.GROUP_DETAILS_DB_NAME || process.env.FLEET_DISTRIBUTION_DB_NAME || process.env.COMPANY_DB_NAME || '',
    mongoUri: mongoUri || process.env.GROUP_DETAILS_MONGO_URI || process.env.FLEET_DISTRIBUTION_MONGO_URI || process.env.COMPANY_DB_URI || ''
  };

  if (!configValues.dbName || !configValues.mongoUri) {
    // Removed console.warn to avoid interfering with MCP JSON-RPC protocol
    return imoList.map(imo => typeof imo === 'number' ? imo : parseInt(String(imo), 10));
  }

  try {
    const imoSet = await companyFilter.getCompanyImoSet(companyName, configValues.dbName, configValues.mongoUri);

    // Filter IMO list to only include company IMOs
    const filteredList = imoList
      .map(imo => String(imo))
      .filter(imo => imoSet.has(imo))
      .map(imo => parseInt(imo, 10));

    return filteredList;
  } catch (error) {
    // Removed console.error to avoid interfering with MCP JSON-RPC protocol
    // Return empty list on error for security
    return [];
  }
}

// Export shouldBypassImoFiltering for use in handlers
export { shouldBypassImoFiltering };
