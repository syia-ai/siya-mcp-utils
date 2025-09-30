import { DatabaseManager } from "./mongodb.js";
import { logger } from "./logger.js";
import { ToolArguments, ToolResponse } from "./types/index.js";
import { getConfig } from "./config";
import { TextContent } from "@modelcontextprotocol/sdk/types.js";
import { fetchCompanyImoNumbers, shouldBypassImoFiltering } from "./imoUtils.js";
import { getTypesenseClient } from "./typesense.js";
import { MongoClient } from 'mongodb';

export async function fetchQADetails(
    imo: string, 
    qaId: number, 
    vesselInfoDbName: string,
    vesselInfoMongoUri: string,
    collectionName: string = 'vesselinfos'
): Promise<any> {
    const databaseManager = new DatabaseManager();
    
    try {
        await databaseManager.initializeDatabase(vesselInfoDbName, vesselInfoMongoUri);
        const vesselInfoDb = databaseManager.getDb();
        const collection = vesselInfoDb.collection(collectionName);
        
        const query = {
            'imo': parseInt(imo),
            'questionNo': qaId
        };

        const projection = {
            '_id': 0,
            'imo': 1,
            'vesselName': 1,
            'refreshDate': 1,
            'answer': 1
        };

        interface QAResponse {
            imo: number;
            vesselName: string | null;
            refreshDate: string | null;
            answer: string | null;
            Artifactlink?: string | null;
        }

        const mongoResult = await collection.findOne(query, { projection });
        let res: QAResponse = mongoResult ? {
            imo: mongoResult.imo as number,
            vesselName: mongoResult.vesselName as string | null,
            refreshDate: mongoResult.refreshDate as string | null,
            answer: mongoResult.answer as string | null
        } : {
            imo: parseInt(imo),
            vesselName: null,
            refreshDate: null,
            answer: null
        };

        // Format refresh date if it exists
        if (res.refreshDate && new Date(res.refreshDate).toString() !== 'Invalid Date') {
            res.refreshDate = new Date(res.refreshDate).toLocaleDateString('en-US', {
                day: 'numeric',
                month: 'short',
                year: 'numeric'
            });
        }

        // Process answer with component data if it exists
        if (res.answer) {
            const vesselComponentsDbName = process.env.vesselComponentsDbName || vesselInfoDbName;
            const vesselComponentsMongoUri = process.env.vesselComponentsMongoUri || vesselInfoMongoUri;
            res.answer = await addComponentData(res.answer, imo, vesselComponentsDbName, vesselComponentsMongoUri);
        }

        // Get vessel QnA snapshot link
        try {
            res.Artifactlink = await getVesselQnASnapshot(imo, qaId.toString());
        } catch (error) {
            res.Artifactlink = null;
        }

        return res;
    } catch (error: any) {
        logger.error('Error fetching QA details:', error);
        throw new Error(`Error fetching QA details: ${error.message}`);
    } finally {
        await databaseManager.closeDatabase();
    }
}



export async function fetchQADetailsAndCreateResponse(
    imo: string | undefined, 
    questionNo: number, 
    functionName: string, 
    linkHeader: string, 
    sessionId: string = "testing",
    vesselInfoDbName: string,
    vesselInfoMongoUri: string,
    collectionName: string = 'vesselinfos'
): Promise<ToolResponse> {
    if (!imo) {
        throw new Error("IMO is required");
    }

    const databaseManager = new DatabaseManager();
    
    try {
        // Fetch QA details
        const result = await fetchQADetails(imo, questionNo, vesselInfoDbName, vesselInfoMongoUri, collectionName);
        const link = result.Artifactlink;
        const vesselName = result.vesselName;

        // Insert data link to MongoDB
        // await insertDataLinkToMongoDB(link, linkHeader, sessionId, imo, vesselName, vesselInfoDbName, vesselInfoMongoUri);

        // Get artifact data
        const artifactData = await getArtifact(functionName, link);

        // Create content responses with processed answer
        const content: TextContent = {
            type: "text",
            text: result.answer || "No data available"
        };

        const artifact: TextContent = {
            type: "text",
            text: JSON.stringify(artifactData, null, 2)
        };

        return [content, artifact];
    } catch (error: any) {
        logger.error(`Error in ${functionName}:`, error);
        throw new Error(`Error in ${functionName}: ${error.message}`);
    } finally {
        await databaseManager.closeDatabase();
    }
}


export async function getComponentData(componentId: string, vesselComponentsDbName: string, vesselComponentsMongoUri: string, collectionName: string = 'vesselinfocomponents'): Promise<string> {
    const match = componentId.match(/^(\d+)_(\d+)_(\d+)$/);
    if (!match) {
        return `⚠️ Invalid component_id format: ${componentId}`;
    } 

    if (!vesselComponentsDbName || !vesselComponentsMongoUri || !collectionName) {
        throw new Error('Database name, MongoDB URI, and collection name are required');
    }

    const [, componentNumber, questionNumber, imo] = match;
    const componentNo = `${componentNumber}_${questionNumber}_${imo}`;

    const databaseManager = new DatabaseManager();
    
    try {
        await databaseManager.initializeDatabase(vesselComponentsDbName, vesselComponentsMongoUri);
        const vesselComponentsDb = databaseManager.getDb();
        const collection = vesselComponentsDb.collection(collectionName);

        const doc = await collection.findOne({ componentNo });
        if (!doc) {
            return `⚠️ No component found for ID: ${componentId}`;
        }

        if (!doc.data) {
            return "No data found in the table component";
        }

        if (!doc.data.headers || !Array.isArray(doc.data.headers)) {
            return "No headers found in the table component";
        }

        if (!doc.data.body || !Array.isArray(doc.data.body)) {
            return "No body data found in the table component";
        }

        // Extract headers excluding lineitem
        const headers = doc.data.headers
            .filter((h: any) => h && h.name !== "lineitem")
            .map((h: any) => h.name);

        const rows = doc.data.body;

        // Build markdown table
        let md = "| " + headers.join(" | ") + " |\n";
        md += "| " + headers.map(() => "---").join(" | ") + " |\n";

        for (const row of rows) {
            const formattedRow = row
                .filter((cell: any) => cell && !cell.lineitem) // Exclude lineitem and null cells
                .map((cell: any) => {
                    if (cell && cell.value && cell.link) {
                        return `[${cell.value}](${cell.link})`;
                    } else if (cell && cell.status && cell.color) {
                        return cell.status;
                    }
                    return cell ? String(cell) : '';
                });
            md += "| " + formattedRow.join(" | ") + " |\n";
        }

        return md;
    } catch (error: any) {
        logger.error('Error getting component data:', error);
        throw new Error(`Error getting component data: ${error.message}`);
    } finally {
        await databaseManager.closeDatabase();
    }
}

export async function addComponentData(answer: string, imo: string, vesselComponentsDbName: string, vesselComponentsMongoUri: string): Promise<string> {
    const pattern = /httpsdev\.syia\.ai\/chat\/ag-grid-table\?component=(\d+_\d+)/g;
    const matches = Array.from(answer.matchAll(pattern));
    
    logger.info(`addComponentData called with IMO: ${imo}, matches found: ${matches.length}`);
    logger.info(`Answer contains ag-grid URL: ${answer.includes('ag-grid-table')}`);
    
    let result = answer;
    for (const match of matches) {
        const component = match[1];
        logger.info(`Processing component: ${component}, full match: ${match[0]}`);
        try {
            const replacement = await getComponentData(`${component}_${imo}`, vesselComponentsDbName, vesselComponentsMongoUri, 'vesselinfocomponents');
            logger.info(`Component data retrieved, length: ${replacement.length}`);
            result = result.replace(match[0], replacement);
        } catch (error) {
            logger.error('Error replacing component data:', error);
        }
    }
    
    logger.info(`addComponentData returning result, length: ${result.length}`);
    return result;
}

export async function getVesselQnASnapshot(imo: string, questionNo: string): Promise<any> {
    try {

        const config = getConfig();
        const raw_snapshotUrl = config.snapshotUrl
        // API endpoint
        const snapshotUrl = `${raw_snapshotUrl}/${imo}/${questionNo}`;
        
        const raw_jwtToken = config.jwtToken
        // Authentication token
        const jwtToken = `Bearer ${raw_jwtToken}`;
        
        // Headers for the request
        const headers = {
            "Authorization": jwtToken
        };
        
        logger.info(`Fetching vessel QnA snapshot for IMO: ${imo}, Question: ${questionNo}`);
        const response = await fetch(snapshotUrl, {
            method: 'GET',
            headers
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Return resultData if it exists, otherwise return the full response
        if (data && typeof data === 'object' && "resultData" in data) {
            return data.resultData;
        }
        return data;
    } catch (error: any) {
        logger.error(`Error fetching vessel QnA snapshot for IMO ${imo}, Question ${questionNo}:`, error);
        return null;
    }
}

export async function getVesselQnASnapshotHandler(arguments_: ToolArguments): Promise<ToolResponse> {
    const { imo, questionNo } = arguments_;
    
    if (!imo || !questionNo) {
        throw new Error("Both IMO and questionNo are required");
    }
    
    try {
        const result = await getVesselQnASnapshot(imo, questionNo);
        
        if (!result) {
            return [{
                type: "text",
                text: `No QnA snapshot data found for vessel IMO: ${imo}, Question: ${questionNo}`
            }];
        }
        
        return [{
            type: "text",
            text: JSON.stringify(result, null, 2),
            title: `Vessel QnA Snapshot - IMO: ${imo}, Question: ${questionNo}`,
            format: "json"
        }];
    } catch (error: any) {
        logger.error(`Error getting vessel QnA snapshot:`, error);
        throw new Error(`Error getting vessel QnA snapshot: ${error.message}`);
    }
}

export async function getDataLink(data: any[]): Promise<string> {
    try {
        const config = getConfig();
        const raw_url = config.snapshotUrl
        const url = raw_url;

        const raw_jwtToken = config.jwtToken
        const headers = {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${raw_jwtToken}`
        };
        const payload = {
            data
        };

        // Log URL and token (complete values)
        logger.info(`Making request to URL: ${url}`);
        logger.info(`Using JWT token: ${raw_jwtToken}`);

        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
        });

        // Log response status and headers
        logger.info(`Response status: ${response.status} ${response.statusText}`);
        logger.info(`Response headers: ${JSON.stringify(Object.fromEntries(response.headers.entries()))}`);

        if (!response.ok) {
            logger.error(`HTTP error! status: ${response.status}, statusText: ${response.statusText}`);
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json() as any;
        
        // Log complete response data
        logger.info(`Complete response data: ${JSON.stringify(result)}`);
        
        if (result.status === "OK") {
            logger.info(`Successfully got data link: ${result.resultData}`);
            return result.resultData;
        } else {
            logger.error(`Failed to get data link: Invalid response status - ${result.status}`);
            throw new Error('Failed to get data link: Invalid response status');
        }
    } catch (error: any) {
        logger.error('Error getting data link:', error);
        throw new Error(`Error getting data link: ${error.message}`);
    }
}

type InsertMode = 'general' | 'pms';

interface InsertDataLinkOptions {
    mode: InsertMode;
    collectionName: string;
    dataLink: string;
    linkHeader?: string;
    sessionId: string;
    imo?: string;
    vesselName?: string;
    type?: string;
}

interface CasefileData {
    sessionId: string;
    imo: string;
    vesselName: string;
    links: { link: string; linkHeader: string }[];
    datetime: string;
}

// /**
//  * Generic function to insert data links into MongoDB
//  */
// export async function insertDataLinkToMongoDBGeneric(options: InsertDataLinkOptions, dbName: string, mongoUri: string): Promise<void> {
//     try {
//         if (!dbName || !mongoUri) {
//             throw new Error('Database name and MongoDB URI are required');
//         }

//         const databaseManager = new DatabaseManager();
//         await databaseManager.initializeDatabase(dbName, mongoUri);
//         const db = databaseManager.getDb();
//         const collection = db.collection(options.collectionName);

//         if (options.mode === 'general') {
//             await collection.insertOne({
//                 link: options.dataLink,
//                 type: options.type,
//                 sessionId: options.sessionId,
//                 imo: options.imo,
//                 vesselName: options.vesselName,
//                 createdAt: new Date()
//             });
//         } else if (options.mode === 'pms') {
//             const linkData = {
//                 link: options.dataLink,
//                 linkHeader: options.linkHeader || ''
//             };

//             const sessionExists = await collection.findOne({ sessionId: options.sessionId });

//             if (sessionExists) {
//                 await collection.updateOne(
//                     { sessionId: options.sessionId },
//                     {
//                         $push: { links: { $each: [linkData] } },
//                         $set: { datetime: new Date().toISOString() }
//                     }
//                 );
//             } else {
//                 const newEntry: CasefileData = {
//                     sessionId: options.sessionId,
//                     imo: options.imo ?? '',
//                     vesselName: options.vesselName ?? '',
//                     links: [linkData],
//                     datetime: new Date().toISOString()
//                 };
//                 await collection.insertOne(newEntry);
//             }
//         } else {
//             throw new Error(`Unsupported insert mode: ${options.mode}`);
//         }
        
//         await databaseManager.closeDatabase();
//     } catch (error: any) {
//         logger.error(`Error inserting data link to MongoDB [${options.mode}]:`, error);
//         throw new Error(`Error inserting data link to MongoDB: ${error.message}`);
//     }
// }

// // export async function insertDataLinkToMongoDB(
// //     link: string,
// //     type: string,
// //     sessionId: string,
// //     imo: string,
// //     vesselName: string,
// //     dataLinksDbName: string,
// //     dataLinksMongoUri: string
// // ): Promise<void> {
// //     return insertDataLinkToMongoDBGeneric({
// //         mode: 'general',
// //         collectionName: 'data_links',
// //         dataLink: link,
// //         sessionId,
// //         imo,
// //         vesselName,
// //         type
// //     }, dataLinksDbName, dataLinksMongoUri);
// // }

// export async function insertPmsDataLinkToMongodb(
//     dataLink: string,
//     linkHeader: string,
//     sessionId: string,
//     imo?: string,
//     vesselName?: string,
//     dbName?: string,
//     mongoUri?: string
// ): Promise<void> {
//     if (!dbName || !mongoUri) {
//         throw new Error('Database name and MongoDB URI are required');
//     }
    
//     return insertDataLinkToMongoDBGeneric({
//         mode: 'pms',
//         collectionName: 'casefile_data',
//         dataLink,
//         linkHeader,
//         sessionId,
//         imo,
//         vesselName
//     }, dbName, mongoUri);
// }


export async function getArtifact(toolName: string, link: string): Promise<any> {
    try {
        const timestamp = Math.floor(Date.now() / 1000);
        const artifact = {
            id: `msg_browser_${Math.random().toString(36).substring(2, 8)}`,
            parentTaskId: `task_${toolName}_${Math.random().toString(36).substring(2, 8)}`,
            timestamp,
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
                    url: link,
                    pageTitle: `Tool response for ${toolName}`,
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
            content: `Viewed page: ${toolName}`,
            artifacts: [
                {
                    id: `artifact_webpage_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
                    type: "browser_view",
                    content: {
                        url: link,
                        title: toolName,
                        screenshot: "",
                        textContent: `Observed output of cmd \`${toolName}\` executed:`,
                        extractedInfo: {}
                    },
                    metadata: {
                        domainName: "example.com",
                        visitTimestamp: Date.now(),
                        category: "web_page"
                    }
                }
            ],
            status: "completed"
        };

        return artifact;
    } catch (error: any) {
        logger.error('Error getting artifact:', error);
        throw new Error(`Error getting artifact: ${error.message}`);
    }
}

export async function getListOfArtifacts(toolName: string, linkData: Array<{ title: string; url: string | null }>): Promise<ToolResponse> {
    try {
        const artifacts: ToolResponse = [];
        for (const link of linkData) {
            if (link.url) {
                const artifactData = await getArtifact(toolName, link.url);
                artifacts.push({
                    type: "text",
                    text: JSON.stringify(artifactData, null, 2)
                });
            }
        }
        return artifacts;
    } catch (error: any) {
        logger.error("Error getting list of artifacts:", error);
        throw new Error(`Error getting list of artifacts: ${error.message}`);
    }
}

export function convertUnixDates(document: any): any {
    logger.debug(`Starting Unix date conversion for document with ${Object.keys(document).length} fields`);
    
    const result = { ...document };

    const dateFields = [
        'purchaseRequisitionDate',
        'purchaseOrderIssuedDate',
        'orderReadinessDate',
        'date',
        'poDate',
        'expenseDate',
        "inspectionTargetDate",
        "reportDate", 
        "closingDate",
        "targetDate",
        "nextDueDate",
        "extendedDate"
    ];

    logger.debug(`Checking ${dateFields.length} potential date fields for Unix timestamp conversion`);

    let convertedCount = 0;
    for (const field of dateFields) {
        const value = result[field];
        if (typeof value === "number" && Number.isFinite(value)) {
            const originalValue = value;
            result[field] = new Date(value * 1000).toISOString();
            logger.debug(`Converted field '${field}' from Unix timestamp ${originalValue} to ISO date: ${result[field]}`);
            convertedCount++;
        }
    }

    logger.debug(`Unix date conversion completed - ${convertedCount} fields converted out of ${dateFields.length} checked fields`);
    return result;
}


/**
 * Convert data to CSV format
 * @param data - Array of objects to convert
 * @returns CSV string
 */
export function convertToCSV(data: any[]): string {
    if (!data.length) return "";

    const headers = Object.keys(data[0]);
    
    const escapeCSV = (value: any): string => {
        const str = value != null ? String(value) : "";
        const needsEscaping = /[",\n]/.test(str);
        const escaped = str.replace(/"/g, '""'); // escape double quotes
        return needsEscaping ? `"${escaped}"` : escaped;
    };

    const rows = data.map(doc =>
        headers.map(header => escapeCSV(doc[header])).join(',')
    );

    return [headers.join(','), ...rows].join('\n');
}



export async function processTypesenseResults(
    searchResult: any,
    toolName: string,
    title: string,
    session_id: string = "testing",
    linkHeader: string,
    artifactTitle?: string,
    dbName?: string,
    mongoUri?: string
): Promise<ToolResponse> {
    logger.info(`Starting processTypesenseResults for tool: ${toolName}, session: ${session_id}`);
    
    try {
        // Log input validation
        logger.info(`Validating search results for ${toolName} - hits count: ${searchResult?.hits?.length || 0}`);
        
        if (!searchResult || !searchResult.hits || searchResult.hits.length === 0) {
            logger.warn(`No search results found for ${toolName}`);
            return [{
                type: "text",
                text: "No records found for the specified criteria.",
                title: "No Results Found",
                format: "json"
            }];
        }

        logger.info(`Processing ${searchResult.hits.length} hits for ${toolName}`);

        // Process search results into the standard format
        const hits = searchResult.hits || [];
        logger.info(`Starting document processing for ${hits.length} hits in ${toolName}`);
        
        const documents = await Promise.all(hits.map(async (hit: any, index: number) => {
            if (!hit.document) {
                logger.warn(`Hit ${index} is missing document property in ${toolName}`);
                return {};
            }
            
            // Create a shallow copy of the document
            const document = { ...hit.document };
            
            // Remove embedding field to reduce response size
            if (document.embedding) {
                logger.debug(`Removing embedding field from document ${index} in ${toolName}`);
                delete document.embedding;
            }
            
            // Convert Unix timestamps to readable dates
            logger.debug(`Converting Unix dates for document ${index} in ${toolName}`);
            return await convertUnixDates(document);
        }));

        logger.info(`Successfully processed ${documents.length} documents for ${toolName}`);

        // Get data link
        logger.info(`Generating data link for ${toolName}`);
        const dataLink = await getDataLink(documents);
        logger.info(`Data link generated successfully for ${toolName}: ${dataLink.substring(0, 50)}...`);

        // Get vessel name and IMO from hits
        let vesselName = null;
        let imo = null;
        logger.info(`Extracting vessel information from search results for ${toolName}`);
        try {
            vesselName = searchResult.hits[0]?.document?.vesselName;
            imo = searchResult.hits[0]?.document?.imo;
            logger.info(`Vessel info extracted for ${toolName} - Name: ${vesselName}, IMO: ${imo}`);
        } catch (error) {
            logger.warn(`Could not get vessel name or IMO from hits in ${toolName}:`, error);
        }

        // Insert the data link to mongodb collection
        logger.info(`Inserting data link to MongoDB for ${toolName}, session: ${session_id}`);
        if (dbName && mongoUri) {
            // await insertDataLinkToMongoDB(dataLink, linkHeader, session_id, imo || "", vesselName || "", dbName, mongoUri);
        }
        logger.info(`Data link successfully inserted to MongoDB for ${toolName}`);

        // Format results in the standard structure
        logger.info(`Formatting results for ${toolName}`);
        const formattedResults = {
            found: searchResult.found || 0,
            out_of: searchResult.out_of || 0,
            page: searchResult.page || 1,
            hits: documents,
            artifactLink: dataLink
        };
        logger.info(`Results formatted successfully for ${toolName} - found: ${formattedResults.found}, out_of: ${formattedResults.out_of}`);

        // Get artifact data
        logger.info(`Retrieving artifact data for ${toolName}`);
        const artifactData = await getArtifact(toolName, dataLink);
        logger.info(`Artifact data retrieved successfully for ${toolName}`);

        // Create content response
        logger.info(`Creating content response for ${toolName}`);
        const content: TextContent = {
            type: "text",
            text: JSON.stringify(formattedResults, null, 2),
            title,
            format: "json"
        };

        // Create artifact response
        logger.info(`Creating artifact response for ${toolName}`);
        const artifact: TextContent = {
            type: "text",
            text: JSON.stringify(artifactData, null, 2),
            title: artifactTitle || title,
            format: "json"
        };

        logger.info(`processTypesenseResults completed successfully for ${toolName}`);
        return [content, artifact];
    } catch (error: any) {
        logger.error(`Error processing Typesense results for ${toolName}:`, error);
        return [{
            type: "text",
            text: `Error processing results: ${error.message}`,
            title: "Error",
            format: "json"
        }];
    }
}

export async function processTypesenseExportResults(
    documents: any[],
    toolName: string,
    title: string, 
    artifactTitle: string,
    session_id: string,
    linkHeader: string,
    imo: string,
    vesselName: string | null,
    dbName?: string,
    mongoUri?: string
): Promise<ToolResponse> {
    try {
        // Process documents
        const processedDocuments = await Promise.all(documents.map(async (doc: any) => {
            const document = { ...doc };
            
            // Remove embedding field to reduce response size
            if (document.embedding) {
                delete document.embedding;
            }
            
            // Convert any Unix timestamps to readable dates
            return await convertUnixDates(document);
        }));
        
        // Get data link
        const dataLink = await getDataLink(processedDocuments);
        
        // Insert the data link to mongodb collection
        if (dbName && mongoUri) {
            // await insertDataLinkToMongoDB(dataLink, linkHeader, session_id, imo || "", vesselName || "", dbName, mongoUri);
        }

        // Format results in the standard structure
        const formattedResults = {
            found: processedDocuments.length,
            out_of: processedDocuments.length,
            page: 1,
            hits: processedDocuments,
            artifactLink: dataLink
        };

        // Get artifact data
        const artifactData = await getArtifact(toolName, dataLink);

        // Create content response
        const content: TextContent = {
            type: "text",
            text: JSON.stringify(formattedResults, null, 2),
            title,
            format: "json"
        };

        // Create artifact response
        const artifact: TextContent = {
            type: "text",
            text: JSON.stringify(artifactData, null, 2),
            title: artifactTitle,
            format: "json"
        };

        return [content, artifact];
    } catch (error: any) {
        logger.error(`Error processing Typesense export results for ${toolName}:`, error);
        return [{
            type: "text",
            text: `Error processing results: ${error.message}`,
            title: "Error",
            format: "json"
        }];
    }
}

export async function formatTypesenseResults(
    searchResult: any,
    toolName: string,
    title: string,
    dataLink: string,
    artifactTitle?: string
): Promise<ToolResponse> {
    try {
        // Process search results into the standard format
        const hits = searchResult.hits || [];
        const documents = await Promise.all(hits.map(async (hit: any) => {
            if (!hit.document) {
                logger.warn(`Hit is missing document property in ${toolName}`);
                return {};
            }
            
            // Create a shallow copy of the document
            const document = { ...hit.document };
            
            // Remove embedding field to reduce response size
            if (document.embedding) {
                delete document.embedding;
            }
            
            // Convert Unix timestamps to readable dates
            return await convertUnixDates(document);
        }));

        // Format results in the standard structure
        const formattedResults = {
            found: searchResult.found || 0,
            out_of: searchResult.out_of || 0,
            page: searchResult.page || 1,
            hits: documents
        };

        // Get artifact data
        const artifactData = await getArtifact(toolName, dataLink);

        const testing_json : any = {
            found: searchResult.found || 0,
            out_of: searchResult.out_of || 0,
            page: searchResult.page || 1,
            hits: "testing"
        }

        // Create content response
        const content: TextContent = {
            type: "text",
            text: JSON.stringify(testing_json, null, 2),
            title,
            format: "json"
        };

        // Create artifact response
        const artifact: TextContent = {
            type: "text",
            text: JSON.stringify(artifactData, null, 2),
            title: artifactTitle || title,
            format: "json"
        };

        return [content, artifact];
    } catch (error: any) {
        logger.error(`Error formatting Typesense results for ${toolName}:`, error);
        return [{
            type: "text",
            text: `Error formatting results: ${error.message}`,
            title: "Error",
            format: "json"
        }];
    }
}

/**
 * Step 1: Query Typesense fleet-details collection to get fleet IMO by name
 * @param fleetName - Name of the fleet (e.g., "SMPL DRY")
 * @returns Promise<number | null> - Fleet IMO number or null if not found
 */
export async function getFleetImoByName(fleetName: string): Promise<number | null> {
    try {
      const client = getTypesenseClient();
      
      const searchResult = await client.collections('fleet-details').documents().search({
        q: fleetName,
        query_by: 'name',
        per_page: 1
      });
      
      if (searchResult.hits && searchResult.hits.length > 0) {
        const fleetDoc = searchResult.hits[0].document as any;
        return fleetDoc.imo || null;
      }
      
      return null;
    } catch (error) {
      logger.error(`Error fetching fleet IMO for ${fleetName}:`, error);
      return null;
    }
  }

/**
 * Step 2: Query MongoDB common_group_details collection to get vessel IMO list
 * @param fleetImo - IMO number of the fleet
 * @returns Promise<number[]> - Array of vessel IMO numbers
 */
export async function getVesselImoListFromFleet(fleetImo: number, dbName: string, mongoUri: string, collectionName: string = 'common_group_details'): Promise<number[]> {
    if (!dbName || !mongoUri || !collectionName) {
      throw new Error('Database name, MongoDB URI, and collection name are required for fleet operations');
    }
    
    const databaseManager = new DatabaseManager();
    
    try {
      await databaseManager.initializeDatabase(dbName, mongoUri);
      const db = databaseManager.getDb();
      const collection = db.collection(collectionName);
      
      const fleetDoc = await collection.findOne({ imo: fleetImo });
      
      if (fleetDoc && fleetDoc.imoList && Array.isArray(fleetDoc.imoList)) {
        return fleetDoc.imoList;
      }
      
      return [];
    } catch (error) {
      logger.error(`Error fetching vessel IMO list for fleet ${fleetImo}:`, error);
      throw error;
    } finally {
      await databaseManager.closeDatabase();
    }
  }

  async function updateTypesenseFilterWithCompanyImosGeneric(
    filter: string,
    options?: {
        bypassForSynergy?: boolean;
        bypassForAdminCompanies?: boolean;
        loggerTag?: string; // For identifying the context: "PMS", "Defect", etc.
    },
    dbName?: string,
    mongoUri?: string
): Promise<string> {
    const { bypassForSynergy = false, bypassForAdminCompanies = false, loggerTag = "" } = options || {};
    const companyName = getConfig().companyName;

    if (!companyName) {
        logger.warn(`[${loggerTag}] Company name is missing in config.`);
        return filter;
    }

    if (bypassForSynergy && companyName === "Synergy") {
        return filter;
    }

    if (bypassForAdminCompanies && shouldBypassImoFiltering(companyName)) {
        logger.debug(`[${loggerTag}] Skipping Typesense IMO filtering for admin company: ${companyName}`);
        return filter;
    }

    const companyImos = dbName && mongoUri ? await fetchCompanyImoNumbers(companyName, dbName, mongoUri) : [];
    if (companyImos.length === 0) {
        logger.warn(`[${loggerTag}] No company IMO numbers configured. Skipping Typesense IMO filtering.`);
        return filter;
    }

    const imoFilter = `imo:[${companyImos.join(",")}]`;

    if (filter && filter.trim()) {
        const combinedFilter = `${filter} && ${imoFilter}`;
        logger.debug(`[${loggerTag}] Applied Typesense IMO filter: ${combinedFilter}`);
        return combinedFilter;
    } else {
        logger.debug(`[${loggerTag}] Applied Typesense IMO filter: ${imoFilter}`);
        return imoFilter;
    }
}

// Specific wrappers

export async function updateTypesenseFilterWithCompanyImos(filter: string, dbName?: string, mongoUri?: string): Promise<string> {
    return updateTypesenseFilterWithCompanyImosGeneric(filter, {
        bypassForSynergy: true,
        loggerTag: "General"
    }, dbName, mongoUri);
}

export async function updateTypesenseFilterWithCompanyImosPms(filter: string, dbName?: string, mongoUri?: string): Promise<string> {
    return updateTypesenseFilterWithCompanyImosGeneric(filter, {
        bypassForAdminCompanies: true,
        loggerTag: "PMS"
    }, dbName, mongoUri);
}

export async function updateTypesenseFilterWithCompanyImosDefect(filter: string, dbName?: string, mongoUri?: string): Promise<string> {
    return updateTypesenseFilterWithCompanyImosGeneric(filter, {
        bypassForAdminCompanies: true,
        loggerTag: "Defect"
    }, dbName, mongoUri);
}

/**
 * Update MongoDB filter with company IMO numbers for filtering (PMS version)
 * @param filter - Existing MongoDB filter object
 * @returns Updated filter object with IMO restrictions
 */
export async function updateMongoFilterWithCompanyImos(filter: any, dbName?: string, mongoUri?: string): Promise<any> {
    const companyName = getConfig().companyName;
    
    // Skip filtering for admin companies
    if (!companyName || shouldBypassImoFiltering(companyName)) {
        logger.debug(`Skipping MongoDB IMO filtering for admin company: ${companyName}`);
        return filter;
    }
    
    const companyImos = dbName && mongoUri ? await fetchCompanyImoNumbers(companyName, dbName, mongoUri) : [];
    
    // If no IMO numbers configured, return original filter
    if (companyImos.length === 0) {
        logger.warn('No company IMO numbers configured. Skipping MongoDB IMO filtering.');
        return filter;
    }
    
    // Create a copy of the filter to avoid modifying the original
    const updatedFilter = { ...filter };
    
    // Convert IMO numbers to integers for MongoDB query
    const imoNumbers = companyImos.map((imo: string) => Number(imo));
    
    // Add IMO restriction to the filter
    updatedFilter.imo = { $in: imoNumbers };
    
    logger.debug(`Applied MongoDB IMO filter: ${JSON.stringify(updatedFilter)}`);
    return updatedFilter;
}

/**
 * Update MongoDB aggregation pipeline with company IMO numbers for filtering (PMS version)
 * @param pipeline - Existing MongoDB aggregation pipeline
 * @returns Updated pipeline with IMO restrictions
 */
export async function updateMongoAggregationWithCompanyImos(pipeline: any[], dbName?: string, mongoUri?: string): Promise<any[]> {
    const companyName = getConfig().companyName;
    
    // Skip filtering for admin companies
    if (!companyName || shouldBypassImoFiltering(companyName)) {
        logger.debug(`Skipping MongoDB aggregation IMO filtering for admin company: ${companyName}`);
        return pipeline;
    }
    
    const companyImos = dbName && mongoUri ? await fetchCompanyImoNumbers(companyName, dbName, mongoUri) : [];
    
    // If no IMO numbers configured, return original pipeline
    if (companyImos.length === 0) {
        logger.warn('No company IMO numbers configured. Skipping MongoDB aggregation IMO filtering.');
        return pipeline;
    }
    
    // Convert IMO numbers to integers for MongoDB query
    const imoNumbers = companyImos.map((imo: string) => Number(imo));
    
    // Create IMO match stage
    const imoMatchStage = {
        $match: {
            imo: { $in: imoNumbers }
        }
    };
    
    // Add IMO filter as the first stage in the pipeline
    const updatedPipeline = [imoMatchStage, ...pipeline];
    
    logger.debug(`Applied MongoDB aggregation IMO filter: ${JSON.stringify(imoMatchStage)}`);
    return updatedPipeline;
}


/**
 * Update search query parameters with company IMO filtering (PMS version)
 * @param searchParams - Search parameters object
 * @returns Updated search parameters with IMO restrictions
 */
export async function updateSearchParamsWithCompanyImos(searchParams: any, dbName?: string, mongoUri?: string): Promise<any> {
    const companyName = getConfig().companyName;
    
    // Skip filtering for admin companies
    if (!companyName || shouldBypassImoFiltering(companyName)) {
        logger.debug(`Skipping search params IMO filtering for admin company: ${companyName}`);
        return searchParams;
    }
    
    const companyImos = dbName && mongoUri ? await fetchCompanyImoNumbers(companyName, dbName, mongoUri) : [];
    
    // If no IMO numbers configured, return original params
    if (companyImos.length === 0) {
        logger.warn('No company IMO numbers configured. Skipping search params IMO filtering.');
        return searchParams;
    }
    
    // Create a copy of the search params
    const updatedParams = { ...searchParams };
    
    // Update filter_by parameter for Typesense
    if (updatedParams.filter_by) {
        updatedParams.filter_by = updateTypesenseFilterWithCompanyImosPms(updatedParams.filter_by);
    } else {
        updatedParams.filter_by = updateTypesenseFilterWithCompanyImosPms('');
    }
    
    logger.debug(`Updated search params with IMO filtering: ${JSON.stringify(updatedParams)}`);
    return updatedParams;
}


/**
 * Check if a vessel IMO is authorized for the current company (PMS version)
 * @param imo - IMO number to check
 * @returns True if authorized, false otherwise
 */
export async function isVesselAuthorizedForCompany(imo: string | number, dbName?: string, mongoUri?: string): Promise<boolean> {
    const companyName = getConfig().companyName;
    
    // Allow access for admin companies
    if (!companyName || shouldBypassImoFiltering(companyName)) {
        return true;
    }
    
    const companyImos = dbName && mongoUri ? await fetchCompanyImoNumbers(companyName, dbName, mongoUri) : [];
    
    // If no IMO numbers configured, deny access
    if (companyImos.length === 0) {
        return false;
    }
    
    const imoNumber = Number(imo);
    const companyImoNumbers = companyImos.map((imo: string) => Number(imo));
    
    return companyImoNumbers.includes(imoNumber);
}


/**
 * Get authorized IMO numbers for the current company (PMS version)
 * @returns Array of authorized IMO numbers
 */
export async function getAuthorizedImoNumbers(dbName?: string, mongoUri?: string): Promise<string[]> {
    const companyName = getConfig().companyName;
    
    // For admin companies, return empty array (no restrictions)
    if (!companyName || shouldBypassImoFiltering(companyName)) {
        return [];
    }
    
    if (!dbName || !mongoUri) {
        throw new Error('Database name and MongoDB URI are required');
    }
    
    return await fetchCompanyImoNumbers(companyName, dbName, mongoUri);
}

/**
 * Log IMO filtering activity for monitoring (PMS version)
 * @param action - Action being performed
 * @param details - Additional details about the filtering
 */
export async function logImoFilteringActivity(action: string, details: any = {}, dbName?: string, mongoUri?: string): Promise<void> {
    const companyName = getConfig().companyName;
    const companyImos = dbName && mongoUri ? await fetchCompanyImoNumbers(companyName, dbName, mongoUri) : [];
    
    logger.info(`IMO filtering activity: ${action}`, {
        companyName,
        companyImoCount: companyImos.length,
        isAdminCompany: companyName ? shouldBypassImoFiltering(companyName) : false,
        ...details
    });
}

/**
 * Generic function to export Typesense data for a given collection and IMO list
 * @param collectionName - Name of the Typesense collection
 * @param imoList - Array of IMO numbers
 * @param startDate - Optional start date filter (ISO string)
 * @param endDate - Optional end date filter (ISO string)
 * @param dateField - Name of the date field to filter on
 * @param excludeFields - Fields to exclude in the export
 * @param timestampFields - Fields to convert from UNIX timestamp to ISO string
 * @returns Array of parsed and processed documents
 */
export async function exportDataForImoListGeneric(
    collectionName: string = 'vesselinfos',
    imoList: number[],
    startDate?: string,
    endDate?: string,
    dateField?: string,
    excludeFields: string = "",
    timestampFields: string[] = []
): Promise<any[]> {
    try {
        const client = getTypesenseClient();
        const collection = client.collections(collectionName);

        const dateToTs = (dateStr: string): number => {
            return Math.floor(new Date(dateStr).getTime() / 1000);
        };

        const filterParts = [`imo:[${imoList.join(',')}]`];
        if (startDate && dateField) {
            filterParts.push(`${dateField}:>=${dateToTs(startDate)}`);
        }
        if (endDate && dateField) {
            filterParts.push(`${dateField}:<=${dateToTs(endDate)}`);
        }

        const filterBy = filterParts.join(" && ");
        const query = {
            filter_by: filterBy,
            exclude_fields: excludeFields
        };

        const exportResult = await collection.documents().export(query);

        let exportData: string;
        if (typeof exportResult === 'string') {
            exportData = exportResult;
        } else if (exportResult && typeof exportResult === 'object' && 'buffer' in exportResult) {
            exportData = new TextDecoder().decode(exportResult as ArrayBuffer);
        } else {
            exportData = String(exportResult);
        }

        const documents = exportData
            .split('\n')
            .filter(line => line.trim())
            .map(line => JSON.parse(line));

        // Convert UNIX timestamps to readable date strings
        for (const doc of documents) {
            for (const field of timestampFields) {
                if (field in doc && typeof doc[field] === 'number') {
                    try {
                        doc[field] = new Date(doc[field] * 1000).toISOString().replace('T', ' ').substring(0, 19);
                    } catch (err) {
                        // Leave original value on error
                    }
                }
            }
        }

        return documents;
    } catch (error) {
        logger.error(`Error exporting data from '${collectionName}' collection:`, error);
        return [];
    }
}

export async function exportDefectsForImoList(imoList: number[], startDate?: string, endDate?: string): Promise<any[]> {
    return exportDataForImoListGeneric(
        'defect',
        imoList,
        startDate,
        endDate,
        'reportDate',
        "_id,docId,fleetId,vesselId,fleetManagerId,technicalSuperintendentId,id",
        [
            'inspectionTargetDate',
            'reportDate',
            'closingDate',
            'targetDate',
            'nextDueDate',
            'extendedDate'
        ]
    );
}

export async function exportPurchasesForImoList(imoList: number[], startDate?: string, endDate?: string): Promise<any[]> {
    return exportDataForImoListGeneric(
        'purchase',
        imoList,
        startDate,
        endDate,
        'purchaseRequisitionDate',
        "embedding",
        [
            'purchaseRequisitionDate',
            'purchaseOrderIssuedDate',
            'orderReadinessDate'
        ]
    );
}

export async function exportBudgetsForImoList(imoList: number[], startDate?: string, endDate?: string): Promise<any[]> {
    return exportDataForImoListGeneric(
        'budget',
        imoList,
        startDate,
        endDate,
        'date',
        "embedding",
        ['date']
    );
}

export async function exportExpensesForImoList(imoList: number[], startDate?: string, endDate?: string): Promise<any[]> {
    return exportDataForImoListGeneric(
        'expense',
        imoList,
        startDate,
        endDate,
        'expenseDate',
        "embedding",
        [
            'expenseDate',
            'poDate'
        ]
    );
}

export async function exportSurveysForImoList(imoList: number[], startDate?: string, endDate?: string): Promise<any[]> {
    return exportDataForImoListGeneric(
        'survey',
        imoList,
        startDate,
        endDate,
        'surveyDate',
        "embedding",
        ['surveyDate']
    );
}

// type DatabaseContext = 'pms' | 'pms-etl' | 'pms-engine' | 'defect' | 'defect-secondary';

// /**
//  * Get MongoDB database instance by context
//  * @param context - Determines the client and database name to use
//  * @returns MongoDB Database instance
//  */
// export async function getDatabaseInstance(context: DatabaseContext, dbName: string, mongoUri: string): Promise<DatabaseManager> {
//     if (!dbName || !mongoUri) {
//         throw new Error('Database name and MongoDB URI are required');
//     }

//     const databaseManager = new DatabaseManager();
//     await databaseManager.initializeDatabase(dbName, mongoUri);
//     return databaseManager;
// }

// export async function getPmsDatabase(dbName: string, mongoUri: string) {
//     return getDatabaseInstance('pms', dbName, mongoUri);
// }

// export async function getPmsEtlDatabase(dbName: string, mongoUri: string) {
//     return getDatabaseInstance('pms-etl', dbName, mongoUri);
// }

// export async function getPmsEngineDataDatabase(dbName: string, mongoUri: string) {
//     return getDatabaseInstance('pms-engine', dbName, mongoUri);
// }

// export async function getDefectDatabase(dbName: string, mongoUri: string) {
//     return getDatabaseInstance('defect', dbName, mongoUri);
// }

// export async function getDefectSecondaryDatabase(dbName: string, mongoUri: string) {
//     return getDatabaseInstance('defect-secondary', dbName, mongoUri);
// }
