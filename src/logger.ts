import winston from 'winston';
import path from 'path';
import fs from 'fs';

// Ensure logs directory exists with error handling
let logsDir: string;
let canWriteLogs = false;

try {
  logsDir = path.join(process.cwd(), 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  canWriteLogs = true;
} catch (error) {
  console.warn('Could not create logs directory, file logging will be disabled:', error);
  canWriteLogs = false;
}

// Determine environment
const NODE_ENV = process.env.NODE_ENV || 'development';
const isProd = NODE_ENV === 'production';

// Configure log level based on environment
const logLevel = isProd ? 'info' : process.env.LOG_LEVEL || 'debug';

// Custom format for production (structured JSON logs)
const productionFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Custom format for development (colorized and readable)
const developmentFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.colorize(),
  winston.format.printf(({ level, message, timestamp, ...meta }) => {
    const metaString = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
    return `${timestamp} [${level}]: ${message} ${metaString}`;
  })
);

// Create transports array
const transports: any[] = [
  // Console transport (always available)
  new winston.transports.Console({
    format: developmentFormat
  })
];

// Add file transports only if we can write to logs directory
if (canWriteLogs) {
  transports.push(
    new winston.transports.File({ 
      filename: 'logs/error.log',
      level: 'error',
      silent: !isProd && process.env.ENABLE_FILE_LOGGING !== 'true'
    }),
    new winston.transports.File({ 
      filename: 'logs/combined.log',
      silent: !isProd && process.env.ENABLE_FILE_LOGGING !== 'true'
    })
  );
}

// Create exception handlers
const exceptionHandlers: any[] = [
  new winston.transports.Console({ format: developmentFormat })
];

if (canWriteLogs) {
  exceptionHandlers.unshift(new winston.transports.File({ filename: 'logs/exceptions.log' }));
}

// Create and export the logger
export const logger = winston.createLogger({
  level: logLevel,
  format: isProd ? productionFormat : developmentFormat,
  defaultMeta: { service: 'purchase-mcp-server', environment: NODE_ENV },
  transports,
  exceptionHandlers,
  exitOnError: false
}); 