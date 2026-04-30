# Genetic Algorithm Engine (`ga/`)

The `ga` directory houses the core Genetic Algorithm (GA) engine, physics simulators, and web-based user interfaces for the S35 LEGO sorter project. 

Operating as the "Surveyor" within the Decoupled Analysis Pipeline, this system executes massively parallel searches to evaluate, breed, and mutate designs in a browser environment. It handles the data generation phase, exporting logs for offline analysis in the Cartographer tool.

## 🧠 Core Architecture

The system utilizes a Decentralized Configuration model to distribute the computational workload:

* **The Coordinator (`ga_worker_S35.js` / `ga_worker_S35_upramp.js`):** The central Web Worker that manages the main evolutionary loop. It maintains the population, applies physics-aware Gaussian mutations, manages the breeding pool, and dispatches individual chromosomes to the sub-workers for evaluation. It implements a "late to dinner" job queue model to prevent slow simulations from delaying the entire generation.
* **The Simulators (`sub_worker_S35.js`):** A pool of independent, headless worker threads. Each simulator receives a single chromosome, runs a high-performance, time-corrected Matter.js physics simulation, and reports the performance score back to the coordinator.
* **The Orchestrator (`main_S35.js` & `index_S35.html`):** The primary user interface. It allows the user to start, pause, or stop the evolution, tune fitness function hyperparameters (weights), and view real-time telemetry. It also acts as the memory buffer, collecting data chunks from the worker to safely download as `.jsonl` files.

## 🛠️ Tooling & Visualization

Beyond the core evolutionary loop, this directory contains specialized tools for inspecting and analyzing designs:

* **Live Visualizer (`simulation_viz_S35.js`):** Renders a real-time, interactive representation of the current champion chromosome directly on the main dashboard.
* **Standalone Simulator (`simulator_S35.html`):** A dedicated debugging environment for loading, visualizing, and visually inspecting the physics behavior of a single, specific chromosome.
* **Metareport Visualizer (`Metareport_S35.html`):** A data dashboard that loads aggregate GA run reports to chart fitness trends, population health, exit reasons, and generational computation times.

## 🚦 System Mechanics

* **Positive Control Handshake:** Before evaluating complex designs, the coordinator tests every newly initialized simulator with a basic "null" chromosome to verify core physics functionality.
* **Pristine State Mandate:** To prevent state contamination across evaluations, a clean, independent simulation instance is instantiated for every single test job.
* **Elitism & Fitness Averaging:** Top-performing designs are carried over to the next generation without mutation, but they are re-evaluated. Their final fitness is the average of their historical runs (capped at 20), ensuring stable designs win over one-hit flukes.