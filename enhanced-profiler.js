const fs = require('fs');
const path = require('path');

class EnhancedProfiler {
  constructor() {
    this.brandDatabase = {
      // Teltonika devices (086872...)
      '086872': { brand: 'Teltonika', family: 'Teltonika GT06', features: ['GPS', 'GPRS', 'CRS'] },
      '86872': { brand: 'Teltonika', family: 'Teltonika GT06', features: ['GPS', 'GPRS'] },
      
      // Queclink devices (035865...)
      '035865': { brand: 'Queclink', family: 'Queclink GT06', features: ['GPS', 'GPRS', 'CRS'] },
      '35865': { brand: 'Queclink', family: 'Queclink GT06', features: ['GPS', 'GPRS'] },
      
      // Suntech devices (086494...)
      '086494': { brand: 'Suntech', family: 'Suntech GT06', features: ['GPS', 'GPRS', 'CRS'] },
      '86494': { brand: 'Suntech', family: 'Suntech GT06', features: ['GPS', 'GPRS'] },
      
      // Concox devices (086108...)
      '086108': { brand: 'Concox', family: 'Concox GT06', features: ['GPS', 'GPRS'] },
      '86108': { brand: 'Concox', family: 'Concox GT06', features: ['GPS', 'GPRS'] },
      
      // Meitrack devices (086219...)
      '086219': { brand: 'Meitrack', family: 'Meitrack GT06', features: ['GPS', 'GPRS'] },
      '86219': { brand: 'Meitrack', family: 'Meitrack GT06', features: ['GPS', 'GPRS'] }
    };
    
    this.protocolMap = {
      '01': { name: 'Login', type: 'authentication' },
      '10': { name: 'GPS Data', type: 'location' },
      '11': { name: 'GPS Data', type: 'location' },
      '12': { name: 'Location Data', type: 'location' },
      '13': { name: 'Heartbeat', type: 'status' },
      '16': { name: 'Alarm', type: 'alarm' },
      '17': { name: 'LBS Location', type: 'location' },
      '1a': { name: 'Address Query', type: 'query' },
      '22': { name: 'GPS + Address', type: 'location' },
      '26': { name: 'Alarm + Address', type: 'alarm' }
    };
  }

  analyzePacket(hexData, deviceId = null) {
    const analysis = {
      timestamp: new Date().toISOString(),
      deviceId: deviceId,
      rawPreview: hexData.substring(0, 50),
      isGT06: hexData.startsWith('7878') || hexData.startsWith('7979'),
      protocol: 'unknown',
      packetType: 'unknown',
      brands: [],
      features: [],
      confidence: 0
    };

    try {
      // Extract protocol number
      if (hexData.length >= 8) {
        const protocolHex = hexData.substring(6, 8);
        analysis.protocol = protocolHex;
        
        // Map protocol to packet type
        if (this.protocolMap[protocolHex]) {
          analysis.packetType = this.protocolMap[protocolHex].name;
          analysis.confidence += 30;
        }
      }

      // Brand detection from deviceId
      if (deviceId) {
        const cleanId = deviceId.toString().replace(/\s/g, '');
        
        // Check for exact matches in brand database
        for (const prefix of Object.keys(this.brandDatabase)) {
          if (cleanId.startsWith(prefix)) {
            const brandInfo = this.brandDatabase[prefix];
            analysis.brands.push(brandInfo.brand);
            analysis.brands.push(brandInfo.family);
            analysis.features = [...analysis.features, ...brandInfo.features];
            analysis.confidence += 40;
            break;
          }
        }
        
        // Generic GT06 detection
        if (cleanId.length === 15 && analysis.isGT06) {
          analysis.brands.push('GT06 Family');
          analysis.confidence += 20;
        }
        
        // Remove duplicates
        analysis.brands = [...new Set(analysis.brands)];
      }

      // Protocol-specific features
      if (analysis.protocol === '12' || analysis.protocol === '22') {
        analysis.features.push('GPS');
        analysis.features.push('Speed');
      }
      if (analysis.protocol === '13') {
        analysis.features.push('Heartbeat');
      }
      if (analysis.protocol === '16' || analysis.protocol === '26') {
        analysis.features.push('Alarm');
      }

      // Remove duplicate features
      analysis.features = [...new Set(analysis.features)];
      
    } catch (error) {
      console.error('Error in analyzePacket:', error.message);
      analysis.error = error.message;
    }

    return analysis;
  }

  extractIMEIFromLogin(hexData) {
    try {
      // GT06 login packet: 7878 0D 01 [IMEI 8 bytes] [Serial 2 bytes] [CRC 2 bytes] 0D0A
      if (!hexData.startsWith('7878') && !hexData.startsWith('7979')) {
        return null;
      }
      
      const protocol = hexData.substring(6, 8);
      if (protocol !== '01') {
        return null; // Not a login packet
      }
      
      if (hexData.length < 28) {
        return null; // Too short for login packet
      }
      
      // Extract IMEI (8 bytes = 16 hex chars starting at position 8)
      const imeiHex = hexData.substring(8, 24);
      
      if (imeiHex.length !== 16) {
        return null;
      }
      
      // Convert BCD to decimal
      let imei = '';
      for (let i = 0; i < imeiHex.length; i += 2) {
        const byte = imeiHex.substring(i, i + 2);
        const value = parseInt(byte, 16);
        
        const digit1 = Math.floor(value / 16);
        const digit2 = value % 16;
        
        // Skip 0xF padding
        if (digit1 !== 0xF) imei += digit1;
        if (digit2 !== 0xF) imei += digit2;
      }
      
      // IMEI should be 15 digits
      return imei.substring(0, 15);
      
    } catch (error) {
      console.error('Error extracting IMEI:', error.message);
      return null;
    }
  }

  generateDeviceProfile(deviceId, packets = []) {
    const profile = {
      deviceId: deviceId,
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      totalPackets: packets.length,
      detectedBrands: new Set(),
      protocols: new Set(),
      packetTypes: new Set(),
      features: new Set(),
      statistics: {
        byProtocol: {},
        byPacketType: {},
        byHour: {}
      }
    };

    packets.forEach(packet => {
      if (packet.analysis) {
        if (packet.analysis.brands) {
          packet.analysis.brands.forEach(brand => profile.detectedBrands.add(brand));
        }
        if (packet.analysis.protocol) {
          profile.protocols.add(packet.analysis.protocol);
        }
        if (packet.analysis.packetType) {
          profile.packetTypes.add(packet.analysis.packetType);
        }
        if (packet.analysis.features) {
          packet.analysis.features.forEach(feature => profile.features.add(feature));
        }
        
        // Statistics
        const protocol = packet.analysis.protocol || 'unknown';
        profile.statistics.byProtocol[protocol] = (profile.statistics.byProtocol[protocol] || 0) + 1;
        
        const packetType = packet.analysis.packetType || 'unknown';
        profile.statistics.byPacketType[packetType] = (profile.statistics.byPacketType[packetType] || 0) + 1;
        
        const hour = new Date(packet.timestamp || new Date()).getHours();
        profile.statistics.byHour[hour] = (profile.statistics.byHour[hour] || 0) + 1;
      }
    });

    // Convert Sets to Arrays
    profile.detectedBrands = Array.from(profile.detectedBrands);
    profile.protocols = Array.from(profile.protocols);
    profile.packetTypes = Array.from(profile.packetTypes);
    profile.features = Array.from(profile.features);

    return profile;
  }
}

module.exports = EnhancedProfiler;