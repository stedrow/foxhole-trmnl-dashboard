import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import logger from "./logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class TownTracker {
  constructor() {
    this.dbPath = join(__dirname, "..", "data", "towns.db");
    this.db = new Database(this.dbPath);
    this.initDatabase();
  }

  initDatabase() {
    // Create towns table to track control changes
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS towns (
        id TEXT PRIMARY KEY,
        iconType TEXT NOT NULL,
        x REAL NOT NULL,
        y REAL NOT NULL,
        region TEXT NOT NULL,
        currentTeam TEXT NOT NULL,
        lastTeam TEXT,
        lastChange INTEGER NOT NULL,
        notes TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);

    // Create index for faster lookups
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_towns_region ON towns(region);
      CREATE INDEX IF NOT EXISTS idx_towns_coords ON towns(x, y);
    `);

    logger.debug("Database initialized");
  }

  // Generate a unique ID for a town based on its coordinates and icon type
  generateTownId(iconType, x, y) {
    return `${iconType}_${Math.round(x * 1000)}_${Math.round(y * 1000)}`;
  }

  // Update town control status
  updateTownControl(iconType, x, y, region, team, notes = null) {
    const townId = this.generateTownId(iconType, x, y);
    const now = Date.now();

    // First, get the current town data if it exists
    const currentTown = this.getTownControl(iconType, x, y);

    let lastTeam = null;
    let lastChange = now;
    let teamChanged = false;

    if (currentTown) {
      // If team has changed, update lastTeam and lastChange
      if (currentTown.currentTeam !== team) {
        lastTeam = currentTown.currentTeam;
        lastChange = now;
        teamChanged = true;
      } else {
        // Team hasn't changed, keep existing values
        lastTeam = currentTown.lastTeam;
        lastChange = currentTown.lastChange;
      }
    }

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO towns
      (id, iconType, x, y, region, currentTeam, lastTeam, lastChange, notes, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      townId,
      iconType,
      x,
      y,
      region,
      team,
      lastTeam,
      lastChange,
      notes,
      now,
    );

    if (teamChanged) {
      logger.info(
        `Town captured: ${notes || townId} (${region}) ${lastTeam} -> ${team}`,
      );
    }

    logger.debug(
      `Updated town ${townId}: team=${team}, lastChange=${new Date(now).toISOString()}`,
    );

    return result;
  }

  // Get town control status
  getTownControl(iconType, x, y) {
    const townId = this.generateTownId(iconType, x, y);

    const stmt = this.db.prepare(`
      SELECT * FROM towns WHERE id = ?
    `);

    return stmt.get(townId);
  }

  // Get all towns for a region
  getTownsInRegion(region) {
    const stmt = this.db.prepare(`
      SELECT * FROM towns WHERE region = ?
    `);

    return stmt.all(region);
  }

  // Get all towns
  getAllTowns() {
    const stmt = this.db.prepare(`
      SELECT * FROM towns ORDER BY region, x, y
    `);

    return stmt.all();
  }

  // Convert database records to conquerStatus format
  getConquerStatus() {
    const towns = this.getAllTowns();
    const features = {};

    towns.forEach((town) => {
      features[town.id] = {
        team: town.currentTeam,
        lastChange: town.lastChange,
        lastTeam: town.lastTeam,
        notes: town.notes,
        iconType: town.iconType,
        x: town.x,
        y: town.y,
        region: town.region,
      };
    });

    return {
      version: Date.now().toString(),
      features: features,
      warNumber: 127, // This should be dynamic
      full: true,
    };
  }

  // Clean up old records (optional)
  cleanupOldRecords(daysToKeep = 30) {
    const cutoffTime = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;

    const stmt = this.db.prepare(`
      DELETE FROM towns WHERE updated_at < ?
    `);

    const result = stmt.run(cutoffTime);
    console.log(`Cleaned up ${result.changes} old records`);

    return result;
  }

  // Close database connection
  close() {
    this.db.close();
  }
}

export default TownTracker;
