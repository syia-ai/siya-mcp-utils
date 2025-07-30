/**
 * Parse a document link and extract relevant information
 */
export function parseDocumentLink(link: any) {
    // Parse the document link format: type-id-timestamp
    const parts = link.split('-');
    if (parts.length !== 3) {
        throw new Error('Invalid document link format');
    }

    return {
        documentType: parts[0],
        documentId: parts[1],
        timestamp: parts[2]
    };
} 