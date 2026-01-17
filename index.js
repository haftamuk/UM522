import net from "net";
import { createRequire } from "module";
import 'dotenv/config';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const gpsTracking = require("gps-tracking");
const gps = gpsTracking;

// Import enhanced adapter
const enhancedAdapter = require('./enhanced-gt06.js');
if (!gps.server.availableAdapters) {
  gps.server.availableAdapters = {};
}
gps.server.availableAdapters.GT06_PLUS = enhancedAdapter;

// Import profiler and parser
import DeviceProfiler from './profiler.js';
import AlarmParser from './alarm-parser.js';

// Initialize profiler and parser
const profiler = new DeviceProfiler();
const alarmParser = new AlarmParser();

// API endpoints (keep existing)
const MOOVE_SERVER_BASE_URL = process.env.MOOVE_SERVER_BASE_URL;
const API_ENDPOINTS = {
  LOCATION: `${MOOVE_SERVER_BASE_URL}/api/gps/location`,
  ALARM: `${MOOVE_SERVER_BASE_URL}/api/gps/alarm`,
  STATUS: `${MOOVE_SERVER_BASE_URL}/api/gps/status`,
  HEARTBEAT: `${MOOVE_SERVER_BASE_URL}/api/gps/heartbeat`,
  LOGIN: `${MOOVE_SERVER_BASE_URL}/api/gps/login`
};

console.log(`Starting Enhanced GPS Server...`);
console.log(`Device Profiling: ENABLED`);
console.log(`Raw Logging: ENABLED`);

// Server configuration
const options = {
  debug: true,
  port: process.env.GPS_SERVER_PORT || 6006,
  device_adapter: "GT06_PLUS", // Use enhanced adapter
  maxConnections: 1000,
  connectionTimeout: 30000,
  keepAlive: true,
};

// Create GPS server
const server = gps.server(options, function (device, connection) {
  console.log(`New connection from ${connection.remoteAddress}:${connection.remotePort}`);
  
  let deviceId = null;
  let connectionStartTime = Date.now();
  let packetsReceived = 0;
  let brandInfo = null;

  // Get adapter instance for statistics
  const adapterInstance = device.adapter;

  // Device event handlers
  device.on("login_request", function (device_id, msg_parts) {
    packetsReceived++;
    deviceId = device_id;
    brandInfo = msg_parts.analysis?.brands || [];
    
    console.log(`═══════════════════════════════════════════════════════════`);
    console.log(`📱 DEVICE LOGIN: ${device_id}`);
    console.log(`📍 IP: ${connection.remoteAddress}`);
    console.log(`🏷️  Detected Brands: ${brandInfo.join(', ')}`);
    console.log(`📊 Protocols: ${msg_parts.analysis?.protocols?.join(', ') || 'Unknown'}`);
    console.log(`═══════════════════════════════════════════════════════════`);
    
    this.login_authorized(true);
    
    // Enhanced login data with profiling
    sendToAPI(API_ENDPOINTS.LOGIN, {
      device_id: device_id,
      imei: device_id,
      protocol_version: "GT06+",
      ip_address: connection.remoteAddress,
      timestamp: new Date().toISOString(),
      brand_info: brandInfo,
      protocol_info: msg_parts.analysis?.protocols,
      device_features: msg_parts.analysis?.features,
      raw_preview: msg_parts.raw?.substring(0, 50)
    }, `Login for ${device_id}`).catch(() => { /* Ignore errors */ });
  });

  device.on("ping", function (data, msg_parts) {
    packetsReceived++;
    if (!data.device_id) {
      console.log('No device_id in location data');
      return;
    }
    
    deviceId = data.device_id;
    
    // Enhanced location data with profiling
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
      brand_info: brandInfo,
      analysis: msg_parts.analysis
    }, `Location for ${data.device_id}`).catch(() => { /* Ignore errors */ });
  });

  device.on("alarm", function (alarm_code, alarm_data, msg_parts) {
    packetsReceived++;
    if (!alarm_data.device_id) {
      console.log('No device_id in alarm data');
      return;
    }
    
    deviceId = alarm_data.device_id;
    
    console.log(`🚨 ALARM DETECTED:`);
    console.log(`   Device: ${alarm_data.device_id}`);
    console.log(`   Type: ${alarm_data.alarm_type}`);
    console.log(`   Code: ${alarm_code}`);
    console.log(`   Protocol: ${msg_parts.protocol_id}`);
    console.log(`   Brands: ${brandInfo?.join(', ') || 'Unknown'}`);
    
    // Enhanced alarm data with parsed details
    const enhancedAlarm = {
      device_id: alarm_data.device_id,
      alarm_type: alarm_data.alarm_type,
      alarm_code: alarm_data.alarm_code || alarm_code,
      alarm_description: alarm_data.msg || alarm_data.alarm_type,
      latitude: alarm_data.latitude,
      longitude: alarm_data.longitude,
      speed: alarm_data.speed || 0,
      device_status: alarm_data.device_status || {},
      parsed_details: alarm_data.parsed_details || {},
      raw_data: alarm_data.raw_data || '',
      timestamp: alarm_data.date || new Date().toISOString(),
      timestampDate: alarm_data.timestampDate || new Date(),
      type: 'alarm',
      protocol: msg_parts.protocol_id,
      brand_info: brandInfo,
      analysis: msg_parts.analysis
    };
    
    sendToAPI(API_ENDPOINTS.ALARM, enhancedAlarm, `Alarm for ${alarm_data.device_id}`).catch(() => { /* Ignore errors */ });
  });

  // Periodic statistics logging
  setInterval(() => {
    if (adapterInstance && adapterInstance.getStatistics) {
      const stats = adapterInstance.getStatistics();
      console.log(`\n📊 SERVER STATISTICS:`);
      console.log(`   Total Devices: ${stats.device_profiles.totalDevices}`);
      console.log(`   Active Devices: ${stats.device_profiles.recentlyActive.length}`);
      console.log(`   Total Alarms: ${stats.alarm_statistics.totalAlarms || 0}`);
      console.log(`   By Protocol: ${JSON.stringify(stats.alarm_statistics.byProtocol)}`);
      console.log(`   By Brand: ${JSON.stringify(stats.alarm_statistics.byBrand)}`);
    }
  }, 300000); // Every 5 minutes

  // Connection cleanup
  connection.on('close', () => {
    const duration = Math.round((Date.now() - connectionStartTime) / 1000);
    console.log(`Connection closed for ${deviceId || 'unknown device'} (Duration: ${duration}s, Packets: ${packetsReceived})`);
  });
});

// Admin endpoints for monitoring
import express from 'express';
const adminApp = express();
adminApp.use(express.json());

// Admin API endpoints
adminApp.get('/admin/devices', (req, res) => {
  const deviceStats = profiler.getDeviceSummary();
  res.json(deviceStats);
});

adminApp.get('/admin/alarms', (req, res) => {
  const alarmStats = alarmParser.getAlarmStatistics();
  res.json(alarmStats);
});

adminApp.get('/admin/logs/raw/:date?', (req, res) => {
  const date = req.params.date || new Date().toISOString().split('T')[0];
  const logDir = path.join(process.cwd(), 'logs', 'raw', date);
  
  if (!fs.existsSync(logDir)) {
    return res.json({ date, logs: [] });
  }
  
  const files = fs.readdirSync(logDir);
  const logs = [];
  
  files.forEach(file => {
    const filePath = path.join(logDir, file);
    const content = fs.readFileSync(filePath, 'utf8');
    content.split('\n').forEach(line => {
      if (line.trim()) {
        try {
          logs.push(JSON.parse(line));
        } catch (e) {}
      }
    });
  });
  
  res.json({ date, count: logs.length, logs: logs.slice(-100) }); // Last 100 entries
});

adminApp.get('/admin/profiles', (req, res) => {
  const profileFile = path.join(process.cwd(), 'logs', 'device_profiles.json');
  if (!fs.existsSync(profileFile)) {
    return res.json({ profiles: {} });
  }
  
  const profiles = JSON.parse(fs.readFileSync(profileFile, 'utf8'));
  res.json({ count: Object.keys(profiles).length, profiles });
});

// Start admin server
const ADMIN_PORT = process.env.ADMIN_PORT || 6060;
adminApp.listen(ADMIN_PORT, () => {
  console.log(`📊 Admin interface available at http://localhost:${ADMIN_PORT}/admin`);
});

// Export server
export default server;