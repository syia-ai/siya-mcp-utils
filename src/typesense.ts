import { Client } from 'typesense';
import { logger } from './logger.js';
import { getConfig } from './config';

let client: Client | null = null;
let isConnected = false;

// Typesense connection options
const typesenseOptions = {
  connectionTimeoutSeconds: 5,
  retryIntervalSeconds: 0.1,
  numRetries: 3,
  healthCheckIntervalSeconds: 60
};

/**
 * Test Typesense connection by performing a health check
 * @param typesenseClient The Typesense client to test
 * @returns True if connection is successful, false otherwise
 */
async function testConnection(typesenseClient: Client): Promise<boolean> {
  try {
    // Attempt to get health stats as a connection test
    const health = await typesenseClient.health.retrieve();
    logger.debug('Typesense health check successful', { health });
    return true;
  } catch (error) {
    logger.error('Typesense health check failed:', error);
    return false;
  }
}

/**
 * Initialize Typesense client connection with retry logic
 * This should be called during server startup
 */
export function initializeConnection(): Client {
  if (!client) {
    try {
      // Create client instance
      client = new Client({
        nodes: [{
          host: getConfig().typesenseHost,
          port: parseInt(getConfig().typesensePort, 10),
          protocol: getConfig().typesenseProtocol
        }],
        apiKey: getConfig().typesenseApiKey,
        ...typesenseOptions
      });
      
      // Schedule periodic health checks in production
      if (process.env.NODE_ENV === 'production') {
        setInterval(async () => {
          isConnected = await testConnection(client as Client);
          if (!isConnected) {
            logger.warn('Typesense connection check failed, may need reconnection');
          }
        }, typesenseOptions.healthCheckIntervalSeconds * 1000);
      }
      
      logger.info('Initialized Typesense client', {
        host: getConfig().typesenseHost,
        port: getConfig().typesensePort,
        protocol: getConfig().typesenseProtocol
      });
      
      // Test connection immediately
      testConnection(client)
        .then(result => {
          isConnected = result;
          if (result) {
            logger.info('Successfully connected to Typesense');
          } else {
            logger.warn('Failed initial connection to Typesense, operations may fail');
          }
        })
        .catch(err => {
          logger.error('Error testing Typesense connection:', err);
        });
    } catch (error) {
      logger.error('Error initializing Typesense client:', error);
      throw error;
    }
  }
  return client;
}

/**
 * Get Typesense client
 * If not already initialized, this will initialize the client
 */
export function getTypesenseClient(): Client {
  if (!client) {
    return initializeConnection();
  }
  return client;
}

/**
 * Check if Typesense connection is healthy
 * @returns True if connected, false otherwise
 */
export function isTypesenseConnected(): boolean {
  return isConnected;
}

/**
 * Close Typesense connection
 * This should be called during server shutdown
 */
export async function closeConnection(): Promise<void> {
  if (client) {
    try {
      // Clear any scheduled health checks
      for (let i = 0; i < 1000; i++) {
        clearInterval(i);
      }
      
      // Typesense doesn't have a direct close method, but we can nullify the client
      client = null;
      isConnected = false;
      logger.info('Closed Typesense connection');
    } catch (error) {
      logger.error('Error closing Typesense connection:', error);
      throw error;
    }
  }
} 