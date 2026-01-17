import fs from 'fs';
import path from 'path';

class AlarmParser {
  constructor() {
    this.alarmPatterns = {
      // GT06 Protocol Alarms (Standard)
      'GT06': {
        '01': 'SOS Emergency',
        '02': 'Low Battery',
        '03': 'Power Cut',
        '04': 'Shock/Vibration',
        '05': 'Geo-fence In',
        '06': 'Geo-fence Out',
        '07': 'Over Speed',
        '08': 'Over Speed End',
        '09': 'Over Speed Start',
        '0A': 'Enter Sleep Mode',
        '0B': 'Exit Sleep Mode',
        '0C': 'Reserved',
        '0D': 'Door Open',
        '0E': 'Door Close',
        '0F': 'AC On',
        '10': 'AC Off',
        '11': 'Movement Detection',
        '12': 'Enter Area',
        '13': 'Exit Area',
        '14': 'Power On',
        '15': 'Power Off',
        '16': 'GPS First Fix',
        '17': 'GPS Antenna Short',
        '18': 'GPS Antenna Open',
        '19': 'Device Tamper',
        '1A': 'Key Detection',
        '1B': 'External Power Disconnected',
        '1C': 'External Power Connected',
        '1D': 'GPS Jamming Detection',
        '1E': 'Tow Alarm',
        '1F': 'Reserved'
      },

      // TK103/TK303 Alarms
      'TK103': {
        'help me': 'SOS Emergency',
        'low battery': 'Low Battery',
        'power off': 'Power Cut',
        'acc on': 'ACC On',
        'acc off': 'ACC Off',
        'door open': 'Door Open',
        'door close': 'Door Close',
        'overspeed': 'Over Speed',
        'sos': 'SOS Emergency',
        'vibration': 'Shock/Vibration',
        'enter area': 'Geo-fence In',
        'exit area': 'Geo-fence Out'
      },

      // UM552 Alarms
      'UM552': {
        'SOS': 'SOS Emergency',
        'LOWBAT': 'Low Battery',
        'POWER_CUT': 'Power Cut',
        'SHOCK': 'Shock/Vibration',
        'FENCE_IN': 'Geo-fence In',
        'FENCE_OUT': 'Geo-fence Out',
        'OVERSPEED': 'Over Speed',
        'DOOR_OPEN': 'Door Open',
        'DOOR_CLOSE': 'Door Close',
        'ACC_ON': 'ACC On',
        'ACC_OFF': 'ACC Off'
      },

      // Queclink GV series
      'GV': {
        'GTTMP': 'Temperature Alert',
        'GTHBM': 'Heartbeat Missing',
        'GTMPN': 'Moving Notification',
        'GTSTT': 'Status Report',
        'GTPNA': 'Parking Notification',
        'GTPFA': 'Power Failure',
        'GTCRA': 'Crash Detection',
        'GTAIS': 'AI-Shock Detection'
      },

      // Meitrack Alarms
      'Meitrack': {
        'SOS': 'SOS Emergency',
        'LOW_BATTERY': 'Low Battery',
        'POWER_OFF': 'Power Cut',
        'SHOCK': 'Shock/Vibration',
        'OVER_SPEED': 'Over Speed',
        'GEO_FENCE_IN': 'Geo-fence In',
        'GEO_FENCE_OUT': 'Geo-fence Out',
        'ACCIDENT': 'Accident Detection',
        'TAMPER': 'Device Tamper'
      }
    };

    this.brandSpecificParsers = {
      'Concox': this.parseConcoxAlarm.bind(this),
      'TKStar': this.parseTKStarAlarm.bind(this),
      'Unicore': this.parseUnicoreAlarm.bind(this),
      'Teltonika': this.parseTeltonikaAlarm.bind(this),
      'Queclink': this.parseQueclinkAlarm.bind(this),
      'Meitrack': this.parseMeitrackAlarm.bind(this),
      'Suntech': this.parseSuntechAlarm.bind(this)
    };
  }

  detectBrand(hexData, deviceId) {
    const brands = [];
    
    // Check IMEI prefixes
    if (deviceId) {
      if (deviceId.startsWith('86872')) brands.push('Teltonika');
      if (deviceId.startsWith('35865')) brands.push('Queclink');
      if (deviceId.startsWith('86494')) brands.push('Suntech');
      if (deviceId.startsWith('86108')) brands.push('Concox');
      if (deviceId.startsWith('86219')) brands.push('Meitrack');
    }

    // Check protocol patterns
    if (hexData.startsWith('7878') || hexData.startsWith('7979')) {
      brands.push('Concox', 'GT06 Family');
      
      // Check for specific GT06 variants
      const protocol = hexData.substring(6, 8);
      if (protocol === '12' || protocol === '22') {
        brands.push('GT06 Standard');
      } else if (protocol === '16' || protocol === '26') {
        brands.push('GT06 Enhanced');
      } else if (protocol === '1A') {
        brands.push('GT06 Query');
      }
    }

    // Check for TKStar patterns
    const asciiPart = Buffer.from(hexData.substring(0, 100), 'hex').toString('ascii');
    if (asciiPart.includes('imei:') || asciiPart.includes('TK')) {
      brands.push('TKStar');
    }

    // Check for Unicore patterns
    if (asciiPart.includes('AT+') || asciiPart.includes('UM')) {
      brands.push('Unicore');
    }

    return [...new Set(brands)]; // Remove duplicates
  }

  parseConcoxAlarm(hexData, protocolId) {
    const result = {
      protocol: 'GT06',
      protocolId,
      raw: hexData
    };

    try {
      // Extract alarm code based on protocol
      let alarmCode = '00';
      
      if (hexData.length >= 70) {
        // Try various positions for alarm code
        const positions = [54, 56, 58, 60, 68, 70];
        for (const pos of positions) {
          if (hexData.length > pos + 2) {
            const code = hexData.substring(pos, pos + 2);
            if (code !== '00' && code !== 'FF' && code !== '') {
              alarmCode = code;
              break;
            }
          }
        }
      }

      result.alarmCode = alarmCode;
      result.alarmType = this.alarmPatterns.GT06[alarmCode] || `Unknown GT06 Alarm (${alarmCode})`;
      
      // Parse GPS data if present
      if (hexData.length >= 40) {
        result.gpsData = this.extractGT06GPSData(hexData);
      }

    } catch (error) {
      result.error = error.message;
      result.alarmType = 'Parse Error';
    }

    return result;
  }

  parseTKStarAlarm(asciiData) {
    const result = {
      protocol: 'TK103',
      raw: asciiData
    };

    // TK103 alarms are usually in text format
    const lowerData = asciiData.toLowerCase();
    
    for (const [pattern, description] of Object.entries(this.alarmPatterns.TK103)) {
      if (lowerData.includes(pattern)) {
        result.alarmType = description;
        result.pattern = pattern;
        
        // Extract IMEI if present
        const imeiMatch = asciiData.match(/imei:(\d+)/i);
        if (imeiMatch) result.deviceId = imeiMatch[1];
        
        break;
      }
    }

    if (!result.alarmType) {
      result.alarmType = 'TK103 Status Report';
    }

    return result;
  }

  parseUnicoreAlarm(asciiData) {
    const result = {
      protocol: 'UM552',
      raw: asciiData
    };

    // UM552 uses AT commands
    if (asciiData.includes('SOS')) {
      result.alarmType = 'SOS Emergency';
    } else if (asciiData.includes('LOWBAT')) {
      result.alarmType = 'Low Battery';
    } else if (asciiData.includes('SHOCK')) {
      result.alarmType = 'Shock/Vibration';
    } else if (asciiData.includes('OVERSPEED')) {
      result.alarmType = 'Over Speed';
    } else {
      result.alarmType = 'UM552 Status Report';
    }

    return result;
  }

  extractGT06GPSData(hexData) {
    try {
      // Extract date/time (6 bytes)
      const dateHex = hexData.substring(8, 20);
      const year = parseInt(dateHex.substring(0, 2), 16) + 2000;
      const month = parseInt(dateHex.substring(2, 4), 16);
      const day = parseInt(dateHex.substring(4, 6), 16);
      const hour = parseInt(dateHex.substring(6, 8), 16);
      const minute = parseInt(dateHex.substring(8, 10), 16);
      const second = parseInt(dateHex.substring(10, 12), 16);

      // Extract latitude (4 bytes)
      const latHex = hexData.substring(20, 28);
      const latitude = latHex !== '00000000' ? parseInt(latHex, 16) / 1800000 : 0;

      // Extract longitude (4 bytes)
      const lngHex = hexData.substring(28, 36);
      const longitude = lngHex !== '00000000' ? parseInt(lngHex, 16) / 1800000 : 0;

      // Extract speed (1 byte)
      const speedHex = hexData.substring(36, 38);
      const speed = parseInt(speedHex, 16);

      return {
        timestamp: `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')} ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:${second.toString().padStart(2, '0')}`,
        latitude,
        longitude,
        speed
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  parseAlarm(data, deviceId = null) {
    let result = {
      timestamp: new Date().toISOString(),
      deviceId,
      detectedBrands: [],
      protocol: 'unknown'
    };

    // Determine data type (hex or ascii)
    let hexData, asciiData;
    
    if (Buffer.isBuffer(data)) {
      hexData = data.toString('hex');
      asciiData = data.toString('ascii', 0, Math.min(100, data.length));
    } else if (typeof data === 'string') {
      // Check if it's hex string
      if (/^[0-9a-fA-F]+$/.test(data)) {
        hexData = data;
        asciiData = Buffer.from(data, 'hex').toString('ascii', 0, Math.min(100, data.length));
      } else {
        asciiData = data;
        hexData = Buffer.from(data).toString('hex');
      }
    } else {
      return { ...result, error: 'Invalid data type' };
    }

    // Detect brand
    result.detectedBrands = this.detectBrand(hexData, deviceId);

    // Determine protocol and parse accordingly
    if (hexData.startsWith('7878') || hexData.startsWith('7979')) {
      result.protocol = 'GT06';
      const protocolId = hexData.substring(6, 8);
      
      // Use Concox parser for GT06
      const concoxResult = this.parseConcoxAlarm(hexData, protocolId);
      result = { ...result, ...concoxResult };
      
    } else if (asciiData.includes('imei:') || asciiData.includes('TK')) {
      result.protocol = 'TK103';
      const tkResult = this.parseTKStarAlarm(asciiData);
      result = { ...result, ...tkResult };
      
    } else if (asciiData.includes('AT+') || asciiData.includes('UM')) {
      result.protocol = 'UM552';
      const umResult = this.parseUnicoreAlarm(asciiData);
      result = { ...result, ...umResult };
      
    } else {
      // Try to parse as generic hex alarm
      result.alarmType = this.parseGenericHexAlarm(hexData);
    }

    // Log for analysis
    this.logAlarmForAnalysis(result);

    return result;
  }

  parseGenericHexAlarm(hexData) {
    // Try to extract alarm code from common positions
    if (hexData.length >= 4) {
      // Check first few bytes for patterns
      const firstByte = hexData.substring(0, 2);
      const secondByte = hexData.substring(2, 4);
      
      if (firstByte === '01') return 'SOS Emergency';
      if (firstByte === '02') return 'Low Battery';
      if (firstByte === '03') return 'Power Cut';
      if (firstByte === '04') return 'Shock/Vibration';
    }
    
    return `Unknown Alarm Pattern (${hexData.substring(0, 20)}...)`;
  }

  logAlarmForAnalysis(alarmData) {
    const logDir = path.join(process.cwd(), 'logs', 'alarms');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const date = new Date();
    const dateStr = date.toISOString().split('T')[0];
    const logFile = path.join(logDir, `alarms_${dateStr}.json`);

    const logEntry = {
      timestamp: date.toISOString(),
      ...alarmData
    };

    try {
      let existing = [];
      if (fs.existsSync(logFile)) {
        const content = fs.readFileSync(logFile, 'utf8');
        if (content.trim()) {
          existing = JSON.parse(`[${content.replace(/\n/g, ',').slice(0, -1)}]`);
        }
      }
      
      existing.push(logEntry);
      fs.writeFileSync(logFile, JSON.stringify(existing, null, 2));
    } catch (error) {
      console.error('Error logging alarm:', error.message);
    }
  }

  getAlarmStatistics() {
    const logDir = path.join(process.cwd(), 'logs', 'alarms');
    if (!fs.existsSync(logDir)) return {};

    const files = fs.readdirSync(logDir).filter(f => f.startsWith('alarms_'));
    const stats = {
      totalAlarms: 0,
      byProtocol: {},
      byBrand: {},
      byType: {},
      recentAlarms: []
    };

    files.slice(-7).forEach(file => { // Last 7 days
      try {
        const content = fs.readFileSync(path.join(logDir, file), 'utf8');
        const alarms = JSON.parse(content);
        
        alarms.forEach(alarm => {
          stats.totalAlarms++;
          
          // Count by protocol
          stats.byProtocol[alarm.protocol] = (stats.byProtocol[alarm.protocol] || 0) + 1;
          
          // Count by brand
          if (alarm.detectedBrands && alarm.detectedBrands.length > 0) {
            alarm.detectedBrands.forEach(brand => {
              stats.byBrand[brand] = (stats.byBrand[brand] || 0) + 1;
            });
          }
          
          // Count by type
          stats.byType[alarm.alarmType] = (stats.byType[alarm.alarmType] || 0) + 1;
          
          // Recent alarms (last 24 hours)
          const alarmTime = new Date(alarm.timestamp);
          const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
          if (alarmTime > dayAgo) {
            stats.recentAlarms.push({
              deviceId: alarm.deviceId,
              alarmType: alarm.alarmType,
              protocol: alarm.protocol,
              timestamp: alarm.timestamp
            });
          }
        });
      } catch (error) {
        console.error(`Error reading alarm file ${file}:`, error.message);
      }
    });

    return stats;
  }
}

export default AlarmParser;