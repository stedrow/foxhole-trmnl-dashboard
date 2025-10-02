#!/usr/bin/env node

import fs from "fs/promises";
import FoxholeSVGGenerator from "./generate-svg.js";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

// Load environment variables
const TERMINUS_URL = process.env.TERMINUS_URL;
const TERMINUS_LOGIN = process.env.TERMINUS_LOGIN;
const TERMINUS_PASSWORD = process.env.TERMINUS_PASSWORD;
const TERMINUS_BIT_DEPTH = process.env.TERMINUS_BIT_DEPTH || "1";

if (!TERMINUS_URL || !TERMINUS_LOGIN || !TERMINUS_PASSWORD) {
  console.error(
    "Missing required environment variables: TERMINUS_URL, TERMINUS_LOGIN, and TERMINUS_PASSWORD",
  );
  console.error("Please create a .env file with these variables");
  console.error("");
  console.error("For Terminus 0.30.0+, you need to:");
  console.error("1. Create a user account via the web UI at your Terminus URL");
  console.error("2. Add TERMINUS_LOGIN=your_email and TERMINUS_PASSWORD=your_password to .env");
  console.error("3. The old DEVICE_API_KEY authentication method is no longer supported");
  process.exit(1);
}

class TerminusPoster {
  constructor() {
    this.generator = new FoxholeSVGGenerator();
    this.screenId = null;
    this.accessToken = null;
    this.refreshToken = null;
  }

  async authenticate() {
    if (this.accessToken) return this.accessToken;

    try {
      console.log("Authenticating with Terminus...");
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
        console.error("Authentication failed:", response.status, errorText);
        return null;
      }

      const data = await response.json();
      this.accessToken = data.access_token;
      this.refreshToken = data.refresh_token;
      console.log("✅ Authentication successful");
      return this.accessToken;
    } catch (error) {
      console.error("Error during authentication:", error);
      return null;
    }
  }

  async refreshAccessToken() {
    if (!this.refreshToken) {
      console.log("No refresh token available, re-authenticating...");
      return await this.authenticate();
    }

    try {
      console.log("Refreshing access token...");
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
        console.log("Token refresh failed, re-authenticating...");
        return await this.authenticate();
      }

      const data = await response.json();
      this.accessToken = data.access_token;
      this.refreshToken = data.refresh_token;
      console.log("✅ Token refreshed successfully");
      return this.accessToken;
    } catch (error) {
      console.error("Error refreshing token:", error);
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
        console.error(
          "Failed to fetch screens:",
          response.status,
          response.statusText,
        );
        return null;
      }

      const data = await response.json();
      const screens = data.data || [];
      console.log(`Found ${screens.length} existing screens`);

      for (const screen of screens) {
        if (screen.name === "foxhole_epaper_dashboard") {
          this.screenId = screen.id;
          console.log(`Found existing Foxhole screen: ${this.screenId}`);
          return this.screenId;
        }
      }

      return null;
    } catch (error) {
      console.error("Error fetching screen ID:", error);
      return null;
    }
  }

  async postToTerminus(svgContent) {
    try {
      const token = await this.authenticate();
      if (!token) {
        console.error("❌ Authentication failed, cannot post to Terminus");
        return;
      }

      const screenId = await this.getScreenId();
      const now = new Date();

      // Check if we're getting HTML instead of SVG
      if (svgContent.includes("<!DOCTYPE html>")) {
        console.log(
          "❌ ERROR: generateEpaperSVG() returned HTML instead of SVG!",
        );
        console.log("🔍 This suggests the SVG generation method is broken");
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
          bit_depth: parseInt(TERMINUS_BIT_DEPTH),
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
        console.log(`Updating existing Foxhole screen ${screenId}`);
        response = await fetch(updateUrl, {
          method: "PATCH",
          headers,
          body: JSON.stringify({
            screen: {
              content: data.screen.content,
              label: data.screen.label,
              name: data.screen.name,
              bit_depth: data.screen.bit_depth,
            },
          }),
        });
      } else {
        // Create new screen
        const screensUrl = `${TERMINUS_URL}/api/screens`;
        console.log("Creating new Foxhole screen");
        response = await fetch(screensUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(data),
        });
      }

      if (response.ok) {
        const result = await response.json();
        console.log("✅ Foxhole dashboard published successfully:", result);

        // If this was a new screen, save the ID
        if (!screenId && result.data && result.data.id) {
          this.screenId = result.data.id;
          console.log(`Saved new screen ID: ${this.screenId}`);
        }
      } else {
        const errorText = await response.text();
        console.error(
          "❌ Error publishing Foxhole dashboard:",
          response.status,
          errorText,
        );
        
        // If it's an authentication error, try to refresh the token
        if (response.status === 401) {
          console.log("🔄 Authentication error, trying to refresh token...");
          const newToken = await this.refreshAccessToken();
          if (newToken) {
            console.log("🔄 Retrying with refreshed token...");
            // Retry the request with the new token
            return await this.postToTerminus(svgContent);
          }
        }
      }
    } catch (error) {
      console.error("Error posting to Terminus:", error);
    }
  }

  async generateAndPost() {
    try {
      console.log("Generating Foxhole e-paper SVG...");

      // Generate the SVG
      await this.generator.fetchAllMapData();
      const svg = this.generator.generateEpaperSVG();

      // Convert SVG to PNG and post to Terminus
      await this.postToTerminus(svg);

      console.log("E-paper HTML posted to Terminus successfully");
    } catch (error) {
      console.error("Error in generateAndPost:", error);
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
      console.error("❌ HTML wrapper generation failed:", error);
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
        console.error("SVG generation failed:", error);
        throw error;
      }

      // Post SVG to Terminus
      await this.postToTerminus(svg);
    } catch (error) {
      console.error("Error in generateAndPostWithFreshData:", error);
    }
  }

  async start() {
    console.log("Starting Terminus poster service...");

    // Handle graceful shutdown
    process.on("SIGINT", () => {
      console.log("Graceful shutdown requested");
      process.exit(0);
    });

    process.on("SIGTERM", () => {
      console.log("Graceful shutdown requested");
      process.exit(0);
    });

    console.log(
      "Service started. Will post only when data updates. Press Ctrl+C to stop.",
    );
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const poster = new TerminusPoster();
  poster.start().catch((error) => {
    console.error("Failed to start service:", error);
    process.exit(1);
  });
}

export default TerminusPoster;
