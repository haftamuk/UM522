/* Enhanced GT06 Protocol Adapter with Device Profiling and Multi-Brand Support */
import AlarmParser from './alarm-parser.js';
import DeviceProfiler from './profiler.js';

const f = require('../functions');

exports.protocol = 'GT06+';
exports.model_name = 'GT06+ Enhanced';
exports.compatible_hardware = ['GT06N', 'GT06', 'GT06E', 'GT06F', 'GT06H', 'TK103', 'TK303', 'UM552', 'GV300', 'VT310'];

var adapter = function (device) {
  if (!(this instanceof adapter)) {
    return new adapter(device);
  }

  this.format = {'start': '(', 'end': ')', 'separator': ''};
  this.device = device;
  this.__count = 1;
  
  // Initialize profiler and parser
  this.profiler = new DeviceProfiler();
  this.alarmParser = new AlarmParser();

  /*******************************************
   ENHANCED PACKET PARSING WITH PROFILING
   *******************************************/
  this.parse_data = function (data) {
    try {
      var hexData = this.bufferToHexString(data);
      
      // Log raw data for profiling
      const deviceId = this.device.getUID ? this.device.getUID() : null;
      const connectionInfo = this.device.connection ? {
        ip: this.device.connection.remoteAddress,
        port: this.device.connection.remotePort
      } : {};
      
      // Log raw message
      this.profiler.logRawMessage(deviceId, data, 'incoming', {
        adapter: 'GT06+ Enhanced'
      });
      
      // Analyze and profile
      const analysis = this.profiler.analyzeRawData(data, deviceId);
      if (deviceId) {
        this.profiler.updateDeviceProfile(deviceId, analysis, connectionInfo);
      }
      
      console.log(`[Profiler] Device: ${deviceId || 'unknown'}, Protocols: ${analysis.protocols.join(', ')}, Brands: ${analysis.brands.join(', ')}`);

      // Continue with parsing
      var parts = {
        'raw': hexData,
        'raw_buffer': data,
        'start': hexData.substr(0, 4),
        'analysis': analysis
      };

      // Protocol detection and mapping
      if (parts['start'] === '7878' || parts['start'] === '7979') {
        // GT06 protocol
        parts['length'] = parseInt(hexData.substr(4, 2), 16);
        parts['protocol_id'] = hexData.substr(6, 2).toLowerCase();
        parts['data'] = hexData.substring(8, 8 + (parts['length'] - 1) * 2);
        
        // Map protocol to action
        this.map_gt06_protocol(parts);
        
      } else if (hexData.substring(0, 2) === '28' || hexData.substring(0, 2) === '29') {
        // TK103 protocol detection
        parts['protocol_id'] = 'tk103';
        parts['cmd'] = 'alarm';
        parts['action'] = 'alarm';
        
      } else {
        // Unknown protocol, try to detect
        parts['protocol_id'] = 'unknown';
        parts['cmd'] = 'noop';
        parts['action'] = 'noop';
      }

      // Extract device ID if not already set
      if (deviceId && !parts['device_id']) {
        parts['device_id'] = deviceId;
      }

      return parts;
    } catch (error) {
      console.error('Error parsing data:', error);
      return { cmd: 'noop', action: 'noop', device_id: '' };
    }
  };

  this.map_gt06_protocol = function(parts) {
    const protocolMap = {
      '01': { cmd: 'login_request', action: 'login_request' },
      '10': { cmd: 'ping', action: 'ping' },
      '11': { cmd: 'ping', action: 'ping' },
      '12': { cmd: 'ping', action: 'ping' },
      '13': { cmd: 'heartbeat', action: 'heartbeat' },
      '16': { cmd: 'alarm', action: 'alarm' },
      '17': { cmd: 'lbs_location', action: 'lbs_location' },
      '18': { cmd: 'status', action: 'status' },
      '19': { cmd: 'status', action: 'status' },
      '1a': { cmd: 'alarm', action: 'alarm' },
      '1b': { cmd: 'alarm', action: 'alarm' },
      '1c': { cmd: 'alarm', action: 'alarm' },
      '22': { cmd: 'ping', action: 'ping' },
      '26': { cmd: 'alarm', action: 'alarm' },
      '27': { cmd: 'alarm', action: 'alarm' },
      '28': { cmd: 'ping', action: 'ping' },
      '2a': { cmd: 'alarm', action: 'alarm' },
      '2b': { cmd: 'alarm', action: 'alarm' },
      '2c': { cmd: 'alarm', action: 'alarm' }
    };

    const mapping = protocolMap[parts['protocol_id']] || { cmd: 'noop', action: 'noop' };
    parts.cmd = mapping.cmd;
    parts.action = mapping.action;
  };

  this.bufferToHexString = function (buffer) {
    var str = '';
    for (var i = 0; i < buffer.length; i++) {
      var hex = buffer[i].toString(16);
      str += hex.length === 1 ? '0' + hex : hex;
    }
    return str;
  };

  this.authorize = function () {
    var response = '787805010001D9DC0D0A';
    console.log('Sending login response:', response);
    
    // Log outgoing message
    const deviceId = this.device.getUID ? this.device.getUID() : null;
    this.profiler.logRawMessage(deviceId, Buffer.from(response, 'hex'), 'outgoing');
    
    this.device.send(Buffer.from(response, 'hex'));
  };
  
  this.receive_heartbeat = function (msg_parts) {
    var response = '787805130001D9DC0D0A';
    console.log('Sending heartbeat response:', response);
    
    // Log outgoing message
    const deviceId = this.device.getUID ? this.device.getUID() : null;
    this.profiler.logRawMessage(deviceId, Buffer.from(response, 'hex'), 'outgoing');
    
    this.device.send(Buffer.from(response, 'hex'));
  };

  /*******************************************
   ENHANCED ALARM PARSING WITH MULTI-BRAND SUPPORT
   *******************************************/
  this.receive_alarm = function (msg_parts) {
    try {
      const deviceId = msg_parts.device_id || this.device.getUID ? this.device.getUID() : null;
      const rawData = msg_parts.raw_buffer || Buffer.from(msg_parts.raw, 'hex');
      
      // Use enhanced alarm parser
      const parsedAlarm = this.alarmParser.parseAlarm(rawData, deviceId);
      
      // Add additional GT06-specific parsing
      if (parsedAlarm.protocol === 'GT06') {
        parsedAlarm.gt06_details = this.parse_gt06_alarm_details(msg_parts.raw);
      }
      
      console.log(`[Alarm] Device: ${deviceId}, Type: ${parsedAlarm.alarmType}, Brand: ${parsedAlarm.detectedBrands.join(', ')}`);
      
      return {
        code: parsedAlarm.alarmType,
        msg: parsedAlarm.alarmType,
        device_id: deviceId,
        date: new Date().toISOString(),
        timestampDate: new Date(),
        alarm_type: parsedAlarm.alarmType,
        alarm_code: parsedAlarm.alarmCode || 'unknown',
        raw_data: msg_parts.raw,
        device_status: this.extract_device_status(msg_parts.raw),
        protocol_id: msg_parts.protocol_id,
        parsed_details: parsedAlarm
      };
    } catch (error) {
      console.error('Error parsing alarm:', error);
      return false;
    }
  };

  this.parse_gt06_alarm_details = function(hexData) {
    try {
      const details = {};
      
      if (hexData.length >= 70) {
        // Extract terminal information byte (position varies)
        const termInfoPositions = [52, 54, 56];
        for (const pos of termInfoPositions) {
          if (hexData.length > pos + 2) {
            const termByte = parseInt(hexData.substring(pos, pos + 2), 16);
            if (termByte !== 0) {
              details.terminal_info = {
                byte: termByte.toString(16),
                binary: termByte.toString(2).padStart(8, '0'),
                oil_cut: (termByte >> 7) & 1,
                gps_tracking: (termByte >> 6) & 1,
                alarm_bits: ((termByte >> 3) & 7).toString(2).padStart(3, '0'),
                charging: (termByte >> 2) & 1,
                acc: (termByte >> 1) & 1,
                armed: termByte & 1
              };
              break;
            }
          }
        }
        
        // Extract voltage level
        const voltagePos = 60;
        if (hexData.length > voltagePos + 2) {
          const voltage = parseInt(hexData.substring(voltagePos, voltagePos + 2), 16);
          details.voltage_level = voltage;
          details.voltage_status = this.get_voltage_status(voltage);
        }
        
        // Extract GSM signal
        const gsmPos = 62;
        if (hexData.length > gsmPos + 2) {
          const gsm = parseInt(hexData.substring(gsmPos, gsmPos + 2), 16);
          details.gsm_signal = gsm;
          details.gsm_status = this.get_gsm_status(gsm);
        }
      }
      
      return details;
    } catch (error) {
      return { error: error.message };
    }
  };

  this.get_voltage_status = function(level) {
    const levels = {
      0: 'No Power',
      1: 'Extremely Low',
      2: 'Very Low',
      3: 'Low',
      4: 'Medium',
      5: 'High',
      6: 'Very High'
    };
    return levels[level] || `Unknown (${level})`;
  };

  this.get_gsm_status = function(level) {
    const levels = {
      0: 'No Signal',
      1: 'Extremely Weak',
      2: 'Very Weak',
      3: 'Good',
      4: 'Strong'
    };
    return levels[level] || `Unknown (${level})`;
  };

  this.extract_device_status = function(hexData) {
    try {
      if (hexData.length < 40) return {};
      
      const statusByte = parseInt(hexData.substring(36, 38), 16);
      const binary = statusByte.toString(2).padStart(8, '0');
      
      return {
        power_status: binary[0] === '0' ? 'normal' : 'low',
        gps_status: binary[1] === '0' ? 'valid' : 'invalid',
        alarm_bits: binary.substring(2, 5),
        charge_status: binary[5] === '0' ? 'not_charging' : 'charging',
        acc_status: binary[6] === '1',
        armed_status: binary[7] === '1'
      };
    } catch (error) {
      return {};
    }
  };

  // GPS parsing remains similar but enhanced
  this.get_ping_data = function (msg_parts) {
    try {
      var str = msg_parts.data_body || msg_parts.data;
      
      // Use profiler analysis
      if (msg_parts.analysis && msg_parts.analysis.hasGPSInfo) {
        return this.parse_standard_gps_data(str, msg_parts);
      }
      
      return false;
    } catch (error) {
      console.error('Error parsing ping data:', error);
      return false;
    }
  };

  this.parse_standard_gps_data = function (str, msg_parts) {
    // Parse date: 6 bytes (12 hex chars) - YYMMDDHHMMSS
    const dateHex = str.substr(0, 12);
    const year = parseInt(dateHex.substr(0, 2), 16) + 2000;
    const month = parseInt(dateHex.substr(2, 2), 16);
    const day = parseInt(dateHex.substr(4, 2), 16);
    const hour = parseInt(dateHex.substr(6, 2), 16);
    const minute = parseInt(dateHex.substr(8, 2), 16);
    const second = parseInt(dateHex.substr(10, 2), 16);
    const date = new Date(year, month - 1, day, hour, minute, second);
    
    // Parse satellites (1 byte)
    const satellites = parseInt(str.substr(12, 2), 16);
    
    // Parse latitude (4 bytes = 8 hex chars)
    const latHex = str.substr(14, 8);
    let latitude = 0;
    if (latHex !== '00000000') {
      latitude = parseInt(latHex, 16) / 1800000;
    }
    
    // Parse longitude (4 bytes = 8 hex chars)
    const lngHex = str.substr(22, 8);
    let longitude = 0;
    if (lngHex !== '00000000') {
      longitude = parseInt(lngHex, 16) / 1800000;
    }
    
    // Parse speed (1 byte)
    const speed = parseInt(str.substr(30, 2), 16);
    
    // Parse course/heading (2 bytes = 4 hex chars)
    const courseHex = str.substr(32, 4);
    let course = parseInt(courseHex, 16);
    
    // Fix course: if it's > 360, it might be including status bits
    if (course > 360) {
      course = course & 0xFF;
      course = (course * 360) / 255;
    }
    course = Math.round(course);
    
    // Parse status byte (position varies by protocol)
    let statusByte = 0;
    let statusBinary = '00000000';
    
    // Try different positions for status byte
    if (str.length >= 38) {
      statusByte = parseInt(str.substr(36, 2), 16);
      statusBinary = statusByte.toString(2).padStart(8, '0');
    } else if (str.length >= 30) {
      statusByte = parseInt(str.substr(28, 2), 16);
      statusBinary = statusByte.toString(2).padStart(8, '0');
    }
    
    const data = {
      device_id: msg_parts.device_id || '',
      date: date.toISOString(),
      timestampDate: date,
      latitude: latitude,
      longitude: longitude,
      speed: speed,
      orientation: course,
      satellites: satellites,
      raw_data: str,
      device_status: {
        power_status: statusBinary[0] === '0' ? 'normal' : 'low',
        gps_status: statusBinary[1] === '0' ? 'valid' : 'invalid',
        charge_status: statusBinary[5] === '0' ? 'not_charging' : 'charging',
        acc_status: statusBinary[6] === '1',
        armed_status: statusBinary[7] === '1',
        oil_cut: statusBinary[0] === '1', // Bit 7: 1=oil/electricity disconnected
        gps_tracking: statusBinary[1] === '1', // Bit 6: 1=GPS tracking on
        alarm_bits: statusBinary.substr(2, 3) // Bits 3-5: alarm type in binary
      }
    };
    
    console.log('Parsed location:', {
      device: data.device_id,
      lat: data.latitude,
      lng: data.longitude,
      speed: data.speed,
      course: data.orientation,
      time: data.date
    });
    
    return data;
  };


  // Statistics method
  this.getStatistics = function() {
    const deviceStats = this.profiler.getDeviceSummary();
    const alarmStats = this.alarmParser.getAlarmStatistics();
    
    return {
      timestamp: new Date().toISOString(),
      device_profiles: deviceStats,
      alarm_statistics: alarmStats,
      total_raw_messages: this.profiler.profiles.size
    };
  };
};

exports.adapter = adapter;