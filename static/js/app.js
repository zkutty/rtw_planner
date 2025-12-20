/**
 * Game Application with COZY and ARCHITECT View Modes
 * COZY: Clean, minimal view (no grid, no overlays, minimal metrics)
 * ARCHITECT: Full debugging view (grid, overlays, all metrics)
 */

// =============================================================================
// VIEW MODE STATE MANAGEMENT
// =============================================================================

const ViewMode = {
    COZY: 'COZY',
    ARCHITECT: 'ARCHITECT'
};

class ViewModeManager {
    constructor() {
        this.currentMode = ViewMode.COZY; // Default to COZY
        this.listeners = [];
    }

    setMode(mode) {
        if (mode !== ViewMode.COZY && mode !== ViewMode.ARCHITECT) {
            console.warn(`Invalid view mode: ${mode}`);
            return;
        }
        this.currentMode = mode;
        this.notifyListeners();
    }

    toggleMode() {
        this.setMode(
            this.currentMode === ViewMode.COZY 
                ? ViewMode.ARCHITECT 
                : ViewMode.COZY
        );
    }

    isCozy() {
        return this.currentMode === ViewMode.COZY;
    }

    isArchitect() {
        return this.currentMode === ViewMode.ARCHITECT;
    }

    subscribe(listener) {
        this.listeners.push(listener);
    }

    notifyListeners() {
        this.listeners.forEach(listener => listener(this.currentMode));
    }
}

// =============================================================================
// GAME STATE & METRICS
// =============================================================================

class GameState {
    constructor() {
        // Core metrics
        this.cash = 100000;
        this.reputation = 50;
        this.condition = 100;
        this.courseVibe = "Serene";
        
        // Additional metrics (shown only in ARCHITECT mode)
        this.score = 0;
        this.timeElapsed = 0;
        this.difficulty = "Medium";
        this.level = 1;
        this.streak = 0;
        
        // Simulation data (for overlays)
        this.holeLines = [];
        this.holeLabels = [];
        this.path = [];
    }

    updateMetrics(delta) {
        // Update metrics based on game simulation
        // This would be called by your game loop
        this.timeElapsed += delta;
    }
}

// =============================================================================
// CANVAS RENDERER
// =============================================================================

class CanvasRenderer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) {
            console.error(`Canvas with id "${canvasId}" not found`);
            return;
        }
        this.ctx = this.canvas.getContext('2d');
        this.gridSize = 20;
        this.setupCanvas();
    }

    setupCanvas() {
        // Set canvas size to fill container
        const resize = () => {
            const container = this.canvas.parentElement;
            if (container) {
                this.canvas.width = container.clientWidth;
                this.canvas.height = container.clientHeight;
            }
        };
        resize();
        window.addEventListener('resize', resize);
    }

    clear() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    drawGrid(viewMode) {
        // Only draw grid in ARCHITECT mode
        if (viewMode !== ViewMode.ARCHITECT) {
            return;
        }

        this.ctx.strokeStyle = '#e0e0e0';
        this.ctx.lineWidth = 1;

        // Vertical lines
        for (let x = 0; x < this.canvas.width; x += this.gridSize) {
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, this.canvas.height);
            this.ctx.stroke();
        }

        // Horizontal lines
        for (let y = 0; y < this.canvas.height; y += this.gridSize) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(this.canvas.width, y);
            this.ctx.stroke();
        }
    }

    drawHoleLines(viewMode, holeLines) {
        // Only draw hole lines in ARCHITECT mode
        if (viewMode !== ViewMode.ARCHITECT || !holeLines || holeLines.length === 0) {
            return;
        }

        this.ctx.strokeStyle = '#ff6b6b';
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([5, 5]);

        holeLines.forEach(line => {
            this.ctx.beginPath();
            this.ctx.moveTo(line.startX, line.startY);
            this.ctx.lineTo(line.endX, line.endY);
            this.ctx.stroke();
        });

        this.ctx.setLineDash([]);
    }

    drawHoleLabels(viewMode, holeLabels) {
        // Only draw hole labels in ARCHITECT mode
        if (viewMode !== ViewMode.ARCHITECT || !holeLabels || holeLabels.length === 0) {
            return;
        }

        this.ctx.fillStyle = '#ff6b6b';
        this.ctx.font = '12px monospace';
        this.ctx.textAlign = 'left';
        this.ctx.textBaseline = 'top';

        holeLabels.forEach(label => {
            this.ctx.fillText(label.text, label.x, label.y);
        });
    }

    drawPath(viewMode, path) {
        // Only draw path in ARCHITECT mode
        if (viewMode !== ViewMode.ARCHITECT || !path || path.length < 2) {
            return;
        }

        this.ctx.strokeStyle = '#4ecdc4';
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.moveTo(path[0].x, path[0].y);

        for (let i = 1; i < path.length; i++) {
            this.ctx.lineTo(path[i].x, path[i].y);
        }

        this.ctx.stroke();
    }

    render(gameState, viewMode) {
        this.clear();
        
        // Draw background
        this.ctx.fillStyle = '#f5f5f5';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw grid (ARCHITECT only)
        this.drawGrid(viewMode);

        // Draw analytical overlays (ARCHITECT only)
        this.drawHoleLines(viewMode, gameState.holeLines);
        this.drawHoleLabels(viewMode, gameState.holeLabels);
        this.drawPath(viewMode, gameState.path);

        // Draw game content (always visible)
        this.drawGameContent(gameState);
    }

    drawGameContent(gameState) {
        // Draw your actual game content here
        // This is always visible regardless of view mode
        this.ctx.fillStyle = '#333';
        this.ctx.font = '16px sans-serif';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText('Game Canvas', this.canvas.width / 2, this.canvas.height / 2);
    }
}

// =============================================================================
// METRICS PANEL
// =============================================================================

class MetricsPanel {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            console.error(`Metrics container with id "${containerId}" not found`);
            return;
        }
    }

    render(gameState, viewMode) {
        if (!this.container) return;

        const isCozy = viewMode === ViewMode.COZY;

        // Always show in COZY mode: Cash, Rep, Condition, Course Vibe
        // Show all metrics in ARCHITECT mode
        let html = '<div class="metrics-panel">';
        
        // Core metrics (always visible)
        html += this.renderMetric('Cash', `$${gameState.cash.toLocaleString()}`, true);
        html += this.renderMetric('Rep', gameState.reputation.toString(), true);
        html += this.renderMetric('Condition', `${gameState.condition}%`, true);
        html += this.renderMetric('Course Vibe', gameState.courseVibe, true);

        // Additional metrics (ARCHITECT only)
        if (!isCozy) {
            html += this.renderMetric('Score', gameState.score.toString(), false);
            html += this.renderMetric('Time', this.formatTime(gameState.timeElapsed), false);
            html += this.renderMetric('Difficulty', gameState.difficulty, false);
            html += this.renderMetric('Level', gameState.level.toString(), false);
            html += this.renderMetric('Streak', gameState.streak.toString(), false);
        }

        html += '</div>';
        this.container.innerHTML = html;
    }

    renderMetric(label, value, isCore) {
        const className = isCore ? 'metric-core' : 'metric-architect';
        return `
            <div class="metric-item ${className}">
                <span class="metric-label">${label}:</span>
                <span class="metric-value">${value}</span>
            </div>
        `;
    }

    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
}

// =============================================================================
// VIEW MODE TOGGLE UI
// =============================================================================

class ViewModeToggle {
    constructor(containerId, viewModeManager) {
        this.container = document.getElementById(containerId);
        this.viewModeManager = viewModeManager;
        
        if (!this.container) {
            console.warn(`Toggle container with id "${containerId}" not found. Creating in sidebar.`);
            // Try to find sidebar and add toggle there
            const sidebar = document.getElementById('flight-sidebar') || 
                           document.querySelector('.sidebar') ||
                           document.querySelector('.control-panel');
            if (sidebar) {
                this.container = this.createToggleContainer(sidebar);
            }
        } else {
            this.setupToggle();
        }
    }

    createToggleContainer(parent) {
        const container = document.createElement('div');
        container.id = 'view-mode-toggle-container';
        container.className = 'panel-section';
        container.style.paddingTop = '1rem';
        container.style.borderTop = '1px solid var(--color-border, #e0e0e0)';
        
        const header = document.createElement('h3');
        header.textContent = 'View Mode';
        header.style.fontSize = 'var(--font-size-md, 1rem)';
        header.style.marginBottom = '0.75rem';
        header.style.color = 'var(--color-primary, #667eea)';
        header.style.fontWeight = '600';
        
        container.appendChild(header);
        
        // Try to append to the end of parent, or just append
        if (parent) {
            parent.appendChild(container);
        } else {
            document.body.appendChild(container);
        }
        
        return container;
    }

    setupToggle() {
        const isCozy = this.viewModeManager.isCozy();
        
        this.container.innerHTML = `
            <div class="view-mode-toggle-wrapper">
                <button id="view-mode-toggle-btn" class="view-mode-toggle-btn ${isCozy ? 'cozy-active' : 'architect-active'}">
                    <span class="toggle-label-cozy">Cozy</span>
                    <span class="toggle-label-architect">Architect</span>
                </button>
            </div>
        `;

        const button = this.container.querySelector('#view-mode-toggle-btn');
        if (button) {
            button.addEventListener('click', () => {
                this.viewModeManager.toggleMode();
                this.updateToggle();
            });
        }

        this.updateToggle();
    }

    updateToggle() {
        const button = this.container.querySelector('#view-mode-toggle-btn');
        if (button) {
            const isCozy = this.viewModeManager.isCozy();
            button.className = `view-mode-toggle-btn ${isCozy ? 'cozy-active' : 'architect-active'}`;
        }
    }
}

// =============================================================================
// MAIN APPLICATION
// =============================================================================

class GameApp {
    constructor() {
        this.viewModeManager = new ViewModeManager();
        this.gameState = new GameState();
        this.renderer = new CanvasRenderer('game-canvas');
        this.metricsPanel = new MetricsPanel('metrics-panel');
        this.viewModeToggle = null;
        this.animationFrame = null;
        
        this.init();
    }

    init() {
        // Only initialize if we have the necessary elements
        // This allows the code to coexist with other applications
        const hasCanvas = document.getElementById('game-canvas');
        const hasMetrics = document.getElementById('metrics-panel');
        const hasToggle = document.getElementById('view-mode-toggle-container');
        
        if (!hasCanvas && !hasMetrics && !hasToggle) {
            // No game elements found, skip initialization
            console.log('Game elements not found, skipping game initialization');
            return;
        }

        // Create canvas if it doesn't exist
        this.ensureCanvasExists();

        // Setup view mode toggle
        this.viewModeToggle = new ViewModeToggle('view-mode-toggle-container', this.viewModeManager);

        // Subscribe to view mode changes
        this.viewModeManager.subscribe((mode) => {
            this.onViewModeChanged(mode);
        });

        // Start render loop
        this.startRenderLoop();

        // Initialize sample data for overlays (ARCHITECT mode)
        this.initializeSampleOverlays();
    }

    ensureCanvasExists() {
        let canvas = document.getElementById('game-canvas');
        if (!canvas) {
            // Try to find map container or create canvas container
            const mapContainer = document.getElementById('map') || 
                                document.querySelector('.map-container') ||
                                document.body;
            
            const container = document.createElement('div');
            container.id = 'canvas-container';
            container.style.width = '100%';
            container.style.height = '100%';
            container.style.position = 'relative';
            
            canvas = document.createElement('canvas');
            canvas.id = 'game-canvas';
            canvas.style.display = 'block';
            canvas.style.width = '100%';
            canvas.style.height = '100%';
            
            container.appendChild(canvas);
            
            // Insert before map or append to body
            if (mapContainer && mapContainer.parentNode) {
                mapContainer.parentNode.insertBefore(container, mapContainer);
                mapContainer.style.display = 'none'; // Hide map in favor of canvas
            } else {
                document.body.appendChild(container);
            }
            
            // Reinitialize renderer with new canvas
            this.renderer = new CanvasRenderer('game-canvas');
        }
    }

    initializeSampleOverlays() {
        // Sample data for analytical overlays (shown in ARCHITECT mode)
        this.gameState.holeLines = [
            { startX: 100, startY: 100, endX: 300, endY: 200 },
            { startX: 300, startY: 200, endX: 500, endY: 150 }
        ];

        this.gameState.holeLabels = [
            { text: 'Hole 1', x: 150, y: 120 },
            { text: 'Hole 2', x: 350, y: 180 }
        ];

        this.gameState.path = [
            { x: 100, y: 100 },
            { x: 200, y: 150 },
            { x: 300, y: 200 },
            { x: 400, y: 175 },
            { x: 500, y: 150 }
        ];
    }

    onViewModeChanged(mode) {
        // Update UI elements based on view mode
        if (this.viewModeToggle) {
            this.viewModeToggle.updateToggle();
        }
        
        // Trigger re-render
        this.render();
    }

    startRenderLoop() {
        const loop = (timestamp) => {
            // Update game state
            const delta = 0.016; // ~60fps
            this.gameState.updateMetrics(delta);

            // Render
            this.render();

            // Continue loop
            this.animationFrame = requestAnimationFrame(loop);
        };
        this.animationFrame = requestAnimationFrame(loop);
    }

    render() {
        const viewMode = this.viewModeManager.currentMode;
        
        // Render canvas
        if (this.renderer) {
            this.renderer.render(this.gameState, viewMode);
        }

        // Render metrics panel
        if (this.metricsPanel) {
            this.metricsPanel.render(this.gameState, viewMode);
        }
    }

    destroy() {
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
        }
    }
}

// =============================================================================
// INITIALIZATION
// =============================================================================

// Initialize app when DOM is ready
let gameApp = null;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        gameApp = new GameApp();
    });
} else {
    gameApp = new GameApp();
}

// Export for external use
window.GameApp = GameApp;
window.ViewMode = ViewMode;
window.gameApp = gameApp;
