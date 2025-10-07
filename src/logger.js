// Simple logger with log levels and timestamps
const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

class Logger {
  constructor() {
    // Default to INFO level, can be overridden with LOG_LEVEL env var
    const envLevel = process.env.LOG_LEVEL?.toUpperCase() || "INFO";
    this.level = LOG_LEVELS[envLevel] ?? LOG_LEVELS.INFO;

    // Timezone for timestamps (default to UTC)
    this.timezone = process.env.LOG_TIMEZONE || "America/New_York";
  }

  getTimestamp() {
    const now = new Date();
    // Format: YYYY-MM-DD HH:MM:SS
    return now.toLocaleString("en-US", {
      timeZone: this.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).replace(/(\d+)\/(\d+)\/(\d+),/, "$3-$1-$2");
  }

  formatMessage(level, ...args) {
    const timestamp = this.getTimestamp();
    return `[${timestamp}] [${level}]`;
  }

  debug(...args) {
    if (this.level <= LOG_LEVELS.DEBUG) {
      console.log(this.formatMessage("DEBUG"), ...args);
    }
  }

  info(...args) {
    if (this.level <= LOG_LEVELS.INFO) {
      console.log(this.formatMessage("INFO"), ...args);
    }
  }

  warn(...args) {
    if (this.level <= LOG_LEVELS.WARN) {
      console.warn(this.formatMessage("WARN"), ...args);
    }
  }

  error(...args) {
    if (this.level <= LOG_LEVELS.ERROR) {
      console.error(this.formatMessage("ERROR"), ...args);
    }
  }
}

export default new Logger();
