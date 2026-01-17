const fs = require('fs');
const path = require('path');

class AlarmParser {
  constructor() {
    this.alarmPatterns = {
      // GT06 Protocol Alarms
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
        '0D': 'Door Open',
        '0E': 'Door Close',
        '0F': 'AC On',
        '10': 'AC Off',
        '11': 'Movement Detection',
        '12': 'Enter Area',
        '13': 'Exit Area',
        '14': 'Power On',
        '15': 'Power Off',
        '16': 'GPS First Fix'
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
        'sos': 'SOS Emergency'
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
        'DOOR_CLOSE': 'Door Close'
      }
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

    return [...new Set(brands)];
  }

  parseAlarm(data, deviceId = null) {
    let result = {
      timestamp: new Date().toISOString(),
      deviceId,
      detectedBrands: [],
      protocol: 'unknown'
    };

    // Determine data type
    let hexData, asciiData;
    
    if (Buffer.isBuffer(data)) {
      hexData = data.toString('hex');
      asciiData = data.toString('ascii', 0, Math.min(100, data.length));
    } else if (typeof data === 'string') {
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
      
      // Extract alarm code
      let alarmCode = '01';
      if (hexData.length >= 70) {
        alarmCode = hexData.substring(68, 70) || '01';
      }
      
      result.alarmCode = alarmCode;
      result.alarmType = this.alarmPatterns.GT06[alarmCode] || `Unknown GT06 Alarm (${alarmCode})`;
      
    } else if (asciiData.includes('imei:') || asciiData.includes('TK')) {
      result.protocol = 'TK103';
      
      // Find alarm type in text
      const lowerData = asciiData.toLowerCase();
      for (const [pattern, description] of Object.entries(this.alarmPatterns.TK103)) {
        if (lowerData.includes(pattern)) {
          result.alarmType = description;
          break;
        }
      }
      
      if (!result.alarmType) {
        result.alarmType = 'TK103 Status Report';
      }
      
    } else if (asciiData.includes('AT+') || asciiData.includes('UM')) {
      result.protocol = 'UM552';
      
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
    } else {
      result.alarmType = `Unknown Protocol (${hexData.substring(0, 20)}...)`;
    }

    // Log for analysis
    this.logAlarmForAnalysis(result);

    return result;
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
      byType: {}
    };

    files.slice(-7).forEach(file => {
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
        });
      } catch (error) {
        console.error(`Error reading alarm file ${file}:`, error.message);
      }
    });

    return stats;
  }
}

module.exports = AlarmParser;