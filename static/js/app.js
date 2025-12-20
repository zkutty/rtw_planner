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

// =============================================================================
// ANIMATION SETTINGS
// =============================================================================

class AnimationsManager {
    constructor() {
        this.enabled = true; // Default: on
        this.listeners = [];
    }

    setEnabled(enabled) {
        this.enabled = Boolean(enabled);
        this.notifyListeners();
    }

    toggle() {
        this.setEnabled(!this.enabled);
    }

    subscribe(listener) {
        this.listeners.push(listener);
    }

    notifyListeners() {
        this.listeners.forEach(listener => listener(this.enabled));
    }
}

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

        // Lightweight demo scene for animations (swap with your real tile/obstacle data)
        this.scene = this.createDemoScene();
    }

    updateMetrics(delta) {
        // Update metrics based on game simulation
        // This would be called by your game loop
        this.timeElapsed += delta;
    }

    createDemoScene() {
        // Keep this lightweight: a small number of primitives to avoid FPS drops.
        const waterTiles = [];
        const tile = 64;
        for (let y = 0; y < 4; y++) {
            for (let x = 0; x < 6; x++) {
                waterTiles.push({
                    x: 40 + x * (tile + 6),
                    y: 40 + y * (tile + 6),
                    w: tile,
                    h: tile
                });
            }
        }

        const obstacles = [
            { type: 'tree', x: 520, y: 140, r: 18, phase: 0.3 },
            { type: 'tree', x: 580, y: 210, r: 16, phase: 1.1 },
            { type: 'bush', x: 520, y: 260, r: 14, phase: 2.0 },
            { type: 'bush', x: 590, y: 300, r: 12, phase: 2.6 }
        ];

        return { waterTiles, obstacles };
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

    render(gameState, viewMode, frame = null) {
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
        this.drawGameContent(gameState, frame);
    }

    drawGameContent(gameState, frame) {
        // Demo scene for lightweight animations. Replace with your real render pipeline.
        const t = frame?.t ?? 0;
        const animationsEnabled = Boolean(frame?.animationsEnabled);

        const tiles = gameState.scene?.waterTiles ?? [];
        const obstacles = gameState.scene?.obstacles ?? [];

        this.drawWaterTiles(tiles);

        // Animations should work in COZY mode too (it’s part of the “alive” feel).
        if (animationsEnabled) {
            this.drawWaterShimmer(tiles, t);
        }

        this.drawObstacles(obstacles, t, animationsEnabled);
    }

    drawWaterTiles(tiles) {
        if (!tiles || tiles.length === 0) return;
        const ctx = this.ctx;

        ctx.save();
        for (const tile of tiles) {
            ctx.fillStyle = '#4aa3d8';
            ctx.fillRect(tile.x, tile.y, tile.w, tile.h);

            // subtle edge depth (still cheap)
            ctx.strokeStyle = 'rgba(0,0,0,0.06)';
            ctx.lineWidth = 1;
            ctx.strokeRect(tile.x + 0.5, tile.y + 0.5, tile.w - 1, tile.h - 1);
        }
        ctx.restore();
    }

    drawWaterShimmer(tiles, t) {
        // Water shimmer = moving soft highlight band via a reused gradient.
        // No per-pixel work; one gradient per frame.
        if (!tiles || tiles.length === 0) return;

        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;

        // Slow drift (subtle)
        const driftX = (t * 6) % (w + 200) - 100;
        const driftY = (t * 2) % (h + 200) - 100;

        ctx.save();
        ctx.globalAlpha = 0.06; // very low intensity

        const grad = ctx.createLinearGradient(driftX, driftY, driftX + w, driftY + h);
        grad.addColorStop(0.0, 'rgba(255,255,255,0)');
        grad.addColorStop(0.45, 'rgba(255,255,255,0)');
        grad.addColorStop(0.55, 'rgba(255,255,255,1)');
        grad.addColorStop(0.65, 'rgba(255,255,255,0)');
        grad.addColorStop(1.0, 'rgba(255,255,255,0)');
        ctx.fillStyle = grad;

        for (const tile of tiles) {
            ctx.fillRect(tile.x, tile.y, tile.w, tile.h);
        }

        ctx.restore();
    }

    drawObstacles(obstacles, t, animationsEnabled) {
        if (!obstacles || obstacles.length === 0) return;
        const ctx = this.ctx;

        ctx.save();
        for (const o of obstacles) {
            const phase = o.phase ?? 0;

            if (o.type === 'tree') {
                // Tiny rotation around base using time + per-obstacle phase
                const sway = animationsEnabled ? Math.sin(t * 1.2 + phase) * 0.04 : 0; // radians

                ctx.save();
                ctx.translate(o.x, o.y);
                ctx.rotate(sway);

                // trunk
                ctx.strokeStyle = '#6b4f2a';
                ctx.lineWidth = 4;
                ctx.beginPath();
                ctx.moveTo(0, 10);
                ctx.lineTo(0, -18);
                ctx.stroke();

                // canopy
                ctx.fillStyle = '#2f7d32';
                ctx.beginPath();
                ctx.arc(0, -26, o.r ?? 18, 0, Math.PI * 2);
                ctx.fill();

                // highlight
                ctx.globalAlpha = 0.08;
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(-6, -30, (o.r ?? 18) * 0.55, 0, Math.PI * 2);
                ctx.fill();
                ctx.globalAlpha = 1;

                ctx.restore();
            } else if (o.type === 'bush') {
                // Tiny lateral bob (offset) rather than rotation
                const bob = animationsEnabled ? Math.sin(t * 1.6 + phase) * 1.5 : 0; // px

                ctx.save();
                ctx.translate(o.x + bob, o.y);
                ctx.fillStyle = '#3a8f3e';
                ctx.beginPath();
                ctx.arc(0, 0, o.r ?? 14, 0, Math.PI * 2);
                ctx.fill();

                ctx.globalAlpha = 0.08;
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(-5, -4, (o.r ?? 14) * 0.6, 0, Math.PI * 2);
                ctx.fill();
                ctx.globalAlpha = 1;
                ctx.restore();
            }
        }
        ctx.restore();
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
            <h3 style="margin-bottom: 0.75rem;">View Mode</h3>
            <div class="view-mode-toggle-wrapper">
                <button id="view-mode-toggle-btn" class="view-mode-toggle-btn ${isCozy ? 'cozy-active' : 'architect-active'}">
                    <span class="toggle-label-cozy">Cozy</span>
                    <span class="toggle-label-architect">Architect</span>
                </button>
            </div>
            <div id="animations-toggle-container"></div>
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
// ANIMATIONS TOGGLE UI
// =============================================================================

class AnimationsToggle {
    constructor(containerId, viewModeManager, animationsManager) {
        this.container = document.getElementById(containerId);
        this.viewModeManager = viewModeManager;
        this.animationsManager = animationsManager;

        if (!this.container) return;

        this.viewModeManager.subscribe(() => this.render());
        this.animationsManager.subscribe(() => this.render());
        this.render();
    }

    render() {
        if (!this.container) return;

        const isCozy = this.viewModeManager.isCozy();
        if (!isCozy) {
            this.container.innerHTML = '';
            this.container.style.display = 'none';
            return;
        }

        this.container.style.display = 'block';
        const checked = this.animationsManager.enabled ? 'checked' : '';

        this.container.innerHTML = `
            <div class="anim-toggle-row">
                <label class="anim-toggle-label" for="animations-toggle">Animations</label>
                <label class="switch">
                    <input id="animations-toggle" type="checkbox" ${checked} />
                    <span class="slider"></span>
                </label>
            </div>
        `;

        const input = this.container.querySelector('#animations-toggle');
        if (input) {
            input.addEventListener('change', (e) => {
                this.animationsManager.setEnabled(e.target.checked);
            });
        }
    }
}

// =============================================================================
// MAIN APPLICATION
// =============================================================================

class GameApp {
    constructor() {
        this.viewModeManager = new ViewModeManager();
        this.animationsManager = new AnimationsManager();
        this.gameState = new GameState();
        this.renderer = new CanvasRenderer('game-canvas');
        this.metricsPanel = new MetricsPanel('metrics-panel');
        this.viewModeToggle = null;
        this.animationFrame = null;
        this.animationsToggle = null;
        this.running = false;
        this.lastTimestampMs = null;
        
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
        this.animationsToggle = new AnimationsToggle('animations-toggle-container', this.viewModeManager, this.animationsManager);

        // Subscribe to view mode changes
        this.viewModeManager.subscribe((mode) => {
            this.onViewModeChanged(mode);
        });

        // Pause/resume animations when tab visibility changes; also stop RAF when animations are disabled.
        this.animationsManager.subscribe(() => this.syncLoopWithSettings());
        document.addEventListener('visibilitychange', () => this.syncLoopWithSettings());

        // Start render loop (or static render)
        this.syncLoopWithSettings();

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
        if (this.running) return;
        this.running = true;
        this.lastTimestampMs = null;

        const loop = (timestampMs) => {
            if (!this.running) return;

            // If hidden or disabled mid-loop, stop scheduling frames.
            if (document.visibilityState !== 'visible' || !this.animationsManager.enabled) {
                this.running = false;
                return;
            }

            if (this.lastTimestampMs == null) {
                this.lastTimestampMs = timestampMs;
            }
            const dt = Math.min(0.05, (timestampMs - this.lastTimestampMs) / 1000);
            this.lastTimestampMs = timestampMs;

            // Underlying sim logic should live elsewhere; this is just placeholder metrics.
            this.gameState.updateMetrics(dt);

            this.render(timestampMs / 1000);
            this.animationFrame = requestAnimationFrame(loop);
        };

        this.animationFrame = requestAnimationFrame(loop);
    }

    syncLoopWithSettings() {
        const shouldAnimate = this.animationsManager.enabled && document.visibilityState === 'visible';
        if (shouldAnimate) {
            this.startRenderLoop();
            return;
        }

        this.stopRenderLoop();
        this.render();
    }

    stopRenderLoop() {
        this.running = false;
        this.lastTimestampMs = null;
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
    }

    render(tSeconds = null) {
        const viewMode = this.viewModeManager.currentMode;
        
        // Render canvas
        if (this.renderer) {
            const t = tSeconds ?? (this.gameState?.timeElapsed ?? 0);
            this.renderer.render(this.gameState, viewMode, {
                t,
                animationsEnabled: this.animationsManager.enabled && document.visibilityState === 'visible'
            });
        }

        // Render metrics panel
        if (this.metricsPanel) {
            this.metricsPanel.render(this.gameState, viewMode);
        }
    }

    destroy() {
        this.stopRenderLoop();
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
