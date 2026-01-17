const net = require("net");
const fs = require("fs");
const path = require("path");

// Load environment variables
require('dotenv').config();

const gpsTracking = require("gps-tracking");
const gps = gpsTracking;

// Import profiler and parser
const EnhancedProfiler = require('./enhanced-profiler');
const AlarmParser = require('./alarm-parser');

// Import enhanced adapter
const enhancedAdapter = require('./node_modules/gps-tracking/lib/adapters/enhanced-gt06');
if (!gps.server.availableAdapters) {
  gps.server.availableAdapters = {};
}
gps.server.availableAdapters.GT06_PLUS = enhancedAdapter;

// Initialize profiler and parser
const enhancedProfiler = new EnhancedProfiler();
const alarmParser = new AlarmParser();

// API endpoints
const MOOVE_SERVER_BASE_URL = process.env.MOOVE_SERVER_BASE_URL;
const API_ENDPOINTS = {
  LOCATION: `${MOOVE_SERVER_BASE_URL}/api/gps/location`,
  ALARM: `${MOOVE_SERVER_BASE_URL}/api/gps/alarm`,
  STATUS: `${MOOVE_SERVER_BASE_URL}/api/gps/status`,
  HEARTBEAT: `${MOOVE_SERVER_BASE_URL}/api/gps/heartbeat`,
  LOGIN: `${MOOVE_SERVER_BASE_URL}/api/gps/login`
};

console.log(`Starting Enhanced GPS Server...`);
console.log(`Moove Server Base URL: ${MOOVE_SERVER_BASE_URL}`);
console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

// Server configuration
const options = {
  debug: true,
  port: process.env.GPS_SERVER_PORT || 6006,
  device_adapter: "GT06",
  maxConnections: 1000,
  connectionTimeout: 30000,
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

// Queue for API requests
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

const requestQueue = new RequestQueue(3);

// Function to create CRS proxy connection
function createCrsConnection() {
  if (!process.env.CRS_SERVER || !process.env.CRS_SERVER_PORT) {
    console.error("CRS server configuration missing!");
    return null;
  }

  try {
    const client = new net.Socket();
    
    client.setTimeout(30000);
    client.setKeepAlive(true, 10000);
    
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
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "User-Agent": "GPS-Server/1.0"
        },
        body: JSON.stringify(data)
      });
      
      if (!response.ok) {
        const errorText = await response.text().catch(() => 'No error body');
        console.error(`API Error (${endpoint}): ${response.status}`, errorText.substring(0, 200));
        return null;
      }
      
      return await response.json();
    } catch (error) {
      console.error(`Failed to send to ${endpoint}:`, error.message);
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

// Then in the device.on("login_request") event handler, update:
device.on("login_request", function (device_id, msg_parts) {
  packetsReceived++;
  deviceId = device_id;
  
  console.log(`\n🔍 LOGIN PACKET DETAILS:`);
  console.log(`   Raw hex: ${msg_parts.raw}`);
  console.log(`   Protocol ID: 0x${msg_parts.protocol_id}`);
  console.log(`   Packet length: ${msg_parts.length} bytes`);
  console.log(`   Data section: ${msg_parts.data}`);
  
  // ENHANCED: Get analysis from multiple sources
  let analysis = {};
  
  // 1. First try to get from msg_parts.analysis (from adapter)
  if (msg_parts.analysis && Object.keys(msg_parts.analysis).length > 0) {
    analysis = msg_parts.analysis;
    console.log('✓ Using analysis from adapter');
  } 
  // 2. If not available, use enhanced profiler
  else if (msg_parts.raw) {
    analysis = enhancedProfiler.analyzePacket(msg_parts.raw, device_id);
    console.log('✓ Using analysis from enhanced profiler');
  }
  // 3. Fallback to simple analysis
  else {
    analysis = {
      protocolNumber: msg_parts.protocol_id || 'unknown',
      packetType: 'Login',
      brands: ['GT06 Family'],
      protocols: ['GT06']
    };
    console.log('⚠ Using fallback analysis');
  }
  
  console.log(`ANALYSIS OBJECT:`, JSON.stringify(analysis, null, 2));
  
  console.log(`\n═══════════════════════════════════════════════════════════`);
  console.log(`📱 DEVICE LOGIN: ${device_id}`);
  console.log(`📍 IP: ${connection.remoteAddress}`);
  console.log(`🔢 Protocol: 0x${analysis.protocolNumber || msg_parts.protocol_id || 'Unknown'}`);
  console.log(`📦 Packet Type: ${analysis.packetType || 'Unknown'}`);
  console.log(`🏷️  Brands: ${analysis.brands && analysis.brands.length > 0 ? analysis.brands.join(', ') : 'Unknown'}`);
  console.log(`📊 Protocols: ${analysis.protocols && analysis.protocols.length > 0 ? analysis.protocols.join(', ') : 'Unknown'}`);
  console.log(`═══════════════════════════════════════════════════════════\n`);
  
  this.login_authorized(true);
  is_proxy_CRS_device = crsTerminals.includes(device_id);

  // Create CRS connection if needed
  if (is_proxy_CRS_device && !crsClient) {
    console.log(`Creating CRS proxy for device ${device_id}`);
    crsClient = createCrsConnection();
  }

  // Enhanced login data with profiling
  sendToAPI(API_ENDPOINTS.LOGIN, {
    device_id: device_id,
    imei: device_id,
    protocol_version: "GT06+",
    ip_address: connection.remoteAddress,
    timestamp: new Date().toISOString(),
    crs_proxy: is_proxy_CRS_device,
    brand_info: analysis.brands || [],
    protocol_info: analysis.protocols || [],
    packet_type: analysis.packetType,
    protocol_number: analysis.protocolNumber,
    raw_preview: msg_parts.raw ? msg_parts.raw.substring(0, 50) : '',
    analysis: analysis // Include full analysis
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
    
    console.log("@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@");
    console.log("MOOVE Location for device:", data.device_id);
    console.log("Lat:", data.latitude, "Lng:", data.longitude, "Speed:", data.speed);
    console.log("@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@");
    
    sendToAPI(API_ENDPOINTS.LOCATION, {
      device_id: data.device_id,
      latitude: data.latitude,
      longitude: data.longitude,
      speed: data.speed || 0,
      course: data.orientation || 0,
      satellites: data.satellites || 0,
      raw_data: data.raw_data || '',
      timestamp: data.date || new Date().toISOString(),
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
    
    console.log(`🚨 ALARM DETECTED:`);
    console.log(`   Device: ${alarm_data.device_id}`);
    console.log(`   Type: ${alarm_data.alarm_type}`);
    console.log(`   Code: ${alarm_code}`);
    console.log(`   Protocol: ${msg_parts.protocol_id}`);
    
    sendToAPI(API_ENDPOINTS.ALARM, {
      device_id: alarm_data.device_id,
      alarm_type: alarm_data.alarm_type,
      alarm_code: alarm_data.alarm_code || alarm_code,
      latitude: alarm_data.latitude,
      longitude: alarm_data.longitude,
      speed: alarm_data.speed || 0,
      parsed_details: alarm_data.parsed_details || {},
      raw_data: alarm_data.raw_data || '',
      timestamp: alarm_data.date || new Date().toISOString(),
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
});

process.on('unhandledRejection', function (reason, promise) {
  console.error('UNHANDLED REJECTION at:', promise);
  console.error('Reason:', reason);
});

// ... previous code ...

// Graceful shutdown
function gracefulShutdown(signal) {
  console.log(`\n${signal} received. Starting graceful shutdown...`);
  
  // Display queue stats
  const stats = requestQueue.getStats();
  console.log('Request Queue Stats:', stats);
  
  // Get device statistics
  try {
    const deviceStats = enhancedProfiler.getDeviceSummary();
    const alarmStats = alarmParser.getAlarmStatistics();
    
    console.log('\n📊 FINAL STATISTICS:');
    console.log(`   Total Devices: ${deviceStats.totalDevices}`);
    console.log(`   Recently Active: ${deviceStats.recentlyActive.length}`);
    console.log(`   Total Alarms: ${alarmStats.totalAlarms || 0}`);
    console.log(`   By Protocol: ${JSON.stringify(alarmStats.byProtocol || {})}`);
  } catch (error) {
    console.error('Error getting statistics:', error.message);
  }
  
  // Check if server has a close method
  if (server && typeof server.close === 'function') {
    console.log('Closing GPS server...');
    server.close(() => {
      console.log('GPS Server closed');
      process.exit(0);
    });
    
    // Force exit after 10 seconds
    setTimeout(() => {
      console.log('Forcing shutdown after timeout');
      process.exit(1);
    }, 10000);
  } else if (server && typeof server.server !== 'undefined') {
    // Try accessing the underlying net server
    console.log('Closing underlying net server...');
    if (server.server && typeof server.server.close === 'function') {
      server.server.close(() => {
        console.log('GPS Server closed');
        process.exit(0);
      });
      
      setTimeout(() => {
        console.log('Forcing shutdown after timeout');
        process.exit(1);
      }, 10000);
    } else {
      console.log('Cannot find server close method, exiting...');
      process.exit(0);
    }
  } else {
    console.log('Server instance not found, exiting...');
    process.exit(0);
  }
}

// Alternative: Check what type of object server is
console.log('Server type:', typeof server);
console.log('Server keys:', Object.keys(server || {}));
console.log('Server.constructor.name:', server?.constructor?.name);

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
  const deviceStats = enhancedProfiler.getDeviceSummary();
  const alarmStats = alarmParser.getAlarmStatistics();
  
  console.log(`\n📊 SERVER STATISTICS:`);
  console.log(`   Queue: ${stats.active} active, ${stats.queued} queued`);
  console.log(`   Devices: ${deviceStats.totalDevices} total, ${deviceStats.recentlyActive.length} active`);
  console.log(`   Alarms: ${alarmStats.totalAlarms || 0} total`);
  console.log(`   Protocols: ${JSON.stringify(deviceStats.devicesByProtocol)}`);
}, 60000);

module.exports = server;
