// simulation_viz_S35.js - Renders the board for the S35 Cascade Designer.
//
// ===================================================================================
// == VERSION 3.3 BUG FIX: RAMP ANGLE ORIENTATION                                   ==
// ===================================================================================
// - Corrected the `effectiveAngle` calculation, which was inverted.
// - A left-side ramp (`\`) now correctly receives a positive angle.
// - A right-side ramp (`/`) now correctly receives a negative angle.
// - This fixes the visual bug where right-side ramps were rendering with an
//   upward slope.
// ===================================================================================

class Visualizer {
    constructor(containerElement, config) {
        this.config = config;
        this.Matter = Matter;
        const { Engine, Render, Runner, World, Events } = this.Matter;

        this.engine = Engine.create({ gravity: { y: 0 } }); // No gravity for visualization
        this.world = this.engine.world;
        this.render = Render.create({
            element: containerElement,
            engine: this.engine,
            options: {
                width: this.config.SIM_CONFIG.MACHINE_WIDTH,
                height: this.config.SIM_CONFIG.MACHINE_HEIGHT,
                wireframes: false,
                background: '#2c3e50'
            }
        });
        this.runner = Runner.create();
        Render.run(this.render);
        Runner.run(this.runner, this.engine);
        Render.lookAt(this.render, {
            min: { x: 0, y: 0 },
            max: { x: this.config.SIM_CONFIG.MACHINE_WIDTH, y: this.config.SIM_CONFIG.MACHINE_HEIGHT }
        });

        Events.on(this.render, 'afterRender', () => {
            this.drawGrid();
        });
    }
    
    drawGrid() {
        const ctx = this.render.context;
        const bounds = this.render.bounds;
        const gridSpacing = 200; // pixels

        ctx.save();
        ctx.strokeStyle = 'rgba(149, 165, 166, 0.2)';
        ctx.fillStyle = 'rgba(189, 195, 199, 0.7)';
        ctx.font = '12px Arial';
        ctx.lineWidth = 1;

        for (let x = bounds.min.x; x < bounds.max.x; x += gridSpacing) {
            const canvasX = (x - bounds.min.x) * (this.render.options.width / (bounds.max.x - bounds.min.x));
            if (canvasX < 0 || canvasX > this.render.options.width) continue;
            
            ctx.beginPath();
            ctx.moveTo(canvasX, 0);
            ctx.lineTo(canvasX, this.render.options.height);
            ctx.stroke();

            ctx.fillText(`${Math.round(x)}px`, canvasX + 5, 15);
        }

        for (let y = bounds.min.y; y < bounds.max.y; y += gridSpacing) {
             const canvasY = (y - bounds.min.y) * (this.render.options.height / (bounds.max.y - bounds.min.y));
             if (canvasY < 0 || canvasY > this.render.options.height) continue;

            ctx.beginPath();
            ctx.moveTo(0, canvasY);
            ctx.lineTo(this.render.options.width, canvasY);
            ctx.stroke();
            
            if(y > 0) ctx.fillText(`${Math.round(y)}px`, 5, canvasY - 5);
        }

        ctx.restore();
    }


    drawStaticBoard(chromosome) {
        if (!chromosome) return;
        const { World, Composite } = this.Matter;
        Composite.clear(this.world, false);
        
        const boardBodies = this.createBoardFromS35Chromosome(chromosome);
        World.add(this.world, boardBodies);

        this.drawSensors(chromosome);
    }

    drawSensors(chromosome) {
        const { World, Bodies } = this.Matter;
        const channelCenterX = this.config.SIM_CONFIG.MACHINE_WIDTH / 2;
        const detectorX = channelCenterX + chromosome.detectorOffset;
        const detectorY = this.config.SIM_CONFIG.MACHINE_HEIGHT - chromosome.detectorHeight;
        const mainSensor = Bodies.rectangle(detectorX, detectorY, this.config.SENSOR_CONFIG.DETECTOR_WIDTH, 10, { isStatic: true, isSensor: true, render: { fillStyle: 'rgba(46, 204, 113, 0.7)' } });
        World.add(this.world, mainSensor);
    }
    
    createBoardFromS35Chromosome(chromosome) {
        const { Bodies, Vector } = this.Matter;
        const allBodies = [];
        const wallOptions = { isStatic: true, render: { fillStyle: '#95a5a6' } };
        const { channelWidth, cascadingRamps, detectorOffset, detectorHeight, finalRampKneeX_factor, finalRampKneeY_factor } = chromosome;

        const channelCenterX = this.config.SIM_CONFIG.MACHINE_WIDTH / 2;
        const leftWallX = channelCenterX - (channelWidth / 2);
        const rightWallX = channelCenterX + (channelWidth / 2);

        allBodies.push(Bodies.rectangle(leftWallX, this.config.SIM_CONFIG.MACHINE_HEIGHT / 2, this.config.SIM_CONFIG.WALL_THICKNESS, this.config.SIM_CONFIG.MACHINE_HEIGHT, wallOptions));
        allBodies.push(Bodies.rectangle(rightWallX, this.config.SIM_CONFIG.MACHINE_HEIGHT / 2, this.config.SIM_CONFIG.WALL_THICKNESS, this.config.SIM_CONFIG.MACHINE_HEIGHT, wallOptions));
        
        const detectorX = channelCenterX + detectorOffset;

        cascadingRamps.forEach((ramp, index) => {
            const isLastRamp = index === cascadingRamps.length - 1;
            const rampThickness = this.config.SIM_CONFIG.RAMP_THICKNESS;
            const attachX = ramp.side === 'left' ? leftWallX + (this.config.SIM_CONFIG.WALL_THICKNESS / 2) : rightWallX - (this.config.SIM_CONFIG.WALL_THICKNESS / 2);

            if (isLastRamp) {
                const p0 = Vector.create(attachX, ramp.y_position);
                const p2 = Vector.create(detectorX + (this.config.SENSOR_CONFIG.DETECTOR_WIDTH / 2), this.config.SIM_CONFIG.MACHINE_HEIGHT - detectorHeight);
                const totalVector = Vector.sub(p2, p0);
                const p1 = Vector.add(p0, { x: totalVector.x * finalRampKneeX_factor, y: totalVector.y * finalRampKneeY_factor });
                const points = [p0, p1, p2];
                for (let i = 0; i < points.length - 1; i++) {
                    const start = points[i];
                    const end = points[i+1];
                    const segmentVector = Vector.sub(end, start);
                    const length = Vector.magnitude(segmentVector);
                    const angle = Vector.angle(segmentVector, {x: 1, y: 0});
                    const center = Vector.add(start, Vector.mult(Vector.normalise(segmentVector), length / 2));
                    if (length > 1) {
                         const rampBody = Bodies.rectangle(center.x, center.y, length, rampThickness, {
                            isStatic: true,
                            angle: angle,
                            render: { fillStyle: '#bdc3c7' }
                        });
                        allBodies.push(rampBody);
                    }
                }
            } else {
                const rampLength = channelWidth * 0.85;
                // CORRECTED: A left ramp (\) needs a positive angle, a right ramp (/) needs a negative one.
                const effectiveAngle = (ramp.side === 'left') ? ramp.angle : -ramp.angle;
                
                const centerOffsetX = (rampLength / 2) * Math.cos(ramp.angle);
                const centerOffsetY = (rampLength / 2) * Math.sin(ramp.angle);
                
                const rampCenterX = attachX + (ramp.side === 'left' ? centerOffsetX : -centerOffsetX);
                const rampCenterY = ramp.y_position + centerOffsetY;
                
                if (rampLength > 1) {
                    const rampBody = Bodies.rectangle(rampCenterX, rampCenterY, rampLength, rampThickness, {
                        isStatic: true,
                        angle: effectiveAngle,
                        render: { fillStyle: '#bdc3c7' }
                    });
                    allBodies.push(rampBody);
                }
            }
        });
        return allBodies;
    }

    takeScreenshot(filename) {
        const canvas = this.render.canvas;
        if (!canvas) { return; }
        const dataUrl = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.download = filename;
        link.href = dataUrl;
        link.click();
    }
}
