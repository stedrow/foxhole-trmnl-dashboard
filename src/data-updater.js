import WarApi from "./warapi.js";
import TownTracker from "./database.js";
import fs from "fs/promises";

class DataUpdater {
  constructor() {
    this.warApi = new WarApi();
    this.tracker = new TownTracker();
    this.isRunning = false;
    this.updateInterval = 5 * 60 * 1000; // 5 minutes
    this.terminusPoster = null; // Will be set by the server
  }

  async start() {
    if (this.isRunning) {
      console.log("Data updater is already running");
      return;
    }

    this.isRunning = true;
    console.log("Starting data updater service...");

    // Do initial update
    await this.updateData();

    // Set up periodic updates
    this.intervalId = setInterval(async () => {
      await this.updateData();
    }, this.updateInterval);
  }

  stop() {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    console.log("Data updater service stopped");
  }

  async updateData() {
    try {
      console.log("Updating town control data...");

      // Load static data from local file (same as SVG generator)
      const staticFile = await fs.readFile("/app/public/static.json", "utf8");
      const staticData = JSON.parse(staticFile);
      const regions = staticData.features.filter(
        (f) => f.properties.type === "Region",
      );

      let totalUpdates = 0;

      // Process each region
      for (const region of regions) {
        try {
          const regionName = region.id;

          // Get dynamic data for this region
          const dynamicData = await this.warApi.getDynamicMap(regionName);

          if (!dynamicData || !dynamicData.mapItems) {
            continue;
          }

          // Process conquerable towns in this region
          const conquerableTowns = dynamicData.mapItems.filter(
            (item) =>
              this.warApi.isIconType(item.iconType) &&
              this.warApi.iconTypes[item.iconType].conquer,
          );

          for (const town of conquerableTowns) {
            const team = this.warApi.getTeam(town.teamId);
            const notes = this.warApi.iconTypes[town.iconType].notes;

            // Update town control in database
            const result = this.tracker.updateTownControl(
              town.iconType,
              town.x,
              town.y,
              regionName,
              team,
              notes,
            );

            if (result.changes > 0) {
              totalUpdates++;
            }
          }

          // Small delay to avoid overwhelming the API
          await new Promise((resolve) => setTimeout(resolve, 100));
        } catch (error) {
          console.error(`Error processing region ${region.id}:`, error.message);
        }
      }

      console.log(`Data update complete. Updated ${totalUpdates} towns.`);

      // If we have a Terminus poster, trigger it to post fresh data
      if (this.terminusPoster) {
        console.log("🔄 Triggering Terminus poster with fresh data...");
        try {
          // Get the fresh conquer status and pass it to the poster
          const freshConquerStatus = this.getConquerStatus();
          await this.terminusPoster.generateAndPostWithFreshData(
            freshConquerStatus,
          );
        } catch (error) {
          console.error("Error triggering Terminus poster:", error);
        }
      }
    } catch (error) {
      console.error("Error updating data:", error);
    }
  }

  // Set the Terminus poster instance
  setTerminusPoster(poster) {
    this.terminusPoster = poster;
  }

  // Get current conquerStatus data
  getConquerStatus() {
    return this.tracker.getConquerStatus();
  }

  // Cleanup old records
  cleanup() {
    this.tracker.cleanupOldRecords();
  }

  // Close connections
  close() {
    this.stop();
    this.tracker.close();
  }
}

export default DataUpdater;
