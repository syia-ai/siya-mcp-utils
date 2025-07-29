import { MongoClient, MongoClientOptions, ServerApiVersion } from 'mongodb';
import { logger } from './logger.js';
import { getConfig } from './config';

// MongoDB connection options for better resilience
const mongoOptions: MongoClientOptions = {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
  maxPoolSize: 10,
  minPoolSize: 5,
  maxIdleTimeMS: 60000,
  connectTimeoutMS: 30000,
  socketTimeoutMS: 45000,
  retryWrites: true,
  retryReads: true,
};

// Main MongoDB clients
let client: MongoClient | null = null;
let secondaryClient: MongoClient | null = null;

// Specific database clients
let devApiClient: MongoClient | null = null;
let etlDevClient: MongoClient | null = null;
let etlDevDataClient: MongoClient | null = null;

// Connection status tracking
const connectionStatus = {
  primary: false,
  secondary: false,
  devApi: false,
  etlDev: false,
  etlDevData: false,
};

/**
 * Connect to MongoDB with retry logic
 * @param uri MongoDB connection URI
 * @param name Connection name for logging
 * @returns MongoDB client instance
 */
async function connectWithRetry(uri: string, name: string): Promise<MongoClient | null> {
  const maxRetries = 5;
  const retryDelayMs = 2000;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const client = new MongoClient(uri, mongoOptions);
      await client.connect();
      
      // Verify connection by pinging the database
      await client.db().command({ ping: 1 });
      
      logger.info(`Connected to ${name} MongoDB instance (attempt ${attempt})`);
      return client;
    } catch (error) {
      logger.error(`Failed to connect to ${name} MongoDB (attempt ${attempt}/${maxRetries}):`, error);
      
      if (attempt === maxRetries) {
        logger.error(`Max retries reached for ${name} MongoDB connection`);
        return null;
      }
      
      // Wait before retrying
      logger.info(`Retrying ${name} MongoDB connection in ${retryDelayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, retryDelayMs));
    }
  }
  
  return null;
}

/**
 * Initialize all MongoDB connections
 * This should be called during server startup
 */
export async function initializeConnections(): Promise<void> {
  // Skip MongoDB connection in test environment
  if (process.env.NODE_ENV === 'test') {
    logger.info('Test environment detected, skipping MongoDB connections');
    return;
  }

  try {
    // Initialize primary connection
    if (!client && getConfig().mongoUri) {
      client = await connectWithRetry(getConfig().mongoUri, 'primary');
      connectionStatus.primary = client !== null;
    }

    // Initialize secondary connection if configured
    if (!secondaryClient && getConfig().secondaryMongoUri) {
      secondaryClient = await connectWithRetry(getConfig().secondaryMongoUri, 'secondary');
      connectionStatus.secondary = secondaryClient !== null;
    }

    // Initialize dev-api connection
    if (!devApiClient && getConfig().devApiMongoUri) {
      devApiClient = await connectWithRetry(getConfig().devApiMongoUri, 'dev-syia-api');
      connectionStatus.devApi = devApiClient !== null;
    }

    // Initialize etl-dev connection
    if (!etlDevClient && getConfig().etlDevMongoUri) {
      etlDevClient = await connectWithRetry(getConfig().etlDevMongoUri, 'syia-etl-dev');
      connectionStatus.etlDev = etlDevClient !== null;
    }

    // Initialize etl-dev-data connection
    if (!etlDevDataClient && getConfig().etlDevDataUri) {
      etlDevDataClient = await connectWithRetry(getConfig().etlDevDataUri, 'syia-etl-dev-data');
      connectionStatus.etlDevData = etlDevDataClient !== null;
    }

    // Check if primary connection is established
    if (!connectionStatus.primary) {
      throw new Error('Failed to establish primary MongoDB connection');
    }

    logger.info('MongoDB connections initialized', { connectionStatus });
  } catch (error) {
    logger.error('Error initializing MongoDB connections:', error);
    throw error;
  }
}

/**
 * Get MongoDB client based on URI or default
 */
export async function getMongoClient(uri?: string): Promise<MongoClient> {
  // Skip MongoDB connection in test environment
  if (process.env.NODE_ENV === 'test') {
    logger.info('Test environment detected, skipping MongoDB connection');
    return {} as MongoClient;
  }

  // If URI is provided, use it for a specific connection
  if (uri) {
    // Check for dev-api connection
    if (uri === getConfig().devApiMongoUri) {
      if (!devApiClient) {
        // If not initialized during startup, initialize now
        devApiClient = await connectWithRetry(uri, 'dev-syia-api');
        connectionStatus.devApi = devApiClient !== null;
      }
      return devApiClient || ({} as MongoClient);
    }
    
    // Check for etl-dev connection
    if (uri === getConfig().etlDevMongoUri) {
      if (!etlDevClient) {
        // If not initialized during startup, initialize now
        etlDevClient = await connectWithRetry(uri, 'syia-etl-dev');
        connectionStatus.etlDev = etlDevClient !== null;
      }
      return etlDevClient || ({} as MongoClient);
    }
    
    // Check for etl-dev-data connection
    if (uri === getConfig().etlDevDataUri) {
      if (!etlDevDataClient) {
        // If not initialized during startup, initialize now
        etlDevDataClient = await connectWithRetry(uri, 'syia-etl-dev-data');
        connectionStatus.etlDevData = etlDevDataClient !== null;
      }
      return etlDevDataClient || ({} as MongoClient);
    }
    
    // Check for secondary connection
    if (uri === getConfig().secondaryMongoUri) {
      if (!secondaryClient) {
        // If not initialized during startup, initialize now
        secondaryClient = await connectWithRetry(uri, 'secondary');
        connectionStatus.secondary = secondaryClient !== null;
      }
      return secondaryClient || ({} as MongoClient);
    }
    
    // For custom URI, create a new connection
    logger.info('Creating new MongoDB connection for custom URI');
    const customClient = await connectWithRetry(uri, 'custom');
    return customClient || ({} as MongoClient);
  }
  
  // Use primary connection by default
  if (!client) {
    // If not initialized during startup, initialize now
    client = await connectWithRetry(getConfig().mongoUri, 'primary');
    connectionStatus.primary = client !== null;
  }
  
  return client || ({} as MongoClient);
}

// Remaining helper functions for specific clients
export async function getDevApiClient(): Promise<MongoClient> {
  return getMongoClient(getConfig().devApiMongoUri);
}

export async function getEtlDevClient(): Promise<MongoClient> {
  return getMongoClient(getConfig().etlDevMongoUri);
}

export async function getEtlDevDataClient(): Promise<MongoClient> {
  return getMongoClient(getConfig().etlDevDataUri);
}

export function getEtlDevDataDbName(): string {
  return getConfig().etlDevDataDbName;
}

export function getDevApiDbName(): string {
  return getConfig().devApiDbName;
}

export function getEtlDevDbName(): string {
  return getConfig().etlDevDbName;
}

/**
 * Get connection status for monitoring
 */
export function getConnectionStatus() {
  return { ...connectionStatus };
}

/**
 * Close all MongoDB connections
 */
export async function closeConnections(): Promise<void> {
  logger.info('Closing MongoDB connections...');
  
  const closePromises = [];
  
  if (client) {
    closePromises.push(client.close().catch(err => {
      logger.error('Error closing primary MongoDB connection:', err);
    }));
  }
  
  if (secondaryClient) {
    closePromises.push(secondaryClient.close().catch(err => {
      logger.error('Error closing secondary MongoDB connection:', err);
    }));
  }
  
  if (devApiClient) {
    closePromises.push(devApiClient.close().catch(err => {
      logger.error('Error closing dev-api MongoDB connection:', err);
    }));
  }
  
  if (etlDevClient) {
    closePromises.push(etlDevClient.close().catch(err => {
      logger.error('Error closing etl-dev MongoDB connection:', err);
    }));
  }
  
  if (etlDevDataClient) {
    closePromises.push(etlDevDataClient.close().catch(err => {
      logger.error('Error closing etl-dev-data MongoDB connection:', err);
    }));
  }
  
  await Promise.all(closePromises);
  logger.info('All MongoDB connections closed');
} 