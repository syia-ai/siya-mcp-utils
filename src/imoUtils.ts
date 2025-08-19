import { logger } from './logger.js';
import { getEtlDevDataClient, getEtlDevDataDbName } from './mongodb.js';
import { getConfig } from './config.js';

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
      return [];
    }
    
    // Extract IMO numbers from the query result
    const imoNumbers = result.imoList;
    
    logger.info(`Found ${imoNumbers.length} IMO numbers for company: ${companyName}`);
    
    return imoNumbers;
  } catch (error) {
    logger.error(`Error fetching IMO numbers for company ${companyName}:`, error);
    throw error;
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
export async function isValidImoForCompany(imoNumber: string | number, companyName: string): Promise<boolean> {
  try {
    // Convert to string for consistent comparison
    const imoStr = String(imoNumber);
    
    // Basic IMO number validation (7 digits)
    if (!/^\d{7}$/.test(imoStr)) {
      return false;
    }
    
    // Check if IMO is in company's authorized list
    const companyImos = await fetchCompanyImoNumbers(companyName);
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