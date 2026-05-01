# Project S34: Evolutionary Design of Small Parts Sorting Mechanisms

![Initial Poor Solution](assets/initial_poor_solution.png)
*An example of a poor initial generation state, before evolutionary optimization.*

## Overview
Project S34 is a custom-built, highly advanced Genetic Algorithm (GA) framework designed to procedurally generate, simulate, and optimize physical sorting mechanisms (Plinko-style boards, funnels, and ramps) for small parts. 

Standard optimization algorithms struggle with rigid-body physics simulations (using `matter.js`) due to the highly chaotic and rugged nature of the fitness landscape. A minor millimeter adjustment in a single component can drastically alter the trajectory of falling parts, leading to premature convergence and evolutionary stagnation. 

To solve this, S34 features a completely custom, from-scratch evolutionary architecture. It leverages a heterogeneous genome with latent traits, multi-objective fitness sculpting, dynamic extinction events, and a "Human-in-the-Loop" (HitL) directive system to force the algorithm out of local optima and discover highly efficient, non-intuitive sorting geometries.

![Evolution Data Over Time](assets/evolution_data_over_time.png)
*Tracking the progression and convergence of fitness scores across generations.*

---

## 🧬 1. The Genome Architecture (Heterogeneous & Latent)
Unlike standard GAs that use simple fixed-length arrays of floats, S34 utilizes a highly complex, variable-expression genome. 

* **Continuous Machine Variables:** Global board properties like `machineHeight`, `boardAngle`, `detectorOffset`, and `dropDelayTime`.
* **The Functional Funnel Profile:** A multi-slice array mapping the width, offset, and vertical positioning of the primary funnel walls, allowing the algorithm to evolve smooth, organic curves or sharp choke points.
* **Latent Genes (Complex Ramps & Peg Matrices):** The most novel feature of the chromosome. The genome contains arrays of internal obstacles (ramps with pegs, and grid matrices). Crucially, these components possess an `isActive` toggle. 
    * *Why this matters:* This allows the GA to carry "dormant" genetic information across generations. A sequence of genes defining a highly specific ramp setup might be deactivated (causing no physics collisions) but passed down. Later mutations can reactivate it in a new context, allowing for massive, sudden leaps in structural complexity without breaking the current physical geometry during the intermediate steps.

## ⚖️ 2. The Multi-Objective Fitness Landscape
Because the goal is not just "throughput" but also "consistency," the fitness function is a heavily engineered composite score balancing multiple competing objectives.

* **Throughput vs. Jams:** Rewards total parts successfully passing the detector while heavily penalizing parts that get stuck or take too long (`jamPenalty`).
* **The IQR Consistency Reward:** To achieve a "smooth" flow of parts, the algorithm records the exact timestamp of every part drop. It calculates the Interquartile Range (IQR) of these intervals. A lower IQR indicates a highly consistent, metronome-like feed rate, which the algorithm exponentially rewards.
* **Simultaneous Drop Penalty:** Explicitly penalizes mechanics that cause multiple parts to drop at the exact same millisecond, forcing the algorithm to evolve true staggering and sorting mechanics rather than bulk dumping.
* **Spatial Symmetry:** Evaluates the exit coordinates of the parts to ensure the machine isn't heavily biased to one side of the board.
* **Physics Violations:** Penalizes intersecting geometries (e.g., a peg spawning inside a wall) to ensure the resulting CAD/model is physically manufacturable in the real world.

## 🌩️ 3. Novel Evolutionary Mechanics
To combat the massive issue of stagnation in physics-based GAs, S34 employs aggressive, dynamic population control.

* **Dynamic Stagnation Tracking:** The master GA thread constantly monitors the Delta between the current generation's elite and historical bests.
* **Targeted Mutation Scaling:** If the population stagnates, the global mutation rate dynamically scales up to force exploration, and scales back down when a new optimal gradient is found to allow for fine-tuning.
* **Diversity Injection:** If minor stagnation occurs, the algorithm automatically overwrites the bottom percentile of the population with completely randomized "alien" genomes to introduce fresh genetic material without destroying the elite lineages.
* **Mass Extinction Events:** If deep stagnation is detected (e.g., stuck in a local optimum for X generations), an extinction event is triggered. The algorithm preserves only the top absolute elites and aggressively wipes the rest of the population, forcing a massive geographical leap in the fitness landscape.

## 🎮 4. Human-in-the-Loop (HitL) "Directives"
Perhaps the most unique feature is the live interaction system. Rather than waiting hours for a run to finish only to realize the algorithm exploited a physics glitch or optimized for the wrong variable, S34 allows real-time human intervention.

* **Live Weight Manipulation:** The user UI allows for real-time adjustment of fitness weights (`weightThroughput`, `weightJam`, `weightConsistency`). This actually alters the topology of the fitness landscape *while the algorithm is running*.
* **Evolutionary Directives:** The user can issue command "Directives" (e.g., "Force Symmetry", "Prioritize Flow"). These directives override the default mutation behaviors, actively pushing the GA to explore specific regions of the genetic search space based on human intuition.

---

## ⚙️ 5. Technical Stack, Parallelization & Data Cartography
Simulating thousands of 2D physics drops is computationally expensive. S34 is built for maximum browser performance.

* **Web Worker Concurrency:** The main UI offloads the evolutionary logic to a dedicated Web Worker.
* **Sub-Worker Simulation Pool:** The `ga_worker` further spawns a pool of sub-worker threads. Entire generations are chunked and evaluated in parallel across all available CPU cores.
* **Headless `matter.js`:** The sub-workers run instances of the `matter.js` engine completely headlessly (without rendering canvas graphics) to achieve maximum ticks-per-second (TPS).

### Exploring the Fitness Landscape
Outputs are serialized to `.jsonl` and fed into a separate Python/Dash data pipeline (`cartographer.py`) for deep Principal Component Analysis (PCA) to map the evolutionary pathways.

![PC1 Population Evolution Over Time](assets/pc1_population_evolution_over_time.png)
*Tracking how the population clusters around specific Principal Component values as generations advance.*

![3D Fitness Landscape: PC1 vs PC2 vs Fitness](assets/pc1vspc2vfitness.png)
*A 3D projection of the fitness landscape, mapping the physical geometries against their evolutionary success.*

### Principal Component Definitions
To interpret the mathematical vectors discovered by the Cartographer, the following definitions map the Principal Components back to the physical traits of the sorting machines:

![PCA Definitions](assets/pca_definitions.png)