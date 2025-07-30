import { ToolResponse } from './types/index.js';
import { getConfig } from './config.js';
import { logger } from './logger.js';
import { 
    getCompanyImoNumbers, 
    shouldBypassImoFiltering, 
    isValidImoForCompany 
} from './imoUtils.js';

/**
 * Statistics for filtering operations
 */
export interface FilterStats {
    itemsProcessed: number;
    itemsFiltered: number;
    unauthorizedImos: string[];
    processingTimeMs: number;
}

/**
 * IMO field names that should be checked for filtering
 */
const IMO_FIELD_NAMES = [
    'imo',
    'vesselImo', 
    'imoNumber',
    'IMO',
    'vessel_imo',
    'imo_number',
    'vesselIMO'
];

/**
 * Check if an object contains any IMO field
 * @param obj - Object to check
 * @returns Object containing IMO field name and value, or null if none found
 */
function findImoField(obj: any): { fieldName: string; value: any } | null {
    if (!obj || typeof obj !== 'object') {
        return null;
    }

    for (const fieldName of IMO_FIELD_NAMES) {
        if (obj.hasOwnProperty(fieldName) && obj[fieldName] !== null && obj[fieldName] !== undefined) {
            return { fieldName, value: obj[fieldName] };
        }
    }

    return null;
}

/**
 * Filter an array by removing items with unauthorized IMO numbers
 * @param array - Array to filter
 * @param stats - Statistics object to update
 * @returns Filtered array and updated statistics
 */
function filterArrayByImo(array: any[], stats: FilterStats): { filtered: any[], stats: FilterStats } {
    logger.debug(`Starting array filtering`, { arrayLength: array.length });
    
    const filteredArray = array.filter(item => {
        stats.itemsProcessed++;
        
        // Check if this item has an IMO field at any level
        const hasUnauthorizedImo = checkForUnauthorizedImo(item);
        
        if (hasUnauthorizedImo.found) {
            stats.itemsFiltered++;
            stats.unauthorizedImos.push(hasUnauthorizedImo.location);
            logger.debug(`Filtered item with unauthorized IMO: ${hasUnauthorizedImo.location}`);
            return false;
        }

        return true;
    });

    logger.debug(`Array filtering complete`, { 
        originalLength: array.length, 
        filteredLength: filteredArray.length,
        itemsFiltered: stats.itemsFiltered 
    });

    return { filtered: filteredArray, stats };
}

/**
 * Recursively check for unauthorized IMO numbers in an object
 * @param obj - Object to check
 * @returns Object with found flag and location string
 */
function checkForUnauthorizedImo(obj: any): { found: boolean, location: string } {
    if (!obj || typeof obj !== 'object') {
        return { found: false, location: '' };
    }

    // Check direct IMO fields
    const imoField = findImoField(obj);
    if (imoField && !isValidImoForCompany(imoField.value)) {
        return { found: true, location: `${imoField.fieldName}: ${imoField.value}` };
    }

    // Check nested objects and arrays
    for (const [key, value] of Object.entries(obj)) {
        if (Array.isArray(value)) {
            // Check each item in the array
            for (let i = 0; i < value.length; i++) {
                const result = checkForUnauthorizedImo(value[i]);
                if (result.found) {
                    return { found: true, location: `${key}[${i}].${result.location}` };
                }
            }
        } else if (typeof value === 'object' && value !== null) {
            // Recursively check nested objects
            const result = checkForUnauthorizedImo(value);
            if (result.found) {
                return { found: true, location: `${key}.${result.location}` };
            }
        }
    }

    return { found: false, location: '' };
}

/**
 * Filter response content recursively
 * @param content - Content to filter
 * @param stats - Statistics object to update
 * @returns Filtered content and updated statistics
 */
function filterResponseContent(content: any, stats: FilterStats): { filtered: any, stats: FilterStats } {
    if (Array.isArray(content)) {
        const { filtered, stats: updatedStats } = filterArrayByImo(content, stats);
        return { filtered, stats: updatedStats };
    } else if (content && typeof content === 'object') {
        // Check if this object has unauthorized IMO
        const hasUnauthorizedImo = checkForUnauthorizedImo(content);
        if (hasUnauthorizedImo.found) {
            stats.itemsFiltered++;
            stats.unauthorizedImos.push(hasUnauthorizedImo.location);
            logger.debug(`Filtered object with unauthorized IMO: ${hasUnauthorizedImo.location}`);
            return { filtered: null, stats };
        }

        // Recursively filter nested objects
        const filteredContent: any = {};
        for (const [key, value] of Object.entries(content)) {
            const { filtered: filteredValue, stats: updatedStats } = filterResponseContent(value, stats);
            if (filteredValue !== null) {
                filteredContent[key] = filteredValue;
            }
        }
        return { filtered: filteredContent, stats };
    }

    return { filtered: content, stats };
}

/**
 * Filter a ToolResponse by removing items with unauthorized IMO numbers
 * @param response - ToolResponse to filter
 * @returns Filtered ToolResponse
 */
export async function filterResponseByCompanyImos(response: ToolResponse): Promise<ToolResponse> {
    const startTime = Date.now();
    const stats: FilterStats = {
        itemsProcessed: 0,
        itemsFiltered: 0,
        unauthorizedImos: [],
        processingTimeMs: 0
    };

    try {
        // Skip filtering for admin companies
        const config = getConfig();
        if (shouldBypassImoFiltering(config.companyName || '')) {
            logger.debug('Admin company detected, skipping IMO filtering');
            return response;
        }

        // Get company IMO numbers
        const companyImos = getCompanyImoNumbers();
        if (companyImos.length === 0) {
            logger.warn('No company IMO numbers available, skipping filtering');
            return response;
        }

        logger.debug('Starting response filtering', { 
            responseLength: response.length,
            companyImosCount: companyImos.length 
        });

        const filteredResponse: ToolResponse = [];

        for (const item of response) {
            if (item.type === 'text' && item.text) {
                // Try to parse JSON content
                try {
                    const parsedContent = JSON.parse(item.text);
                    const { filtered: filteredContent, stats: updatedStats } = filterResponseContent(parsedContent, stats);
                    
                    if (filteredContent !== null) {
                        filteredResponse.push({
                            ...item,
                            text: JSON.stringify(filteredContent, null, 2)
                        });
                    }
                } catch (error) {
                    // If not JSON, keep the text as is
                    filteredResponse.push(item);
                }
            } else {
                // For other types (image, resource), check if they contain unauthorized IMO
                const hasUnauthorizedImo = checkForUnauthorizedImo(item);
                if (!hasUnauthorizedImo.found) {
                    filteredResponse.push(item);
                } else {
                    stats.itemsFiltered++;
                    stats.unauthorizedImos.push(hasUnauthorizedImo.location);
                }
            }
        }

        stats.processingTimeMs = Date.now() - startTime;

        logger.info('Response filtering completed', {
            originalItems: response.length,
            filteredItems: filteredResponse.length,
            itemsFiltered: stats.itemsFiltered,
            processingTimeMs: stats.processingTimeMs,
            unauthorizedImos: stats.unauthorizedImos
        });

        return filteredResponse;

    } catch (error) {
        logger.error('Error during response filtering:', error);
        // Return original response if filtering fails
        return response;
    }
}

/**
 * Filter a single response item
 * @param item - Response item to filter
 * @returns Filtered item or null if unauthorized
 */
export function filterSingleResponseItem(item: any): any | null {
    if (!item || typeof item !== 'object') {
        return item;
    }

    // Check if this item has unauthorized IMO
    const hasUnauthorizedImo = checkForUnauthorizedImo(item);
    if (hasUnauthorizedImo.found) {
        logger.debug(`Filtered single item with unauthorized IMO: ${hasUnauthorizedImo.location}`);
        return null;
    }

    return item;
}

/**
 * Check if a response contains unauthorized IMO numbers
 * @param response - ToolResponse to check
 * @returns True if unauthorized IMO found
 */
export function hasUnauthorizedImos(response: ToolResponse): boolean {
    for (const item of response) {
        const hasUnauthorizedImo = checkForUnauthorizedImo(item);
        if (hasUnauthorizedImo.found) {
            return true;
        }
    }
    return false;
}

/**
 * Get filtering statistics from a response
 * @param response - ToolResponse to analyze
 * @returns FilterStats object
 */
export function getFilteringStats(response: ToolResponse): FilterStats {
    const stats: FilterStats = {
        itemsProcessed: 0,
        itemsFiltered: 0,
        unauthorizedImos: [],
        processingTimeMs: 0
    };

    for (const item of response) {
        stats.itemsProcessed++;
        const hasUnauthorizedImo = checkForUnauthorizedImo(item);
        if (hasUnauthorizedImo.found) {
            stats.itemsFiltered++;
            stats.unauthorizedImos.push(hasUnauthorizedImo.location);
        }
    }

    return stats;
} 