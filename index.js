const net = require("net");
const gps = require("gps-tracking");
require('dotenv/config');


// API Endpoints
const MOOVE_SERVER_BASE_URL = process.env.MOOVE_SERVER_BASE_URL;
const API_ENDPOINTS = {
  LOCATION: `${MOOVE_SERVER_BASE_URL}/api/gps/location`,
  ALARM: `${MOOVE_SERVER_BASE_URL}/api/gps/alarm`,
  STATUS: `${MOOVE_SERVER_BASE_URL}/api/gps/status`,
  HEARTBEAT: `${MOOVE_SERVER_BASE_URL}/api/gps/heartbeat`,
  LOGIN: `${MOOVE_SERVER_BASE_URL}/api/gps/login`,
  LBS_LOCATION: `${MOOVE_SERVER_BASE_URL}/api/gps/lbs`,
  STRING_INFO: `${MOOVE_SERVER_BASE_URL}/api/gps/string`,
  COMMAND_RESPONSE: `${MOOVE_SERVER_BASE_URL}/api/gps/command-response`
};

// CRS Server Configuration
const CRS_SERVER = process.env.CRS_SERVER;
const CRS_SERVER_PORT = process.env.CRS_SERVER_PORT || 20859;

console.log(`Moove Server Base URL: ${MOOVE_SERVER_BASE_URL}`);
console.log(`CRS Server: ${CRS_SERVER}:${CRS_SERVER_PORT}`);

// Configuration
var options = {
  debug: true,
  port: process.env.GPS_SERVER_PORT || 6006,
  device_adapter: "GT06N",
};

// Terminal configurations
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
const terminalConfigs = {};

// Create GPS server
var server = gps.server(options, function (device, connection) {
  let crsClient = null;
  let isCRSDevice = false;
  const deviceIMEI = null;

  // Initialize CRS connection if needed
  function initCRSConnection() {
    if (!CRS_SERVER || crsClient) return;
    
    crsClient = new net.Socket();
    
    crsClient.connect(CRS_SERVER_PORT, CRS_SERVER, function () {
      console.log("=".repeat(75));
      console.log("CRS Server Connected");
      console.log("=".repeat(75));
    });

    crsClient.on("error", (err) => {
      console.error("CRS Connection Error:", err.message);
      crsClient = null;
    });

    crsClient.on("close", () => {
      console.log("CRS Connection Closed");
      crsClient = null;
    });
  }

  // Helper function to send data to Moove API
  async function sendToMooveAPI(endpoint, data) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-GPS-Protocol": "GT06N"
        },
        body: JSON.stringify({
          device_id: device.getUID(),
          timestamp: new Date().toISOString(),
          ...data
        })
      });
      
      if (!response.ok) {
        console.error(`API Error (${endpoint}):`, response.statusText);
      }
      
      return await response.json();
    } catch (error) {
      console.error(`Failed to send data to ${endpoint}:`, error.message);
    }
  }

  // Helper function to proxy data to CRS server
  function proxyToCRS(data) {
    if (!crsClient || !isCRSDevice) return;
    
    try {
      const hexData = bufferToHexString(data);
      console.log("Proxying to CRS:", hexData.substring(0, 50) + "...");
      crsClient.write(data);
    } catch (error) {
      console.error("CRS Proxy Error:", error.message);
    }
  }

  function bufferToHexString(buffer) {
    return Array.from(buffer)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // Device Event Handlers
  device.on("connected", function () {
    console.log("Device Connected - IP:", connection.remoteAddress);
    initCRSConnection();
  });

  device.on("disconnected", function () {
    console.log("Device Disconnected:", device.getUID());
    if (crsClient) {
      crsClient.destroy();
    }
  });

  device.on("login_request", function (device_id, msg_parts) {
    this.login_authorized(true);
    console.log("Device Login:", device_id);
    
    // Check if this is a CRS device
    isCRSDevice = crsTerminals.includes(device_id);
    
    // Send login event to Moove
    sendToMooveAPI(API_ENDPOINTS.LOGIN, {
      imei: device_id,
      terminal_info: msg_parts.terminal_info,
      protocol_version: "GT06N"
    });
  });

  device.on("location", function (locationData, msg_parts) {
    console.log("Location Data:", {
      device: locationData.device_id,
      lat: locationData.latitude,
      lng: locationData.longitude,
      speed: locationData.speed,
      satellites: locationData.satellites
    });

    // Send to Moove API
    sendToMooveAPI(API_ENDPOINTS.LOCATION, {
      type: "location",
      latitude: locationData.latitude,
      longitude: locationData.longitude,
      speed: locationData.speed,
      course: locationData.course,
      satellites: locationData.satellites,
      accuracy: locationData.gps_status === '1' ? 'low' : 'high',
      altitude: 0, // GT06N doesn't provide altitude
      device_status: {
        power: locationData.power_status,
        charging: locationData.charge_status,
        acc: locationData.acc_status,
        armed: locationData.armed_status
      },
      raw_data: locationData.raw_data
    });

    // Proxy to CRS if applicable
    proxyToCRS(Buffer.from(msg_parts.raw, 'hex'));
  });

  device.on("alarm", function (alarm_type, alarmData, msg_parts) {
    console.log("Alarm Received:", {
      device: alarmData.device_id,
      type: alarm_type,
      location: `${alarmData.latitude}, ${alarmData.longitude}`
    });

    // Send to Moove API
    sendToMooveAPI(API_ENDPOINTS.ALARM, {
      type: "alarm",
      alarm_type: alarm_type,
      alarm_code: alarmData.alarm_type,
      latitude: alarmData.latitude,
      longitude: alarmData.longitude,
      speed: alarmData.speed,
      device_status: {
        power: alarmData.power_status,
        charging: alarmData.charge_status,
        acc: alarmData.acc_status,
        armed: alarmData.armed_status
      },
      raw_data: alarmData.raw_data
    });

    // Proxy to CRS
    proxyToCRS(Buffer.from(msg_parts.raw, 'hex'));
  });

  device.on("heartbeat", function (heartbeatData, msg_parts) {
    console.log("Heartbeat from:", heartbeatData.device_id);

    sendToMooveAPI(API_ENDPOINTS.HEARTBEAT, {
      type: "heartbeat",
      online: true,
      timestamp: heartbeatData.timestamp
    });

    proxyToCRS(Buffer.from(msg_parts.raw, 'hex'));
  });

  device.on("status", function (statusData, msg_parts) {
    console.log("Status Update:", {
      device: statusData.device_id,
      voltage: statusData.voltage_level,
      gsm_signal: statusData.gsm_signal
    });

    sendToMooveAPI(API_ENDPOINTS.STATUS, {
      type: "status",
      voltage: statusData.voltage_level,
      gsm_signal: statusData.gsm_signal,
      alarm_zone: statusData.alarm_zone,
      raw_data: statusData.raw_data
    });

    proxyToCRS(Buffer.from(msg_parts.raw, 'hex'));
  });

  device.on("lbs_location", function (lbsData, msg_parts) {
    console.log("LBS Location:", lbsData.device_id);

    sendToMooveAPI(API_ENDPOINTS.LBS_LOCATION, {
      type: "lbs_location",
      raw_data: lbsData.raw_data
    });

    proxyToCRS(Buffer.from(msg_parts.raw, 'hex'));
  });

  device.on("string_info", function (stringData, msg_parts) {
    console.log("String Info:", stringData.device_id);

    sendToMooveAPI(API_ENDPOINTS.STRING_INFO, {
      type: "string_info",
      data: stringData.data
    });

    proxyToCRS(Buffer.from(msg_parts.raw, 'hex'));
  });

  device.on("command_response", function (responseData, msg_parts) {
    console.log("Command Response:", responseData.device_id);

    sendToMooveAPI(API_ENDPOINTS.COMMAND_RESPONSE, {
      type: "command_response",
      response: responseData.response
    });

    proxyToCRS(Buffer.from(msg_parts.raw, 'hex'));
  });

  // Handle raw connection data for logging
  connection.on("data", function (data) {
    const hexData = bufferToHexString(data);
    console.log("=".repeat(75));
    console.log("Raw Data (", data.length, "bytes):", hexData.substring(0, 100));
    
    // Log based on protocol
    if (hexData.startsWith('7878') || hexData.startsWith('7979')) {
      const protocol = hexData.substr(6, 2);
      console.log("Protocol ID:", protocol);
    }
    console.log("=".repeat(75));
  });

  // Handle commands from Moove API (optional)
  connection.on("command", function (command) {
    console.log("Received command:", command);
    // Implement command handling if needed
  });
});

// Handle server errors
server.on("error", function (err) {
  console.error("Server Error:", err);
});

console.log(`GPS Server listening on port ${options.port}`);