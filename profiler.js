const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class DeviceProfiler {
  constructor() {
    this.profiles = new Map();
    this.logDir = path.join(process.cwd(), 'logs');
    this.ensureLogDirectory();
    
    // Device fingerprint database
    this.deviceFingerprints = {
      // GT06 Variants
      '7878': { protocol: 'GT06', brand: 'Concox', family: 'GT06' },
      '7979': { protocol: 'GT06', brand: 'Unknown', family: 'GT06' },
      
      // TK103/303 variants
      '(0)': { protocol: 'TK103', brand: 'TKStar', family: 'TK10x' },
      '(1)': { protocol: 'TK103', brand: 'TKStar', family: 'TK10x' },
      
      // UM552/UM series
      'AT+': { protocol: 'UM552', brand: 'Unicore', family: 'UM' },
      'STX': { protocol: 'UM552', brand: 'Unicore', family: 'UM' },
      
      // IMEI prefixes
      '86872': { brand: 'Teltonika', country: 'China' },
      '35865': { brand: 'Queclink', country: 'China' },
      '86494': { brand: 'Suntech', country: 'China' },
      '86108': { brand: 'Concox', country: 'China' },
      '86219': { brand: 'Meitrack', country: 'China' }
    };
  }

  ensureLogDirectory() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  generateDeviceFingerprint(data) {
    const hash = crypto.createHash('md5');
    hash.update(data);
    return hash.digest('hex');
  }

  analyzeRawData(rawData, deviceId = null) {
    const analysis = {
      timestamp: new Date().toISOString(),
      deviceId,
      rawLength: rawData.length,
      hexPreview: rawData.slice(0, 100).toString('hex'),
      protocols: [],
      brands: [],
      features: {}
    };

    // Protocol detection
    const hexString = rawData.toString('hex');
    const asciiString = rawData.toString('ascii', 0, Math.min(50, rawData.length));

    // Check for GT06 protocol
    if (hexString.startsWith('7878') || hexString.startsWith('7979')) {
      analysis.protocols.push('GT06');
      analysis.protocolVersion = hexString.substring(6, 8);
    }

    // Check for TK103 protocol
    if (asciiString.includes('(') && asciiString.includes(')')) {
      analysis.protocols.push('TK103');
      if (asciiString.includes('imei:')) analysis.brands.push('TKStar');
    }

    // Check for UM552 protocol
    if (asciiString.startsWith('AT+') || asciiString.includes('STX')) {
      analysis.protocols.push('UM552');
      analysis.brands.push('Unicore');
    }

    // IMEI-based brand detection
    if (deviceId) {
      for (const [prefix, info] of Object.entries(this.deviceFingerprints)) {
        if (deviceId.startsWith(prefix)) {
          analysis.brands.push(info.brand);
          analysis.imeiPrefix = prefix;
          Object.assign(analysis.features, info);
          break;
        }
      }
    }

    return analysis;
  }

  updateDeviceProfile(deviceId, analysis, connectionInfo = {}) {
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
      profile.connections.push({
        ip: connectionInfo.ip,
        port: connectionInfo.port,
        timestamp: new Date().toISOString()
      });
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
        suspectedBrands: Array.from(profile.suspectedBrands),
        protocols: Array.from(profile.detectedProtocols),
        uniqueFeatures: Array.from(profile.features)
      },
      latestAnalysis
    };

    // Read existing profiles
    let allProfiles = {};
    try {
      if (fs.existsSync(profileFile)) {
        allProfiles = JSON.parse(fs.readFileSync(profileFile, 'utf8'));
      }
    } catch (e) {
      console.error('Error reading profiles file:', e.message);
    }

    // Update this device's profile
    allProfiles[deviceId] = logEntry;

    // Write back
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
    
    // Create directory structure
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
    } catch (e) {
      console.error('Error writing raw log:', e.message);
    }

    return logEntry;
  }

  getDeviceSummary() {
    const summary = {
      totalDevices: this.profiles.size,
      devicesByProtocol: {},
      devicesByBrand: {},
      recentlyActive: []
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
          brands: Array.from(profile.suspectedBrands)
        });
      }
    }

    return summary;
  }
}

module.exports = DeviceProfiler;