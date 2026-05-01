// validator_simulation_viz_S34.js - Renders the board for the S34 validator.
export class Visualizer {
    constructor(containerElement, config) {
        this.Matter = Matter;
        const { Engine, Render, World } = this.Matter;
        this.config = config;

        this.engine = Engine.create(this.config.ENGINE_CONFIG);
        this.world = this.engine.world;
        this.currentChromosome = null;

        this.render = Render.create({
            element: containerElement,
            engine: this.engine,
            options: { 
                width: this.config.SIM_CONFIG.BOARD_WIDTH, 
                height: this.config.SIM_CONFIG.BOARD_HEIGHT, 
                wireframes: false, 
                background: '#2c3e50',
                preserveDrawingBuffer: true 
            }
        });

        Render.run(this.render);
        Render.lookAt(this.render, { 
            min: { x: 0, y: 0 }, 
            max: { x: this.config.SIM_CONFIG.BOARD_WIDTH, y: this.config.SIM_CONFIG.BOARD_HEIGHT } 
        });
    }

    drawStaticBoard(chromosome) {
        if (!chromosome) return;
        this.currentChromosome = chromosome;
        
        const { World, Engine } = this.Matter;
        World.clear(this.engine.world, false);
        Engine.clear(this.engine);
        
        const boardBodies = this.createBoardFromFunctionalProfile(chromosome);
        World.add(this.engine.world, boardBodies);
        
        this.Matter.Render.world(this.render);
    }

    createBoardFromFunctionalProfile(chromosome) {
        const { Bodies } = this.Matter;
        const { funnel_profile, machineHeight, detectorOffset } = chromosome;
        const wallThickness = 8;
        const allBodies = [];
        if (!funnel_profile) return allBodies;

        const verticesL = [];
        const verticesR = [];
        const topY = 50;

        funnel_profile.forEach((slice, i) => {
            const t = i / (funnel_profile.length - 1);
            const y = topY + t * (machineHeight - topY);
            const centerX = (this.config.SIM_CONFIG.BOARD_WIDTH / 2) + slice.offset;
            verticesL.push({ x: centerX - slice.width / 2, y });
            verticesR.push({ x: centerX + slice.width / 2, y });
        });

        const sensorCenterX = (this.config.SIM_CONFIG.BOARD_WIDTH / 2) + detectorOffset;
        const sensorWidth = this.config.SENSOR_CONFIG.SENSOR_WIDTH;
        verticesL[verticesL.length - 1] = { x: sensorCenterX - sensorWidth / 2, y: machineHeight };
        verticesR[verticesR.length - 1] = { x: sensorCenterX + sensorWidth / 2, y: machineHeight };

        for (let i = 0; i < verticesL.length - 1; i++) {
            const startL = verticesL[i], endL = verticesL[i+1];
            const lengthL = Math.hypot(endL.x - startL.x, endL.y - startL.y);
            const angleL = Math.atan2(endL.y - startL.y, endL.x - startL.x);
            const centerXL = (startL.x + endL.x) / 2, centerYL = (startL.y + endL.y) / 2;
            allBodies.push(Bodies.rectangle(centerXL, centerYL, lengthL, wallThickness, { isStatic: true, angle: angleL }));

            const startR = verticesR[i], endR = verticesR[i+1];
            const lengthR = Math.hypot(endR.x - startR.x, endR.y - startR.y);
            const angleR = Math.atan2(endR.y - startR.y, endR.x - startR.x);
            const centerXR = (startR.x + endR.x) / 2, centerYR = (startR.y + endR.y) / 2;
            allBodies.push(Bodies.rectangle(centerXR, centerYR, lengthR, wallThickness, { isStatic: true, angle: angleR }));
        }
        
        return allBodies;
    }
}
