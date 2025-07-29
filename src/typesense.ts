import { Client } from 'typesense';
import { logger } from './logger';

// Typesense connection options
const defaultTypesenseOptions = {
  connectionTimeoutSeconds: 5,
  retryIntervalSeconds: 0.1,
  numRetries: 3,
  healthCheckIntervalSeconds: 60
};

export interface TypesenseConfig {
  host: string;
  port: number;
  protocol: string;
  apiKey: string;
  options?: any;
}

export class TypesenseClient {
  private client: Client | null = null;
  private isConnected = false;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private readonly config: TypesenseConfig;
  private readonly connectionName: string;

  constructor(config: TypesenseConfig, connectionName: string = 'typesense') {
    if (!config.host || !config.port || !config.protocol || !config.apiKey) {
      throw new Error('Complete Typesense configuration is required (host, port, protocol, apiKey)');
    }
    
    this.config = config;
    this.connectionName = connectionName;
  }

  /**
   * Test Typesense connection by performing a health check
   */
  private async testConnection(): Promise<boolean> {
    if (!this.client) return false;
    
    try {
      const health = await this.client.health.retrieve();
      logger.debug(`${this.connectionName} Typesense health check successful`, { health });
      return true;
    } catch (error) {
      logger.error(`${this.connectionName} Typesense health check failed:`, error);
      return false;
    }
  }

  /**
   * Initialize Typesense client connection
   */
  async connect(): Promise<void> {
    if (this.isConnected && this.client) {
      return;
    }

    try {
      // Create client instance
      this.client = new Client({
        nodes: [{
          host: this.config.host,
          port: this.config.port,
          protocol: this.config.protocol
        }],
        apiKey: this.config.apiKey,
        ...defaultTypesenseOptions,
        ...(this.config.options || {})
      });
      
      logger.info(`Initialized ${this.connectionName} Typesense client`, {
        host: this.config.host,
        port: this.config.port,
        protocol: this.config.protocol
      });
      
      // Test connection immediately
      this.isConnected = await this.testConnection();
      
      if (this.isConnected) {
        logger.info(`Successfully connected to ${this.connectionName} Typesense`);
        
        // Schedule periodic health checks in production
        if (process.env.NODE_ENV === 'production') {
          this.healthCheckInterval = setInterval(async () => {
            this.isConnected = await this.testConnection();
            if (!this.isConnected) {
              logger.warn(`${this.connectionName} Typesense connection check failed, may need reconnection`);
            }
          }, defaultTypesenseOptions.healthCheckIntervalSeconds * 1000);
        }
      } else {
        logger.warn(`Failed initial connection to ${this.connectionName} Typesense, operations may fail`);
      }
      
    } catch (error) {
      logger.error(`Error initializing ${this.connectionName} Typesense client:`, error);
      throw error;
    }
  }

  /**
   * Get Typesense client instance
   */
  async getClient(): Promise<Client> {
    if (!this.isConnected || !this.client) {
      await this.connect();
    }
    
    if (!this.client) {
      throw new Error(`Failed to establish ${this.connectionName} Typesense connection`);
    }
    
    return this.client;
  }

  /**
   * Check if Typesense connection is healthy
   */
  getConnectionStatus(): { connected: boolean; host: string; port: number; connectionName: string } {
    return {
      connected: this.isConnected,
      host: this.config.host,
      port: this.config.port,
      connectionName: this.connectionName
    };
  }

  /**
   * Close Typesense connection
   */
  async close(): Promise<void> {
    try {
      // Clear the health check interval
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
        this.healthCheckInterval = null;
      }
      
      // Typesense doesn't have a direct close method, but we can nullify the client
      this.client = null;
      this.isConnected = false;
      logger.info(`Closed ${this.connectionName} Typesense connection`);
    } catch (error) {
      logger.error(`Error closing ${this.connectionName} Typesense connection:`, error);
      throw error;
    }
  }
}

// Connection registry for managing multiple Typesense connections
class TypesenseConnectionManager {
  private connections = new Map<string, TypesenseClient>();

  /**
   * Get or create a Typesense client for the given configuration
   */
  getClient(config: TypesenseConfig, connectionName?: string): TypesenseClient {
    const key = `${config.host}:${config.port}:${config.protocol}`;
    
    if (!this.connections.has(key)) {
      const client = new TypesenseClient(config, connectionName || `typesense-${this.connections.size + 1}`);
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
        host: status.host,
        port: status.port
      };
    });
    return statuses;
  }

  /**
   * Close all connections
   */
  async closeAllConnections(): Promise<void> {
    logger.info('Closing all Typesense connections...');
    
    const closePromises = Array.from(this.connections.values()).map(client =>
      client.close().catch((err: any) => {
        logger.error('Error closing Typesense connection:', err);
      })
    );
    
    await Promise.all(closePromises);
    this.connections.clear();
    logger.info('All Typesense connections closed');
  }
}

// Export singleton instance
export const typesenseManager = new TypesenseConnectionManager();

// Convenience functions for backward compatibility and ease of use
export async function getTypesenseClient(config: TypesenseConfig, connectionName?: string): Promise<Client> {
  const client = typesenseManager.getClient(config, connectionName);
  return client.getClient();
}

export function getTypesenseConnectionStatus() {
  return typesenseManager.getAllConnectionStatuses();
}

export async function closeTypesenseConnections(): Promise<void> {
  return typesenseManager.closeAllConnections();
}

// Legacy support - for backward compatibility with existing code
export function isTypesenseConnected(): boolean {
  const statuses = typesenseManager.getAllConnectionStatuses();
  return Object.values(statuses).some((status: any) => status.connected);
}