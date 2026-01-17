import net from "net";
import { createRequire } from "module";
import 'dotenv/config';

const require = createRequire(import.meta.url);
const gpsTracking = require("gps-tracking");
const gps = gpsTracking;

// Import custom adapter
const customAdapter = require('./node_modules/gps-tracking/lib/adapters/gt06.js');
if (!gps.server.availableAdapters) {
  gps.server.availableAdapters = {};
}
gps.server.availableAdapters.GT06N = customAdapter;

// API endpoints
const MOOVE_SERVER_BASE_URL = process.env.MOOVE_SERVER_BASE_URL;
const API_ENDPOINTS = {
  LOCATION: `${MOOVE_SERVER_BASE_URL}/api/gps/location`,
  ALARM: `${MOOVE_SERVER_BASE_URL}/api/gps/alarm`,
  STATUS: `${MOOVE_SERVER_BASE_URL}/api/gps/status`,
  HEARTBEAT: `${MOOVE_SERVER_BASE_URL}/api/gps/heartbeat`,
  LOGIN: `${MOOVE_SERVER_BASE_URL}/api/gps/login`
};

console.log(`Starting GPS Server...`);
console.log(`Moove Server Base URL: ${MOOVE_SERVER_BASE_URL}`);
console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

// Server configuration
const options = {
  debug: true,
  port: process.env.GPS_SERVER_PORT || 6006,
  device_adapter: "GT06N",
  maxConnections: 1000,
  connectionTimeout: 30000, // 30 seconds
  keepAlive: true,
};

// These are devices I need to proxy to a different server
const crsTerminals = [
  "0868720063451946",
  "0868720063452100",
  "0868720062933829",
  "0864943047255027",
  "0358657103600172",
  "0358657103608399",
  "0358657103600453",
  "0358657105060953",
  "0358657104462051",
  "0868720061903625",
  "0868720061906289",
  "0868720061905174",
  "0868720061898619",
  "0358657104517136",
  "0358657103861956",
  "0358657104813964",
];

// Queue for API requests to prevent overload
class RequestQueue {
  constructor(maxConcurrent = 5) {
    this.queue = [];
    this.active = 0;
    this.maxConcurrent = maxConcurrent;
    this.totalProcessed = 0;
    this.totalErrors = 0;
  }

  async add(requestFn, description = 'request') {
    return new Promise((resolve, reject) => {
      this.queue.push({ requestFn, resolve, reject, description });
      this.process();
    });
  }

  async process() {
    if (this.active >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    this.active++;
    const { requestFn, resolve, reject, description } = this.queue.shift();

    try {
      console.log(`Queue: Processing ${description} (Active: ${this.active}, Queued: ${this.queue.length})`);
      const result = await requestFn();
      this.totalProcessed++;
      resolve(result);
    } catch (error) {
      this.totalErrors++;
      console.error(`Queue: Error in ${description}:`, error.message);
      reject(error);
    } finally {
      this.active--;
      this.process();
    }
  }

  getStats() {
    return {
      active: this.active,
      queued: this.queue.length,
      totalProcessed: this.totalProcessed,
      totalErrors: this.totalErrors
    };
  }
}

const requestQueue = new RequestQueue(3); // Max 3 concurrent requests

// Function to create CRS proxy connection
function createCrsConnection() {
  if (!process.env.CRS_SERVER || !process.env.CRS_SERVER_PORT) {
    console.error("CRS server configuration missing!");
    return null;
  }

  try {
    const client = new net.Socket();
    
    // Configure connection
    client.setTimeout(30000); // 30 second timeout
    client.setKeepAlive(true, 10000); // Keep-alive every 10 seconds
    
    // Event handlers
    client.on('connect', function () {
      console.log("==========================================================================");
      console.log("CRS - Connected to proxy server:", process.env.CRS_SERVER, process.env.CRS_SERVER_PORT);
      console.log("==========================================================================");
    });
    
    client.on('error', (err) => {
      console.log("CRS - Connection Error:", err.message);
    });
    
    client.on('timeout', () => {
      console.log("CRS - Connection timeout");
      client.destroy();
    });
    
    client.on('close', (hadError) => {
      console.log(`CRS - Connection closed ${hadError ? 'with error' : 'cleanly'}`);
    });
    
    client.on('end', () => {
      console.log("CRS - Connection ended by server");
    });
    
    // Connect to CRS server
    client.connect(process.env.CRS_SERVER_PORT, process.env.CRS_SERVER, function () {
      console.log("CRS - Successfully connected to proxy server");
    });
    
    return client;
  } catch (error) {
    console.error("CRS - ERROR creating connection:", error.message);
    return null;
  }
}

// Helper function with queue
async function sendToAPI(endpoint, data, description = 'API request') {
  return requestQueue.add(async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
      
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "User-Agent": "GPS-Server/1.0"
        },
        body: JSON.stringify(data),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorText = await response.text().catch(() => 'No error body');
        console.error(`API Error (${endpoint}): ${response.status}`, errorText.substring(0, 200));
        return null;
      }
      
      return await response.json();
    } catch (error) {
      if (error.name === 'AbortError') {
        console.error(`API Timeout (${endpoint})`);
      } else {
        console.error(`Failed to send to ${endpoint}:`, error.message);
      }
      return null;
    }
  }, description);
}

// Create GPS server
const server = gps.server(options, function (device, connection) {
  console.log(`New connection from ${connection.remoteAddress}:${connection.remotePort}`);
  
  let crsClient = null;
  let is_proxy_CRS_device = false;
  let deviceId = null;
  let connectionStartTime = Date.now();
  let packetsReceived = 0;

  // Connection event handlers
  connection.on('error', (err) => {
    console.error(`Connection error for ${deviceId || 'unknown device'}:`, err.message);
  });

  connection.on('close', () => {
    console.log(`Connection closed for ${deviceId || 'unknown device'} (Duration: ${Math.round((Date.now() - connectionStartTime) / 1000)}s, Packets: ${packetsReceived})`);
    
    // Clean up CRS connection
    if (crsClient) {
      try {
        crsClient.destroy();
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  });

  connection.on('timeout', () => {
    console.log(`Connection timeout for ${deviceId || 'unknown device'}`);
  });

  // Device event handlers
  device.on("login_request", function (device_id, msg_parts) {
    packetsReceived++;
    deviceId = device_id;
    console.log(`Login from ${device_id} (IP: ${connection.remoteAddress})`);
    
    this.login_authorized(true);
    is_proxy_CRS_device = crsTerminals.includes(device_id);

    // Create CRS connection if needed
    if (is_proxy_CRS_device && !crsClient) {
      console.log(`Creating CRS proxy for device ${device_id}`);
      crsClient = createCrsConnection();
    }

    sendToAPI(API_ENDPOINTS.LOGIN, {
      device_id: device_id,
      imei: device_id,
      protocol_version: "GT06N",
      ip_address: connection.remoteAddress,
      timestamp: new Date().toISOString(),
      crs_proxy: is_proxy_CRS_device
    }, `Login for ${device_id}`).catch(() => { /* Ignore errors */ });
  });

  device.on("ping", function (data, msg_parts) {
    packetsReceived++;
    if (!data.device_id) {
      console.log('No device_id in location data');
      return;
    }
    
    deviceId = data.device_id;
    is_proxy_CRS_device = crsTerminals.includes(data.device_id);
    
    console.log("@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@")
    console.log("MOOVE Location for device:", data.device_id)
    console.log("Lat:", data.latitude, "Lng:", data.longitude, "Speed:", data.speed)
    console.log("@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@")
    
    sendToAPI(API_ENDPOINTS.LOCATION, {
      device_id: data.device_id,
      latitude: data.latitude,
      longitude: data.longitude,
      speed: data.speed || 0,
      course: data.orientation || 0,
      satellites: data.satellites || 0,
      device_status: data.device_status || {},
      raw_data: data.raw_data || '',
      timestamp: data.date || new Date().toISOString(),
      timestampDate: data.timestampDate || new Date(),
      type: 'location',
      protocol: msg_parts.protocol_id,
      crs_proxy: is_proxy_CRS_device
    }, `Location for ${data.device_id}`).catch(() => { /* Ignore errors */ });
  });

  device.on("alarm", function (alarm_code, alarm_data, msg_parts) {
    packetsReceived++;
    if (!alarm_data.device_id) {
      console.log('No device_id in alarm data');
      return;
    }
    
    deviceId = alarm_data.device_id;
    is_proxy_CRS_device = crsTerminals.includes(alarm_data.device_id);
    
    console.log(`Alarm ${alarm_code} from ${alarm_data.device_id} (Type: ${alarm_data.alarm_type})`);
    
    sendToAPI(API_ENDPOINTS.ALARM, {
      device_id: alarm_data.device_id,
      alarm_type: alarm_code,
      alarm_description: alarm_data.alarm_type,
      alarm_code: alarm_data.alarm_code || alarm_code,
      latitude: alarm_data.latitude,
      longitude: alarm_data.longitude,
      speed: alarm_data.speed || 0,
      device_status: alarm_data.device_status || {},
      raw_data: alarm_data.raw_data || '',
      timestamp: alarm_data.date || new Date().toISOString(),
      timestampDate: alarm_data.timestampDate || new Date(),
      type: 'alarm',
      protocol: msg_parts.protocol_id,
      crs_proxy: is_proxy_CRS_device
    }, `Alarm for ${alarm_data.device_id}`).catch(() => { /* Ignore errors */ });
  });

  device.on("heartbeat", function (data, msg_parts) {
    packetsReceived++;
    const deviceId = data.device_id || device.getUID();
    if (!deviceId) return;
    
    is_proxy_CRS_device = crsTerminals.includes(deviceId);
    console.log(`Heartbeat from ${deviceId}` + (is_proxy_CRS_device ? ' (CRS proxy)' : ''));
    
    sendToAPI(API_ENDPOINTS.HEARTBEAT, {
      device_id: deviceId,
      online: true,
      timestamp: new Date().toISOString(),
      type: 'heartbeat',
      crs_proxy: is_proxy_CRS_device
    }, `Heartbeat for ${deviceId}`).catch(() => { /* Ignore errors */ });
  });

  device.on("connected", function () {
    console.log(`Device ${deviceId || 'unknown'} connected`);
  });

  device.on("disconnected", function () {
    console.log(`Device ${deviceId || 'unknown'} disconnected`);
    
    if (crsClient) {
      try {
        crsClient.destroy();
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  });

  // Handle incoming data for CRS proxying
  connection.on("data", function (data) {
    if (is_proxy_CRS_device && crsClient) {
      try {
        if (crsClient.writable) {
          const success = crsClient.write(data);
          if (success) {
            console.log("CRS - Data forwarded to proxy server");
          } else {
            console.log("CRS - Buffer full, data not forwarded");
          }
        } else {
          console.log("CRS - Socket not writable, attempting to reconnect");
          crsClient.destroy();
          crsClient = createCrsConnection();
        }
      } catch (error) {
        console.log("CRS - Error forwarding data:", error.message);
      }
    }
  });
});

// Server error handling
server.on("error", function (err) {
  console.error("Server Error:", err);
});

// Global error handlers
process.on('uncaughtException', function (err) {
  console.error('UNCAUGHT EXCEPTION:', err.message);
  console.error('Stack:', err.stack);
  // Don't exit, continue running
});

process.on('unhandledRejection', function (reason, promise) {
  console.error('UNHANDLED REJECTION at:', promise);
  console.error('Reason:', reason);
});

// Graceful shutdown
function gracefulShutdown(signal) {
  console.log(`\n${signal} received. Starting graceful shutdown...`);
  
  // Display queue stats
  const stats = requestQueue.getStats();
  console.log('Request Queue Stats:', stats);
  
  // Close server
  server.close(() => {
    console.log('GPS Server closed');
    process.exit(0);
  });
  
  // Force exit after 10 seconds
  setTimeout(() => {
    console.log('Forcing shutdown after timeout');
    process.exit(1);
  }, 10000);
}

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Log startup information
console.log(`GPS Server listening on port ${options.port}`);
console.log(`CRS Proxy enabled: ${!!process.env.CRS_SERVER}`);
console.log(`CRS Server: ${process.env.CRS_SERVER || 'Not configured'}`);
console.log(`CRS Port: ${process.env.CRS_SERVER_PORT || 'Not configured'}`);
console.log(`CRS Terminals count: ${crsTerminals.length}`);
console.log(`Queue settings: Max ${requestQueue.maxConcurrent} concurrent requests\n`);

// Periodic stats logging
setInterval(() => {
  const stats = requestQueue.getStats();
  console.log(`[Stats] Queue: ${stats.active} active, ${stats.queued} queued, ${stats.totalProcessed} processed, ${stats.totalErrors} errors`);
}, 60000); // Log every minute

export default server;