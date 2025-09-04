#!/usr/bin/env node

import fs from 'fs/promises';
import FoxholeSVGGenerator from './generate-svg.js';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// Load environment variables
const TERMINUS_URL = process.env.TERMINUS_URL;
const DEVICE_API_KEY = process.env.DEVICE_API_KEY;

if (!TERMINUS_URL || !DEVICE_API_KEY) {
  console.error('Missing required environment variables: TERMINUS_URL and DEVICE_API_KEY');
  console.error('Please create a .env file with these variables');
  process.exit(1);
}

class TerminusPoster {
  constructor() {
    this.generator = new FoxholeSVGGenerator();
    this.screenId = null;
  }

  async getScreenId() {
    if (this.screenId) return this.screenId;

    try {
      const headers = {
        'Access-Token': DEVICE_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      };

      const screensUrl = `${TERMINUS_URL}/api/screens`;
      const response = await fetch(screensUrl, { headers });

      if (!response.ok) {
        console.error('Failed to fetch screens:', response.status, response.statusText);
        return null;
      }

      const data = await response.json();
      const screens = data.data || [];
      console.log(`Found ${screens.length} existing screens`);

      for (const screen of screens) {
        if (screen.name === 'foxhole_epaper_dashboard') {
          this.screenId = screen.id;
          console.log(`Found existing Foxhole screen: ${this.screenId}`);
          return this.screenId;
        }
      }

      return null;
    } catch (error) {
      console.error('Error fetching screen ID:', error);
      return null;
    }
  }



  async postToTerminus(svgContent) {
    try {
      const screenId = await this.getScreenId();
      const now = new Date();
      

      
      // Check if we're getting HTML instead of SVG
      if (svgContent.includes('<!DOCTYPE html>')) {
        console.log('❌ ERROR: generateEpaperSVG() returned HTML instead of SVG!');
        console.log('🔍 This suggests the SVG generation method is broken');
        return;
      }
      
      // Generate HTML wrapper for SVG
      const htmlContent = await this.generateAndSaveHTMLWrapper(svgContent);
      
      // Create data for HTML upload to Terminus API - using simplified SVG wrapper
      const data = {
        image: {
          content: htmlContent,
          file_name: `foxhole-epaper-${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}-${now.getHours().toString().padStart(2, '0')}-${now.getMinutes().toString().padStart(2, '0')}.html`,
          model_id: 1,
          label: "Foxhole E-Paper Map",
          name: "foxhole_epaper_dashboard"
        }
      };

      const headers = {
        'Access-Token': DEVICE_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      };

      let response;
      if (screenId) {
        // Update existing screen (PATCH only supports HTML content)
        const updateUrl = `${TERMINUS_URL}/api/screens/${screenId}`;
        console.log(`Updating existing Foxhole screen ${screenId}`);
        response = await fetch(updateUrl, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            image: {
              content: data.image.content,
              label: data.image.label,
              name: data.image.name
            }
          })
        });
      } else {
        // Create new screen
        const screensUrl = `${TERMINUS_URL}/api/screens`;
        console.log('Creating new Foxhole screen');
        response = await fetch(screensUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(data)
        });
      }

      if (response.ok) {
        const result = await response.json();
        console.log('Foxhole dashboard published successfully:', result);
        
        // If this was a new screen, save the ID
        if (!screenId && result.data && result.data.id) {
          this.screenId = result.data.id;
          console.log(`Saved new screen ID: ${this.screenId}`);
        }
      } else {
        const errorText = await response.text();
        console.error('Error publishing Foxhole dashboard:', response.status, errorText);
      }
    } catch (error) {
      console.error('Error posting to Terminus:', error);
    }
  }

  async generateAndPost() {
    try {
      console.log('Generating Foxhole e-paper SVG...');
      
      // Generate the SVG
      await this.generator.fetchAllMapData();
      const svg = this.generator.generateEpaperSVG();
      
      // Convert SVG to PNG and post to Terminus
      await this.postToTerminus(svg);
      
      console.log('E-paper HTML posted to Terminus successfully');
    } catch (error) {
      console.error('Error in generateAndPost:', error);
    }
  }

  // Generate HTML wrapper for SVG and save to output directory
  async generateAndSaveHTMLWrapper(svgContent) {
    try {

      
      const now = new Date();
      
      // Create HTML content that wraps the SVG (required by Terminus API)
      // Use the same approach as the working Python template - JavaScript insertion
      const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1.0">
    <title>Foxhole E-Paper Map</title>
    <style>
        body {
            margin: 0;
            padding: 0;
            background: white;
            font-family: Arial, sans-serif;
            width: 800px;
            height: 480px;
            overflow: hidden;
        }
        .svg-container {
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        svg {
            width: 100%;
            height: 100%;
            object-fit: contain;
            shape-rendering: crispEdges;
        }
    </style>
</head>
<body>
    <div class="svg-container">
        <div id="foxhole-map-svg"></div>
        <script>
            // Insert the SVG content directly (same approach as working Python template)
            document.getElementById('foxhole-map-svg').innerHTML = \`${svgContent}\`;
        </script>
    </div>
</body>
</html>`;
      

      
      return htmlContent;
    } catch (error) {
      console.error('❌ HTML wrapper generation failed:', error);
      throw error;
    }
  }

  // Method to generate and post with fresh conquer status from data updater
  async generateAndPostWithFreshData(conquerStatus) {
    try {

      
      // Set the fresh conquer status on the generator (same as web UI)
      this.generator.conquerStatus = conquerStatus;
      
      // Generate the SVG (same logic as web UI)
      await this.generator.fetchAllMapData();
      
      let svg;
      try {
        svg = this.generator.generateEpaperSVG();
      } catch (error) {
        console.error('SVG generation failed:', error);
        throw error;
      }
      
      // Post SVG to Terminus
      await this.postToTerminus(svg);
    } catch (error) {
      console.error('Error in generateAndPostWithFreshData:', error);
    }
  }

  async start() {
    console.log('Starting Terminus poster service...');
    
    // Initial run
    await this.generateAndPost();
    
    // Run every 5 minutes (300,000 ms) as fallback
    const interval = setInterval(async () => {
      await this.generateAndPost();
    }, 300000);
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log('Graceful shutdown requested');
      clearInterval(interval);
      process.exit(0);
    });
    
    process.on('SIGTERM', () => {
      console.log('Graceful shutdown requested');
      clearInterval(interval);
      process.exit(0);
    });
    
    console.log('Service started. Will post every 5 minutes. Press Ctrl+C to stop.');
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const poster = new TerminusPoster();
  poster.start().catch(error => {
    console.error('Failed to start service:', error);
    process.exit(1);
  });
}

export default TerminusPoster;
