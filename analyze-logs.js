import fs from 'fs';
import path from 'path';

class LogAnalyzer {
  constructor() {
    this.logDir = path.join(process.cwd(), 'logs');
  }

  analyzeAlarmPatterns() {
    const alarmDir = path.join(this.logDir, 'alarms');
    if (!fs.existsSync(alarmDir)) {
      console.log('No alarm logs found');
      return;
    }

    const files = fs.readdirSync(alarmDir).filter(f => f.endsWith('.json'));
    const patterns = {};
    const unknownCodes = new Set();

    files.forEach(file => {
      const filePath = path.join(alarmDir, file);
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const alarms = JSON.parse(content);
        
        alarms.forEach(alarm => {
          const protocol = alarm.protocol || 'unknown';
          const code = alarm.alarmCode || 'unknown';
          const type = alarm.alarmType || 'unknown';
          
          if (!patterns[protocol]) patterns[protocol] = {};
          if (!patterns[protocol][code]) {
            patterns[protocol][code] = {
              type,
              count: 0,
              examples: []
            };
          }
          
          patterns[protocol][code].count++;
          if (patterns[protocol][code].examples.length < 5) {
            patterns[protocol][code].examples.push({
              deviceId: alarm.deviceId,
              raw: alarm.raw?.substring(0, 50),
              timestamp: alarm.timestamp
            });
          }
          
          if (type.includes('Unknown') || type.includes('Parse Error')) {
            unknownCodes.add(`${protocol}:${code}`);
          }
        });
      } catch (error) {
        console.error(`Error reading ${file}:`, error.message);
      }
    });

    // Generate report
    const report = {
      summary: {
        totalProtocols: Object.keys(patterns).length,
        totalAlarmCodes: Object.values(patterns).reduce((sum, p) => sum + Object.keys(p).length, 0),
        unknownAlarmCodes: Array.from(unknownCodes)
      },
      patterns,
      recommendations: this.generateRecommendations(patterns, unknownCodes)
    };

    const reportFile = path.join(this.logDir, 'alarm_analysis_report.json');
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    
    console.log('Alarm analysis complete. Report saved to:', reportFile);
    return report;
  }

  generateRecommendations(patterns, unknownCodes) {
    const recommendations = [];
    
    unknownCodes.forEach(code => {
      const [protocol, alarmCode] = code.split(':');
      recommendations.push({
        type: 'NEW_ALARM_CODE',
        protocol,
        alarmCode,
        action: 'Add this code to alarm mapping',
        priority: 'HIGH'
      });
    });

    // Check for protocol-specific patterns
    Object.entries(patterns).forEach(([protocol, codes]) => {
      const codeCount = Object.keys(codes).length;
      if (codeCount > 20) {
        recommendations.push({
          type: 'PROTOCOL_COMPLEXITY',
          protocol,
          codeCount,
          action: 'Consider protocol-specific parser module',
          priority: 'MEDIUM'
        });
      }
    });

    return recommendations;
  }

  analyzeDeviceBrands() {
    const profileFile = path.join(this.logDir, 'device_profiles.json');
    if (!fs.existsSync(profileFile)) {
      console.log('No device profiles found');
      return;
    }

    const profiles = JSON.parse(fs.readFileSync(profileFile, 'utf8'));
    const brandStats = {};
    const protocolStats = {};

    Object.values(profiles).forEach(profile => {
      const brands = profile.summary?.suspectedBrands || [];
      const protocols = profile.summary?.protocols || [];
      
      brands.forEach(brand => {
        brandStats[brand] = (brandStats[brand] || 0) + 1;
      });
      
      protocols.forEach(protocol => {
        protocolStats[protocol] = (protocolStats[protocol] || 0) + 1;
      });
    });

    const report = {
      deviceCount: Object.keys(profiles).length,
      brandDistribution: brandStats,
      protocolDistribution: protocolStats,
      topDevices: Object.entries(profiles)
        .sort((a, b) => new Date(b[1].summary?.lastSeen) - new Date(a[1].summary?.lastSeen))
        .slice(0, 10)
        .map(([deviceId, profile]) => ({
          deviceId,
          lastSeen: profile.summary?.lastSeen,
          brands: profile.summary?.suspectedBrands,
          protocols: profile.summary?.protocols
        }))
    };

    const reportFile = path.join(this.logDir, 'brand_analysis_report.json');
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    
    console.log('Brand analysis complete. Report saved to:', reportFile);
    return report;
  }
}

// Run analysis
const analyzer = new LogAnalyzer();
console.log('Starting log analysis...');
analyzer.analyzeDeviceBrands();
analyzer.analyzeAlarmPatterns();
console.log('Analysis complete!');