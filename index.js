import net from "net";
import { createRequire } from "module";
import 'dotenv/config';

const require = createRequire(import.meta.url);
const gpsTracking = require("gps-tracking");
const gps = gpsTracking;

// Import custom adapter
const customAdapter = require('./adapters/gt06n.js');
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

// Server configuration
const options = {
  debug: true,
  port: process.env.GPS_SERVER_PORT || 6006,
  device_adapter: "GT06N",
};

// Queue for API requests to prevent overload
class RequestQueue {
  constructor(maxConcurrent = 5) {
    this.queue = [];
    this.active = 0;
    this.maxConcurrent = maxConcurrent;
  }

  async add(requestFn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ requestFn, resolve, reject });
      this.process();
    });
  }

  async process() {
    if (this.active >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    this.active++;
    const { requestFn, resolve, reject } = this.queue.shift();

    try {
      const result = await requestFn();
      resolve(result);
    } catch (error) {
      reject(error);
    } finally {
      this.active--;
      this.process();
    }
  }
}

const requestQueue = new RequestQueue(3); // Max 3 concurrent requests

// Create GPS server
const server = gps.server(options, function (device, connection) {
  console.log(`New connection from ${connection.remoteAddress}:${connection.remotePort}`);
  
  // Helper function with queue
  async function sendToAPI(endpoint, data) {
    return requestQueue.add(async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
        
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          const errorText = await response.text();
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
    });
  }

  // Device event handlers
  device.on("login_request", function (device_id, msg_parts) {
    console.log(`Login from ${device_id}`);
    this.login_authorized(true);
    
    sendToAPI(API_ENDPOINTS.LOGIN, {
      device_id: device_id,
      imei: device_id,
      protocol_version: "GT06N",
      ip_address: connection.remoteAddress,
      timestamp: new Date().toISOString()
    }).catch(() => { /* Ignore errors */ });
  });

  device.on("ping", function (data, msg_parts) {
    if (!data.device_id) {
      console.log('No device_id in location data');
      return;
    }
    
    console.log(`Location from ${data.device_id}`);
    
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
    }).catch(() => { /* Ignore errors */ });
  });

  device.on("alarm", function (alarm_code, alarm_data, msg_parts) {
    if (!alarm_data.device_id) {
      console.log('No device_id in alarm data');
      return;
    }
    
    console.log(`Alarm ${alarm_code} from ${alarm_data.device_id}`);
    
    sendToAPI(API_ENDPOINTS.ALARM, {
      device_id: alarm_data.device_id,
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
    }).catch(() => { /* Ignore errors */ });
  });

  device.on("heartbeat", function (data, msg_parts) {
    const deviceId = data.device_id || device.getUID();
    if (!deviceId) return;
    
    console.log(`Heartbeat from ${deviceId}`);
    
    sendToAPI(API_ENDPOINTS.HEARTBEAT, {
      device_id: deviceId,
      online: true,
      timestamp: new Date().toISOString(),
      type: 'heartbeat'
    }).catch(() => { /* Ignore errors */ });
  });
});

server.on("error", function (err) {
  console.error("Server Error:", err);
});

console.log(`GPS Server listening on port ${options.port}`);
export default server;