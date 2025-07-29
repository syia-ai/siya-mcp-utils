import { MongoClient, MongoClientOptions, ServerApiVersion, Db } from 'mongodb';
import { logger } from './logger';

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

export class MongoDBClient {
  private client: MongoClient | null = null;
  private isConnected = false;
  private readonly uri: string;
  private readonly dbName: string;
  private readonly connectionName: string;

  constructor(uri: string, dbName: string, connectionName: string = 'mongodb') {
    if (!uri) {
      throw new Error('MongoDB URI is required');
    }
    if (!dbName) {
      throw new Error('Database name is required');
    }
    
    this.uri = uri;
    this.dbName = dbName;
    this.connectionName = connectionName;
  }

  /**
   * Connect to MongoDB with retry logic
   */
  async connect(): Promise<void> {
    if (this.isConnected && this.client) {
      return;
    }

    // Skip MongoDB connection in test environment
    if (process.env.NODE_ENV === 'test') {
      logger.info('Test environment detected, skipping MongoDB connection');
      return;
    }

    const maxRetries = 5;
    const retryDelayMs = 2000;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.client = new MongoClient(this.uri, mongoOptions);
        await this.client.connect();
        
        // Verify connection by pinging the database
        await this.client.db(this.dbName).command({ ping: 1 });
        
        this.isConnected = true;
        logger.info(`Connected to ${this.connectionName} MongoDB instance (attempt ${attempt})`);
        return;
      } catch (error) {
        logger.error(`Failed to connect to ${this.connectionName} MongoDB (attempt ${attempt}/${maxRetries}):`, error);
        
        if (this.client) {
          try {
            await this.client.close();
          } catch (closeError) {
            logger.error('Error closing failed connection:', closeError);
          }
          this.client = null;
        }
        
        if (attempt === maxRetries) {
          logger.error(`Max retries reached for ${this.connectionName} MongoDB connection`);
          throw new Error(`Failed to connect to ${this.connectionName} MongoDB after ${maxRetries} attempts`);
        }
        
        // Wait before retrying
        logger.info(`Retrying ${this.connectionName} MongoDB connection in ${retryDelayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      }
    }
  }

  /**
   * Get the MongoDB client instance
   */
  async getClient(): Promise<MongoClient> {
    if (process.env.NODE_ENV === 'test') {
      return {} as MongoClient;
    }

    if (!this.isConnected || !this.client) {
      await this.connect();
    }
    
    if (!this.client) {
      throw new Error(`Failed to establish ${this.connectionName} MongoDB connection`);
    }
    
    return this.client;
  }

  /**
   * Get the database instance
   */
  async getDatabase(): Promise<Db> {
    const client = await this.getClient();
    if (process.env.NODE_ENV === 'test') {
      return {} as Db;
    }
    return client.db(this.dbName);
  }

  /**
   * Get connection status
   */
  getConnectionStatus(): { connected: boolean; uri: string; dbName: string; connectionName: string } {
    return {
      connected: this.isConnected,
      uri: this.uri,
      dbName: this.dbName,
      connectionName: this.connectionName
    };
  }

  /**
   * Close the MongoDB connection
   */
  async close(): Promise<void> {
    if (this.client) {
      try {
        await this.client.close();
        logger.info(`Closed ${this.connectionName} MongoDB connection`);
      } catch (error) {
        logger.error(`Error closing ${this.connectionName} MongoDB connection:`, error);
        throw error;
      } finally {
        this.client = null;
        this.isConnected = false;
      }
    }
  }
}

// Connection registry for managing multiple database connections
class MongoDBConnectionManager {
  private connections = new Map<string, MongoDBClient>();

  /**
   * Get or create a MongoDB client for the given configuration
   */
  getClient(uri: string, dbName: string, connectionName?: string): MongoDBClient {
    const key = `${uri}:${dbName}`;
    
    if (!this.connections.has(key)) {
      const client = new MongoDBClient(uri, dbName, connectionName || `mongodb-${this.connections.size + 1}`);
      this.connections.set(key, client);
    }
    
    return this.connections.get(key)!;
  }

  /**
   * Get all connection statuses for monitoring
   */
  getAllConnectionStatuses() {
    const statuses: any = {};
    this.connections.forEach((client) => {
      const status = client.getConnectionStatus();
      statuses[status.connectionName] = {
        connected: status.connected,
        uri: status.uri,
        dbName: status.dbName
      };
    });
    return statuses;
  }

  /**
   * Close all connections
   */
  async closeAllConnections(): Promise<void> {
    logger.info('Closing all MongoDB connections...');
    
    const closePromises = Array.from(this.connections.values()).map(client =>
      client.close().catch((err: any) => {
        logger.error('Error closing MongoDB connection:', err);
      })
    );
    
    await Promise.all(closePromises);
    this.connections.clear();
    logger.info('All MongoDB connections closed');
  }
}

// Export singleton instance
export const mongoManager = new MongoDBConnectionManager();

// Convenience functions for backward compatibility and ease of use
export async function getMongoClient(uri: string, dbName: string, connectionName?: string): Promise<MongoClient> {
  const client = mongoManager.getClient(uri, dbName, connectionName);
  return client.getClient();
}

export async function getMongoDatabase(uri: string, dbName: string, connectionName?: string): Promise<Db> {
  const client = mongoManager.getClient(uri, dbName, connectionName);
  return client.getDatabase();
}

export function getConnectionStatus() {
  return mongoManager.getAllConnectionStatuses();
}

export async function closeConnections(): Promise<void> {
  return mongoManager.closeAllConnections();
}