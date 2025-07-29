import { getEtlDevClient } from "./mongodb.js";
import { getEtlDevDbName } from "./mongodb.js";
import { logger } from "./logger.js";
import { ToolArguments, ToolResponse } from "./types/index.js";
import { getMongoClient } from "./mongodb.js";
import { getConfig } from "./config";
import { TextContent } from "@modelcontextprotocol/sdk/types.js";
import { getCompanyImoNumbers } from "./imoUtils.js";

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