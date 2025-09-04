#!/usr/bin/env node

import fs from 'fs/promises';
import WarApi from './warapi.js';
import { voronoi, intersect } from '@turf/turf';
import TownTracker from './database.js';

// Load static coordinate data from the main project
let STATIC_DATA = null;
async function loadStaticData() {
  if (!STATIC_DATA) {
    const staticFile = await fs.readFile('/app/public/static.json', 'utf8');
    STATIC_DATA = JSON.parse(staticFile);
  }
  return STATIC_DATA;
}

// Foxhole hex regions in proper order for stitching
const HEX_REGIONS = [
  'BasinSionnachHex', 'SpeakingWoodsHex', 'HowlCountyHex',
  'CallumsCapeHex', 'ReachingTrailHex', 'ClansheadValleyHex',
  'NevishLineHex', 'MooringCountyHex', 'ViperPitHex', 'MorgensCrossingHex',
  'OarbreakerHex', 'StonecradleHex', 'CallahansPassageHex', 'WeatheredExpanseHex', 'GodcroftsHex',
  'FarranacCoastHex', 'LinnMercyHex', 'MarbanHollow', 'StlicanShelfHex',
  'WestgateHex', 'LochMorHex', 'DrownedValeHex', 'EndlessShoreHex',
  'FishermansRowHex', 'KingsCageHex', 'DeadLandsHex', 'ClahstraHex', 'TempestIslandHex',
  'StemaLandingHex', 'SableportHex', 'UmbralWildwoodHex', 'AllodsBightHex', 'TheFingersHex',
  'OriginHex', 'HeartlandsHex', 'ShackledChasmHex', 'ReaversPassHex',
  'AshFieldsHex', 'GreatMarchHex', 'TerminusHex',
  'RedRiverHex', 'AcrithiaHex',
  'KalokaiHex'
];

class FoxholeSVGGenerator {
  constructor() {
    this.warApi = new WarApi();
    this.mapData = new Map();
    this.conquerStatus = null;
    this.tracker = new TownTracker();
    this.requiredVictoryTowns = 32; // Default value
    this.warNumber = null;
    this.conquestStartTime = null;
    this.activePlayers = 'N/A';
    this.initializeVictoryTowns();
    this.initializeWarData();
  }

  // Initialize required victory towns from war API
  async initializeVictoryTowns() {
    try {
      this.requiredVictoryTowns = await this.getRequiredVictoryTowns();
    } catch (error) {
      console.warn('Failed to initialize victory towns, using default 32:', error.message);
      this.requiredVictoryTowns = 32;
    }
  }

  // Initialize war data and active players
  async initializeWarData() {
    try {
      const warData = await this.warApi.war();
      this.warNumber = warData.warNumber;
      this.conquestStartTime = warData.conquestStartTime;
      this.activePlayers = await this.fetchActivePlayers();
    } catch (error) {
      console.warn('Failed to initialize war data:', error.message);
      this.warNumber = '?';
      this.conquestStartTime = null;
      this.activePlayers = 'N/A';
    }
  }

  // Fetch conquerStatus data from our local tracking system
  async fetchConquerStatus() {
    console.log('Fetching conquerStatus from local tracking system...');
    this.conquerStatus = this.tracker.getConquerStatus();
    console.log(`Loaded ${Object.keys(this.conquerStatus.features).length} tracked towns`);
    return this.conquerStatus;
  }

  async fetchAllMapData() {
    console.log('Fetching map data from Foxhole API...');
    
    // Fetch conquerStatus data from warden.express
    try {
      await this.fetchConquerStatus();
      console.log('Successfully fetched conquerStatus data');
    } catch (error) {
      console.warn('Failed to fetch conquerStatus data, using fallback colors:', error.message);
      this.conquerStatus = null;
    }
    
    // Load static coordinate data
    const staticData = await loadStaticData();
    
    // Get current war info
    const warInfo = await this.warApi.war();
    console.log(`War ${warInfo.warNumber} - Status: ${warInfo.winner === 'NONE' ? 'Ongoing' : 'Ended'}`);
    this.warNumber = warInfo.warNumber;
    
    // Fetch data for all regions
    for (const region of HEX_REGIONS) {
      try {
        console.log(`Fetching ${region}...`);
        const [dynamicData] = await Promise.all([
          this.warApi.dynamicMap(region)
        ]);
        
        // Find static data for this region from the main project's static.json
        const regionStaticData = staticData.features.filter(feature => 
          feature.properties.region === region || feature.id === region
        );
        
        // Get Voronoi regions for this hex
        const voronoiRegions = staticData.features.filter(feature => 
          feature.properties.type === 'voronoi' && feature.properties.region === region
        );
        
        this.mapData.set(region, { 
          static: { mapTextItems: regionStaticData.filter(f => f.properties.type === 'Major' || f.properties.type === 'Minor') },
          dynamic: dynamicData,
          regionGeometry: regionStaticData.find(f => f.properties.type === 'Region'),
          voronoiRegions: voronoiRegions
        });
      } catch (error) {
        console.warn(`Failed to fetch data for ${region}:`, error.message);
      }
    }
  }



  generateSVG() {
    // Calculate bounds from all regions
    const bounds = this.calculateMapBounds();
    const padding = 50;
    const svgWidth = 1200;
    const svgHeight = 900;
    
    // Calculate scaling to fit map in SVG
    const mapWidth = bounds.maxX - bounds.minX;
    const mapHeight = bounds.maxY - bounds.minY;
    const scale = Math.min(
      (svgWidth - 2 * padding) / mapWidth,
      (svgHeight - 150) / mapHeight // Extra space for title and legend
    );
    
    // SVG header
    let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}" 
     xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      /* Region labels removed for cleaner appearance */
      .colonial-region { 
        fill: rgba(0, 0, 0, 0.15); 
        stroke: rgba(0, 0, 0, 0.9); 
        stroke-width: 2; 
      }
      .warden-region { 
        fill: rgba(0, 0, 0, 0.08); 
        stroke: rgba(0, 0, 0, 0.7); 
        stroke-width: 2; 
      }
      .neutral-region { 
        fill: rgba(0, 0, 0, 0.02); 
        stroke: rgba(0, 0, 0, 0.4); 
        stroke-width: 1; 
      }
      .contested-region {
        fill: rgba(0, 0, 0, 0.12);
        stroke: rgba(0, 0, 0, 0.8); 
        stroke-width: 2;
      }
      /* Town dots removed for cleaner appearance */
      /* Major labels removed for cleaner appearance */
      .territory-colonial { 
        stroke: rgba(0, 0, 0, 0.8) !important;
        stroke-width: 2;
      }
      .territory-warden { 
        stroke: rgba(0, 0, 0, 0.5) !important;
        stroke-width: 2;
      }
      .territory-contested { 
        stroke: rgba(0, 0, 0, 0.7) !important;
        stroke-width: 2;
      }
      .territory-neutral { 
        stroke: rgba(0, 0, 0, 0.3) !important;
        stroke-width: 1;
      }
      /* Sub-region styles - visible borders and fills */
      .subregion-colonial { 
        fill: #D0D0D0; 
        stroke: #666666; 
        stroke-width: 1; 
      }
      .subregion-warden { 
        fill: #707070; 
        stroke: #333333; 
        stroke-width: 1; 
      }
      .subregion-contested { 
        fill: #A0A0A0;
        stroke: #404040; 
        stroke-width: 1; 
      }
      .subregion-neutral { 
        fill: #F0F0F0; 
        stroke: #CCCCCC; 
        stroke-width: 1; 
      }
    </style>
  </defs>
  
  <!-- Background -->
  <rect width="${svgWidth}" height="${svgHeight}" fill="white"/>
  

`;

    // Generate regions with proper coordinates
    for (const [regionName, data] of this.mapData) {
      if (data.regionGeometry) {
        // Get region control from dynamic data
        const regionControl = this.getRegionControl(data.dynamic);
        svg += this.generateRegionWithCoords(regionName, data, regionControl);
      }
    }
    
    // Add recent captures display
    svg += this.generateRecentCapturesDisplay(svgWidth, svgHeight);
    
    svg += '</svg>';
    return svg;
  }

  generateEpaperSVG() {
    // Calculate bounds from all regions
    const bounds = this.calculateMapBounds();
    const padding = 20; // Reduced padding for smaller display
    const svgWidth = 800;
    const svgHeight = 480;
    
    // Calculate scaling to fit map in SVG with space for captures
    const mapWidth = bounds.maxX - bounds.minX;
    const mapHeight = bounds.maxY - bounds.minY;
    const scale = Math.min(
      (svgWidth - 2 * padding - 5) / mapWidth, // Reserve only 5px for Warden captures on right
      (svgHeight - 50) / mapHeight // Reduced space for captures only
    );
    
    // Calculate offset to center the map (shifted left to make room for Warden captures)
    const offsetX = padding + (svgWidth - 2 * padding - 5 - mapWidth * scale) / 2;
    const offsetY = 15; // Start closer to top for better spacing
    
    // SVG header
    let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}" 
     xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- Grayscale patterns for better region distinction -->
    <pattern id="colonialPattern" x="0" y="0" width="8" height="8" patternUnits="userSpaceOnUse">
      <rect width="8" height="8" fill="#E0E0E0"/>
      <circle cx="2" cy="2" r="0.5" fill="#CCCCCC"/>
      <circle cx="6" cy="6" r="0.5" fill="#CCCCCC"/>
    </pattern>
    <pattern id="wardenPattern" x="0" y="0" width="8" height="8" patternUnits="userSpaceOnUse">
      <rect width="8" height="8" fill="#808080"/>
      <rect x="2" y="2" width="1" height="1" fill="#666666"/>
      <rect x="5" y="5" width="1" height="1" fill="#666666"/>
    </pattern>
    <pattern id="neutralPattern" x="0" y="0" width="8" height="8" patternUnits="userSpaceOnUse">
      <rect width="8" height="8" fill="#F5F5F5"/>
      <line x1="0" y1="0" x2="8" y2="8" stroke="#E0E0E0" stroke-width="0.5"/>
      <line x1="8" y1="0" x2="0" y2="8" stroke="#E0E0E0" stroke-width="0.5"/>
    </pattern>
    <pattern id="contestedPattern" x="0" y="0" width="8" height="8" patternUnits="userSpaceOnUse">
      <rect width="8" height="8" fill="#B0B0B0"/>
      <circle cx="4" cy="4" r="1" fill="#909090"/>
    </pattern>
    
    <style>
      /* Region labels removed for cleaner appearance */
      .colonial-region { 
        fill: url(#colonialPattern); 
        stroke: #666666; 
        stroke-width: 1; 
      }
      .warden-region { 
        fill: url(#wardenPattern); 
        stroke: #333333; 
        stroke-width: 1; 
      }
      .neutral-region { 
        fill: url(#neutralPattern); 
        stroke: #CCCCCC; 
        stroke-width: 1; 
      }
      .contested-region {
        fill: url(#contestedPattern);
        stroke: #404040; 
        stroke-width: 1;
      }
      /* Town dots removed for cleaner appearance */
      /* Major labels removed for cleaner appearance */
      .territory-colonial { 
        stroke: rgba(0, 0, 0, 0.8) !important;
        stroke-width: 1;
      }
      .territory-warden { 
        stroke: rgba(0, 0, 0, 0.5) !important;
        stroke-width: 1;
      }
      .territory-contested { 
        stroke: rgba(0, 0, 0, 0.7) !important;
        stroke-width: 1;
      }
      .territory-neutral { 
        stroke: rgba(0, 0, 0, 0.3) !important;
        stroke-width: 1;
      }
      /* Sub-region styles - visible borders and fills */
      .subregion-colonial { 
        fill: rgba(76, 175, 80, 0.15); 
        stroke: rgba(0, 0, 0, 0.8); 
        stroke-width: 1; 
      }
      .subregion-warden { 
        fill: rgba(33, 150, 243, 0.15); 
        stroke: rgba(0, 0, 0, 0.8); 
        stroke-width: 1; 
      }
      .subregion-contested { 
        fill: rgba(255, 193, 7, 0.15); 
        stroke: rgba(0, 0, 0, 0.8); 
        stroke-width: 1; 
      }
      .subregion-neutral { 
        fill: rgba(158, 158, 158, 0.15); 
        stroke: rgba(0, 0, 0, 0.8); 
        stroke-width: 1; 
      }
    </style>
  </defs>
  
  <!-- Background -->
  <rect width="${svgWidth}" height="${svgHeight}" fill="white"/>
  
  <!-- Victory Points Display -->
  <!-- Colonial Victory Points - Top Left -->
  <g transform="translate(20, 25)">
    <text x="0" y="0" style="font-family: 'Segoe UI', sans-serif; font-size: 16px; font-weight: bold; fill: #000000;">Colonial</text>
    <text x="0" y="20" style="font-family: 'Segoe UI', sans-serif; font-size: 18px; font-weight: bold; fill: #000000;">${this.getColonialVictoryPoints()} / ${this.requiredVictoryTowns || 32}</text>
  </g>
  
  <!-- War Information - Top Left next to Colonial VP -->
  <g transform="translate(180, 25)">
    <text x="0" y="0" style="font-family: 'Segoe UI', sans-serif; font-size: 14px; font-weight: bold; fill: #000000;">War #${this.warNumber || '?'} - ${this.getWarDuration()}</text>
  </g>
  
  <!-- Active Players - Top Right next to Warden VP -->
  <g transform="translate(${svgWidth - 200}, 25)">
    <text x="0" y="0" style="font-family: 'Segoe UI', sans-serif; font-size: 14px; font-weight: bold; fill: #000000; text-anchor: end;">Active Players: ${this.activePlayers || 'N/A'}</text>
  </g>
  
  <!-- Warden Victory Points - Top Right -->
  <g transform="translate(${svgWidth - 20}, 25)">
    <text x="0" y="0" style="font-family: 'Segoe UI', sans-serif; font-size: 16px; font-weight: bold; fill: #000000; text-anchor: end;">Warden</text>
    <text x="0" y="20" style="font-family: 'Segoe UI', sans-serif; font-size: 18px; font-weight: bold; fill: #000000; text-anchor: end;">${this.getWardenVictoryPoints()} / ${this.requiredVictoryTowns || 32}</text>
  </g>
`;

    // Generate regions with proper coordinates for e-paper
    for (const [regionName, data] of this.mapData) {
      if (data.regionGeometry) {
        // Get region control from dynamic data
        const regionControl = this.getRegionControl(data.dynamic);
        svg += this.generateEpaperRegionWithCoords(regionName, data, regionControl, scale, offsetX, offsetY);
      }
    }
    
    // Add recent captures display optimized for e-paper
    svg += this.generateEpaperRecentCapturesDisplay(svgWidth, svgHeight);
    
    svg += '</svg>';
    return svg;
  }
  
  calculateMapBounds() {
    // Use exact bounds from the main project's tile system
    // These match the OpenLayers tileGrid extent: [0,-12432,14336,0]
    return {
      minX: 0,
      maxX: 14336, 
      minY: -12432,
      maxY: 0
    };
  }
  
  getRegionControl(dynamicData) {
    if (!dynamicData || !dynamicData.mapItems) return 'neutral';
    
    // Count towns controlled by each team
    let colonialTowns = 0;
    let wardenTowns = 0;
    let totalTowns = 0;
    
    for (const item of dynamicData.mapItems) {
      if (this.warApi.isIconType(item.iconType)) {
        const iconInfo = this.warApi.iconTypes[item.iconType];
        if (iconInfo.conquer) {
          totalTowns++;
          if (item.teamId === 'COLONIALS') colonialTowns++;
          else if (item.teamId === 'WARDENS') wardenTowns++;
        }
      }
    }
    
    // Determine region control with contested state
    if (totalTowns === 0) return 'neutral';
    
    const colonialPercent = colonialTowns / totalTowns;
    const wardenPercent = wardenTowns / totalTowns;
    
    // If one team has significantly more control (>60%), they control the region
    if (colonialPercent >= 0.6) return 'colonial';
    if (wardenPercent >= 0.6) return 'warden';
    
    // If it's close or mixed, mark as contested
    if (colonialTowns > 0 && wardenTowns > 0) return 'contested';
    
    // Default fallback
    if (colonialTowns > wardenTowns) return 'colonial';
    if (wardenTowns > colonialTowns) return 'warden';
    return 'neutral';
  }

  renderExistingVoronoiRegions(regionName, voronoiRegions, dynamicData, worldBounds, uniformScale, offsetX, offsetY) {
    let svg = '';
    
    // Render each pre-generated Voronoi region
    voronoiRegions.forEach(voronoiRegion => {
      try {
        if (voronoiRegion.geometry && voronoiRegion.geometry.coordinates) {
                  // Get control status for this sub-region based on region name/notes
        const subRegionControl = this.getVoronoiControlStatus(voronoiRegion, dynamicData, regionName);
          
          // Handle both Polygon and MultiPolygon
          const coordinates = voronoiRegion.geometry.type === 'MultiPolygon' 
            ? voronoiRegion.geometry.coordinates 
            : [voronoiRegion.geometry.coordinates];
          
          coordinates.forEach(polygonCoords => {
            if (polygonCoords && polygonCoords[0] && polygonCoords[0].length >= 3) {
              const coords = polygonCoords[0]; // Outer ring
              
              // Transform to SVG space
              const svgCoords = coords.map(([x, y]) => [
                offsetX + (x - worldBounds.minX) * uniformScale,
                offsetY + (worldBounds.maxY - y) * uniformScale
              ]);
              
              const pointsString = svgCoords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
              
              // Get the town's conquerStatus data for alpha channel variation
              let conquerFeature = null;
              if (this.conquerStatus && this.conquerStatus.features) {
                // Try multiple approaches to find the conquerStatus for this Voronoi region
                const regionData = this.mapData.get(regionName);
                if (regionData && regionData.dynamic && regionData.dynamic.mapItems) {
                  // Find the town that's inside this Voronoi region
                  const conquerableTowns = regionData.dynamic.mapItems.filter(item => 
                    this.warApi.isIconType(item.iconType) && this.warApi.iconTypes[item.iconType].conquer
                  );
                  
                  for (const town of conquerableTowns) {
                    const worldCoords = this.convertTownToWorldCoordinates(town, regionData.regionGeometry);
                    const isInside = this.inside(worldCoords, voronoiRegion.geometry.coordinates[0]);
                    
                    if (isInside) {
                      // Found the town! Now try multiple ID formats to match conquerStatus
                      const townName = this.warApi.iconTypes[town.iconType].notes;
                      const voronoiId = voronoiRegion.id;
                      
                      // Try different ID formats that the main project might use
                      const possibleIds = [
                        // Format 1: iconType_x_y (what we were trying)
                        `${town.iconType}_${Math.round(town.x * 1000)}_${Math.round(town.y * 1000)}`,
                        // Format 2: iconType_x_y (without rounding)
                        `${town.iconType}_${Math.floor(town.x * 1000)}_${Math.floor(town.y * 1000)}`,
                        // Format 3: Just the voronoi ID (if towns are indexed by voronoi region)
                        voronoiId,
                        // Format 4: Town name (if indexed by name)
                        townName,
                        // Format 5: iconType with coordinates as decimals
                        `${town.iconType}_${town.x.toFixed(3)}_${town.y.toFixed(3)}`
                      ];
                      
                      // Try each possible ID format
                      for (const possibleId of possibleIds) {
                        if (possibleId in this.conquerStatus.features) {
                          conquerFeature = this.conquerStatus.features[possibleId];
                          console.log(`Found conquerStatus for "${townName}" using ID "${possibleId}": team=${conquerFeature.team}, lastChange=${conquerFeature.lastChange}`);
                          break;
                        }
                      }
                      
                      // If no direct match, try to find by voronoi property
                      if (!conquerFeature) {
                        const voronoiMatch = Object.values(this.conquerStatus.features).find(feature => 
                          feature.voronoi === voronoiId
                        );
                        if (voronoiMatch) {
                          conquerFeature = voronoiMatch;
                          console.log(`Found conquerStatus for "${townName}" via voronoi property: team=${conquerFeature.team}, lastChange=${conquerFeature.lastChange}`);
                        }
                      }
                      
                      // If still no match, try by notes property
                      if (!conquerFeature) {
                        const notesMatch = Object.values(this.conquerStatus.features).find(feature => 
                          feature.notes === townName
                        );
                        if (notesMatch) {
                          conquerFeature = notesMatch;
                          console.log(`Found conquerStatus for "${townName}" via notes property: team=${conquerFeature.team}, lastChange=${conquerFeature.lastChange}`);
                        }
                      }
                      
                      if (conquerFeature) {
                        break;
                      } else {
                        console.log(`No conquerStatus found for town "${townName}" in Voronoi region "${voronoiRegion.properties.notes}"`);
                      }
                    }
                  }
                }
              }
              
              // Get conquerStatus data from our local tracking system
              if (!conquerFeature && this.conquerStatus && this.conquerStatus.features) {
                const regionData = this.mapData.get(regionName);
                if (regionData && regionData.dynamic && regionData.dynamic.mapItems) {
                  const conquerableTowns = regionData.dynamic.mapItems.filter(item => 
                    this.warApi.isIconType(item.iconType) && this.warApi.iconTypes[item.iconType].conquer
                  );
                  
                  for (const town of conquerableTowns) {
                    const worldCoords = this.convertTownToWorldCoordinates(town, regionData.regionGeometry);
                    const isInside = this.inside(worldCoords, voronoiRegion.geometry.coordinates[0]);
                    
                    if (isInside) {
                      // Find the town in our tracked data
                      const townId = this.tracker.generateTownId(town.iconType, town.x, town.y);
                      const trackedTown = this.conquerStatus.features[townId];
                      
                      if (trackedTown) {
                        conquerFeature = {
                          team: trackedTown.team,
                          lastChange: trackedTown.lastChange
                        };
                        console.log(`Found tracked data for "${this.warApi.iconTypes[town.iconType].notes}": team=${trackedTown.team}, lastChange=${new Date(trackedTown.lastChange).toISOString()}`);
                      } else {
                        console.log(`No tracked data found for "${this.warApi.iconTypes[town.iconType].notes}"`);
                      }
                      break;
                    }
                  }
                }
              }
              
              // Get color with alpha variation using conquerStatus data
              const teamId = subRegionControl === 'colonial' ? 'COLONIALS' : 
                            subRegionControl === 'warden' ? 'WARDENS' : 'NEUTRAL';
              const color = this.getColorWithAlpha(teamId, conquerFeature);
              
              // Add Voronoi sub-region polygon with visible styling
              svg += `
    <polygon points="${pointsString}" 
             fill="${color}" 
             stroke="rgba(0, 0, 0, 0.8)" 
             stroke-width="1" />`;
            }
          });
        }
      } catch (error) {
        console.warn(`Failed to render Voronoi region in ${regionName}:`, error.message);
      }
    });
    
    return svg;
  }

  getVoronoiControlStatus(voronoiRegion, dynamicData, regionName) {
    if (!dynamicData || !dynamicData.mapItems) {
      return 'neutral';
    }

    // Each Voronoi region has a 'notes' property with the town name
    const voronoiTownName = voronoiRegion.properties.notes;
    if (!voronoiTownName) {
      return 'neutral';
    }

    // Get conquerable towns in this region
    const conquerableTowns = dynamicData.mapItems.filter(item => 
      this.warApi.isIconType(item.iconType) && this.warApi.iconTypes[item.iconType].conquer
    );

    if (conquerableTowns.length === 0) {
      return 'neutral';
    }

    // Get the region geometry to convert coordinates
    const regionData = this.mapData.get(regionName);
    if (!regionData || !regionData.regionGeometry) {
      return 'neutral';
    }

    // Convert town coordinates to world coordinates and find which town is inside this Voronoi region
    let associatedTown = null;
    
    for (const town of conquerableTowns) {
      // Convert town coordinates from 0-1024 range to world coordinates
      const worldCoords = this.convertTownToWorldCoordinates(town, regionData.regionGeometry);
      
      // Check if this town is inside the Voronoi region using the same method as the main project
      const isInside = this.inside(worldCoords, voronoiRegion.geometry.coordinates[0]);
      console.log(`Town ${this.warApi.iconTypes[town.iconType].notes} inside "${voronoiTownName}": ${isInside}`);
      
      if (isInside) {
        associatedTown = town;
        break;
      }
    }

    if (!associatedTown) {
      // If no town is found inside this Voronoi region, return neutral
      // This ensures we don't use incorrect fallback data
      console.log(`No town found inside Voronoi region "${voronoiTownName}" in ${regionName} - returning neutral`);
      return 'neutral';
    }

    // Debug: log the mapping
    console.log(`Voronoi region "${voronoiTownName}" mapped to town "${this.warApi.iconTypes[associatedTown.iconType].notes}" (${associatedTown.teamId}) in ${regionName}`);

    // Get the town's conquerStatus data from our tracked database
    let conquerFeature = null;
    if (this.conquerStatus && this.conquerStatus.features) {
      // Generate the town ID using the same method as the database
      const townId = this.tracker.generateTownId(associatedTown.iconType, associatedTown.x, associatedTown.y);
      conquerFeature = this.conquerStatus.features[townId];
      
      if (conquerFeature) {
        console.log(`Found tracked data for "${this.warApi.iconTypes[associatedTown.iconType].notes}": team=${conquerFeature.team}, lastChange=${new Date(conquerFeature.lastChange).toISOString()}`);
      } else {
        console.log(`No tracked data found for "${this.warApi.iconTypes[associatedTown.iconType].notes}" with ID ${townId}`);
      }
    }

    // Return control status based on town ownership
    switch (associatedTown.teamId) {
      case 'COLONIALS':
        return 'colonial';
      case 'WARDENS':
        return 'warden';
      default:
        return 'neutral';
    }
  }

  // Get color with alpha channel using the exact logic from the main warden.express project
  getColorWithAlpha(teamId, conquerFeature = null) {
    let alpha = 'BB'; // Default alpha
    
    if (conquerFeature && conquerFeature.lastChange) {
      const timeSinceCapture = Date.now() - conquerFeature.lastChange;
      
      if (timeSinceCapture >= 86400000) { // 24 hours
        alpha = 'BB'; // Older towns: more transparent (73% opacity)
      } else {
        // Exact warden.express logic
        // Recent captures: fully opaque (255), older: more transparent
        const alphaValue = Math.floor(255 - (timeSinceCapture / 86400000) * 68);
        alpha = alphaValue.toString(16).padStart(2, '0');
      }
      
      console.log(`Town captured ${(timeSinceCapture / (1000 * 60 * 60)).toFixed(1)} hours ago - Alpha: ${alpha}`);
    }
    
    // Return distinct grayscale colors for e-paper display
    if (teamId === 'WARDENS') {
      return `#404040${alpha}`; // Dark gray for Warden
    } else if (teamId === 'COLONIALS') {
      return `#A0A0A0${alpha}`; // Medium gray for Colonial
    }
    return `#F0F0F0${alpha}`; // Light gray for neutral
  }

  // Get proper hex name from static data
  getHexName(regionName, regionGeometry) {
    if (regionGeometry && regionGeometry.properties && regionGeometry.properties.notes) {
      return regionGeometry.properties.notes;
    }
    // Fallback: convert camelCase to readable format
    return regionName.replace('Hex', '').replace(/([A-Z])/g, ' $1').trim();
  }

  // Calculate Colonial victory points (only actual victory towns)
  getColonialVictoryPoints() {
    let colonialVP = 0;
    for (const [, data] of this.mapData) {
      if (data.dynamic && data.dynamic.mapItems) {
        for (const item of data.dynamic.mapItems) {
          // Check if it's a victory town (iconType 45, 56, 57, 58 with flags & 32)
          if (this.isVictoryTown(item.iconType, item.flags) && 
              item.teamId === 'COLONIALS') {
            colonialVP++;
          }
        }
      }
    }
    return colonialVP;
  }

  // Calculate Warden victory points (only actual victory towns)
  getWardenVictoryPoints() {
    let wardenVP = 0;
    for (const [, data] of this.mapData) {
      if (data.dynamic && data.dynamic.mapItems) {
        for (const item of data.dynamic.mapItems) {
          // Check if it's a victory town (iconType 45, 56, 57, 58 with flags & 32)
          if (this.isVictoryTown(item.iconType, item.flags) && 
              item.teamId === 'WARDENS') {
            wardenVP++;
          }
        }
      }
    }
    return wardenVP;
  }

  // Check if a map item is a victory town
  isVictoryTown(iconType, flags) {
    // Victory base types: 45 (Relic Base), 56-58 (Town Halls)
    const victoryBaseTypes = [45, 56, 57, 58];
    // Victory base flag: 32 (bit flag to identify victory towns)
    const victoryBaseFlag = 32;
    
    return victoryBaseTypes.includes(iconType) && (flags & victoryBaseFlag);
  }

  // Get required victory towns from war API
  async getRequiredVictoryTowns() {
    try {
      const warData = await this.warApi.war();
      return warData.requiredVictoryTowns || 32;
    } catch (error) {
      console.warn('Failed to fetch war data, using default 32:', error.message);
      return 32;
    }
  }

  // Calculate war duration in days
  getWarDuration() {
    if (!this.conquestStartTime) {
      return 'Day 0';
    }
    
    const now = Date.now();
    const warDurationMs = now - this.conquestStartTime;
    const warDays = Math.floor(warDurationMs / (1000 * 60 * 60 * 24));
    const warHours = Math.floor((warDurationMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    return `Day ${warDays} ${warHours}h`;
  }

  // Fetch active player count from Steam Charts API
  async fetchActivePlayers() {
    try {
      const response = await fetch('https://steamcharts.com/app/505460/chart-data.json');
      if (response.ok) {
        const data = await response.json();
        if (data && data.length > 0) {
          const latestEntry = data[data.length - 1];
          if (latestEntry && latestEntry.length >= 2) {
            return latestEntry[1].toLocaleString();
          }
        }
      }
      return 'N/A';
    } catch (error) {
      console.warn('Failed to fetch Steam player data:', error.message);
      return 'N/A';
    }
  }

  // Generate recent captures display for bottom of SVG
  generateRecentCapturesDisplay(svgWidth, svgHeight) {
    if (!this.conquerStatus || !this.conquerStatus.features) {
      return '';
    }

    // Collect recent captures (within last 48 hours for testing)
    const recentCaptures = [];
    const now = Date.now();
    const fortyEightHours = 48 * 60 * 60 * 1000;

    for (const [id, feature] of Object.entries(this.conquerStatus.features)) {
      if (feature.lastChange && (now - feature.lastChange) < fortyEightHours) {
        // Find the town name from static data
        let townName = 'Unknown';
        let hexName = 'Unknown';
        for (const [regionName, data] of this.mapData) {
          if (data.dynamic && data.dynamic.mapItems) {
            const town = data.dynamic.mapItems.find(item => 
              this.warApi.isIconType(item.iconType) && 
              this.warApi.iconTypes[item.iconType].conquer &&
              this.tracker.generateTownId(item.iconType, item.x, item.y) === id
            );
            if (town) {
              hexName = this.getHexName(regionName, data.regionGeometry);
              // Try to get the actual zone name from the Voronoi regions
              if (data.voronoiRegions) {
                const voronoiRegion = data.voronoiRegions.find(vRegion => {
                  // Check if this town is inside this Voronoi region
                  const townWorldCoords = this.convertTownToWorldCoordinates(town, data.regionGeometry);
                  return this.inside(townWorldCoords, vRegion.geometry.coordinates[0]);
                });
                if (voronoiRegion && voronoiRegion.properties && voronoiRegion.properties.notes) {
                  townName = voronoiRegion.properties.notes;
                } else {
                  townName = this.warApi.iconTypes[town.iconType].notes;
                }
              } else {
                townName = this.warApi.iconTypes[town.iconType].notes;
              }
              break;
            }
          }
        }

        recentCaptures.push({
          id,
          team: feature.team,
          lastChange: feature.lastChange,
          townName,
          hexName,
          timeSinceCapture: now - feature.lastChange
        });
      }
    }

    // Sort by most recent first
    recentCaptures.sort((a, b) => a.timeSinceCapture - b.timeSinceCapture);

    // Take only the 8 most recent captures for each team
    const wardenCaptures = recentCaptures
      .filter(capture => capture.team === 'WARDENS' || capture.team === 'Warden')
      .slice(0, 8);
    
    const colonialCaptures = recentCaptures
      .filter(capture => capture.team === 'COLONIALS' || capture.team === 'Colonial')
      .slice(0, 8);

    let svg = '';
    
    // Warden captures on bottom right
    if (wardenCaptures.length > 0) {
      svg += `<g transform="translate(${svgWidth - 300}, ${svgHeight - 200})">`;
      svg += `<text x="0" y="0" style="font-family: 'Segoe UI', sans-serif; font-size: 14px; font-weight: bold; fill: #245682;">Warden Captures</text>`;
      
      wardenCaptures.forEach((capture, index) => {
        const hours = Math.floor(capture.timeSinceCapture / (60 * 60 * 1000));
        const minutes = Math.floor((capture.timeSinceCapture % (60 * 60 * 1000)) / (60 * 1000));
        const timeText = hours > 0 ? `${hours}h ${minutes}m ago` : `${minutes}m ago`;
        
        svg += `<text x="0" y="${(index + 1) * 20}" style="font-family: 'Segoe UI', sans-serif; font-size: 12px; fill: #245682;">`;
        svg += `${capture.hexName} - ${capture.townName} - ${timeText}`;
        svg += `</text>`;
      });
      svg += `</g>`;
    }

    // Colonial captures on bottom left
    if (colonialCaptures.length > 0) {
      svg += `<g transform="translate(20, ${svgHeight - 200})">`;
      svg += `<text x="0" y="0" style="font-family: 'Segoe UI', sans-serif; font-size: 14px; font-weight: bold; fill: #516C4B;">Colonial Captures</text>`;
      
      colonialCaptures.forEach((capture, index) => {
        const hours = Math.floor(capture.timeSinceCapture / (60 * 60 * 1000));
        const minutes = Math.floor((capture.timeSinceCapture % (60 * 60 * 1000)) / (60 * 1000));
        const timeText = hours > 0 ? `${hours}h ${minutes}m ago` : `${minutes}m ago`;
        
        svg += `<text x="0" y="${(index + 1) * 20}" style="font-family: 'Segoe UI', sans-serif; font-size: 12px; fill: #516C4B;">`;
        svg += `${capture.hexName} - ${capture.townName} - ${timeText}`;
        svg += `</text>`;
      });
      svg += `</g>`;
    }

    return svg;
  }

  convertTownToWorldCoordinates(town, regionGeometry) {
    // Use the exact coordinate conversion from the main project
    // The main project uses extent = [-2046, 1777] and region.properties.box
    const coords = regionGeometry.geometry.coordinates[0];
    const minX = Math.min(...coords.map(([x]) => x));
    const maxX = Math.max(...coords.map(([x]) => x));
    const minY = Math.min(...coords.map(([, y]) => y));
    const maxY = Math.max(...coords.map(([, y]) => y));
    
    // Use the main project's coordinate conversion
    const extent = [-2046, 1777];
    const worldX = minX - town.x * extent[0];
    const worldY = maxY - town.y * extent[1];
    
    // Debug coordinate conversion
    console.log(`Town ${this.warApi.iconTypes[town.iconType].notes} at (${town.x}, ${town.y}) -> world (${worldX.toFixed(0)}, ${worldY.toFixed(0)})`);
    
    return [worldX, worldY];
  }

  // Generate recent captures display optimized for e-paper (800x480)
  generateEpaperRecentCapturesDisplay(svgWidth, svgHeight) {
    if (!this.conquerStatus || !this.conquerStatus.features) {
      return '';
    }

    // Collect recent captures (within last 48 hours)
    const recentCaptures = [];
    const now = Date.now();
    const fortyEightHours = 48 * 60 * 60 * 1000;

    for (const [id, feature] of Object.entries(this.conquerStatus.features)) {
      if (feature.lastChange && (now - feature.lastChange) < fortyEightHours) {
        // Find the town name from static data
        let townName = 'Unknown';
        let hexName = 'Unknown';
        for (const [regionName, data] of this.mapData) {
          if (data.dynamic && data.dynamic.mapItems) {
            const town = data.dynamic.mapItems.find(item => 
              this.warApi.isIconType(item.iconType) && 
              this.warApi.iconTypes[item.iconType].conquer &&
              this.tracker.generateTownId(item.iconType, item.x, item.y) === id
            );
            if (town) {
              hexName = this.getHexName(regionName, data.regionGeometry);
              // Try to get the actual zone name from the Voronoi regions
              if (data.voronoiRegions) {
                const voronoiRegion = data.voronoiRegions.find(vRegion => {
                  // Check if this town is inside this Voronoi region
                  const townWorldCoords = this.convertTownToWorldCoordinates(town, data.regionGeometry);
                  return this.inside(townWorldCoords, vRegion.geometry.coordinates[0]);
                });
                if (voronoiRegion && voronoiRegion.properties && voronoiRegion.properties.notes) {
                  townName = voronoiRegion.properties.notes;
                } else {
                  townName = this.warApi.iconTypes[town.iconType].notes;
                }
              } else {
                townName = this.warApi.iconTypes[town.iconType].notes;
              }
              break;
            }
          }
        }

        recentCaptures.push({
          id,
          team: feature.team,
          lastChange: feature.lastChange,
          townName,
          hexName,
          timeSinceCapture: now - feature.lastChange
        });
      }
    }

    // Sort by most recent first
    recentCaptures.sort((a, b) => a.timeSinceCapture - b.timeSinceCapture);

    // Take only the 6 most recent captures for each team (optimized for e-paper)
    const wardenCaptures = recentCaptures
      .filter(capture => capture.team === 'WARDENS' || capture.team === 'Warden')
      .slice(0, 6);
    
    const colonialCaptures = recentCaptures
      .filter(capture => capture.team === 'COLONIALS' || capture.team === 'Colonial')
      .slice(0, 6);

    let svg = '';
    
        // Colonial captures on bottom left (compact layout)
    if (colonialCaptures.length > 0) {
      svg += `<g transform="translate(10, ${svgHeight - 120})">`;
      svg += `<text x="0" y="0" style="font-family: 'Segoe UI', sans-serif; font-size: 14px; font-weight: bold; fill: #000000;">Colonial</text>`;
      
      colonialCaptures.forEach((capture, index) => {
        const hours = Math.floor(capture.timeSinceCapture / (60 * 60 * 1000));
        const minutes = Math.floor((capture.timeSinceCapture % (60 * 60 * 1000)) / (60 * 1000));
        const timeText = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
        
        // Compact format for e-paper with better spacing
        svg += `<text x="0" y="${(index + 1) * 18}" style="font-family: 'Segoe UI', sans-serif; font-size: 11px; fill: #000000;">`;
        svg += `${capture.hexName} - ${capture.townName} - ${timeText}`;
        svg += `</text>`;
      });
      svg += `</g>`;
    }
    
    // Warden captures on bottom right (compact layout, right-justified)
    if (wardenCaptures.length > 0) {
      svg += `<g transform="translate(${svgWidth - 10}, ${svgHeight - 120})">`;
      svg += `<text x="0" y="0" style="font-family: 'Segoe UI', sans-serif; font-size: 14px; font-weight: bold; fill: #000000; text-anchor: end;">Warden</text>`;
      
      wardenCaptures.forEach((capture, index) => {
        const hours = Math.floor(capture.timeSinceCapture / (60 * 60 * 1000));
        const minutes = Math.floor((capture.timeSinceCapture % (60 * 60 * 1000)) / (60 * 1000));
        const timeText = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
        
        // Compact format for e-paper, right-justified with better spacing
        svg += `<text x="0" y="${(index + 1) * 18}" style="font-family: 'Segoe UI', sans-serif; font-size: 11px; fill: #000000; text-anchor: end;">`;
        svg += `${capture.hexName} - ${capture.townName} - ${timeText}`;
        svg += `</text>`;
      });
      svg += `</g>`;
    }

    return svg;
  }

  // Inside function from the main project
  inside(point, vs) {
    // ray-casting algorithm based on
    // https://wrf.ecse.rpi.edu/Research/Short_Notes/pnpoly.html

    const x = point[0], y = point[1];

    let inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
      let xi = vs[i]?.[0];
      let yi = vs[i]?.[1];
      let xj = vs[j]?.[0];
      let yj = vs[j]?.[1];

      let intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }

    return inside;
  }



  generateVoronoiSubRegions(regionName, landmarks, regionGeometry, dynamicData) {
    if (!landmarks || landmarks.length < 2) {
      return '';
    }

    try {
      // Create points for Voronoi diagram - use only the coordinates
      const points = {
        type: 'FeatureCollection',
        features: landmarks.map(landmark => ({
          type: 'Feature',
          geometry: landmark.geometry,
          properties: landmark.properties
        }))
      };

      // Get region bounds for bbox
      const regionCoords = regionGeometry.geometry.coordinates[0];
      const minX = Math.min(...regionCoords.map(([x]) => x));
      const maxX = Math.max(...regionCoords.map(([x]) => x));
      const minY = Math.min(...regionCoords.map(([, y]) => y));
      const maxY = Math.max(...regionCoords.map(([, y]) => y));
      const bbox = [minX, minY, maxX, maxY];

      // Generate Voronoi diagram
      const voronoiResult = voronoi(points, { bbox });
      
      let svg = '';
      
      // Transform coordinates to SVG space
      const worldBounds = this.calculateMapBounds();
      const worldWidth = worldBounds.maxX - worldBounds.minX;
      const worldHeight = worldBounds.maxY - worldBounds.minY;
      
      const svgPadding = 50;
      const availableWidth = 1200 - 2 * svgPadding;
      const availableHeight = 800 - 2 * svgPadding;
      
      const scaleX = availableWidth / worldWidth;
      const scaleY = availableHeight / worldHeight;
      const uniformScale = Math.min(scaleX, scaleY);
      
      const offsetX = svgPadding + (availableWidth - worldWidth * uniformScale) / 2;
      const offsetY = svgPadding + 50;
      
      // Process each Voronoi cell - using the exact approach from main project
      voronoiResult.features.forEach(voronoiCell => {
        try {
          // Create proper GeoJSON features as done in the main project
          const voronoiGeoJSON = {
            type: 'Feature',
            geometry: voronoiCell.geometry,
            properties: voronoiCell.properties || {}
          };
          
          const regionGeoJSON = {
            type: 'Feature', 
            geometry: regionGeometry.geometry,
            properties: regionGeometry.properties || {}
          };
          
          // Use intersect exactly like main project: intersect(writeFeatureObject, writeFeatureObject)
          const intersectedCell = intersect(voronoiGeoJSON, regionGeoJSON);
          
          if (intersectedCell && intersectedCell.geometry && intersectedCell.geometry.coordinates) {
            // Get control status for this sub-region
            const subRegionControl = this.getVoronoiControlStatus(voronoiCell, dynamicData, regionName);
            
            // Handle both Polygon and MultiPolygon results from intersect
            const coordinates = intersectedCell.geometry.type === 'MultiPolygon' 
              ? intersectedCell.geometry.coordinates 
              : [intersectedCell.geometry.coordinates];
            
            coordinates.forEach(polygonCoords => {
              if (polygonCoords && polygonCoords[0] && polygonCoords[0].length >= 3) {
                const coords = polygonCoords[0]; // Outer ring
                
                // Transform to SVG space
                const svgCoords = coords.map(([x, y]) => [
                  offsetX + (x - worldBounds.minX) * uniformScale,
                  offsetY + (worldBounds.maxY - y) * uniformScale
                ]);
                
                const pointsString = svgCoords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
                
                // Add clipped sub-region polygon with clean, subtle styling
                svg += `
    <polygon points="${pointsString}" 
             fill="${this.getControlColor(subRegionControl)}" 
             stroke="rgba(0, 0, 0, 0.3)" 
             stroke-width="0.5" />`;
              }
            });
          }
        } catch (error) {
          console.warn(`Failed to process Voronoi cell in ${regionName}:`, error.message);
        }
      });
      
      return svg;
    } catch (error) {
      console.warn(`Failed to generate Voronoi sub-regions for ${regionName}:`, error.message);
      return '';
    }
  }



  getControlColor(control) {
    switch(control) {
      case 'colonial': return '#4CAF50';
      case 'warden': return '#2196F3';
      case 'contested': return '#FFC107';
      case 'neutral': return '#9E9E9E';
      default: return '#9E9E9E';
    }
  }

  generateRegionWithCoords(regionName, data, regionControl) {
    // Use exact coordinates from static.json instead of hard-coded data
    if (!data.regionGeometry) {
      console.warn(`No region geometry found for ${regionName}`);
      return '';
    }
    
    const coords = data.regionGeometry.geometry.coordinates[0];
    if (!coords) return '';

    // Transform world coordinates to SVG coordinates using exact bounds
    const worldBounds = this.calculateMapBounds();
    
    const worldWidth = worldBounds.maxX - worldBounds.minX;
    const worldHeight = worldBounds.maxY - worldBounds.minY;
    
    const svgPadding = 50;
    const availableWidth = 1200 - 2 * svgPadding;
    const availableHeight = 800 - 2 * svgPadding; // Leave space for title and legend
    
    const scaleX = availableWidth / worldWidth;
    const scaleY = availableHeight / worldHeight;
    const uniformScale = Math.min(scaleX, scaleY);
    
    const offsetX = svgPadding + (availableWidth - worldWidth * uniformScale) / 2;
    const offsetY = svgPadding + 50; // Extra space for title
    
    // Convert coordinates to SVG space
    const svgCoords = coords.map(([x, y]) => [
      offsetX + (x - worldBounds.minX) * uniformScale,
      offsetY + (worldBounds.maxY - y) * uniformScale // Flip Y axis
    ]);
    
    const pointsString = svgCoords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    
    // Calculate the center point of the polygon for labeling
    const centerX = svgCoords.reduce((sum, [x]) => sum + x, 0) / svgCoords.length;
    const centerY = svgCoords.reduce((sum, [, y]) => sum + y, 0) / svgCoords.length;
    
    let svg = `\n  <!-- ${regionName} -->
  <g id="${regionName}">`;
    
    // Draw hexagonal region boundary using actual coordinates
    svg += `
    <polygon points="${pointsString}" class="${regionControl}-region" />`;
    
    // Region labels removed for cleaner appearance
    
    // Add pre-generated Voronoi sub-regions (behind other elements)
    if (data.voronoiRegions && data.voronoiRegions.length > 0) {
      svg += this.renderExistingVoronoiRegions(regionName, data.voronoiRegions, data.dynamic, worldBounds, uniformScale, offsetX, offsetY);
    }

    // Add major landmarks as subtle points only (no text clutter)
    if (data.static && data.static.mapTextItems) {
      data.static.mapTextItems.forEach(landmark => {
        if (landmark.properties.type === 'Major') {
          const landmarkCoords = landmark.geometry.coordinates;
          const landmarkX = offsetX + (landmarkCoords[0] - worldBounds.minX) * uniformScale;
          const landmarkY = offsetY + (worldBounds.maxY - landmarkCoords[1]) * uniformScale;
          
          // Landmark dots removed for cleaner appearance
        }
      });
    }
    
    // Add towns from dynamic data - make them smaller and more subtle
    if (data.dynamic && data.dynamic.mapItems) {
      const townItems = data.dynamic.mapItems.filter(item => 
        this.warApi.isIconType(item.iconType) && 
        this.warApi.iconTypes[item.iconType].conquer
      );
      
      // Calculate bounding box of the hex for positioning towns
      const minX = Math.min(...svgCoords.map(([x]) => x));
      const maxX = Math.max(...svgCoords.map(([x]) => x));
      const minY = Math.min(...svgCoords.map(([, y]) => y));
      const maxY = Math.max(...svgCoords.map(([, y]) => y));
      const hexWidth = maxX - minX;
      const hexHeight = maxY - minY;
      
      townItems.slice(0, 6).forEach(item => {
        // Convert item coordinates (0-1024) to position within hex bounds
        const townX = minX + (item.x / 1024) * hexWidth;
        const townY = minY + (item.y / 1024) * hexHeight;
        
        const teamClass = item.teamId === 'COLONIALS' ? 'colonial' : 
                         item.teamId === 'WARDENS' ? 'warden' : 'neutral';
        
        // Town dots removed for cleaner appearance
      });
    }
    
    svg += '\n  </g>';
    return svg;
  }

  generateEpaperRegionWithCoords(regionName, data, regionControl, scale, offsetX, offsetY) {
    // Use exact coordinates from static.json with e-paper scaling
    if (!data.regionGeometry) {
      console.warn(`No region geometry found for ${regionName}`);
      return '';
    }
    
    const coords = data.regionGeometry.geometry.coordinates[0];
    if (!coords) return '';

    // Transform world coordinates to SVG coordinates using e-paper bounds
    const worldBounds = this.calculateMapBounds();
    
    // Convert coordinates to SVG space using provided scale and offset
    const svgCoords = coords.map(([x, y]) => [
      offsetX + (x - worldBounds.minX) * scale,
      offsetY + (worldBounds.maxY - y) * scale // Flip Y axis
    ]);
    
    const pointsString = svgCoords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    
    let svg = `\n  <!-- ${regionName} -->
  <g id="${regionName}">`;
    
    // Draw hexagonal region boundary using actual coordinates
    svg += `
    <polygon points="${pointsString}" class="${regionControl}-region" />`;
    
    // Add pre-generated Voronoi sub-regions (behind other elements)
    if (data.voronoiRegions && data.voronoiRegions.length > 0) {
      svg += this.renderExistingVoronoiRegions(regionName, data.voronoiRegions, data.dynamic, worldBounds, scale, offsetX, offsetY);
    }

    // Add major landmarks as subtle points only (no text clutter)
    if (data.static && data.static.mapTextItems) {
      data.static.mapTextItems.forEach(landmark => {
        if (landmark.properties.type === 'Major') {
          const landmarkCoords = landmark.geometry.coordinates;
          const landmarkX = offsetX + (landmarkCoords[0] - worldBounds.minX) * scale;
          const landmarkY = offsetY + (worldBounds.maxY - landmarkCoords[1]) * scale;
          
          // Landmark dots removed for cleaner appearance
        }
      });
    }
    
    // Add towns from dynamic data - make them smaller and more subtle
    if (data.dynamic && data.dynamic.mapItems) {
      const townItems = data.dynamic.mapItems.filter(item => 
        this.warApi.isIconType(item.iconType) && 
        this.warApi.iconTypes[item.iconType].conquer
      );
      
      // Calculate bounding box of the hex for positioning towns
      const minX = Math.min(...svgCoords.map(([x]) => x));
      const maxX = Math.max(...svgCoords.map(([x]) => x));
      const minY = Math.min(...svgCoords.map(([, y]) => y));
      const maxY = Math.max(...svgCoords.map(([, y]) => y));
      const hexWidth = maxX - minX;
      const hexHeight = maxY - minY;
      
      townItems.slice(0, 6).forEach(item => {
        // Convert item coordinates (0-1024) to position within hex bounds
        const townX = minX + (item.x / 1024) * hexWidth;
        const townY = minY + (item.y / 1024) * hexHeight;
        
        const teamClass = item.teamId === 'COLONIALS' ? 'colonial' : 
                         item.teamId === 'WARDENS' ? 'warden' : 'neutral';
        
        // Town dots removed for cleaner appearance
      });
    }
    
    svg += '\n  </g>';
    return svg;
  }
  

  generateRegionSVG(regionName, data, x, y, width, height) {
    let svg = `\n  <!-- ${regionName} -->
  <g transform="translate(${x},${y})">
    <rect width="${width}" height="${height}" fill="white" stroke="#ccc" stroke-width="1"/>
    <text x="${width/2}" y="15" text-anchor="middle" class="region-label" font-size="10">
      ${regionName.replace('Hex', '')}
    </text>\n`;

    // Add major locations and towns
    if (data.dynamic && data.dynamic.mapItems) {
      const townItems = data.dynamic.mapItems.filter(item => 
        this.warApi.isIconType(item.iconType) && 
        this.warApi.iconTypes[item.iconType].type === 'town'
      );
      
      townItems.forEach((item, index) => {
        const iconX = (item.x / 1024) * width;
        const iconY = (item.y / 1024) * height;
        const teamClass = item.teamId === 'COLONIALS' ? 'colonial' : 
                         item.teamId === 'WARDENS' ? 'warden' : 'neutral';
        
        svg += `    <circle cx="${iconX}" cy="${iconY}" r="4" class="town ${teamClass}"/>\n`;
      });
    }

    // Add major labels from static data
    if (data.static && data.static.mapTextItems) {
      const majorLabels = data.static.mapTextItems.filter(item => item.mapMarkerType === 'Major');
      
      majorLabels.slice(0, 3).forEach((label, index) => {
        const labelX = (label.x / 1024) * width;
        const labelY = (label.y / 1024) * height + 20;
        
        svg += `    <text x="${labelX}" y="${labelY}" text-anchor="middle" font-size="8" fill="#333">
      ${label.text.substring(0, 12)}
    </text>\n`;
      });
    }

    svg += '  </g>';
    return svg;
  }

  generateLegend(x, y) {
    // Calculate current statistics
    let colonialRegions = 0;
    let wardenRegions = 0;
    let contestedRegions = 0;
    let neutralRegions = 0;
    let totalTowns = 0;
    let colonialTowns = 0;
    let wardenTowns = 0;
    
    for (const [, data] of this.mapData) {
      const regionControl = this.getRegionControl(data.dynamic);
      switch(regionControl) {
        case 'colonial': colonialRegions++; break;
        case 'warden': wardenRegions++; break;
        case 'contested': contestedRegions++; break;
        default: neutralRegions++;
      }
      
      // Count victory points
      if (data.dynamic && data.dynamic.mapItems) {
        for (const item of data.dynamic.mapItems) {
          if (this.warApi.isIconType(item.iconType) && this.warApi.iconTypes[item.iconType].conquer) {
            totalTowns++;
            if (item.teamId === 'COLONIALS') colonialTowns++;
            else if (item.teamId === 'WARDENS') wardenTowns++;
          }
        }
      }
    }
    
    return `\n  <!-- Legend -->
  <g transform="translate(${x},${y})">
    <rect width="180" height="140" fill="white" stroke="black" stroke-width="1" rx="5"/>
    <text x="90" y="18" text-anchor="middle" style="font-family: 'Segoe UI', sans-serif; font-size: 12px; font-weight: 600; fill: black;">War ${this.warNumber || '127'} Status</text>
    
    <!-- Colonial Info -->
    <rect x="10" y="25" width="15" height="12" class="colonial-region" />
    <text x="30" y="35" style="font-family: 'Segoe UI', sans-serif; font-size: 10px; fill: black;">Colonial: ${colonialRegions} regions (${colonialTowns} VP)</text>
    
    <!-- Warden Info -->
    <rect x="10" y="42" width="15" height="12" class="warden-region" />
    <text x="30" y="52" style="font-family: 'Segoe UI', sans-serif; font-size: 10px; fill: black;">Warden: ${wardenRegions} regions (${wardenTowns} VP)</text>
    
    <!-- Contested Info -->
    <rect x="10" y="59" width="15" height="12" class="contested-region" />
    <text x="30" y="69" style="font-family: 'Segoe UI', sans-serif; font-size: 10px; fill: black;">Contested: ${contestedRegions} regions</text>
    
    <!-- Neutral Info -->
    <rect x="10" y="76" width="15" height="12" class="neutral-region" />
    <text x="30" y="86" style="font-family: 'Segoe UI', sans-serif; font-size: 10px; fill: black;">Neutral: ${neutralRegions} regions</text>
    
    <text x="90" y="112" text-anchor="middle" style="font-family: 'Segoe UI', sans-serif; font-size: 9px; fill: black;">Victory Points: ${totalTowns} total</text>
    
    <text x="90" y="128" text-anchor="middle" style="font-family: 'Segoe UI', sans-serif; font-size: 8px; fill: black;">
      Generated: ${new Date().toLocaleString()}
    </text>
  </g>`;
  }

  async generateAndSave() {
    try {
      await this.fetchAllMapData();
      const svg = this.generateSVG();
      
      // Ensure output directory exists
      await fs.mkdir('/app/output', { recursive: true });
      
      // Save SVG file
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `/app/output/foxhole-map-${timestamp}.svg`;
      
      await fs.writeFile(filename, svg);
      console.log(`SVG map generated: ${filename}`);
      
      // Also save as latest.svg for easy access
      await fs.writeFile('/app/output/latest.svg', svg);
      console.log('Saved as latest.svg');
      
      return filename;
    } catch (error) {
      console.error('Error generating SVG:', error);
      throw error;
    }
  }

  async generateAndSaveSVG() {
    return await this.generateAndSave();
  }

  async generateAndSaveEpaperSVG() {
    try {
      await this.fetchAllMapData();
      const svg = this.generateEpaperSVG();
      
      // Ensure output directory exists
      await fs.mkdir('/app/output', { recursive: true });
      
      // Save e-paper SVG file
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `/app/output/foxhole-map-epaper-${timestamp}.svg`;
      
      await fs.writeFile(filename, svg);
      console.log(`E-paper SVG map generated: ${filename}`);
      
      // Also save as latest-epaper.svg for easy access
      await fs.writeFile('/app/output/latest-epaper.svg', svg);
      console.log('Saved as latest-epaper.svg');
      
      return filename;
    } catch (error) {
      console.error('Error generating e-paper SVG:', error);
      throw error;
    }
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const generator = new FoxholeSVGGenerator();
  generator.generateAndSave()
    .then(filename => console.log(`✓ Map generated successfully: ${filename}`))
    .catch(error => {
      console.error('✗ Generation failed:', error);
      process.exit(1);
    });
}

export default FoxholeSVGGenerator;