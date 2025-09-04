#!/usr/bin/env node

import express from 'express';
import DataUpdater from './data-updater.js';
import FoxholeSVGGenerator from './generate-svg.js';

const app = express();
const port = process.env.PORT || 3000;

// Start the tracking service
const dataUpdater = new DataUpdater();

// Start tracking service in background
dataUpdater.start().catch(error => {
  console.error('Failed to start tracking service:', error);
});

// Basic web server setup
app.use(express.static('public'));

// Simple web interface
app.get('/', (req, res) => {
  const status = dataUpdater.getConquerStatus();
  const trackedTowns = Object.keys(status.features).length;
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Foxhole SVG Generator</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        .status { background: #f0f0f0; padding: 20px; border-radius: 5px; margin: 20px 0; }
        .button { background: #007cba; color: white; padding: 10px 20px; text-decoration: none; border-radius: 3px; display: inline-block; margin: 5px; }
        .button:hover { background: #005a87; }
      </style>
    </head>
    <body>
      <h1>Foxhole SVG Generator</h1>
      
      <div class="status">
        <h3>Status</h3>
        <p><strong>Tracking Service:</strong> ${dataUpdater.isRunning ? 'Running' : 'Stopped'}</p>
        <p><strong>Tracked Towns:</strong> ${trackedTowns}</p>
        <p><strong>Last Update:</strong> ${new Date().toLocaleString()}</p>
      </div>
      
      <div class="status">
        <h3>Recent Captures (Last 48 Hours)</h3>
        <div id="recentCaptures">
          <p>Loading recent captures...</p>
        </div>
      </div>
      
      <h3>Actions</h3>
      <a href="/api/generate-svg" class="button">Download SVG</a>
      <a href="/api/generate-svg" class="button" onclick="generateAndSave(event)">Generate & Save</a>
      <a href="/view-svg" class="button">View Latest SVG</a>
      <a href="/api/generate-epaper-svg" class="button">Download E-Paper SVG</a>
      <a href="/api/generate-epaper-svg" class="button" onclick="generateAndSaveEpaper(event)">Generate & Save E-Paper</a>
      <a href="/view-epaper-svg" class="button">View Latest E-Paper SVG</a>
      <a href="/health" class="button">Health Check</a>
      
      <script>
        function generateAndSave(e) {
          e.preventDefault();
          fetch('/api/generate-svg', { method: 'POST' })
            .then(response => response.json())
            .then(data => {
              if (data.success) {
                alert('SVG generated and saved successfully!');
                loadRecentCaptures(); // Refresh the captures display
              } else {
                alert('Error: ' + data.error);
              }
            })
            .catch(error => {
              alert('Error: ' + error);
            });
        }
        
        function generateAndSaveEpaper(e) {
          e.preventDefault();
          fetch('/api/generate-epaper-svg', { method: 'POST' })
            .then(response => response.json())
            .then(data => {
              if (data.success) {
                alert('E-Paper SVG generated and saved successfully!');
                loadRecentCaptures(); // Refresh the captures display
              } else {
                alert('Error: ' + data.error);
              }
            })
            .catch(error => {
              alert('Error: ' + error);
            });
        }
        
        function loadRecentCaptures() {
          fetch('/api/conquerStatus')
            .then(response => response.json())
            .then(data => {
              const now = Date.now();
              const fortyEightHours = 48 * 60 * 60 * 1000;
              const recentCaptures = [];
              
              // Process recent captures
              for (const [id, feature] of Object.entries(data.features)) {
                if (feature.lastChange && (now - feature.lastChange) < fortyEightHours) {
                  recentCaptures.push({
                    id,
                    team: feature.team,
                    lastChange: feature.lastChange,
                    timeSinceCapture: now - feature.lastChange
                  });
                }
              }
              
              // Sort by most recent first
              recentCaptures.sort((a, b) => a.timeSinceCapture - b.timeSinceCapture);
              
              // Take top 8 for each team
              const wardenCaptures = recentCaptures
                .filter(capture => capture.team === 'WARDENS' || capture.team === 'Warden')
                .slice(0, 8);
              
              const colonialCaptures = recentCaptures
                .filter(capture => capture.team === 'COLONIALS' || capture.team === 'Colonial')
                .slice(0, 8);
              
              // Display captures
              let html = '<div style="display: flex; gap: 20px;">';
              
              // Warden captures
              html += '<div style="flex: 1;"><h4 style="color: #245682;">Warden Captures</h4>';
              if (wardenCaptures.length > 0) {
                wardenCaptures.forEach(capture => {
                  const hours = Math.floor(capture.timeSinceCapture / (60 * 60 * 1000));
                  const minutes = Math.floor((capture.timeSinceCapture % (60 * 60 * 1000)) / (60 * 1000));
                  const timeText = hours > 0 ? hours + 'h ' + minutes + 'm ago' : minutes + 'm ago';
                  html += '<p style="margin: 5px 0; color: #245682;">' + timeText + '</p>';
                });
              } else {
                html += '<p style="color: #666;">No recent captures</p>';
              }
              html += '</div>';
              
              // Colonial captures
              html += '<div style="flex: 1;"><h4 style="color: #516C4B;">Colonial Captures</h4>';
              if (colonialCaptures.length > 0) {
                colonialCaptures.forEach(capture => {
                  const hours = Math.floor(capture.timeSinceCapture / (60 * 60 * 1000));
                  const minutes = Math.floor((capture.timeSinceCapture % (60 * 60 * 1000)) / (60 * 1000));
                  const timeText = hours > 0 ? hours + 'h ' + minutes + 'm ago' : minutes + 'm ago';
                  html += '<p style="margin: 5px 0; color: #516C4B;">' + timeText + '</p>';
                });
              } else {
                html += '<p style="color: #666;">No recent captures</p>';
              }
              html += '</div>';
              
              html += '</div>';
              document.getElementById('recentCaptures').innerHTML = html;
            })
            .catch(error => {
              document.getElementById('recentCaptures').innerHTML = '<p style="color: red;">Error loading captures: ' + error.message + '</p>';
            });
        }
        
        // Load recent captures when page loads
        loadRecentCaptures();
      </script>
    </body>
    </html>
  `);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    tracking: dataUpdater.isRunning,
    trackedTowns: Object.keys(dataUpdater.getConquerStatus().features).length
  });
});

// Get current conquerStatus data
app.get('/api/conquerStatus', (req, res) => {
  res.json(dataUpdater.getConquerStatus());
});

// Generate SVG map
app.get('/api/generate-svg', async (req, res) => {
  try {
    console.log('Generating SVG map...');
    
    const generator = new FoxholeSVGGenerator();
    generator.conquerStatus = dataUpdater.getConquerStatus();
    
    const svg = await generator.generateSVG();
    
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Content-Disposition', 'attachment; filename="foxhole-map.svg"');
    res.send(svg);
    
    console.log('SVG generated successfully');
  } catch (error) {
    console.error('Error generating SVG:', error);
    res.status(500).json({ error: 'Failed to generate SVG' });
  }
});

// Generate and save SVG to file
app.post('/api/generate-svg', async (req, res) => {
  try {
    console.log('Generating and saving SVG map...');
    
    const generator = new FoxholeSVGGenerator();
    generator.conquerStatus = dataUpdater.getConquerStatus();
    
    await generator.generateAndSaveSVG();
    
    res.json({ 
      success: true, 
      message: 'SVG generated and saved',
      files: ['latest.svg', `foxhole-map-${new Date().toISOString().replace(/[:.]/g, '-')}.svg`]
    });
    
    console.log('SVG generated and saved successfully');
  } catch (error) {
    console.error('Error generating SVG:', error);
    res.status(500).json({ error: 'Failed to generate SVG' });
  }
});

// Generate e-paper SVG map
app.get('/api/generate-epaper-svg', async (req, res) => {
  try {
    console.log('Generating e-paper SVG map...');
    
    const generator = new FoxholeSVGGenerator();
    generator.conquerStatus = dataUpdater.getConquerStatus();
    
    const svg = await generator.generateEpaperSVG();
    
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Content-Disposition', 'attachment; filename="foxhole-map-epaper.svg"');
    res.send(svg);
    
    console.log('E-paper SVG generated successfully');
  } catch (error) {
    console.error('Error generating e-paper SVG:', error);
    res.status(500).json({ error: 'Failed to generate e-paper SVG' });
  }
});

// Generate and save e-paper SVG to file
app.post('/api/generate-epaper-svg', async (req, res) => {
  try {
    console.log('Generating and saving e-paper SVG map...');
    
    const generator = new FoxholeSVGGenerator();
    generator.conquerStatus = dataUpdater.getConquerStatus();
    
    await generator.generateAndSaveEpaperSVG();
    
    res.json({ 
      success: true, 
      message: 'E-paper SVG generated and saved',
      files: ['latest-epaper.svg', `foxhole-map-epaper-${new Date().toISOString().replace(/[:.]/g, '-')}.svg`]
    });
    
    console.log('E-paper SVG generated and saved successfully');
  } catch (error) {
    console.error('Error generating e-paper SVG:', error);
    res.status(500).json({ error: 'Failed to generate e-paper SVG' });
  }
});

// View the latest e-paper SVG in the browser
app.get('/view-epaper-svg', async (req, res) => {
  try {
    const fs = await import('fs');
    const path = await import('path');
    
    // Check if latest-epaper.svg exists
    const svgPath = path.join(process.cwd(), 'output', 'latest-epaper.svg');
    
    if (!fs.existsSync(svgPath)) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>E-Paper SVG Not Found</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 40px; text-align: center; }
            .error { background: #ffe6e6; padding: 20px; border-radius: 5px; margin: 20px 0; }
            .button { background: #007cba; color: white; padding: 10px 20px; text-decoration: none; border-radius: 3px; display: inline-block; margin: 5px; }
          </style>
        </head>
        <body>
          <h1>E-Paper SVG Not Found</h1>
          <div class="error">
            <p>No e-paper SVG file found. Please generate one first.</p>
          </div>
          <a href="/" class="button">Back to Home</a>
          <a href="/api/generate-epaper-svg" class="button" onclick="generateAndSaveEpaper(event)">Generate E-Paper SVG</a>
          <script>
            function generateAndSaveEpaper(e) {
              e.preventDefault();
              fetch('/api/generate-epaper-svg', { method: 'POST' })
                .then(response => response.json())
                .then(data => {
                  if (data.success) {
                    window.location.href = '/view-epaper-svg';
                  } else {
                    alert('Error: ' + data.error);
                  }
                })
                .catch(error => {
                  alert('Error: ' + error);
                });
            }
          </script>
        </body>
        </html>
      `);
    }
    
    // Read and serve the SVG
    const svgContent = fs.readFileSync(svgPath, 'utf8');
    
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Foxhole Map - Latest E-Paper SVG</title>
        <style>
          body { 
            font-family: Arial, sans-serif; 
            margin: 0; 
            padding: 20px; 
            background: #f5f5f5; 
          }
          .header { 
            background: white; 
            padding: 20px; 
            border-radius: 5px; 
            margin-bottom: 20px; 
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          }
          .svg-container { 
            background: white; 
            padding: 20px; 
            border-radius: 5px; 
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            text-align: center;
          }
          .svg-container svg { 
            max-width: 100%; 
            height: auto; 
            border: 1px solid #ddd;
          }
          .button { 
            background: #007cba; 
            color: white; 
            padding: 10px 20px; 
            text-decoration: none; 
            border-radius: 3px; 
            display: inline-block; 
            margin: 5px; 
          }
          .button:hover { background: #005a87; }
          .controls { margin-bottom: 20px; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Foxhole Map - Latest E-Paper SVG (800x480)</h1>
          <div class="controls">
            <a href="/" class="button">Back to Home</a>
            <a href="/api/generate-epaper-svg" class="button">Download E-Paper SVG</a>
            <a href="/api/generate-epaper-svg" class="button" onclick="regenerateAndRefresh(event)">Regenerate E-Paper SVG</a>
          </div>
        </div>
        
        <div class="svg-container">
          ${svgContent}
        </div>
        
        <script>
          function regenerateAndRefresh(e) {
            e.preventDefault();
            if (confirm('This will regenerate the e-paper SVG. Continue?')) {
              fetch('/api/generate-epaper-svg', { method: 'POST' })
                .then(response => response.json())
                .then(data => {
                  if (data.success) {
                    window.location.reload();
                  } else {
                    alert('Error: ' + data.error);
                  }
                })
                .catch(error => {
                  alert('Error: ' + error);
                });
            }
          }
        </script>
      </body>
      </html>
    `);
    
  } catch (error) {
    console.error('Error viewing e-paper SVG:', error);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Error</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 40px; text-align: center; }
          .error { background: #ffe6e6; padding: 20px; border-radius: 5px; margin: 20px 0; }
          .button { background: #007cba; color: white; padding: 10px 20px; text-decoration: none; border-radius: 3px; display: inline-block; margin: 5px; }
        </style>
      </head>
      <body>
        <h1>Error</h1>
        <div class="error">
          <p>Failed to load e-paper SVG: ${error.message}</p>
        </div>
        <a href="/" class="button">Back to Home</a>
      </body>
      </html>
    `);
  }
});

// View the latest SVG in the browser
app.get('/view-svg', async (req, res) => {
  try {
    const fs = await import('fs');
    const path = await import('path');
    
    // Check if latest.svg exists
    const svgPath = path.join(process.cwd(), 'output', 'latest.svg');
    
    if (!fs.existsSync(svgPath)) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>SVG Not Found</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 40px; text-align: center; }
            .error { background: #ffe6e6; padding: 20px; border-radius: 5px; margin: 20px 0; }
            .button { background: #007cba; color: white; padding: 10px 20px; text-decoration: none; border-radius: 3px; display: inline-block; margin: 5px; }
          </style>
        </head>
        <body>
          <h1>SVG Not Found</h1>
          <div class="error">
            <p>No SVG file found. Please generate one first.</p>
          </div>
          <a href="/" class="button">Back to Home</a>
          <a href="/api/generate-svg" class="button" onclick="generateAndSave(event)">Generate SVG</a>
          <script>
            function generateAndSave(e) {
              e.preventDefault();
              fetch('/api/generate-svg', { method: 'POST' })
                .then(response => response.json())
                .then(data => {
                  if (data.success) {
                    window.location.href = '/view-svg';
                  } else {
                    alert('Error: ' + data.error);
                  }
                })
                .catch(error => {
                  alert('Error: ' + error);
                });
            }
          </script>
        </body>
        </html>
      `);
    }
    
    // Read and serve the SVG
    const svgContent = fs.readFileSync(svgPath, 'utf8');
    
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Foxhole Map - Latest SVG</title>
        <style>
          body { 
            font-family: Arial, sans-serif; 
            margin: 0; 
            padding: 20px; 
            background: #f5f5f5; 
          }
          .header { 
            background: white; 
            padding: 20px; 
            border-radius: 5px; 
            margin-bottom: 20px; 
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          }
          .svg-container { 
            background: white; 
            padding: 20px; 
            border-radius: 5px; 
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            text-align: center;
          }
          .svg-container svg { 
            max-width: 100%; 
            height: auto; 
            border: 1px solid #ddd;
          }
          .button { 
            background: #007cba; 
            color: white; 
            padding: 10px 20px; 
            text-decoration: none; 
            border-radius: 3px; 
            display: inline-block; 
            margin: 5px; 
          }
          .button:hover { background: #005a87; }
          .controls { margin-bottom: 20px; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Foxhole Map - Latest SVG</h1>
          <div class="controls">
            <a href="/" class="button">Back to Home</a>
            <a href="/api/generate-svg" class="button">Download SVG</a>
            <a href="/api/generate-svg" class="button" onclick="regenerateAndRefresh(event)">Regenerate SVG</a>
          </div>
        </div>
        
        <div class="svg-container">
          ${svgContent}
        </div>
        
        <script>
          function regenerateAndRefresh(e) {
            e.preventDefault();
            if (confirm('This will regenerate the SVG. Continue?')) {
              fetch('/api/generate-svg', { method: 'POST' })
                .then(response => response.json())
                .then(data => {
                  if (data.success) {
                    window.location.reload();
                  } else {
                    alert('Error: ' + data.error);
                  }
                })
                .catch(error => {
                  alert('Error: ' + error);
                });
            }
          }
        </script>
      </body>
      </html>
    `);
    
  } catch (error) {
    console.error('Error viewing SVG:', error);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Error</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 40px; text-align: center; }
          .error { background: #ffe6e6; padding: 20px; border-radius: 5px; margin: 20px 0; }
          .button { background: #007cba; color: white; padding: 10px 20px; text-decoration: none; border-radius: 3px; display: inline-block; margin: 5px; }
        </style>
      </head>
      <body>
        <h1>Error</h1>
        <div class="error">
          <p>Failed to load SVG: ${error.message}</p>
        </div>
        <a href="/" class="button">Back to Home</a>
      </body>
      </html>
    `);
  }
});

// Start the web server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Tracking service: ${dataUpdater.isRunning ? 'running' : 'stopped'}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  dataUpdater.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down gracefully...');
  dataUpdater.close();
  process.exit(0);
});
