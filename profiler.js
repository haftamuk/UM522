const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class DeviceProfiler {
  constructor() {
    this.profiles = new Map();
    this.logDir = path.join(process.cwd(), 'logs');
    this.ensureLogDirectory();
    
    // Enhanced device fingerprint database
    this.deviceFingerprints = {
      // IMEI prefixes by brand
      '86872': { brand: 'Teltonika', family: 'Teltonika' },
      '35865': { brand: 'Queclink', family: 'Queclink' },
      '86494': { brand: 'Suntech', family: 'Suntech' },
      '86108': { brand: 'Concox', family: 'GT06' },
      '86219': { brand: 'Meitrack', family: 'Meitrack' },
      '086872': { brand: 'Teltonika', family: 'Teltonika' },
      '035865': { brand: 'Queclink', family: 'Queclink' },
      '086494': { brand: 'Suntech', family: 'Suntech' },
      '086108': { brand: 'Concox', family: 'GT06' },
      '086219': { brand: 'Meitrack', family: 'Meitrack' },
    };
  }

  ensureLogDirectory() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  analyzeRawData(rawData, deviceId = null) {
    const analysis = {
      timestamp: new Date().toISOString(),
      deviceId,
      rawLength: rawData.length,
      hexPreview: rawData.slice(0, 100).toString('hex'),
      protocols: [],
      brands: [],
      features: {},
      isGT06: false,
      protocolNumber: null
    };

    const hexString = rawData.toString('hex');
    const asciiString = rawData.toString('ascii', 0, Math.min(50, rawData.length));

    // Enhanced GT06 detection
    if (hexString.startsWith('7878') || hexString.startsWith('7979')) {
      analysis.protocols.push('GT06');
      analysis.isGT06 = true;
      
      try {
        // Extract protocol number
        if (hexString.length >= 8) {
          analysis.protocolNumber = hexString.substring(6, 8);
          analysis.protocolVersion = `0x${analysis.protocolNumber}`;
          
          // Map protocol numbers to types
          const protocolMap = {
            '01': 'Login',
            '10': 'GPS Data',
            '11': 'GPS Data',
            '12': 'Location Data',
            '13': 'Heartbeat/Status',
            '16': 'Alarm',
            '17': 'LBS Location',
            '1a': 'Address Query',
            '22': 'GPS + Address',
            '26': 'Alarm + Address'
          };
          
          if (protocolMap[analysis.protocolNumber]) {
            analysis.packetType = protocolMap[analysis.protocolNumber];
          }
        }
        
        // Try to extract IMEI from login packet (protocol 01)
        if (analysis.protocolNumber === '01' && hexString.length >= 24) {
          // Login packet: 7878 0D 01 IMEI(8 bytes) SERIAL CRC STOP
          const imeiHex = hexString.substring(8, 24); // 8 bytes = 16 hex chars
          let imei = '';
          for (let i = 0; i < imeiHex.length; i += 2) {
            const byte = imeiHex.substring(i, i + 2);
            imei += parseInt(byte, 16).toString().padStart(2, '0');
          }
          analysis.extractedIMEI = imei;
          
          if (!deviceId && imei) {
            deviceId = imei;
            analysis.deviceId = imei;
          }
        }
      } catch (error) {
        console.error('Error analyzing GT06 data:', error.message);
      }
    }

    // Check for TK103 protocol
    if (asciiString.includes('imei:') || asciiString.includes('(') && asciiString.includes(')')) {
      analysis.protocols.push('TK103');
      analysis.protocols.push('TKStar');
    }

    // Check for UM552 protocol
    if (asciiString.includes('AT+') || asciiString.includes('UM')) {
      analysis.protocols.push('UM552');
      analysis.protocols.push('Unicore');
    }

    // IMEI-based brand detection
    if (deviceId) {
      const cleanDeviceId = deviceId.toString().replace(/\s/g, '');
      
      for (const [prefix, info] of Object.entries(this.deviceFingerprints)) {
        if (cleanDeviceId.startsWith(prefix)) {
          analysis.brands.push(info.brand);
          analysis.family = info.family;
          analysis.imeiPrefix = prefix;
          Object.assign(analysis.features, info);
          break;
        }
      }
      
      // If no brand detected but it's GT06, assume Concox
      if (analysis.isGT06 && analysis.brands.length === 0) {
        analysis.brands.push('Concox');
        analysis.brands.push('GT06 Family');
        analysis.family = 'GT06';
      }
      
      // Check for specific device patterns in your CRS terminals
      if (cleanDeviceId.startsWith('086872') || cleanDeviceId.startsWith('035865') || cleanDeviceId.startsWith('086494')) {
        analysis.isCRSDevice = true;
      }
    }

    // Remove duplicates
    analysis.protocols = [...new Set(analysis.protocols)];
    analysis.brands = [...new Set(analysis.brands)];

    return analysis;
  }

  updateDeviceProfile(deviceId, analysis, connectionInfo = {}) {
    if (!deviceId) return null;
    
    if (!this.profiles.has(deviceId)) {
      this.profiles.set(deviceId, {
        firstSeen: new Date().toISOString(),
        connections: [],
        packets: [],
        analyses: [],
        suspectedBrands: new Set(),
        detectedProtocols: new Set(),
        features: new Set()
      });
    }

    const profile = this.profiles.get(deviceId);
    
    profile.lastSeen = new Date().toISOString();
    profile.analyses.push(analysis);
    
    if (analysis.protocols.length > 0) {
      analysis.protocols.forEach(p => profile.detectedProtocols.add(p));
    }
    
    if (analysis.brands.length > 0) {
      analysis.brands.forEach(b => profile.suspectedBrands.add(b));
    }
    
    if (connectionInfo.ip) {
      const existingConnection = profile.connections.find(conn => 
        conn.ip === connectionInfo.ip && conn.port === connectionInfo.port
      );
      
      if (!existingConnection) {
        profile.connections.push({
          ip: connectionInfo.ip,
          port: connectionInfo.port,
          timestamp: new Date().toISOString()
        });
      }
    }

    // Log to file
    this.logProfileToFile(deviceId, profile, analysis);
    
    return profile;
  }

  logProfileToFile(deviceId, profile, latestAnalysis) {
    const profileFile = path.join(this.logDir, 'device_profiles.json');
    
    const logEntry = {
      timestamp: new Date().toISOString(),
      deviceId,
      summary: {
        firstSeen: profile.firstSeen,
        lastSeen: profile.lastSeen,
        totalConnections: profile.connections.length,
        uniqueIPs: [...new Set(profile.connections.map(c => c.ip))].length,
        suspectedBrands: Array.from(profile.suspectedBrands),
        protocols: Array.from(profile.detectedProtocols),
        totalPackets: profile.analyses.length
      },
      latestAnalysis: {
        timestamp: latestAnalysis.timestamp,
        protocols: latestAnalysis.protocols,
        brands: latestAnalysis.brands,
        packetType: latestAnalysis.packetType,
        protocolNumber: latestAnalysis.protocolNumber
      }
    };

    let allProfiles = {};
    try {
      if (fs.existsSync(profileFile)) {
        const content = fs.readFileSync(profileFile, 'utf8');
        if (content.trim()) {
          allProfiles = JSON.parse(content);
        }
      }
    } catch (e) {
      console.error('Error reading profiles file:', e.message);
    }

    allProfiles[deviceId] = logEntry;

    try {
      fs.writeFileSync(profileFile, JSON.stringify(allProfiles, null, 2));
    } catch (e) {
      console.error('Error writing profiles file:', e.message);
    }
  }

  logRawMessage(deviceId, rawData, direction = 'incoming', metadata = {}) {
    const timestamp = new Date();
    const dateStr = timestamp.toISOString().split('T')[0];
    const hourStr = timestamp.getHours().toString().padStart(2, '0');
    
    const rawDir = path.join(this.logDir, 'raw', dateStr);
    if (!fs.existsSync(rawDir)) {
      fs.mkdirSync(rawDir, { recursive: true });
    }

    const logFile = path.join(rawDir, `raw_${hourStr}.log`);
    const hexString = rawData.toString('hex');
    const asciiPreview = rawData.toString('ascii', 0, Math.min(50, rawData.length))
      .replace(/[^\x20-\x7E]/g, '.');

    const logEntry = {
      timestamp: timestamp.toISOString(),
      deviceId: deviceId || 'unknown',
      direction,
      length: rawData.length,
      hex: hexString,
      asciiPreview,
      ...metadata
    };

    const logLine = JSON.stringify(logEntry) + '\n';
    
    try {
      fs.appendFileSync(logFile, logLine);
      return logEntry;
    } catch (e) {
      console.error('Error writing raw log:', e.message);
      return null;
    }
  }

  getDeviceSummary() {
    const summary = {
      totalDevices: this.profiles.size,
      devicesByProtocol: {},
      devicesByBrand: {},
      recentlyActive: [],
      crsDevices: []
    };

    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600000);

    for (const [deviceId, profile] of this.profiles) {
      // Count by protocol
      profile.detectedProtocols.forEach(protocol => {
        summary.devicesByProtocol[protocol] = (summary.devicesByProtocol[protocol] || 0) + 1;
      });

      // Count by brand
      profile.suspectedBrands.forEach(brand => {
        summary.devicesByBrand[brand] = (summary.devicesByBrand[brand] || 0) + 1;
      });

      // Recently active
      const lastSeen = new Date(profile.lastSeen);
      if (lastSeen > oneHourAgo) {
        summary.recentlyActive.push({
          deviceId,
          lastSeen: profile.lastSeen,
          protocols: Array.from(profile.detectedProtocols),
          brands: Array.from(profile.suspectedBrands),
          totalPackets: profile.analyses.length
        });
      }

      // Check if it's a CRS device
      if (deviceId.startsWith('086872') || deviceId.startsWith('035865') || deviceId.startsWith('086494')) {
        summary.crsDevices.push({
          deviceId,
          lastSeen: profile.lastSeen,
          totalPackets: profile.analyses.length
        });
      }
    }

    return summary;
  }
}

module.exports = DeviceProfiler;