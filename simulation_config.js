/**
 * ===================================================================================
 * S35 SIMULATION CORE CONFIGURATION
 * ===================================================================================
 * Document Version: 2.0 (S35 Cascade Model Conversion)
 * Purpose: This file serves as the SINGLE SOURCE OF TRUTH for all physics-related
 * parameters across the entire S35 project.
 *
 * MANDATORY IMPLEMENTATION:
 * Any script that instantiates a Matter.js physics environment MUST import and
 * use the constants and functions from this file. This is the cornerstone of
 * our Simulation Integrity Mandate. Do NOT hard-code these values locally.
 * ===================================================================================
 */

// ===================================================================================
// SECTION 1: PHYSICS ENGINE PARAMETERS
// ===================================================================================

export const ENGINE_CONFIG = {
    positionIterations: 6,
    velocityIterations: 4,
    gravity: {
        x: 0,
        y: 1.0,
        scale: 0.001
    },
    timing: {
        timeScale: 1.0,
    }
};

export const TIME_STEP = 1000 / 60;

// This function is retained from S34 as the physics model for board tilt is identical.
export const BOARD_ANGLE_CALC_FN = (gravity, boardAngleRad) => {
    const baselineGravity = ENGINE_CONFIG.gravity.y;
    // Keep gravity's x-component at 0, preventing sideways acceleration.
    gravity.x = 0;
    // Adjust the y-component based on the cosine of the angle.
    // This simulates the board tilting against a vertical wall.
    gravity.y = Math.cos(boardAngleRad) * baselineGravity;
};


// ===================================================================================
// SECTION 2: PIECE & MATERIAL PROPERTIES
// ===================================================================================

export const PIECE_PHYSICS_PROPERTIES = {
    friction: 0.3,
    frictionStatic: 0.5,
    restitution: 0.1,
    density: 0.01,
};

export const PIECE_LIBRARY = [
    { type: 'rect', vertices: '0 0 8 0 8 8 0 8' },    // 1x1 Plate
    { type: 'rect', vertices: '0 0 16 0 16 8 0 8' },  // 1x2 Plate
    { type: 'rect', vertices: '0 0 32 0 32 8 0 8' },  // 1x4 Plate
    { type: 'rect', vertices: '0 0 16 0 16 16 0 16' } // 2x2 Plate
];


// ===================================================================================
// SECTION 3: SIMULATION BOUNDARIES & CONSTANTS (S35 UPDATE)
// ===================================================================================

export const SIM_CONFIG = {
    MACHINE_WIDTH: 2400,
    MACHINE_HEIGHT: 3000,
    WALL_THICKNESS: 20,
    RAMP_THICKNESS: 10,
    // S35 Heuristic from algo_specs.odt for validation checks
    MIN_VERTICAL_CLEARANCE: 40
};

export const SENSOR_CONFIG = {
    DETECTOR_WIDTH: 300
};

export const MAX_SIM_TIME = 900000; // 900 seconds
