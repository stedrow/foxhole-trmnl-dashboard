# Foxhole SVG Map Generator

A lightweight Docker container that generates SVG maps of Foxhole with accurate sub-region coloring and alpha channel variation, optimized for e-paper displays.

## Features

- **Accurate Sub-region Coloring**: Matches warden.express color logic with proper alpha channels
- **Town Control Tracking**: SQLite database tracks real `lastChange` timestamps
- **Live Data Updates**: Background service updates every 5 minutes
- **E-paper Optimized**: High contrast colors and clear typography
- **Single Container**: Everything runs in one Docker container
- **Web Interface**: Easy-to-use UI for map generation
- **API Endpoints**: Programmatic access to all features

## Quick Start

### 1. Build and Start
```bash
# Start everything (recommended)
make service

# Or build manually
make build
docker-compose up -d
```

### 2. Generate SVG Map
```bash
# Generate and save SVG
make generate

# Download SVG directly
make download

# Use web interface
# Visit http://localhost:3000
```

### 3. Complete Setup
```bash
# One-command setup
make quickstart
```

## Architecture

### Single Container Design
```
foxhole-svg Container:
├── Web Server (port 3000)
│   ├── Web Interface (/)
│   ├── Health Check (/health)
│   ├── API Endpoints (/api/*)
│   └── Static Files
├── Tracking Service (background)
│   ├── Updates every 5 minutes
│   ├── SQLite database
│   └── Town control tracking
└── SVG Generation (on-demand)
    ├── GET /api/generate-svg (download)
    └── POST /api/generate-svg (save to file)
```

### Database Schema
```sql
CREATE TABLE towns (
  id TEXT PRIMARY KEY,           -- Unique town ID
  iconType TEXT NOT NULL,        -- Town type (TownHall, RelicBase, etc.)
  x REAL NOT NULL,               -- X coordinate
  y REAL NOT NULL,               -- Y coordinate
  region TEXT NOT NULL,          -- Region name
  currentTeam TEXT NOT NULL,     -- Current controlling team
  lastTeam TEXT,                 -- Previous team
  lastChange INTEGER NOT NULL,   -- Timestamp of last team change
  notes TEXT,                    -- Town name/notes
  created_at INTEGER,            -- Record creation time
  updated_at INTEGER             -- Last update time
);
```

### Data Flow
1. **Data Updater Service** runs every 5 minutes
2. Fetches dynamic map data from Foxhole API
3. Compares current team with stored team
4. Updates `lastChange` timestamp when team changes
5. **SVG Generator** reads tracked data
6. Applies alpha channel variation based on `lastChange`

## Commands

### Service Management
```bash
# Start server with tracking service
make service

# Stop server
make service-stop

# Restart server
make service-restart

# View service logs
make service-logs

# Check health status
make status

# Show tracking data
make conquer-status
```

### SVG Generation
```bash
# Generate and save SVG
make generate

# Download SVG directly
make download

# Quick generation
make svg

# Web interface
# Visit http://localhost:3000
```

### Development
```bash
# Open shell in container
make shell

# Run in development mode
make dev

# Test container build
make test

# Health check
make health-check
```

### File Operations
```bash
# List generated maps
make list-maps

# Show latest map info
make show-latest

# Backup maps and data
make backup
```

### Cleanup
```bash
# Stop and remove containers
make service-down

# Clean everything
make clean

# Remove everything including volumes
make clean-all
```

## API Endpoints

When running the web server:

- `GET /` - Web interface
- `GET /health` - Health check
- `POST /api/generate-svg` - Generate and save SVG map
- `GET /api/generate-svg` - Download SVG map
- `GET /api/conquerStatus` - Get current tracking data

## Usage Examples

### For TRMNL E-Paper Display

1. Generate the SVG:
```bash
make generate
```

2. Download the map:
```bash
make download
```

3. The SVG is optimized for e-paper displays with:
   - High contrast colors
   - Clear typography
   - Simplified graphics
   - Appropriate sizing for small screens

### Automated Updates

Set up a cron job or scheduled task to generate updated maps:

```bash
# Generate map every 30 minutes
*/30 * * * * make generate
```

## Configuration

### Update Interval
Modify `updateInterval` in `src/data-updater.js`:
```javascript
this.updateInterval = 5 * 60 * 1000; // 5 minutes
```

### Database Location
The SQLite database is stored in `data/towns.db`

### Data Retention
Old records are automatically cleaned up after 30 days by default.

### Environment Variables
- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment mode (default: production)

## Alpha Channel Logic

The system uses the same alpha channel calculation as the main warden.express project:

```javascript
if (timeSinceCapture >= 86400000) { // 24 hours
  alpha = 'BB';
} else {
  const alphaValue = Math.floor(255 - (timeSinceCapture / 86400000) * 68);
  alpha = alphaValue.toString(16).padStart(2, '0');
}
```

This creates visual variation where:
- Recently captured towns have higher alpha (more opaque)
- Towns captured >24 hours ago have lower alpha (more transparent)

## Output

SVG files are saved to the `output/` directory with:
- Timestamped filenames: `foxhole-map-2024-01-15T10-30-00-000Z.svg`
- Latest map: `latest.svg`

## Map Features

The generated SVG includes:
- **Regions**: All 40+ Foxhole hexagonal regions
- **Sub-regions**: Voronoi-based sub-regions with accurate coloring
- **Team Control**: Color-coded Colonial (green) vs Warden (blue) territories
- **Victory Points**: Towns, keeps, and relic bases that determine war outcome
- **Major Landmarks**: Important locations and geographical features
- **Legend**: Clear identification of map symbols
- **Timestamp**: When the map was generated

## File Structure

```
foxhole-svg/
├── Dockerfile                    # Container definition
├── docker-compose.yml           # Single container setup
├── package.json                 # Dependencies & scripts
├── Makefile                     # Build & management commands
├── src/
│   ├── generate-svg.js          # Main SVG generation logic
│   ├── warapi.js               # Foxhole War API client
│   ├── server-with-tracking.js  # Combined web server + tracking
│   ├── data-updater.js         # Background data tracking service
│   └── database.js             # SQLite database management
├── public/
│   └── static.json             # Static map data
├── output/                      # Generated SVG files
├── data/                        # SQLite database files
└── README.md                    # This file
```

## Technical Details

- **Node.js 20+** runtime
- **Foxhole War API** for live game data
- **SVG generation** optimized for e-paper displays
- **Express.js** web server for API endpoints
- **SQLite** database for town control tracking
- **Docker** containerization for easy deployment

## Benefits

1. **Accurate Data**: Real `lastChange` timestamps from actual team changes
2. **Self-Contained**: No dependency on external WebSocket services
3. **Persistent**: Data survives container restarts
4. **Efficient**: Only updates when team control actually changes
5. **Scalable**: Can run as a background service
6. **Single Container**: Simple deployment and management

## Troubleshooting

### Service Won't Start
- Check if port 3000 is available
- Verify Foxhole API is accessible
- Check logs: `make service-logs`

### No Alpha Variation
- Ensure tracking service is running
- Check database has data: `make conquer-status`
- Verify town coordinates match between API and database

### Database Issues
- Database is automatically created on first run
- Check `data/towns.db` exists and is writable
- Reset database by deleting `data/towns.db` and restarting service

### Container Issues
- Check container status: `make ps`
- View resource usage: `make stats`
- Restart service: `make service-restart`

## License

Based on the Foxhole Map Annotate project. See original repository for license details.