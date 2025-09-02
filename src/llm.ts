import OpenAI from "openai";
import { logger } from "./logger.js";
import { config } from './config.js';
import axios from 'axios';

interface LLMResponse {
    content: string;
    topic: string;
    flag: string;
    importance: "low" | "medium" | "high";
}

interface LLMRequest {
    query: string;
    systemPrompt: string;
    modelName: string;
    jsonMode?: boolean;
    temperature?: number;
}

interface LlamaParseResponse {
    markdown?: string;
    json?: any;
}

interface LlamaChatResponse {
    content: string;
}

export class LLMClient {
    private client: OpenAI;

    constructor(apiKey: string) {
        this.client = new OpenAI({ apiKey });
    }

    async ask(request: LLMRequest): Promise<LLMResponse> {
        try {
            const response = await this.client.chat.completions.create({
                model: request.modelName,
                messages: [
                    { role: "system", content: request.systemPrompt },
                    { role: "user", content: request.query }
                ],
                response_format: request.jsonMode ? { type: "json_object" } : undefined,
                temperature: request.temperature || 0
            });

            const content = response.choices[0]?.message?.content;
            if (!content) {
                throw new Error("No content in LLM response");
            }

            if (request.jsonMode) {
                return JSON.parse(content) as LLMResponse;
            }

            return {
                content,
                topic: "",
                flag: "",
                importance: "medium"
            };
        } catch (error) {
            logger.error("Error in LLM request:", error);
            throw error;
        }
    }
}

export async function parseDocumentToMarkdown(params: {
    file_path: string;
    json_output_path: string;
    md_output_path: string;
    parsing_instruction?: string;
    api_key: string;
    vendor_model?: string;
}): Promise<boolean> {
    try {
        const { file_path, json_output_path, md_output_path, parsing_instruction, api_key, vendor_model } = params;

        // Read the file content
        const fs = require('fs');
        const fileContent = await fs.promises.readFile(file_path);

        // Prepare the request to LlamaParse API
        const response = await axios.post<LlamaParseResponse>('https://api.llamaparse.com/v1/parse', {
            file: fileContent,
            output_format: 'markdown',
            parsing_instruction: parsing_instruction || '',
            model: vendor_model || 'default'
        }, {
            headers: {
                'Authorization': `Bearer ${api_key}`,
                'Content-Type': 'multipart/form-data'
            }
        });

        if (response.status === 200 && response.data) {
            // Save the markdown output
            await fs.promises.writeFile(md_output_path, response.data.markdown);

            // Save the JSON output if available
            if (response.data.json) {
                await fs.promises.writeFile(json_output_path, JSON.stringify(response.data.json, null, 2));
            }

            return true;
        }

        return false;
    } catch (error) {
        logger.error('Error in parseDocumentToMarkdown:', error);
        return false;
    }
}

export async function extractMarkdownFromJson(jsonPath: string, mdOutputPath: string): Promise<string | null> {
    try {
        const fs = require('fs');
        const jsonContent = await fs.promises.readFile(jsonPath, 'utf-8');
        const jsonData = JSON.parse(jsonContent);

        // Extract markdown content from JSON
        // This is a basic implementation - adjust based on your JSON structure
        const markdown = jsonData.markdown || jsonData.content || '';

        // Save the markdown output
        await fs.promises.writeFile(mdOutputPath, markdown);

        return markdown;
    } catch (error) {
        logger.error('Error in extractMarkdownFromJson:', error);
        return null;
    }
}

export async function callLLM(prompt: string, apiKey: string, model: string = 'default'): Promise<LLMResponse> {
    try {
        const response = await axios.post<LlamaChatResponse>('https://api.llamaparse.com/v1/chat', {
            prompt,
            model
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.status === 200 && response.data) {
            return {
                content: response.data.content,
                topic: "",
                flag: "",
                importance: "medium"
            };
        }

        return {
            content: "",
            topic: "",
            flag: "",
            importance: "medium"
        };
    } catch (error) {
        logger.error('Error in callLLM:', error);
        throw error;
    }
}

// Preserve existing functionality
export async function getLLMResponse(prompt: string): Promise<LLMResponse> {
    try {
        const openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });

        const completion = await openai.chat.completions.create({
            messages: [{ role: "user", content: prompt }],
            model: "gpt-4",
        });

        const content = completion.choices[0]?.message?.content || "";
        return {
            content,
            topic: "",
            flag: "",
            importance: "medium"
        };
    } catch (error) {
        logger.error("Error in getLLMResponse:", error);
        return {
            content: "",
            topic: "",
            flag: "",
            importance: "medium"
        };
    }
}

// New enhanced interfaces and LLMClient
export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string | Array<{
        type: 'text' | 'image_url';
        text?: string;
        image_url?: {
            url: string;
        };
    }>;
}

export interface EnhancedLLMResponse {
    content: string;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

export class EnhancedLLMClient {
    private openai: OpenAI;

    constructor(apiKey?: string) {
        const key = apiKey || config().openai?.apiKey || process.env.OPENAI_API_KEY;
        if (!key) {
            throw new Error('OpenAI API key is required');
        }
        
        this.openai = new OpenAI({
            apiKey: key
        });
        
        logger.info('Enhanced LLM client initialized successfully');
    }

    async ask(
        query: string,
        systemPrompt?: string,
        modelName: string = 'gpt-4o',
        jsonMode: boolean = false,
        temperature: number = 0.1,
        maxTokens?: number
    ): Promise<any> {
        try {
            const messages: ChatMessage[] = [];
            
            if (systemPrompt) {
                messages.push({
                    role: 'system',
                    content: systemPrompt
                });
            }
            
            messages.push({
                role: 'user',
                content: query
            });

            const requestParams: any = {
                model: modelName,
                messages,
                temperature,
                max_tokens: maxTokens
            };

            if (jsonMode) {
                requestParams.response_format = { type: 'json_object' };
            }

            logger.debug(`Making LLM request with model: ${modelName}`);
            const response = await this.openai.chat.completions.create(requestParams);

            const content = response.choices[0]?.message?.content;
            if (!content) {
                throw new Error('No content in LLM response');
            }

            // Parse JSON if json_mode is enabled
            if (jsonMode) {
                try {
                    return JSON.parse(content);
                } catch (parseError) {
                    logger.error('Failed to parse JSON response:', parseError);
                    throw new Error('Invalid JSON response from LLM');
                }
            }

            return content;
        } catch (error) {
            logger.error('LLM request failed:', error);
            throw error;
        }
    }

    async chatCompletion(
        messages: ChatMessage[],
        modelName: string = 'gpt-4o',
        temperature: number = 0.1,
        maxTokens?: number
    ): Promise<string> {
        try {
            const requestParams: any = {
                model: modelName,
                messages,
                temperature,
                max_tokens: maxTokens
            };

            logger.debug(`Making chat completion request with model: ${modelName}`);
            const response = await this.openai.chat.completions.create(requestParams);

            const content = response.choices[0]?.message?.content;
            if (!content) {
                throw new Error('No content in chat completion response');
            }

            return content;
        } catch (error) {
            logger.error('Chat completion request failed:', error);
            throw error;
        }
    }

    async generateEmbedding(text: string, model: string = 'text-embedding-ada-002'): Promise<number[]> {
        try {
            logger.debug(`Generating embedding for text of length: ${text.length}`);
            const response = await this.openai.embeddings.create({
                model,
                input: text
            });

            return response.data[0].embedding;
        } catch (error) {
            logger.error('Embedding generation failed:', error);
            throw error;
        }
    }

    async solveCaptcha(captchaImage: string, prompt: string = "This is a captcha image containing only numbers. Please extract and return only the numbers you see in the image, nothing else."): Promise<string> {
        try {
            const messages: ChatMessage[] = [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: prompt },
                        {
                            type: 'image_url',
                            image_url: {
                                url: `data:image/jpeg;base64,${captchaImage}`
                            }
                        }
                    ]
                }
            ];

            const result = await this.chatCompletion(messages, 'gpt-4o-mini');
            return result.trim();
        } catch (error) {
            logger.error('Captcha solving failed:', error);
            throw error;
        }
    }
} 