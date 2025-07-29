import { logger } from './logger.js';
import { getEtlDevDataClient, getEtlDevDataDbName } from './mongodb.js';

// Store IMO numbers for the company
let companyImoNumbers: string[] = [];

/**
 * Fetch IMO numbers for a specific company from MongoDB
 * @param companyName The name of the company to fetch IMO numbers for
 * @returns Array of IMO numbers as strings
 */
export async function fetchCompanyImoNumbers(companyName: string): Promise<string[]> {
  try {
    logger.info(`Fetching IMO numbers for company: ${companyName}`);
    
    // Get ETL Dev MongoDB client
    const client = await getEtlDevDataClient();
    const db = client.db(getEtlDevDataDbName());
    
    // Query the common_group_details collection for IMO numbers belonging to the company
    const collection = db.collection('common_group_details');
    
    const result = await collection.findOne(
      { groupName: companyName },
      { projection: { imoList: 1, _id: 0 } }
    );

    logger.info(`Result: ${JSON.stringify(result)}`);
    
    if (!result || !result.imoList) {
      logger.warn(`No IMO numbers found for company: ${companyName}`);
      companyImoNumbers = [];
      return [];
    }
    
    // Extract IMO numbers from the query result
    const imoNumbers = result.imoList;
    
    logger.info(`Found ${imoNumbers.length} IMO numbers for company: ${companyName}`);
    
    // Store the IMO numbers for later use
    companyImoNumbers = imoNumbers;
    
    return imoNumbers;
  } catch (error) {
    logger.error(`Error fetching IMO numbers for company ${companyName}:`, error);
    throw error;
  }
}

/**
 * Get the cached IMO numbers for the company
 * @returns Array of IMO numbers as strings
 */
export function getCompanyImoNumbers(): string[] {
  return companyImoNumbers;
} 