# LEGO Sorter Evolutionary Pipeline (S35)

This repository contains a fully functional, browser-based Genetic Algorithm (GA) and physics simulation pipeline designed to optimize physical sorting machinery. 

The primary achievement of this project is its proven end-to-end pipeline: the system successfully takes randomized, chaotic "Plinko-style" board parameters and automatically evolves them into highly efficient, traditional "shaker" (zig-zag cascade) sorter designs through thousands of generations of physics-based natural selection.

## 🚀 Key Features

* **Proven Evolutionary Pipeline:** Successfully transitions designs from random Plinko geometries to deterministic, high-throughput cascade shakers.
* **Decentralized Multithreading:** Utilizes a Web Worker architecture. A central Coordinator (`ga_worker_S35.js`) manages the genetic population while dispatching headless Matter.js physics simulations to parallel Sub-Workers (`sub_worker_S35.js`).
* **Time-Corrected Physics Engine:** Re-engineered Matter.js implementation that decouples simulation speed from hardware limits, allowing for thousands of physics steps to be processed in a fraction of a second without losing real-world accuracy.
* **Nuanced Fitness Function:** A complex scoring system that doesn't just measure speed. It rewards throughput and piece-to-piece consistency while harshly penalizing jams, clumped exits, and physics violations.
* **Topological Cartographer:** An offline Python analysis toolkit (`cartographer.py`) that uses Principal Component Analysis (PCA) to map the multi-dimensional fitness landscape of the generated designs.

## 🧠 How the Evolution Works

The algorithm searches a massive solution space to find the optimal physical configuration for a sorting machine. 

1.  **The Blueprint (Chromosome):** Each design is defined by "genes" controlling machine width, global board tilt (gravity modifier), shake amplitude (vibration), batch release timing, and the specific coordinates and angles of internal cascading ramps.
2.  **The Trial (Simulation):** Headless workers drop virtual LEGO pieces (with specific friction, restitution, and density) into the machine. 
3.  **The Score (Fitness):** The system records every interaction. Designs that safely singulate pieces at a consistent rate score high. Designs that jam or drop clumps score low.
4.  **The Next Generation:** The best designs are preserved (Elitism), bred together, and subjected to intelligent, physics-aware Gaussian mutations (e.g., preventing impossible overlapping geometry) to create the next generation.

## 🛠️ System Architecture

* **`index_S35.html` & `main_S35.js`:** The primary UI/dashboard. Provides real-time telemetry, fitness breakdowns, and live visual rendering of the current "Champion" design.
* **`simulation_config.js`:** The single source of truth for all physics rules, gravity, piece definitions, and spatial boundaries.
* **`ga_worker_S35.js`:** The Genetic Algorithm coordinator. Handles breeding, mutation, and population management.
* **`sub_worker_S35.js`:** The headless physics simulators that crunch the actual drop tests.
* **`simulator_S35.html`:** A standalone debugging simulator for manually testing and tweaking specific JSON chromosomes.
* **`cartographer.py`:** A Dash/Plotly Python app for analyzing `.jsonl` survey data dumps to visualize the PCA fitness landscape.

## 🚦 Getting Started

### Running the Simulator & GA
Because the project heavily utilizes Web Workers and ES6 modules, it must be served via a local web server (opening the HTML files directly via `file://` will trigger CORS errors).

1. Clone the repository.
2. Start a local server in the project directory:
   ```bash
   # Using Python 3
   python -m http.server 8000