import { MongoClient, MongoClientOptions, ServerApiVersion } from 'mongodb';
import { logger } from './logger.js';

// Database management class for direct client creation
export class DatabaseManager {
  private mongoClient: MongoClient | null = null;
  private db: any = null;

  /**
   * Initialize database connection with direct client creation
   * @param mongoDbName Database name
   * @param mongoUri MongoDB URI
   */
  async initializeDatabase(mongoDbName: string, mongoUri: string): Promise<void> {
    if (!this.mongoClient) {
      if (!mongoUri) {
        throw new Error('MongoDB URI is required but not provided');
      }

      // MongoDB connection options
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

      try {
        // Create MongoDB client directly
        this.mongoClient = new MongoClient(mongoUri, mongoOptions);
        
        // Connect to MongoDB
        await this.mongoClient.connect();
        
        // Use the database name passed as parameter
        this.db = this.mongoClient.db(mongoDbName);
        
        logger.info(`Connected to MongoDB database: ${mongoDbName}`);
      } catch (error) {
        logger.error('Failed to connect to MongoDB:', error);
        throw new Error(`MongoDB connection failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /**
   * Close database connection
   */
  async closeDatabase(): Promise<void> {
    if (this.mongoClient) {
      await this.mongoClient.close();
      this.mongoClient = null;
      this.db = null;
    }
  }

  /**
   * Get the database instance
   */
  getDb(): any {
    return this.db;
  }

  /**
   * Check if database is connected
   */
  isConnected(): boolean {
    return this.mongoClient !== null && this.db !== null;
  }
} 