import { getEtlDevClient } from "./mongodb.js";
import { getEtlDevDbName } from "./mongodb.js";
import { logger } from "./logger.js";
import { ToolArguments, ToolResponse } from "./types/index.js";
import { getMongoClient } from "./mongodb.js";
import { getConfig } from "./config";
import { TextContent } from "@modelcontextprotocol/sdk/types.js";
import { getCompanyImoNumbers, shouldBypassImoFiltering } from "./imoUtils.js";
import { getTypesenseClient } from "./typesense.js";
import { MongoClient } from 'mongodb';

export async function fetchQADetails(imo: string, qaId: number): Promise<any> {
    try {
        const client = await getEtlDevClient();
        const db = client.db(getEtlDevDbName());
        const vesselinfos = db.collection('vesselinfos');

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
            link?: string | null;
        }

        const mongoResult = await vesselinfos.findOne(query, { projection });
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
            res.answer = await addComponentData(res.answer, imo);
        }

        // Get vessel QnA snapshot link
        try {
            res.link = await getVesselQnASnapshot(imo, qaId.toString());
        } catch (error) {
            res.link = null;
        }

        return res;
    } catch (error: any) {
        logger.error('Error fetching QA details:', error);
        throw new Error(`Error fetching QA details: ${error.message}`);
    }
}

export async function getComponentData(componentId: string): Promise<string> {
    const match = componentId.match(/^(\d+)_(\d+)_(\d+)$/);
    if (!match) {
        return `⚠️ Invalid component_id format: ${componentId}`;
    }

    const [, componentNumber, questionNumber, imo] = match;
    const componentNo = `${componentNumber}_${questionNumber}_${imo}`;

    try {
        const client = await getEtlDevClient();
        const db = client.db(getEtlDevDbName());
        const collection = db.collection('vesselinfocomponents');

        const doc = await collection.findOne({ componentNo });
        if (!doc) {
            return `⚠️ No component found for ID: ${componentId}`;
        }

        if (!doc.data) {
            return "No data found in the table component";
        }

        // Extract headers excluding lineitem
        const headers = doc.data.headers
            .filter((h: any) => h.name !== "lineitem")
            .map((h: any) => h.name);

        const rows = doc.data.body;

        // Build markdown table
        let md = "| " + headers.join(" | ") + " |\n";
        md += "| " + headers.map(() => "---").join(" | ") + " |\n";

        for (const row of rows) {
            const formattedRow = row
                .filter((cell: any) => !cell.lineitem) // Exclude lineitem
                .map((cell: any) => {
                    if (cell.value && cell.link) {
                        return `[${cell.value}](${cell.link})`;
                    } else if (cell.status && cell.color) {
                        return cell.status;
                    }
                    return String(cell);
                });
            md += "| " + formattedRow.join(" | ") + " |\n";
        }

        return md;
    } catch (error: any) {
        logger.error('Error getting component data:', error);
        throw new Error(`Error getting component data: ${error.message}`);
    }
}

export async function addComponentData(answer: string, imo: string): Promise<string> {
    const pattern = /httpsdev\.syia\.ai\/chat\/ag-grid-table\?component=(\d+_\d+)/g;
    const matches = Array.from(answer.matchAll(pattern));
    
    let result = answer;
    for (const match of matches) {
        const component = match[1];
        try {
            const replacement = await getComponentData(`${component}_${imo}`);
            result = result.replace(match[0], replacement);
        } catch (error) {
            logger.error('Error replacing component data:', error);
        }
    }
    
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

export async function insertDataLinkToMongoDB(link: string, type: string, sessionId: string, imo: string, vesselName: string): Promise<void> {
    try {
        const mongoClient = await getMongoClient();
        const db = mongoClient.db(getConfig().dbName);
        await db.collection('data_links').insertOne({
            link,
            type,
            sessionId,
            imo,
            vesselName,
            createdAt: new Date()
        });
    } catch (error: any) {
        logger.error('Error inserting data link to MongoDB:', error);
        throw new Error(`Error inserting data link to MongoDB: ${error.message}`);
    }
}

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

export async function convertUnixDates(document: any): Promise<any> {
    // Create a shallow copy to avoid modifying the original object
    const result = { ...document };
    
    const dateFields = [
        "date",
        "purchaseRequisitionDate",
        "purchaseOrderIssuedDate",
        "orderReadinessDate"
    ];

    for (const field of dateFields) {
        const value = result[field];
        if (typeof value === "number" && Number.isFinite(value)) {
            result[field] = new Date(value * 1000).toISOString();
        }
    }

    return result;
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

        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json() as any;
        if (result.status === "OK") {
            return result.resultData;
        } else {
            throw new Error('Failed to get data link: Invalid response status');
        }
    } catch (error: any) {
        logger.error('Error getting data link:', error);
        throw new Error(`Error getting data link: ${error.message}`);
    }
}

export async function convertToCsvTable(documents: any[]): Promise<string> {
    if (!documents.length) return "";

    const headers = Object.keys(documents[0]);

    // Escape cell values for CSV
    const escapeValue = (value: any): string => {
        const str = value != null ? String(value) : "";
        const needsEscaping = /[",\n]/.test(str);
        const escaped = str.replace(/"/g, '""'); // escape double quotes
        return needsEscaping ? `"${escaped}"` : escaped;
    };

    const rows = documents.map(doc =>
        headers.map(header => escapeValue(doc[header])).join(',')
    );

    return [headers.join(','), ...rows].join('\n');
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

export async function fetchQADetailsAndCreateResponse(
        imo: string | undefined, 
        questionNo: number, 
        functionName: string, 
        linkHeader: string, 
        session_id: string = "testing"
    ): Promise<ToolResponse> {
        if (!imo) {
            throw new Error("IMO is required");
        }

        try {
            // Fetch QA details
            const result = await fetchQADetails(imo, questionNo);
            const link = result.link;
            const vesselName = result.vesselName;

            // Insert data link to MongoDB
            await insertDataLinkToMongoDB(link, linkHeader, session_id, imo, vesselName);

            // Get artifact data
            const artifactData = await getArtifact(functionName, link);

            // Create content responses
            const content: TextContent = {
                type: "text",
                text: JSON.stringify(result, null, 2)
            };

            const artifact: TextContent = {
                type: "text",
                text: JSON.stringify(artifactData, null, 2)
            };

            return [content, artifact];
        } catch (error: any) {
            logger.error(`Error in ${functionName}:`, error);
            throw new Error(`Error in ${functionName}: ${error.message}`);
        }
    }

export async function processTypesenseResults(
    searchResult: any,
    toolName: string,
    title: string,
    session_id: string = "testing",
    linkHeader: string,
    artifactTitle?: string
): Promise<ToolResponse> {
    try {
        if (!searchResult || !searchResult.hits || searchResult.hits.length === 0) {
            return [{
                type: "text",
                text: "No records found for the specified criteria.",
                title: "No Results Found",
                format: "json"
            }];
        }

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

        // Get data link
        const dataLink = await getDataLink(documents);

        // Get vessel name and IMO from hits
        let vesselName = null;
        let imo = null;
        try {
            vesselName = searchResult.hits[0]?.document?.vesselName;
            imo = searchResult.hits[0]?.document?.imo;
        } catch (error) {
            logger.warn(`Could not get vessel name or IMO from hits in ${toolName}`);
        }

        // Insert the data link to mongodb collection
        await insertDataLinkToMongoDB(dataLink, linkHeader, session_id, imo || "", vesselName || "");

        // Format results in the standard structure
        const formattedResults = {
            found: searchResult.found || 0,
            out_of: searchResult.out_of || 0,
            page: searchResult.page || 1,
            hits: documents
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
            title: artifactTitle || title,
            format: "json"
        };

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

export async function processTypesenseExportResults(
    documents: any[],
    toolName: string,
    title: string,
    artifactTitle: string,
    session_id: string,
    linkHeader: string,
    imo: string,
    vesselName: string | null
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
        await insertDataLinkToMongoDB(dataLink, linkHeader, session_id, imo || "", vesselName || "");

        // Format results in the standard structure
        const formattedResults = {
            found: processedDocuments.length,
            out_of: processedDocuments.length,
            page: 1,
            hits: processedDocuments
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

export async function updateTypesenseFilterWithCompanyImos(filter: string): Promise<string> {
    const companyName = getConfig().companyName;
    if (companyName == "Synergy") {
        return filter;
    }
    const companyImos = getCompanyImoNumbers();
    if (companyImos.length > 0) {
        if (!filter.includes("imo:")) {
            // Use the correct syntax for numerical IMO values (without :=)
            filter += ` && imo:[${companyImos.join(",")}]`;
        }
    }
    return filter;
}

// PMS Helper Functions
// ===================

interface CasefileData {
    sessionId: string;
    imo: string;
    vesselName: string;
    links: { link: any; linkHeader: string }[];
    datetime: string;
}

/**
 * Get data link from documents for PMS
 */
export async function getPmsDataLink(data: any[]): Promise<string | null> {
    const url = 'https://dev-api.siya.com/v1.0/vessel-info/qna-snapshot';
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJkYXRhIjp7ImlkIjoiNjRkMzdhMDM1Mjk5YjFlMDQxOTFmOTJhIiwiZmlyc3ROYW1lIjoiU3lpYSIsImxhc3ROYW1lIjoiRGV2IiwiZW1haWwiOiJkZXZAc3lpYS5haSIsInJvbGUiOiJhZG1pbiIsInJvbGVJZCI6IjVmNGUyODFkZDE4MjM0MzY4NDE1ZjViZiIsImlhdCI6MTc0MDgwODg2OH0sImlhdCI6MTc0MDgwODg2OCwiZXhwIjoxNzcyMzQ0ODY4fQ.1grxEO0aO7wfkSNDzpLMHXFYuXjaA1bBguw2SJS9r2M'
    };
  
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ data })
      });
  
      const result = await response.json() as { status: string; resultData?: string };
  
      if (result.status === 'OK') {
        return result.resultData || null;
      } else {
        return null;
      }
    } catch (error) {
      logger.error('Error fetching PMS data link:', error);
      return null;
    }
}

/**
 * Insert data link to MongoDB for PMS
 */
export async function insertPmsDataLinkToMongodb(
    dataLink: string, 
    linkHeader: string, 
    sessionId: string, 
    imo?: string, 
    vesselName?: string
): Promise<void> {
    try {
        const mongoClient = await getMongoClient();
        const db = mongoClient.db(getConfig().dbName);
        const collection = db.collection<CasefileData>('casefile_data');
        
        const sessionExists = await collection.findOne({ sessionId });

        const linkData = {
          link: dataLink,
          linkHeader: linkHeader
        };
    
        if (sessionExists) {
          await collection.updateOne(
            { sessionId },
            {
              $push: {
                links: {
                  $each: [linkData]
                }
              },
              $set: {
                datetime: new Date().toISOString()
              }
            }
          );
        } else {
            const newEntry: CasefileData = {
                sessionId,
                imo: imo ?? "",
                vesselName: vesselName ?? "",
                links: [linkData],
                datetime: new Date().toISOString(),
            };
            await collection.insertOne(newEntry);
        }
    } catch (error) {
        logger.error('Error inserting PMS data link to MongoDB:', error);
    }
}

/**
 * Update Typesense filter with company IMO numbers for filtering (PMS version)
 * @param filter - Existing filter string
 * @returns Updated filter string with IMO restrictions
 */
export function updateTypesenseFilterWithCompanyImosPms(filter: string): string {
    const companyName = getConfig().companyName;
    
    // Skip filtering for admin companies
    if (!companyName || shouldBypassImoFiltering(companyName)) {
        logger.debug(`Skipping Typesense IMO filtering for admin company: ${companyName}`);
        return filter;
    }
    
    const companyImos = getCompanyImoNumbers();
    
    // If no IMO numbers configured, return original filter
    if (companyImos.length === 0) {
        logger.warn('No company IMO numbers configured. Skipping Typesense IMO filtering.');
        return filter;
    }
    
    // Create IMO filter for Typesense
    const imoFilter = `imo:[${companyImos.join(",")}]`;
    
    // Combine with existing filter
    if (filter && filter.trim()) {
        const combinedFilter = `${filter} && ${imoFilter}`;
        logger.debug(`Applied Typesense IMO filter: ${combinedFilter}`);
        return combinedFilter;
    } else {
        logger.debug(`Applied Typesense IMO filter: ${imoFilter}`);
        return imoFilter;
    }
}

/**
 * Update MongoDB filter with company IMO numbers for filtering (PMS version)
 * @param filter - Existing MongoDB filter object
 * @returns Updated filter object with IMO restrictions
 */
export function updateMongoFilterWithCompanyImos(filter: any): any {
    const companyName = getConfig().companyName;
    
    // Skip filtering for admin companies
    if (!companyName || shouldBypassImoFiltering(companyName)) {
        logger.debug(`Skipping MongoDB IMO filtering for admin company: ${companyName}`);
        return filter;
    }
    
    const companyImos = getCompanyImoNumbers();
    
    // If no IMO numbers configured, return original filter
    if (companyImos.length === 0) {
        logger.warn('No company IMO numbers configured. Skipping MongoDB IMO filtering.');
        return filter;
    }
    
    // Create a copy of the filter to avoid modifying the original
    const updatedFilter = { ...filter };
    
    // Convert IMO numbers to integers for MongoDB query
    const imoNumbers = companyImos.map(imo => Number(imo));
    
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
export function updateMongoAggregationWithCompanyImos(pipeline: any[]): any[] {
    const companyName = getConfig().companyName;
    
    // Skip filtering for admin companies
    if (!companyName || shouldBypassImoFiltering(companyName)) {
        logger.debug(`Skipping MongoDB aggregation IMO filtering for admin company: ${companyName}`);
        return pipeline;
    }
    
    const companyImos = getCompanyImoNumbers();
    
    // If no IMO numbers configured, return original pipeline
    if (companyImos.length === 0) {
        logger.warn('No company IMO numbers configured. Skipping MongoDB aggregation IMO filtering.');
        return pipeline;
    }
    
    // Convert IMO numbers to integers for MongoDB query
    const imoNumbers = companyImos.map(imo => Number(imo));
    
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
export function updateSearchParamsWithCompanyImos(searchParams: any): any {
    const companyName = getConfig().companyName;
    
    // Skip filtering for admin companies
    if (!companyName || shouldBypassImoFiltering(companyName)) {
        logger.debug(`Skipping search params IMO filtering for admin company: ${companyName}`);
        return searchParams;
    }
    
    const companyImos = getCompanyImoNumbers();
    
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
export function isVesselAuthorizedForCompany(imo: string | number): boolean {
    const companyName = getConfig().companyName;
    
    // Allow access for admin companies
    if (!companyName || shouldBypassImoFiltering(companyName)) {
        return true;
    }
    
    const companyImos = getCompanyImoNumbers();
    
    // If no IMO numbers configured, deny access
    if (companyImos.length === 0) {
        return false;
    }
    
    const imoNumber = Number(imo);
    const companyImoNumbers = companyImos.map(imo => Number(imo));
    
    return companyImoNumbers.includes(imoNumber);
}

/**
 * Get authorized IMO numbers for the current company (PMS version)
 * @returns Array of authorized IMO numbers
 */
export function getAuthorizedImoNumbers(): string[] {
    const companyName = getConfig().companyName;
    
    // For admin companies, return empty array (no restrictions)
    if (!companyName || shouldBypassImoFiltering(companyName)) {
        return [];
    }
    
    return getCompanyImoNumbers();
}

/**
 * Log IMO filtering activity for monitoring (PMS version)
 * @param action - Action being performed
 * @param details - Additional details about the filtering
 */
export function logImoFilteringActivity(action: string, details: any = {}): void {
    const companyName = getConfig().companyName;
    const companyImos = getCompanyImoNumbers();
    
    logger.info(`IMO filtering activity: ${action}`, {
        companyName,
        companyImoCount: companyImos.length,
        isAdminCompany: companyName ? shouldBypassImoFiltering(companyName) : false,
        ...details
    });
}

/**
 * Get database instance for PMS (wrapper for MongoDB client)
 */
export async function getPmsDatabase() {
    const client = await getMongoClient();
    return client.db(getConfig().dbName);
}

/**
 * Get ETL database instance for PMS
 */
export async function getPmsEtlDatabase() {
    const client = await getEtlDevClient();
    return client.db(getEtlDevDbName());
}

/**
 * Get engine data database instance for PMS
 */
export async function getPmsEngineDataDatabase() {
    const client = await getMongoClient();
    return client.db(getConfig().secondaryDbName || getConfig().dbName);
}

// Defect Inspection Helper Functions
// =================================

/**
 * Get database instance for Defect Inspection (wrapper for MongoDB client)
 */
export async function getDefectDatabase() {
    const client = await getMongoClient();
    return client.db(getConfig().dbName);
}

/**
 * Get secondary database instance for Defect Inspection
 */
export async function getDefectSecondaryDatabase() {
    const client = await getMongoClient();
    return client.db(getConfig().secondaryDbName || getConfig().dbName);
}

/**
 * Update Typesense filter with company IMO numbers for filtering (Defect version)
 * @param filter - Existing filter string
 * @returns Updated filter string with IMO restrictions
 */
export function updateTypesenseFilterWithCompanyImosDefect(filter: string): string {
    const companyName = getConfig().companyName;
    
    // Skip filtering for admin companies
    if (!companyName || shouldBypassImoFiltering(companyName)) {
        logger.debug(`Skipping Typesense IMO filtering for admin company: ${companyName}`);
        return filter;
    }
    
    const companyImos = getCompanyImoNumbers();
    
    // If no IMO numbers configured, return original filter
    if (companyImos.length === 0) {
        logger.warn('No company IMO numbers configured. Skipping Typesense IMO filtering.');
        return filter;
    }
    
    // Create IMO filter for Typesense
    const imoFilter = `imo:[${companyImos.join(",")}]`;
    
    // Combine with existing filter
    if (filter && filter.trim()) {
        const combinedFilter = `${filter} && ${imoFilter}`;
        logger.debug(`Applied Typesense IMO filter: ${combinedFilter}`);
        return combinedFilter;
    } else {
        logger.debug(`Applied Typesense IMO filter: ${imoFilter}`);
        return imoFilter;
    }
}

/**
 * Update MongoDB filter with company IMO numbers for filtering (Defect version)
 * @param filter - Existing MongoDB filter object
 * @returns Updated filter object with IMO restrictions
 */
export function updateMongoFilterWithCompanyImosDefect(filter: any): any {
    const companyName = getConfig().companyName;
    
    // Skip filtering for admin companies
    if (!companyName || shouldBypassImoFiltering(companyName)) {
        logger.debug(`Skipping MongoDB IMO filtering for admin company: ${companyName}`);
        return filter;
    }
    
    const companyImos = getCompanyImoNumbers();
    
    // If no IMO numbers configured, return original filter
    if (companyImos.length === 0) {
        logger.warn('No company IMO numbers configured. Skipping MongoDB IMO filtering.');
        return filter;
    }
    
    // Create a copy of the filter to avoid modifying the original
    const updatedFilter = { ...filter };
    
    // Convert IMO numbers to integers for MongoDB query
    const imoNumbers = companyImos.map(imo => Number(imo));
    
    // Add IMO restriction to the filter
    updatedFilter.imo = { $in: imoNumbers };
    
    logger.debug(`Applied MongoDB IMO filter: ${JSON.stringify(updatedFilter)}`);
    return updatedFilter;
}

/**
 * Update MongoDB aggregation pipeline with company IMO numbers for filtering (Defect version)
 * @param pipeline - Existing MongoDB aggregation pipeline
 * @returns Updated pipeline with IMO restrictions
 */
export function updateMongoAggregationWithCompanyImosDefect(pipeline: any[]): any[] {
    const companyName = getConfig().companyName;
    
    // Skip filtering for admin companies
    if (!companyName || shouldBypassImoFiltering(companyName)) {
        logger.debug(`Skipping MongoDB aggregation IMO filtering for admin company: ${companyName}`);
        return pipeline;
    }
    
    const companyImos = getCompanyImoNumbers();
    
    // If no IMO numbers configured, return original pipeline
    if (companyImos.length === 0) {
        logger.warn('No company IMO numbers configured. Skipping MongoDB aggregation IMO filtering.');
        return pipeline;
    }
    
    // Convert IMO numbers to integers for MongoDB query
    const imoNumbers = companyImos.map(imo => Number(imo));
    
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
 * Update search query parameters with company IMO filtering (Defect version)
 * @param searchParams - Search parameters object
 * @returns Updated search parameters with IMO restrictions
 */
export function updateSearchParamsWithCompanyImosDefect(searchParams: any): any {
    const companyName = getConfig().companyName;
    
    // Skip filtering for admin companies
    if (!companyName || shouldBypassImoFiltering(companyName)) {
        logger.debug(`Skipping search params IMO filtering for admin company: ${companyName}`);
        return searchParams;
    }
    
    const companyImos = getCompanyImoNumbers();
    
    // If no IMO numbers configured, return original params
    if (companyImos.length === 0) {
        logger.warn('No company IMO numbers configured. Skipping search params IMO filtering.');
        return searchParams;
    }
    
    // Create a copy of the search params
    const updatedParams = { ...searchParams };
    
    // Update filter_by parameter for Typesense
    if (updatedParams.filter_by) {
        updatedParams.filter_by = updateTypesenseFilterWithCompanyImosDefect(updatedParams.filter_by);
    } else {
        updatedParams.filter_by = updateTypesenseFilterWithCompanyImosDefect('');
    }
    
    logger.debug(`Updated search params with IMO filtering: ${JSON.stringify(updatedParams)}`);
    return updatedParams;
}

/**
 * Check if a vessel IMO is authorized for the current company (Defect version)
 * @param imo - IMO number to check
 * @returns True if authorized, false otherwise
 */
export function isVesselAuthorizedForCompanyDefect(imo: string | number): boolean {
    const companyName = getConfig().companyName;
    
    // Allow access for admin companies
    if (!companyName || shouldBypassImoFiltering(companyName)) {
        return true;
    }
    
    const companyImos = getCompanyImoNumbers();
    
    // If no IMO numbers configured, deny access
    if (companyImos.length === 0) {
        return false;
    }
    
    const imoNumber = Number(imo);
    const companyImoNumbers = companyImos.map(imo => Number(imo));
    
    return companyImoNumbers.includes(imoNumber);
}

/**
 * Get authorized IMO numbers for the current company (Defect version)
 * @returns Array of authorized IMO numbers
 */
export function getAuthorizedImoNumbersDefect(): string[] {
    const companyName = getConfig().companyName;
    
    // For admin companies, return empty array (no restrictions)
    if (!companyName || shouldBypassImoFiltering(companyName)) {
        return [];
    }
    
    return getCompanyImoNumbers();
}

/**
 * Log IMO filtering activity for monitoring (Defect version)
 * @param action - Action being performed
 * @param details - Additional details about the filtering
 */
export function logImoFilteringActivityDefect(action: string, details: any = {}): void {
    const companyName = getConfig().companyName;
    const companyImos = getCompanyImoNumbers();
    
    logger.info(`IMO filtering activity: ${action}`, {
        companyName,
        companyImoCount: companyImos.length,
        isAdminCompany: companyName ? shouldBypassImoFiltering(companyName) : false,
        ...details
    });
}

// Additional Defect-Specific Functions
// ===================================

/**
 * Convert defect dates from Unix timestamps to readable format
 * @param document - Document with date fields
 * @returns Document with converted dates
 */
export function convertDefectDates(document: Record<string, any>): Record<string, any> {
    const result = { ...document };
    
    const dateFields = [
        "inspectionTargetDate",
        "reportDate", 
        "closingDate",
        "targetDate",
        "nextDueDate",
        "extendedDate"
    ];

    for (const field of dateFields) {
        const value = result[field];
        if (typeof value === "number" && Number.isFinite(value)) {
            try {
                result[field] = new Date(value * 1000).toISOString().replace('T', ' ').substring(0, 19);
            } catch (error) {
                // Keep original value if conversion fails
            }
        }
    }

    return result;
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
export async function getVesselImoListFromFleet(fleetImo: number): Promise<number[]> {
  const mongoUri = getConfig().mongodbEtlDevDataUri;
  const dbName = getConfig().mongodbEtlDevDataDbName;
  
  if (!mongoUri || !dbName) {
    throw new Error('ETL database URI and name are required for fleet operations');
  }
  
  const client = new MongoClient(mongoUri);
  
  try {
    await client.connect();
    const db = client.db(dbName);
    const collection = db.collection('common_group_details');
    
    const fleetDoc = await collection.findOne({ imo: fleetImo });
    
    if (fleetDoc && fleetDoc.imoList && Array.isArray(fleetDoc.imoList)) {
      return fleetDoc.imoList;
    }
    
    return [];
  } catch (error) {
    logger.error(`Error fetching vessel IMO list for fleet ${fleetImo}:`, error);
    throw error;
  } finally {
    await client.close();
  }
}

/**
 * Export defects for a list of IMO numbers
 * @param imoList - Array of IMO numbers
 * @param startDate - Start date filter (optional)
 * @param endDate - End date filter (optional)
 * @returns Array of defect documents
 */
export async function exportDefectsForImoList(imoList: number[], startDate?: string, endDate?: string): Promise<any[]> {
    try {
        const client = getTypesenseClient();
        const collection = client.collections('defect');
        
        const dateToTs = (dateStr: string): number => {
            return Math.floor(new Date(dateStr).getTime() / 1000);
        };

        const filterParts = [`imo:[${imoList.join(',')}]`];

        if (startDate) {
            const startTs = dateToTs(startDate);
            filterParts.push(`reportDate:>=${startTs}`);
        }
        if (endDate) {
            const endTs = dateToTs(endDate);
            filterParts.push(`reportDate:<=${endTs}`);
        }

        const filterBy = filterParts.join(" && ");
        const query = {
            filter_by: filterBy,
            exclude_fields: "_id,docId,fleetId,vesselId,fleetManagerId,technicalSuperintendentId,id"
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

        // Convert timestamps to date strings for specified fields
        const dateFields = [
            'inspectionTargetDate',
            'reportDate',
            'closingDate',
            'targetDate',
            'nextDueDate',
            'extendedDate'
        ];

        for (const doc of documents) {
            for (const field of dateFields) {
                if (field in doc && typeof doc[field] === 'number') {
                    try {
                        doc[field] = new Date(doc[field] * 1000).toISOString().replace('T', ' ').substring(0, 19);
                    } catch (error) {
                        // Keep original value if conversion fails
                    }
                }
            }
        }

        return documents;
    } catch (error) {
        logger.error('Error exporting defects for IMO list:', error);
        return [];
    }
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

/**
 * Export purchases for a list of IMO numbers
 * @param imoList - Array of IMO numbers
 * @param startDate - Start date filter (optional)
 * @param endDate - End date filter (optional)
 * @returns Array of purchase documents
 */
export async function exportPurchasesForImoList(imoList: number[], startDate?: string, endDate?: string): Promise<any[]> {
    try {
        const client = getTypesenseClient();
        const collection = client.collections('purchase');
        
        const dateToTs = (dateStr: string): number => {
            return Math.floor(new Date(dateStr).getTime() / 1000);
        };

        const filterParts = [`imo:[${imoList.join(',')}]`];

        if (startDate) {
            const startTs = dateToTs(startDate);
            filterParts.push(`purchaseRequisitionDate:>=${startTs}`);
        }
        if (endDate) {
            const endTs = dateToTs(endDate);
            filterParts.push(`purchaseRequisitionDate:<=${endTs}`);
        }

        const filterBy = filterParts.join(" && ");
        const query = {
            filter_by: filterBy,
            exclude_fields: "embedding"
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

        // Convert timestamps to date strings for specified fields
        const dateFields = [
            'purchaseRequisitionDate',
            'purchaseOrderIssuedDate',
            'orderReadinessDate'
        ];

        for (const doc of documents) {
            for (const field of dateFields) {
                if (field in doc && typeof doc[field] === 'number') {
                    try {
                        doc[field] = new Date(doc[field] * 1000).toISOString().replace('T', ' ').substring(0, 19);
                    } catch (error) {
                        // Keep original value if conversion fails
                    }
                }
            }
        }

        return documents;
    } catch (error) {
        logger.error('Error exporting purchases for IMO list:', error);
        return [];
    }
}

/**
 * Export budgets for a list of IMO numbers
 * @param imoList - Array of IMO numbers
 * @param startDate - Start date filter (optional)
 * @param endDate - End date filter (optional)
 * @returns Array of budget documents
 */
export async function exportBudgetsForImoList(imoList: number[], startDate?: string, endDate?: string): Promise<any[]> {
    try {
        const client = getTypesenseClient();
        const collection = client.collections('budget');
        
        const dateToTs = (dateStr: string): number => {
            return Math.floor(new Date(dateStr).getTime() / 1000);
        };

        const filterParts = [`imo:[${imoList.join(',')}]`];

        if (startDate) {
            const startTs = dateToTs(startDate);
            filterParts.push(`date:>=${startTs}`);
        }
        if (endDate) {
            const endTs = dateToTs(endDate);
            filterParts.push(`date:<=${endTs}`);
        }

        const filterBy = filterParts.join(" && ");
        const query = {
            filter_by: filterBy,
            exclude_fields: "embedding"
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

        // Convert timestamps to date strings for specified fields
        const dateFields = [
            'date'
        ];

        for (const doc of documents) {
            for (const field of dateFields) {
                if (field in doc && typeof doc[field] === 'number') {
                    try {
                        doc[field] = new Date(doc[field] * 1000).toISOString().replace('T', ' ').substring(0, 19);
                    } catch (error) {
                        // Keep original value if conversion fails
                    }
                }
            }
        }

        return documents;
    } catch (error) {
        logger.error('Error exporting budgets for IMO list:', error);
        return [];
    }
}

/**
 * Export expenses for a list of IMO numbers
 * @param imoList - Array of IMO numbers
 * @param startDate - Start date filter (optional)
 * @param endDate - End date filter (optional)
 * @returns Array of expense documents
 */
export async function exportExpensesForImoList(imoList: number[], startDate?: string, endDate?: string): Promise<any[]> {
    try {
        const client = getTypesenseClient();
        const collection = client.collections('expense');
        
        const dateToTs = (dateStr: string): number => {
            return Math.floor(new Date(dateStr).getTime() / 1000);
        };

        const filterParts = [`imo:[${imoList.join(',')}]`];

        if (startDate) {
            const startTs = dateToTs(startDate);
            filterParts.push(`expenseDate:>=${startTs}`);
        }
        if (endDate) {
            const endTs = dateToTs(endDate);
            filterParts.push(`expenseDate:<=${endTs}`);
        }

        const filterBy = filterParts.join(" && ");
        const query = {
            filter_by: filterBy,
            exclude_fields: "embedding"
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

        // Convert timestamps to date strings for specified fields
        const dateFields = [
            'expenseDate',
            'poDate'
        ];

        for (const doc of documents) {
            for (const field of dateFields) {
                if (field in doc && typeof doc[field] === 'number') {
                    try {
                        doc[field] = new Date(doc[field] * 1000).toISOString().replace('T', ' ').substring(0, 19);
                    } catch (error) {
                        // Keep original value if conversion fails
                    }
                }
            }
        }

        return documents;
    } catch (error) {
        logger.error('Error exporting expenses for IMO list:', error);
        return [];
    }
}