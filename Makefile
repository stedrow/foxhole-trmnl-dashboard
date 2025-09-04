# Foxhole SVG Map Generator Makefile

# Variables
IMAGE_NAME = foxhole-svg
CONTAINER_NAME = foxhole-svg
PORT = 3000

# Registry configuration
REGISTRY = registry.sinetworks.xyz
FULL_IMAGE_NAME = $(REGISTRY)/$(IMAGE_NAME)

# Default target
.PHONY: help
help: ## Show this help message
	@echo "Foxhole SVG Map Generator"
	@echo "========================"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

# Build targets
.PHONY: build
build: ## Build Docker image
	docker build -t $(IMAGE_NAME) .

.PHONY: build-no-cache
build-no-cache: ## Build Docker image without cache
	docker build --no-cache -t $(IMAGE_NAME) .

# Registry publishing
.PHONY: publish
publish: ## Build and publish multi-architecture image to registry
	@echo "Building and publishing multi-architecture image..."
	docker buildx build \
		--platform linux/amd64,linux/arm64 \
		--tag $(FULL_IMAGE_NAME):latest \
		--file Dockerfile \
		--push \
		.
	@echo "Multi-architecture image published successfully to $(FULL_IMAGE_NAME):latest"

.PHONY: publish-local
publish-local: ## Build and publish local architecture image to registry
	@echo "Building and publishing local architecture image..."
	docker build -t $(FULL_IMAGE_NAME):latest .
	docker push $(FULL_IMAGE_NAME):latest
	@echo "Image published successfully to $(FULL_IMAGE_NAME):latest"

# Service management
.PHONY: service
service: build ## Start the server with tracking service
	docker-compose up -d

.PHONY: service-stop
service-stop: ## Stop the server
	docker-compose stop

.PHONY: service-restart
service-restart: service-stop service ## Restart the server

.PHONY: service-logs
service-logs: ## Show service logs
	docker-compose logs -f

.PHONY: service-down
service-down: ## Stop and remove containers
	docker-compose down

# Terminus Poster Service (Integrated)
.PHONY: terminus-test
terminus-test: ## Test Terminus poster service (run once)
	@echo "🧪 Testing Terminus poster service..."
	@docker-compose run --rm foxhole-svg node src/terminus-poster.js || \
		(echo "❌ Test failed. Check your .env file and Terminus configuration" && exit 1)

# SVG Generation
.PHONY: generate
generate: ## Generate and save SVG map via API
	@echo "🔄 Generating SVG map..."
	@curl -s -X POST http://localhost:$(PORT)/api/generate-svg | jq . || \
		(echo "❌ Failed to generate. Is the server running? Try: make service" && exit 1)
	@echo "✅ SVG generated successfully"

.PHONY: generate-epaper
generate-epaper: ## Generate and save e-paper SVG map (800x480) via API
	@echo "🔄 Generating e-paper SVG map..."
	@curl -s -X POST http://localhost:$(PORT)/api/generate-epaper-svg | jq . || \
		(echo "❌ Failed to generate e-paper SVG. Is the server running? Try: make service" && exit 1)
	@echo "✅ E-paper SVG generated successfully"

.PHONY: download
download: ## Download SVG map via API
	@echo "📥 Downloading SVG map..."
	@mkdir -p output
	@curl -s -X GET http://localhost:$(PORT)/api/generate-svg -o output/foxhole-map.svg || \
		(echo "❌ Failed to download. Is the server running? Try: make service" && exit 1)
	@echo "✅ Map downloaded to output/foxhole-map.svg"

.PHONY: download-epaper
download-epaper: ## Download e-paper SVG map (800x480) via API
	@echo "📥 Downloading e-paper SVG map..."
	@mkdir -p output
	@curl -s -X GET http://localhost:$(PORT)/api/generate-epaper-svg -o output/foxhole-map-epaper.svg || \
		(echo "❌ Failed to download e-paper SVG. Is the server running? Try: make service" && exit 1)
	@echo "✅ E-paper map downloaded to output/foxhole-map-epaper.svg"

.PHONY: svg
svg: generate ## Alias for generate (quick SVG generation)

.PHONY: quick
quick: svg ## Quick SVG generation (alias for svg)

.PHONY: epaper
epaper: generate-epaper ## Alias for generate-epaper (quick e-paper SVG generation)

.PHONY: quick-epaper
quick-epaper: epaper ## Quick e-paper SVG generation (alias for epaper)

# Status and monitoring
.PHONY: status
status: ## Check server status
	@echo "🏥 Checking server status..."
	@curl -s http://localhost:$(PORT)/health | jq . || \
		(echo "❌ Server not responding. Try: make service" && exit 1)

.PHONY: conquer-status
conquer-status: ## Show current conquer status data
	@echo "🗺️  Current conquer status:"
	@curl -s http://localhost:$(PORT)/api/conquerStatus | jq '.features | length' || \
		(echo "❌ Failed to get conquer status. Is the server running?" && exit 1)
	@echo " towns tracked"

.PHONY: ps
ps: ## Show running containers
	docker-compose ps

.PHONY: stats
stats: ## Show container resource usage
	docker stats $(CONTAINER_NAME) --no-stream

# Development
.PHONY: shell
shell: ## Open shell in running container
	docker-compose exec foxhole-svg sh

.PHONY: dev
dev: build ## Run in development mode with volume mounts
	docker run -it --rm \
		-p $(PORT):$(PORT) \
		-v "$$(pwd)/src:/app/src" \
		-v "$$(pwd)/output:/app/output" \
		-v "$$(pwd)/data:/app/data" \
		$(IMAGE_NAME) sh

# File operations
.PHONY: list-maps
list-maps: ## List all generated maps
	@echo "📁 Generated maps:"
	@ls -la output/*.svg 2>/dev/null || echo "❌ No SVG files found"

.PHONY: show-latest
show-latest: ## Show info about latest generated SVG
	@echo "📋 Latest SVG info:"
	@ls -la output/latest.svg 2>/dev/null || echo "❌ No latest.svg found. Run: make generate"
	@echo ""
	@ls -la output/*.svg 2>/dev/null | tail -5 || echo "❌ No SVG files found"

.PHONY: backup
backup: ## Backup generated maps and data
	@mkdir -p backups
	@tar -czf backups/foxhole-backup-$(shell date +%Y%m%d-%H%M%S).tar.gz output/ data/ 2>/dev/null || \
		(echo "⚠️  No files to backup" && exit 0)
	@echo "✅ Backup created in backups/"

# Quick start
.PHONY: quickstart
quickstart: service generate ## Complete setup: start service and generate map
	@echo ""
	@echo "🎉 Quickstart complete!"
	@echo "📁 Map saved to: output/"
	@echo "🌐 Web interface: http://localhost:$(PORT)"
	@echo "📋 Available commands: make help"

.PHONY: demo
demo: quickstart ## Alias for quickstart

# Testing
.PHONY: test
test: build ## Run basic functionality test
	@echo "🧪 Testing container build..."
	docker run --rm $(IMAGE_NAME) node --version
	@echo "✅ Container test passed"

.PHONY: health-check
health-check: ## Check if everything is working
	@echo "🏥 Health check..."
	@$(MAKE) status
	@$(MAKE) conquer-status
	@echo "✅ Health check passed"

# Cleanup
.PHONY: clean
clean: service-down ## Stop containers and remove images
	docker rmi $(IMAGE_NAME) || true
	docker system prune -f

.PHONY: clean-all
clean-all: clean ## Remove everything including volumes
	docker-compose down -v
	rm -rf output/*.svg data/*.db

# Info
.PHONY: info
info: ## Show project information
	@echo "Foxhole SVG Map Generator"
	@echo "========================"
	@echo "Image name: $(IMAGE_NAME)"
	@echo "Container: $(CONTAINER_NAME)"
	@echo "Port: $(PORT)"
	@echo "Output dir: ./output/"
	@echo "Data dir: ./data/"
	@echo ""
	@echo "API Endpoints:"
	@echo "  Web UI: http://localhost:$(PORT)/"
	@echo "  Health: http://localhost:$(PORT)/health"
	@echo "  Generate: POST http://localhost:$(PORT)/api/generate-svg"
	@echo "  Download: GET http://localhost:$(PORT)/api/generate-svg"
	@echo "  Status: GET http://localhost:$(PORT)/api/conquerStatus"

# Installation helpers
.PHONY: install-deps
install-deps: ## Check system dependencies
	@echo "📦 Checking dependencies..."
	@command -v docker >/dev/null 2>&1 || (echo "❌ Docker not found. Install Docker Desktop" && exit 1)
	@command -v docker-compose >/dev/null 2>&1 || (echo "❌ docker-compose not found. Install Docker Desktop" && exit 1)
	@command -v curl >/dev/null 2>&1 || (echo "❌ curl not found. Install curl" && exit 1)
	@command -v jq >/dev/null 2>&1 || (echo "💡 jq not found. Install with: brew install jq" || true)
	@echo "✅ Dependencies check complete"

# Default target when no arguments
.DEFAULT_GOAL := help