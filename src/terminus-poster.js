#!/usr/bin/env node

import fs from "fs/promises";
import FoxholeSVGGenerator from "./generate-svg.js";
import dotenv from "dotenv";
import logger from "./logger.js";

// Load environment variables from .env file
dotenv.config();

// Load environment variables
const TERMINUS_URL = process.env.TERMINUS_URL;
const TERMINUS_LOGIN = process.env.TERMINUS_LOGIN;
const TERMINUS_PASSWORD = process.env.TERMINUS_PASSWORD;

if (!TERMINUS_URL || !TERMINUS_LOGIN || !TERMINUS_PASSWORD) {
  logger.error(
    "Missing required environment variables: TERMINUS_URL, TERMINUS_LOGIN, and TERMINUS_PASSWORD",
  );
  logger.error("Please create a .env file with these variables");
  logger.error("");
  logger.error("For Terminus 0.30.0+, you need to:");
  logger.error("1. Create a user account via the web UI at your Terminus URL");
  logger.error("2. Add TERMINUS_LOGIN=your_email and TERMINUS_PASSWORD=your_password to .env");
  logger.error("3. The old DEVICE_API_KEY authentication method is no longer supported");
  process.exit(1);
}

class TerminusPoster {
  constructor() {
    this.generator = new FoxholeSVGGenerator();
    this.screenId = null;
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiresAt = null;
    this.tokenRefreshBuffer = 5 * 60 * 1000; // Refresh 5 minutes before expiration
  }

  async authenticate() {
    // Check if current token is still valid
    if (this.accessToken && this.tokenExpiresAt) {
      const now = Date.now();
      // If token expires in more than 5 minutes, reuse it
      if (this.tokenExpiresAt - now > this.tokenRefreshBuffer) {
        return this.accessToken;
      }
      // Token is about to expire, refresh it
      logger.debug("Token expiring soon, refreshing...");
      return await this.refreshAccessToken();
    }

    try {
      logger.debug("Authenticating with Terminus...");
      const response = await fetch(`${TERMINUS_URL}/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          login: TERMINUS_LOGIN,
          password: TERMINUS_PASSWORD,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error("Authentication failed:", response.status, errorText);
        return null;
      }

      const data = await response.json();
      this.accessToken = data.access_token;
      this.refreshToken = data.refresh_token;
      // Token expires in 30 minutes by default
      this.tokenExpiresAt = Date.now() + (30 * 60 * 1000);
      logger.info("✅ Authentication successful");
      return this.accessToken;
    } catch (error) {
      logger.error("Error during authentication:", error);
      return null;
    }
  }

  async refreshAccessToken() {
    if (!this.refreshToken) {
      logger.debug("No refresh token available, re-authenticating...");
      // Clear tokens and re-authenticate
      this.accessToken = null;
      this.tokenExpiresAt = null;
      return await this.authenticate();
    }

    try {
      logger.debug("Refreshing access token...");
      const response = await fetch(`${TERMINUS_URL}/api/jwt`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          refresh_token: this.refreshToken,
        }),
      });

      if (!response.ok) {
        logger.debug("Token refresh failed, re-authenticating...");
        // Clear tokens and re-authenticate
        this.accessToken = null;
        this.refreshToken = null;
        this.tokenExpiresAt = null;
        return await this.authenticate();
      }

      const data = await response.json();
      this.accessToken = data.access_token;
      this.refreshToken = data.refresh_token;
      // Update expiration time for new token (30 minutes)
      this.tokenExpiresAt = Date.now() + (30 * 60 * 1000);
      logger.info("✅ Token refreshed successfully");
      return this.accessToken;
    } catch (error) {
      logger.error("Error refreshing token:", error);
      // Clear tokens and re-authenticate
      this.accessToken = null;
      this.refreshToken = null;
      this.tokenExpiresAt = null;
      return await this.authenticate();
    }
  }

  async getScreenId() {
    if (this.screenId) return this.screenId;

    try {
      const token = await this.authenticate();
      if (!token) return null;

      const headers = {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      };

      const screensUrl = `${TERMINUS_URL}/api/screens`;
      const response = await fetch(screensUrl, { headers });

      if (!response.ok) {
        logger.error(
          "Failed to fetch screens:",
          response.status,
          response.statusText,
        );
        return null;
      }

      const data = await response.json();
      const screens = data.data || [];
      logger.debug(`Found ${screens.length} existing screens`);

      for (const screen of screens) {
        if (screen.name === "foxhole_epaper_dashboard") {
          this.screenId = screen.id;
          logger.debug(`Found existing Foxhole screen: ${this.screenId}`);
          return this.screenId;
        }
      }

      return null;
    } catch (error) {
      logger.error("Error fetching screen ID:", error);
      return null;
    }
  }

  async postToTerminus(svgContent) {
    try {
      const token = await this.authenticate();
      if (!token) {
        logger.error("❌ Authentication failed, cannot post to Terminus");
        return;
      }

      const screenId = await this.getScreenId();
      const now = new Date();

      // Check if we're getting HTML instead of SVG
      if (svgContent.includes("<!DOCTYPE html>")) {
        logger.error(
          "❌ ERROR: generateEpaperSVG() returned HTML instead of SVG!",
        );
        logger.error("🔍 This suggests the SVG generation method is broken");
        return;
      }

      // Generate HTML wrapper for SVG
      const htmlContent = await this.generateAndSaveHTMLWrapper(svgContent);

      // Create data for HTML upload to Terminus API - using new schema
      const data = {
        screen: {
          content: htmlContent,
          file_name: `foxhole-epaper-${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, "0")}-${now.getDate().toString().padStart(2, "0")}-${now.getHours().toString().padStart(2, "0")}-${now.getMinutes().toString().padStart(2, "0")}.png`,
          model_id: "1",
          label: "Foxhole E-Paper Map",
          name: "foxhole_epaper_dashboard",
        },
      };

      const headers = {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      };

      let response;
      if (screenId) {
        // Update existing screen (PATCH only supports HTML content)
        const updateUrl = `${TERMINUS_URL}/api/screens/${screenId}`;
        logger.debug(`Updating existing Foxhole screen ${screenId}`);
        response = await fetch(updateUrl, {
          method: "PATCH",
          headers,
          body: JSON.stringify({
            screen: {
              content: data.screen.content,
              label: data.screen.label,
              name: data.screen.name,
            },
          }),
        });
      } else {
        // Create new screen
        const screensUrl = `${TERMINUS_URL}/api/screens`;
        logger.debug("Creating new Foxhole screen");
        response = await fetch(screensUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(data),
        });
      }

      if (response.ok) {
        const result = await response.json();
        const screenData = result.data;
        logger.info(
          `✅ Dashboard published (${screenData.width}x${screenData.height}, ${Math.round(screenData.size / 1024)}KB)`
        );
        logger.debug("Full response:", result);

        // If this was a new screen, save the ID
        if (!screenId && result.data && result.data.id) {
          this.screenId = result.data.id;
          logger.debug(`Saved new screen ID: ${this.screenId}`);
        }
      } else {
        const errorText = await response.text();
        logger.error(
          "❌ Error publishing Foxhole dashboard:",
          response.status,
          errorText,
        );

        // If it's an authentication error, try to refresh the token
        if (response.status === 401) {
          logger.info("🔄 Authentication error, trying to refresh token...");
          const newToken = await this.refreshAccessToken();
          if (newToken) {
            logger.info("🔄 Retrying with refreshed token...");
            // Retry the request with the new token
            return await this.postToTerminus(svgContent);
          }
        }
      }
    } catch (error) {
      logger.error("Error posting to Terminus:", error);
    }
  }

  async generateAndPost() {
    try {
      logger.info("Generating Foxhole e-paper SVG...");

      // Generate the SVG
      await this.generator.fetchAllMapData();
      const svg = this.generator.generateEpaperSVG();

      // Convert SVG to PNG and post to Terminus
      await this.postToTerminus(svg);

      logger.info("E-paper HTML posted to Terminus successfully");
    } catch (error) {
      logger.error("Error in generateAndPost:", error);
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
      logger.error("❌ HTML wrapper generation failed:", error);
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
        logger.error("SVG generation failed:", error);
        throw error;
      }

      // Post SVG to Terminus
      await this.postToTerminus(svg);
    } catch (error) {
      logger.error("Error in generateAndPostWithFreshData:", error);
    }
  }

  async start() {
    logger.info("Starting Terminus poster service...");

    // Handle graceful shutdown
    process.on("SIGINT", () => {
      logger.info("Graceful shutdown requested");
      process.exit(0);
    });

    process.on("SIGTERM", () => {
      logger.info("Graceful shutdown requested");
      process.exit(0);
    });

    logger.info(
      "Service started. Will post only when data updates. Press Ctrl+C to stop.",
    );
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const poster = new TerminusPoster();
  poster.start().catch((error) => {
    logger.error("Failed to start service:", error);
    process.exit(1);
  });
}

export default TerminusPoster;
