import { DatabaseManager } from "./mongodb.js";
import { getTypesenseClient } from "./typesense.js";
import { getConfig } from "./config.js";
import { ObjectId } from "mongodb";
import { logger } from "./logger.js";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { lookup as mimeLookup } from "mime-types";
import path from "path";
import fs from "fs/promises";

// Helper function to generate alpha-numeric ID
export function generateAlphaNumericId(alphaSize = 3, numericSize = 3): string {
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    const digits = '0123456789';

    let alphaPart = '';
    let numericPart = '';

    for (let i = 0; i < alphaSize; i++) {
        alphaPart += letters.charAt(Math.floor(Math.random() * letters.length));
    }

    for (let i = 0; i < numericSize; i++) {
        numericPart += digits.charAt(Math.floor(Math.random() * letters.length));
    }

    return alphaPart + numericPart;
}

// Helper function to generate artifacts
export function getCasefileArtifacts(functionName: string, results: Array<{ title: string; url: string }>): Array<{
    type: "text";
    text: string;
    title?: string;
    format?: string;
}> {
    const artifacts: Array<{
        type: "text";
        text: string;
        title?: string;
        format?: string;
    }> = [];
    
    for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (!result.url) continue;
        
        const artifactData = {
            id: `msg_browser_${generateAlphaNumericId()}`,
            parentTaskId: `task_casefile_${generateAlphaNumericId()}`,
            timestamp: Date.now(),
            agent: {
                id: "agent_siya_browser",
                name: "SIYA",
                type: "qna"
            },
            messageType: "action",
            action: {
                tool: "browser",
                operation: "browsing",
                params: {
                    url: result.title,
                    pageTitle: `Tool response for ${functionName}`,
                    visual: {
                        icon: "browser",
                        color: "#2D8CFF"
                    },
                    stream: {
                        type: "vnc",
                        streamId: "stream_browser_1",
                        target: "browser"
                    }
                }
            },
            content: `Viewed page: ${functionName}`,
            artifacts: [{
                id: `artifact_webpage_${generateAlphaNumericId()}`,
                type: "browser_view",
                content: {
                    url: result.url,
                    title: functionName,
                    screenshot: "",
                    textContent: `Observed output of cmd \`${functionName}\` executed:`,
                    extractedInfo: {}
                },
                metadata: {
                    domainName: "example.com",
                    visitTimestamp: Date.now(),
                    category: "web_page"
                }
            }],
            status: "completed"
        };
        
        artifacts.push({
            type: "text",
            text: JSON.stringify(artifactData, null, 2),
            title: `Casefile: ${result.title}`,
            format: "json"
        });
    }
    return artifacts;
}

// Helper to generate casefile weblink (calls diary API)
export async function generateCasefileWeblink(casefileId: string): Promise<string> {
    const config = getConfig();
    const endpoints = [
        `${config.API_BASE_URL}/v1.0/diary/casefile-html/${casefileId}`,
        `${config.API_BASE_URL}/v1.0/diary/casefilehtml/${casefileId}`
    ];
    const headers = { Authorization: `Bearer ${config.API_TOKEN}` };
    
    for (const url of endpoints) {
        try {
            const resp = await fetch(url, { headers });
            if (resp.status === 200) {
                const body = await resp.json() as any;
                const data = body.resultData || {};
                if (body.status === "OK" && data.url) {
                    return data.url;
                }
            }
        } catch (e) {
            // Continue to next endpoint if error
            continue;
        }
    }
    throw new Error(`Could not generate weblink for casefile ${casefileId}`);
}

// Upload to S3
export async function uploadToS3(
    fileContent: Buffer | Uint8Array | string,
    destinationPath: string
): Promise<string> {
    const config = getConfig();
    const ACCESS_KEY = config.s3AccessKey;
    const SECRET_KEY = config.s3SecretKey;
    const REGION_NAME = config.s3Region;
    const BUCKET_NAME = config.s3BucketName;

    const s3Client = new S3Client({
        region: REGION_NAME,
        credentials: {
            accessKeyId: ACCESS_KEY,
            secretAccessKey: SECRET_KEY,
        },
    });

    // Detect content type based on file extension
    const fileName = String(destinationPath).split('/').pop() || 'unknown';
    const contentType =
        mimeLookup(fileName) || "application/octet-stream"; // Fallback for unknown types

    const params = {
        Bucket: BUCKET_NAME,
        Key: destinationPath,
        Body: fileContent,
        ContentType: contentType,
    };

    try {
        await s3Client.send(new PutObjectCommand(params));
        logger.info(`Uploaded ${destinationPath} with type ${contentType}`);
        
        // Return the S3 URL
        const s3Url = `https://s3.${REGION_NAME}.amazonaws.com/${BUCKET_NAME}/${destinationPath}`;
        return s3Url;
    } catch (error) {
        logger.error("Error uploading to S3:", error);
        throw new Error(`Failed to upload ${destinationPath} to S3: ${error}`);
    }
}

// Helper function to upload attachments to S3
export async function uploadAttachments(attachments: string[], casefileId: string): Promise<string[]> {
    const uploadedUrls: string[] = [];
    
    for (const filePath of attachments) {
        try {
            // Validate file path - check if it's absolute
            if (!path.isAbsolute(filePath)) {
                throw new Error(`File path must be absolute: ${filePath}. Relative paths are not supported.`);
            }
            
            // Check if file exists
            try {
                await fs.access(filePath);
            } catch (accessError) {
                throw new Error(`File not found or not accessible: ${filePath}. Please ensure the file exists and you have read permissions.`);
            }
            
            // Read file content
            const fileContent = await fs.readFile(filePath);
            const fileName = path.basename(String(filePath));
            
            // Create S3 destination path: casefile_docs/casefile_id/filename
            const destinationPath = `casefile_docs/${casefileId}/${fileName}`;
            
            // Upload to S3
            const s3Url = await uploadToS3(fileContent, destinationPath);
            uploadedUrls.push(s3Url);
            
            logger.info(`Successfully uploaded attachment ${fileName} to S3: ${s3Url}`);
        } catch (error) {
            logger.error(`Failed to upload attachment ${filePath}: ${error}`);
            throw new Error(`Failed to upload attachment ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    
    return uploadedUrls;
}

// Helper function to validate if a string is a valid link
export function isValidLink(link: string): boolean {
    if (typeof link !== 'string' || !link.trim()) {
        return false;
    }
    
    // Check for common URL patterns
    const urlPatterns = [
        /^https?:\/\/.+/i,                    // HTTP/HTTPS URLs
        /^ftp:\/\/.+/i,                       // FTP URLs
        /^mailto:.+/i,                        // Mailto links
        /^tel:.+/i,                           // Telephone links
        /^#.+/i,                              // Anchor links
        /^\/.+/i,                             // Relative paths (starting with /)
        /^[a-zA-Z0-9-]+:\/\/.+/i,            // Other protocols
        /^www\..+/i,                          // WWW URLs (without protocol)
        /^[a-zA-Z0-9][a-zA-Z0-9-]*\.[a-zA-Z]{2,}/i  // Domain names
    ];
    
    // Check if any pattern matches
    return urlPatterns.some(pattern => pattern.test(link.trim()));
}

// Helper function to get vessel details
export async function getVesselDetails(query: string): Promise<any> {
    try {
        if (!query) {
            throw new Error("Query parameter is required for vessel details search");
        }
       
        console.log(`[Internal] Searching for vessel details with vessel name: ${query}`);
            
        // Set up search parameters for the fleet-vessel-lookup collection
        const search_parameters = {
            q: query,
            query_by: 'vesselName',
            collection: 'fleet-vessel-lookup',
            per_page: 1,
            include_fields: 'vesselName,imo,class,flag,shippalmDoc,isV3',
            prefix: false,
            num_typos: 2,
        };
            
        // Execute search
        const typesenseClient = getTypesenseClient();
        const raw = await typesenseClient.collections('fleet-vessel-lookup').documents().search(search_parameters);
        const hits = raw.hits || [];
            
        if (!hits || hits.length === 0) {
            return null;
        }
            
        // Process and format results
        const doc = hits[0].document as any || {};
        return {
            vesselName: doc.vesselName,
            imo: doc.imo,
            class: doc.class,
            flag: doc.flag,
            shippalmDoc: doc.shippalmDoc,
            isV3: doc.isV3,
            score: hits[0].text_match || 0
        };
    } catch (error) {
        console.error(`[Internal] Error searching for vessel details: ${error}`);
        throw error;
    }
}

// Helper to push casefile to Typesense
export async function pushToTypesense(res: any, action: 'create' | 'update' | 'upsert' | 'emplace', dbName: string, mongoUri: string, collectionName: string = 'casefiles'): Promise<any> {
    const id = res.id || res._id?.toString();
    const casefileTxt = res.casefile;
    const summaryTxt = res.summary;
    const embeddingText = `Below casefile ${casefileTxt} with following summary ${summaryTxt} `;
    const link = await generateCasefileWeblink(id);

    if (!dbName || !mongoUri || !collectionName) {
        throw new Error('Database name, MongoDB URI, and collection name are required');
    }

    // Update the casefile in MongoDB with the link
    const databaseManager = new DatabaseManager();
    await databaseManager.initializeDatabase(dbName, mongoUri);
    const db = databaseManager.getDb();
    const collection = db.collection(collectionName);
    await collection.updateOne({ _id: id }, { $set: { link } });
    await databaseManager.closeDatabase();

    // Prepare Typesense data
    const createdAt = res.createdAt instanceof Date ? Math.floor(res.createdAt.getTime() / 1000) : (typeof res.createdAt === 'number' ? res.createdAt : Date.now() / 1000);
    const updatedAt = res.updatedAt instanceof Date ? Math.floor(res.updatedAt.getTime() / 1000) : (typeof res.updatedAt === 'number' ? res.updatedAt : Date.now() / 1000);
    const importance = typeof res.importance === 'number' ? res.importance : 0;
    const data: any = {
        id: id,
        _id: id,
        casefile: res.casefile,
        currentStatus: res.currentStatus,
        casefileInitiationDate: createdAt,
        category: res.category,
        conversationTopic: [],
        embedding_text: embeddingText,
        imo: Number(res.imo),
        importance: String(importance), // <-- convert to string for Typesense
        importance_score: importance,   // <-- keep as number for other uses
        lastcasefileUpdateDate: updatedAt,
        summary: res.summary,
        vesselId: res.vesselId ? String(res.vesselId) : null,
        vesselName: res.vesselName ? String(res.vesselName) : null,
        link: link,
        followUp: res.followUp || "",
        pages: JSON.stringify((res.pages || []).slice(-2)),
        index: JSON.stringify((res.index || []).slice(-2)),
    };
    if (res.plan_status) {
        data.plan_status = res.plan_status;
    }

    // for update action, the following fields are not allowed to be updated:
    // - embedding_text
    // - casefile

    if (action === 'update') {
        delete data.embedding_text;
        delete data.casefile;
    }

    try {
        const typesenseClient = getTypesenseClient();
        console.info(`Data pushed to Typesense:`, data);
        const result = await typesenseClient.collections("emailCasefile").documents().import([data], { action });
        // Log after Typesense push
        console.info(`[pushToTypesense] Data pushed to Typesense successfully for id: ${id}`);
        console.info(result);
        return result;
    } catch (e) {
        if (typeof e === "object" && e !== null && "importResults" in e) {
            console.error("Typesense import error details:", (e as any).importResults);
        }
        throw e;
    }
}

// Interface for create_casefile validation
interface CreateCasefileRequest {
    casefile: string;
    category: "General" | "LocationAndCargoActivity" | "FleetAlert" | "SmartShipAlert";
    currentStatus: string;
    status?: "active" | "resolved";
    summary: string;
    importance: number;
    imo: number;
    vesselName?: string;
    flag?: string;
}

// Field mapping for common incorrect field names
const fieldMapping: Record<string, string> = {
    // Common incorrect field names that LLMs might use
    "vessel_name": "vesselName",
    "imo_number": "imo", 
    "incident_type": "casefile",
    "location": "summary", // This should be part of summary
    "incident_date": "summary", // This should be part of summary
    "status": "currentStatus",
    "importance_level": "importance",
    "category": "category",
    "summary": "summary",
    "created_by": "summary", // This should be part of summary
    "description": "summary",
    "details": "summary",
    "content": "summary",
    "title": "casefile",
    "name": "casefile",
    "flag": "flag"
};

// Validation function for create_casefile
export function validateCreateCasefileArgs(args: any): { valid: boolean; errors: string[]; mappedArgs: any } {
    const errors: string[] = [];
    const mappedArgs: any = {};
    
    // Map incorrect field names to correct ones
    for (const [key, value] of Object.entries(args)) {
        const mappedKey = fieldMapping[key] || key;
        mappedArgs[mappedKey] = value;
    }
    
    // Validate required fields
    const requiredFields = ['casefile', 'category', 'currentStatus', 'summary', 'importance', 'imo','pages','index'];
    const missingFields: string[] = [];
    
    for (const field of requiredFields) {
        if (!mappedArgs[field]) {
            missingFields.push(field);
        }
    }
    
    if (missingFields.length > 0) {
        errors.push(`Missing required fields: ${missingFields.join(', ')}`);
    }
    
    // Validate field types and values
    if (mappedArgs.imo && (typeof mappedArgs.imo !== 'number' || mappedArgs.imo <= 0)) {
        errors.push('IMO must be a positive number');
    }
    if (mappedArgs.vesselName && typeof mappedArgs.vesselName !== 'string') {
        errors.push('Vessel name must be a string');
    }
    
    if (mappedArgs.importance && (typeof mappedArgs.importance !== 'number' || mappedArgs.importance < 0 || mappedArgs.importance > 100)) {
        errors.push('Importance must be a number between 0 and 100');
    }
    
    if (mappedArgs.category && !['General', 'LocationAndCargoActivity', 'FleetAlert', 'SmartShipAlert'].includes(mappedArgs.category)) {
        errors.push(`Invalid category. Must be one of: General, LocationAndCargoActivity, FleetAlert, SmartShipAlert`);
    }
    
    if (mappedArgs.status && !['active', 'resolved'].includes(mappedArgs.status)) {
        errors.push(`Invalid status. Must be one of: active, resolved`);
    }
    
    // Validate string fields are not empty
    if (mappedArgs.casefile && typeof mappedArgs.casefile === 'string' && mappedArgs.casefile.trim() === '') {
        errors.push('Casefile title cannot be empty');
    }
    
    if (mappedArgs.currentStatus && typeof mappedArgs.currentStatus === 'string' && mappedArgs.currentStatus.trim() === '') {
        errors.push('Current status cannot be empty');
    }
    if (mappedArgs.flag && typeof mappedArgs.flag === 'string' && mappedArgs.flag.trim() === '') {
        errors.push('Flag cannot be empty');
    }
    if (mappedArgs.summary && typeof mappedArgs.summary === 'string' && mappedArgs.summary.trim() === '') {
        errors.push('Summary cannot be empty');
    }

    if (mappedArgs.pages && Array.isArray(mappedArgs.pages) && mappedArgs.pages.length === 0) {
        errors.push('Pages cannot be empty');
    }

    if (mappedArgs.index && Array.isArray(mappedArgs.index) && mappedArgs.index.length === 0) {
        errors.push('Index cannot be empty');
    }
    
    // Validate pages and index if provided
    if (mappedArgs.pages && Array.isArray(mappedArgs.pages)) {
        mappedArgs.pages.forEach((page: any, i: number) => {
            if (!page || typeof page !== 'object') {
                errors.push(`pages[${i}] must be an object`);
                return;
            }
            if (!page.type || typeof page.type !== 'string' || page.type.trim() === '') {
                errors.push(`pages[${i}].type is required and cannot be empty`);
            }
            if (!page.topic || typeof page.type !== 'string' || page.topic.trim() === '') {
                errors.push(`pages[${i}].topic is required and cannot be empty`);
            }
            if (!page.summary || typeof page.summary !== 'string' || page.summary.trim() === '') {
                errors.push(`pages[${i}].summary is required and cannot be empty`);
            }
        });
    }
    
    if (mappedArgs.index && Array.isArray(mappedArgs.index)) {
        mappedArgs.index.forEach((idx: any, i: number) => {
            if (!idx || typeof idx !== 'object') {
                errors.push(`index[${i}] must be an object`);
                return;
            }
            if (!idx.type || typeof idx.type !== 'string' || idx.type.trim() === '') {
                errors.push(`index[${i}].type is required and cannot be empty`);
            }
            if (!idx.topic || typeof idx.topic !== 'string' || idx.topic.trim() === '') {
                errors.push(`index[${i}].topic is required and cannot be empty`);
            }
        });
    }

    // Ensure pages and index arrays are consistent in length if both provided
    if (Array.isArray(mappedArgs.pages) && Array.isArray(mappedArgs.index)) {
        if (mappedArgs.pages.length !== mappedArgs.index.length) {
            errors.push(`pages and index must have the same number of entries (got pages=${mappedArgs.pages.length}, index=${mappedArgs.index.length})`);
        }
    }
    
    // Set default values for optional fields
    if (!mappedArgs.status) {
        mappedArgs.status = 'active';
    }
    
    return {
        valid: errors.length === 0,
        errors,
        mappedArgs
    };
}
