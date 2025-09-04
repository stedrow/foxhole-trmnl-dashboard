// Simplified War API client for SVG generation
export class WarApi {
  constructor(shardUrl = 'war-service-live.foxholeservices.com') {
    this.shardUrl = shardUrl;
    this.eTags = {};
  }

  async request(path) {
    const response = await fetch(`https://${this.shardUrl}/api/${path}`, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'foxhole-svg-generator',
      },
    });
    
    if (response.ok) {
      return await response.json();
    }
    throw new Error(`API request failed: ${response.status}`);
  }

  async staticMap(hexId) {
    return await this.request(`worldconquest/maps/${hexId}/static`);
  }

  async getStaticMap() {
    // Get all regions static data
    const maps = await this.maps();
    const allStaticData = [];
    
    // Handle different possible response formats
    const mapList = Array.isArray(maps) ? maps : (maps.maps || []);
    
    for (const map of mapList) {
      try {
        const mapName = map.name || map;
        if (!mapName) {
          console.warn('Skipping map with no name:', map);
          continue;
        }
        
        const staticData = await this.staticMap(mapName);
        if (Array.isArray(staticData)) {
          allStaticData.push(...staticData);
        } else if (staticData && Array.isArray(staticData.features)) {
          allStaticData.push(...staticData.features);
        }
      } catch (error) {
        console.warn(`Failed to fetch static data for ${map.name || map}:`, error.message);
      }
    }
    
    return { features: allStaticData };
  }

  async dynamicMap(hexId) {
    return await this.request(`worldconquest/maps/${hexId}/dynamic/public`);
  }

  async getDynamicMap(hexId) {
    return await this.dynamicMap(hexId);
  }

  async war() {
    return await this.request('worldconquest/war');
  }

  async maps() {
    return await this.request('worldconquest/maps');
  }

  getTeam(teamId) {
    if (teamId === 'COLONIALS') return 'Colonial';
    if (teamId === 'WARDENS') return 'Warden';
    return '';
  }

  // Icon type mappings from the original warapi.js
  iconTypes = {
    // Towns/Victory Points
    27: { type: 'town', icon: 'Keep', notes: 'Keep', conquer: true },
    56: { type: 'town', icon: 'TownHall1', notes: 'Town Hall T1', conquer: true },
    57: { type: 'town', icon: 'TownHall2', notes: 'Town Hall T2', conquer: true },
    58: { type: 'town', icon: 'TownHall3', notes: 'Town Hall T3', conquer: true },
    45: { type: 'town', icon: 'RelicBase1', notes: 'Small Relic Base', conquer: true },
    46: { type: 'town', icon: 'RelicBase2', notes: 'Medium Relic Base', conquer: true },
    47: { type: 'town', icon: 'RelicBase3', notes: 'Large Relic Base', conquer: true },
    
    // Industry
    11: { type: 'industry', icon: 'Hospital', notes: 'Hospital' },
    12: { type: 'industry', icon: 'VehicleFactory', notes: 'Vehicle Factory' },
    15: { type: 'industry', icon: 'Workshop', notes: 'Workshop' },
    16: { type: 'industry', icon: 'Manufacturing', notes: 'Manufacturing Plant' },
    17: { type: 'industry', icon: 'Refinery', notes: 'Refinery' },
    18: { type: 'industry', icon: 'Shipyard', notes: 'Shipyard' },
    
    // Fields
    20: { type: 'field', icon: 'SalvageField', notes: 'Salvage Field' },
    21: { type: 'field', icon: 'ComponentField', notes: 'Component Field' },
    23: { type: 'field', icon: 'SulfurField', notes: 'Sulfur Field' },
    61: { type: 'field', icon: 'CoalField', notes: 'Coal Field' },
    62: { type: 'field', icon: 'OilField', notes: 'Oil Field' },
  };

  isIconType(value) {
    return value in this.iconTypes;
  }
}

export default WarApi;