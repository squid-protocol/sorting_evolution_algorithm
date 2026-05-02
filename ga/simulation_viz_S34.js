// simulation_viz_S34.js - Renders the board for the S34 Cartographer
// S34 Update:
// - Now accepts a configuration object in its constructor to avoid global dependencies.
// - Removed collision check from peg creation to comply with the "Strict Model".
// - Updated board creation to use the new functional `funnel_profile` gene.
// RIVER OF FLOW VISUALIZATION:
// - Added `drawFunctionalAnnotations` to render the drop zone and flow path.
// - `drawStaticBoard` now calls this new function to display the visualizations.
// VERSION 6 FIX: Updated to draw the flood zone from the new `floodZoneVertices` property.

class Visualizer {
    constructor(containerElement, config) {
        if (!config || !config.SIM_CONFIG) {
            throw new Error("Visualizer requires a configuration object with SIM_CONFIG.");
        }
        this.config = config; // Store the entire config object
        this.Matter = Matter;
        const { Engine, Render, Runner, World, Composite, Bodies, Body, Vertices } = this.Matter;

        this.engine = Engine.create();
        this.world = this.engine.world;
        this.render = Render.create({
            element: containerElement,
            engine: this.engine,
            options: {
                width: this.config.SIM_CONFIG.BOARD_WIDTH,
                height: this.config.SIM_CONFIG.BOARD_HEIGHT,
                wireframes: false,
                background: '#2c3e50'
            }
        });
        this.runner = Runner.create();
        Render.run(this.render);
        Runner.run(this.runner, this.engine);
        Render.lookAt(this.render, {
            min: { x: 0, y: 0 },
            max: { x: this.config.SIM_CONFIG.BOARD_WIDTH, y: this.config.SIM_CONFIG.BOARD_HEIGHT }
        });
    }

    drawStaticBoard(chromosome, result) {
        if (!chromosome) return;
        const { World, Composite } = this.Matter;

        // Clear all previous elements (board, sensors, annotations)
        const bodiesToRemove = Composite.allBodies(this.world).filter(body =>
            body.label.includes('board_element') ||
            body.label.includes('sensor') ||
            body.label.includes('annotation') // Also remove old annotations
        );
        Composite.remove(this.world, bodiesToRemove);

        // Draw the main board components
        const boardBodies = this.createBoardFromChromosome(chromosome);
        World.add(this.world, boardBodies);

        // Draw sensors
        this.drawSensors(chromosome);

        // Draw the new functional annotations if results are available
        if (result && result.functionalAnnotations) {
            this.drawFunctionalAnnotations(chromosome, result.functionalAnnotations);
        }

        // --- CAMERA ALIGNMENT FIX ---
        // Dynamically focus the camera on the actual machine height, plus a top and bottom margin 
        // so the spawner and detector are never cut off by the screen edges.
        this.Matter.Render.lookAt(this.render, {
            min: { x: 0, y: -150 },
            max: { x: this.config.SIM_CONFIG.BOARD_WIDTH, y: chromosome.machineHeight + 250 }
        });
    }

    drawSensors(chromosome) {
        const { World, Bodies } = this.Matter;
        const main_sensor_y = chromosome.machineHeight;
        const lost_sensor_y = main_sensor_y + 100;
        const sensor_width = this.config.SENSOR_CONFIG.SENSOR_WIDTH;
        const sensor_padding = sensor_width / 2;
        const board_width = this.config.SIM_CONFIG.BOARD_WIDTH;

        const main_sensor_x_center = (board_width / 2) + chromosome.detectorOffset;
        const main_sensor_start = main_sensor_x_center - (sensor_width / 2);
        const main_sensor_end = main_sensor_x_center + (sensor_width / 2);

        const mainSensor = Bodies.rectangle(main_sensor_x_center, main_sensor_y, sensor_width, 10, { label: 'sensor_main', isStatic: true, isSensor: true, render: { fillStyle: 'rgba(144, 238, 144, 0.5)', strokeStyle: 'rgba(144, 238, 144, 1)', lineWidth: 1 } });
        const left_lost_width = main_sensor_start - sensor_padding;
        const left_lost_x = left_lost_width / 2;
        const leftLostSensor = Bodies.rectangle(left_lost_x, lost_sensor_y, left_lost_width, 10, { label: 'sensor_lost', isStatic: true, isSensor: true, render: { fillStyle: 'rgba(255, 255, 0, 0.3)', strokeStyle: 'rgba(255, 255, 0, 0.7)', lineWidth: 1 } });
        const right_lost_start = main_sensor_end + sensor_padding;
        const right_lost_width = board_width - right_lost_start;
        const right_lost_x = right_lost_start + (right_lost_width / 2);
        const rightLostSensor = Bodies.rectangle(right_lost_x, lost_sensor_y, right_lost_width, 10, { label: 'sensor_lost', isStatic: true, isSensor: true, render: { fillStyle: 'rgba(255, 255, 0, 0.3)', strokeStyle: 'rgba(255, 255, 0, 0.7)', lineWidth: 1 } });

        World.add(this.world, [mainSensor, leftLostSensor, rightLostSensor]);
    }

    drawFunctionalAnnotations(chromosome, annotations) {
        const { World, Bodies, Body, Vertices } = this.Matter;
        const annotationBodies = [];

        // 1. Draw the Drop Zone
        const dropZone = Bodies.rectangle(
            chromosome.conveyorDropX,
            25, // Positioned at the top of the board
            chromosome.conveyorDropWidth,
            50,
            {
                label: 'annotation_drop_zone',
                isStatic: true,
                isSensor: true,
                render: {
                    fillStyle: 'rgba(231, 76, 60, 0.25)', // Translucent red
                    strokeStyle: 'rgba(231, 76, 60, 0.5)',
                    lineWidth: 1
                }
            }
        );
        annotationBodies.push(dropZone);

        // 2. Draw the River of Flow (Flood Zone and Centerline)
        
        // Draw the Flood Zone Polygon from the new `floodZoneVertices` property
        if (annotations.floodZoneVertices && annotations.floodZoneVertices.length > 2) {
            const floodZonePoly = Bodies.fromVertices(0, 0, [annotations.floodZoneVertices], {
                label: 'annotation_flood_zone',
                isStatic: true,
                isSensor: true,
                render: {
                    fillStyle: 'rgba(52, 152, 219, 0.2)',
                    strokeStyle: 'rgba(52, 152, 219, 0.4)',
                    lineWidth: 1
                }
            });
            Body.setPosition(floodZonePoly, Vertices.centre(annotations.floodZoneVertices));
            annotationBodies.push(floodZonePoly);
        }

        // Draw the Centerline from the `riverPath` data (now a 10-vertex polyline)
        if (annotations.riverPath && annotations.riverPath.length > 1) {
            for (let i = 0; i < annotations.riverPath.length - 1; i++) {
                const start = { x: annotations.riverPath[i].centerline_x, y: annotations.riverPath[i].y };
                const endPoint = annotations.riverPath[i+1];
                if (!start || !endPoint) continue;
                
                const end = { x: endPoint.centerline_x, y: endPoint.y };

                const length = Math.hypot(end.x - start.x, end.y - start.y);
                const angle = Math.atan2(end.y - start.y, end.x - start.x);
                const centerX = (start.x + end.x) / 2;
                const centerY = (start.y + end.y) / 2;

                if (length > 0) {
                    const centerlineSegment = Bodies.rectangle(centerX, centerY, length, 2, {
                        label: 'annotation_centerline',
                        isStatic: true,
                        isSensor: true,
                        angle: angle,
                        render: {
                            fillStyle: 'rgba(100, 200, 255, 0.7)' // Brighter blue
                        }
                    });
                    annotationBodies.push(centerlineSegment);
                }
            }
        }

        World.add(this.world, annotationBodies);
    }


    createBoardFromChromosome(chromosome) {
        const allBodies = [];
        const wallThickness = this.config.SIM_CONFIG.INTERNAL_WALL_THICKNESS || 8;

        allBodies.push(...this.createWallsFromFunctionalProfile(chromosome, wallThickness));

        if (chromosome.complexRamps) {
            chromosome.complexRamps.forEach(rampGene => {
                if (rampGene.isActive) {
                     allBodies.push(...this.createComplexRampWithPegs(rampGene, wallThickness));
                }
            });
        }

        if (chromosome.pegMatrices) {
            chromosome.pegMatrices.forEach(matrix => {
                if (matrix.isActive) {
                    allBodies.push(...this.createPegsFromMatrix(matrix));
                }
            });
        }
        return allBodies;
    }

    createWallsFromFunctionalProfile(chromosome, thickness) {
        const { funnel_profile, machineHeight, detectorOffset } = chromosome;
        if (!funnel_profile) return [];

        const verticesL = [];
        const verticesR = [];
        const topY = 50;
        const board_width = this.config.SIM_CONFIG.BOARD_WIDTH;
        const sensor_width = this.config.SENSOR_CONFIG.SENSOR_WIDTH;

        funnel_profile.forEach((slice, i) => {
            const t = i / (funnel_profile.length - 1);
            const y = topY + t * (machineHeight - topY);
            const centerX = (board_width / 2) + slice.offset;
            verticesL.push({ x: centerX - slice.width / 2, y });
            verticesR.push({ x: centerX + slice.width / 2, y });
        });

        const sensorCenterX = (board_width / 2) + detectorOffset;
        verticesL[verticesL.length - 1] = { x: sensorCenterX - sensor_width / 2, y: machineHeight };
        verticesR[verticesR.length - 1] = { x: sensorCenterX + sensor_width / 2, y: machineHeight };

        const leftWall = this.createConnectedWallFromVertices(verticesL, thickness);
        const rightWall = this.createConnectedWallFromVertices(verticesR, thickness);

        return [...leftWall, ...rightWall];
    }

    createPegsFromMatrix(matrix) {
        const { Bodies, Vector } = this.Matter;
        const newPegs = [];
        if (!matrix || !matrix.gridX || !matrix.gridY) return newPegs;

        const { gridX, gridY, startSpacingX, endSpacingX, spacingY, rotation, staggerOffset, x, y } = matrix;
        const pegRadius = 4;
        let localPositions = [];
        let totalWidth = 0;

        for (let r = 0; r < gridY; r++) {
            let currentX = r * staggerOffset;
            for (let c = 0; c < gridX; c++) {
                localPositions.push(Vector.create(currentX, r * spacingY));
                const t = (gridX > 1) ? c / (gridX - 1) : 0;
                currentX += startSpacingX + t * (endSpacingX - startSpacingX);
            }
            if (currentX > totalWidth) totalWidth = currentX;
        }
        const totalHeight = (gridY - 1) * spacingY;
        const centerOffset = Vector.create(totalWidth / 2, totalHeight / 2);

        localPositions.forEach(pos => {
            const finalPos = Vector.add(Vector.rotate(Vector.sub(pos, centerOffset), rotation), {x, y});
            const peg = Bodies.circle(finalPos.x, finalPos.y, pegRadius, {
                label: 'board_element',
                isStatic: true,
                restitution: 0.5,
                render: { fillStyle: '#ecf0f1' }
            });
            newPegs.push(peg);
        });
        return newPegs;
    }

    createComplexRampWithPegs(rampGene, thickness) {
        const { Bodies, Vector } = this.Matter;
        const rampBodies = [];
        const pegRadius = 4;
        const rampRenderStyle = { fillStyle: '#95a5a6' };
        const pegRenderStyle = { fillStyle: '#bdc3c7' };

        const ramp = Bodies.rectangle(rampGene.x, rampGene.y, rampGene.length, thickness, {
            label: 'board_element', isStatic: true, angle: rampGene.rotation, render: rampRenderStyle
        });
        rampBodies.push(ramp);

        const halfLength = rampGene.length / 2;
        const center = Vector.create(rampGene.x, rampGene.y);
        const axis = Vector.rotate(Vector.create(1, 0), rampGene.rotation);

        const vertex1 = Vector.add(center, Vector.mult(axis, -halfLength));
        const vertex2 = Vector.add(center, Vector.mult(axis, halfLength));

        const peg1Offset = Vector.rotate(Vector.create(rampGene.peg1.radius, 0), rampGene.peg1.angle);
        const peg1Pos = Vector.add(vertex1, peg1Offset);
        const peg1 = Bodies.circle(peg1Pos.x, peg1Pos.y, pegRadius, { label: 'board_element', isStatic: true, restitution: 0.5, render: pegRenderStyle });
        rampBodies.push(peg1);

        const peg2Offset = Vector.rotate(Vector.create(rampGene.peg2.radius, 0), rampGene.peg2.angle);
        const peg2Pos = Vector.add(vertex2, peg2Offset);
        const peg2 = Bodies.circle(peg2Pos.x, peg2Pos.y, pegRadius, { label: 'board_element', isStatic: true, restitution: 0.5, render: pegRenderStyle });
        rampBodies.push(peg2);

        return rampBodies;
    }

    createConnectedWallFromVertices(vertices, thickness) {
        if (!vertices || vertices.length < 2) return [];
        const { Bodies } = this.Matter;
        const wallSegments = [];
        for (let i = 0; i < vertices.length - 1; i++) {
            const start = vertices[i], end = vertices[i+1];
            if (!start || !end) continue;
            const length = Math.hypot(end.x - start.x, end.y - start.y);
            const angle = Math.atan2(end.y - start.y, end.x - start.x);
            const centerX = (start.x + end.x) / 2, centerY = (start.y + end.y) / 2;
            wallSegments.push(Bodies.rectangle(centerX, centerY, length, thickness, { label: 'board_element', isStatic: true, angle: angle, render: { fillStyle: '#95a5a6' } }));
        }
        return wallSegments;
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
