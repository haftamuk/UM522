import net from "net";
import { createRequire } from "module";
import 'dotenv/config';

const require = createRequire(import.meta.url);

// Import gps-tracking
const gpsTracking = require("gps-tracking");
const gps = gpsTracking;

// Load custom adapter
const customAdapter = require('./node_modules/gps-tracking/lib/adapters/gt06.js');

// Register the adapter with gps-tracking library
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

console.log(`Moove Server Base URL: ${MOOVE_SERVER_BASE_URL}`);
console.log(`GPS Server starting...`);

// Server configuration
const options = {
  debug: true,
  port: process.env.GPS_SERVER_PORT || 6006,
  device_adapter: "GT06N",
};

// Create GPS server
const server = gps.server(options, function (device, connection) {
  console.log(`New device connection from ${connection.remoteAddress}:${connection.remotePort}`);
  
  let deviceIMEI = null;

  // Helper function to send data to API
  async function sendToAPI(endpoint, data) {
    try {
      console.log(`Sending to ${endpoint}:`, JSON.stringify(data, null, 2));
      
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data)
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`API Error (${endpoint}): ${response.status} ${response.statusText}`, errorText);
      } else {
        const result = await response.json();
        console.log(`API Success (${endpoint})`);
        return result;
      }
    } catch (error) {
      console.error(`Failed to send to ${endpoint}:`, error.message);
    }
  }

  // Device event handlers
  device.on("connected", function () {
    console.log("Device connected");
  });

  device.on("disconnected", function () {
    console.log("Device disconnected:", device.getUID());
  });

  device.on("login_request", function (device_id, msg_parts) {
    console.log(`Login request from ${device_id}`);
    deviceIMEI = device_id;
    this.login_authorized(true);
    
    // Send to API
    sendToAPI(API_ENDPOINTS.LOGIN, {
      device_id: device_id,
      imei: device_id,
      protocol_version: "GT06N",
      ip_address: connection.remoteAddress,
      timestamp: new Date().toISOString()
    });
  });

  device.on("ping", function (data, msg_parts) {
    console.log(`Location data from ${data.device_id || device.getUID()}`);
    
    if (!data.device_id && device.getUID()) {
      data.device_id = device.getUID();
    }
    
    // Send to API
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
      type: 'location'
    });
  });

  device.on("alarm", function (alarm_code, alarm_data, msg_parts) {
    console.log(`Alarm ${alarm_code} from ${alarm_data.device_id || device.getUID()}`);
    
    // Send to API
    sendToAPI(API_ENDPOINTS.ALARM, {
      device_id: alarm_data.device_id || device.getUID(),
      alarm_type: alarm_code,
      alarm_code: alarm_data.alarm_code || alarm_code,
      latitude: alarm_data.latitude,
      longitude: alarm_data.longitude,
      speed: alarm_data.speed || 0,
      device_status: alarm_data.device_status || {},
      raw_data: alarm_data.raw_data || '',
      timestamp: alarm_data.date || new Date().toISOString(),
      timestampDate: alarm_data.timestampDate || new Date(),
      type: 'alarm'
    });
  });

  device.on("heartbeat", function (data, msg_parts) {
    console.log(`Heartbeat from ${data.device_id || device.getUID()}`);
    
    // Send to API
    sendToAPI(API_ENDPOINTS.HEARTBEAT, {
      device_id: data.device_id || device.getUID(),
      online: true,
      timestamp: new Date().toISOString(),
      type: 'heartbeat'
    });
  });

  // Handle raw data for debugging
  connection.on("data", function (data) {
    const hex = Buffer.from(data).toString('hex');
    console.log(`Raw data (${data.length} bytes): ${hex}`);
  });
});

server.on("error", function (err) {
  console.error("Server Error:", err);
});

console.log(`GPS Server listening on port ${options.port}`);
export default server;