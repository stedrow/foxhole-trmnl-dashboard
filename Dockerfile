FROM node:20-alpine

# Install necessary packages for database and potential native dependencies
RUN apk add --no-cache \
    sqlite-dev \
    make \
    g++

WORKDIR /app

# Copy package files and install dependencies
COPY package.json package-lock.json* ./
RUN npm install

# Copy source code
COPY . .

# Set environment variable for production
ENV NODE_ENV=production

# Create directories for outputs and data
RUN mkdir -p /app/output /app/data

# Expose port for web interface (optional)
EXPOSE 3000

# Default command to generate SVG map
CMD ["node", "src/generate-svg.js"]