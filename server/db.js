/**
 * Database connection and initialization
 * Automatically creates users table if it does not exist
 * Supports Aiven connection string format: mysql://user:pass@host:port/database
 */

const mysql = require('mysql2/promise');
require('dotenv').config();

// Create connection pool for better performance
let pool = null;

/**
 * Parse Aiven connection string (SERVICE_URI format)
 * Format: mysql://username:password@host:port/database?options
 */
function parseConnectionString(connectionString) {
  try {
    const url = new URL(connectionString);
    const sslMode = url.searchParams.get('ssl-mode');
    
    // Configure SSL for Aiven (they use self-signed certificates)
    let sslConfig = undefined;
    if (sslMode === 'REQUIRED' || sslMode === 'REQUIRE') {
      // Aiven uses self-signed certs - allow them unless user provides CA
      sslConfig = { rejectUnauthorized: false };
      
      if (process.env.AIVEN_CA_CERT_PATH) {
        const fs = require('fs');
        sslConfig.ca = fs.readFileSync(process.env.AIVEN_CA_CERT_PATH);
        sslConfig.rejectUnauthorized = true;
      }
    }
    
    return {
      host: url.hostname,
      port: parseInt(url.port) || 3306,
      user: url.username,
      password: url.password,
      database: url.pathname.replace('/', '') || 'defaultdb',
      ssl: sslConfig,
    };
  } catch (error) {
    throw new Error(`Invalid connection string format: ${error.message}`);
  }
}

/**
 * Get database connection configuration
 * Supports both Aiven SERVICE_URI and individual environment variables
 */
function getDbConfig() {
  // Priority 1: Use Aiven SERVICE_URI connection string if provided
  if (process.env.AIVEN_SERVICE_URI) {
    return parseConnectionString(process.env.AIVEN_SERVICE_URI);
  }

  // Priority 2: Use Aiven console URL to extract service info (if provided)
  if (process.env.AIVEN_CONSOLE_URL) {
    // Extract service name from console URL
    // Format: https://console.aiven.io/account/{account}/project/{project}/services/{service}/overview
    const urlMatch = process.env.AIVEN_CONSOLE_URL.match(/services\/([^\/]+)/);
    if (urlMatch) {
      const serviceName = urlMatch[1];
      console.log(`ℹ️  Aiven console URL detected. Service: ${serviceName}`);
      console.log(`⚠️  Please use AIVEN_SERVICE_URI instead for direct connection.`);
      console.log(`   Get SERVICE_URI from: ${process.env.AIVEN_CONSOLE_URL.replace('/overview', '/connection-info')}`);
    }
  }

  // Priority 3: Fallback to individual environment variables (backward compatibility)
  if (process.env.DB_HOST && process.env.DB_USER && process.env.DB_PASSWORD) {
    // Configure SSL for Aiven connections
    let sslConfig = undefined;
    if (process.env.DB_HOST.includes('aivencloud.com')) {
      sslConfig = { rejectUnauthorized: false };
      if (process.env.AIVEN_CA_CERT_PATH) {
        const fs = require('fs');
        sslConfig.ca = fs.readFileSync(process.env.AIVEN_CA_CERT_PATH);
        sslConfig.rejectUnauthorized = true;
      }
    }
    
    return {
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME || 'defaultdb',
      port: parseInt(process.env.DB_PORT) || 3306,
      ssl: sslConfig,
    };
  }

  throw new Error(
    'Database configuration missing. Please provide either:\n' +
    '  - AIVEN_SERVICE_URI (recommended): mysql://user:pass@host:port/database\n' +
    '  - Or individual DB_* environment variables (DB_HOST, DB_USER, DB_PASSWORD, etc.)'
  );
}

/**
 * Initialize database connection and create tables
 */
async function initDatabase() {
  try {
    const config = getDbConfig();
    
    pool = mysql.createPool({
      ...config,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });

    // Test connection
    const connection = await pool.getConnection();
    console.log('✅ Database connected successfully');

    // Auto-create users table if it does not exist
    const createUsersTable = `
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        userId VARCHAR(100) UNIQUE,
        name VARCHAR(100),
        email VARCHAR(150),
        phone VARCHAR(20),
        password VARCHAR(255)
      )
    `;
    await connection.execute(createUsersTable);
    console.log('✅ Users table ready');

    // Auto-create sessions table if it does not exist
    const createSessionsTable = `
      CREATE TABLE IF NOT EXISTS sessions (
        session_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL PRIMARY KEY,
        expires INT UNSIGNED NOT NULL,
        data MEDIUMTEXT COLLATE utf8mb4_bin
      )
    `;
    await connection.execute(createSessionsTable);
    console.log('✅ Sessions table ready');
    
    connection.release();
  } catch (error) {
    console.error('❌ Database initialization failed:', error.message);
    if (error.message.includes('configuration missing')) {
      console.error('\n📖 How to get your Aiven SERVICE_URI:');
      console.error('   1. Go to your Aiven Console');
      console.error('   2. Select your MySQL service');
      console.error('   3. Go to "Connection information" tab');
      console.error('   4. Copy the SERVICE_URI (starts with mysql://)');
      console.error('   5. Set it as: AIVEN_SERVICE_URI="mysql://..."\n');
    }
    throw error;
  }
}

/**
 * Get database pool for queries
 */
function getPool() {
  return pool;
}

module.exports = { initDatabase, getPool, getDbConfig };
