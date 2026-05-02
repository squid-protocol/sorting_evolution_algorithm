# Evolutionary Design of a Small Parts Singulator Sorting Machine

### 🎥 Raw Evolution Demo (Gen 3 vs 50)
[![Raw Evolution Demo](https://img.youtube.com/vi/g3T9_7ois08/maxresdefault.jpg)](https://youtu.be/g3T9_7ois08)

## Overview
This project is a highly specialized Machine Learning and Simulation pipeline designed to procedurally generate, optimize, and validate physical sorting mechanisms for small, asymmetric parts. 

Whether sorting agricultural seeds by size, filtering manufacturing components for defects, or organizing consumer plastics (like Lego bricks), designing passive physical sorters (Plinko-style boards, funnels, and vibrating ramps) is traditionally a slow, manual CAD process. 

I've replaced manual iteration with a custom, human-in-the-loop Genetic Algorithm (GA) powered by a headless 2D physics engine (`matter.js`). It is capable of exploring a near-infinite mechanical solution space, mathematically mapping its own evolutionary strategies, and ruthlessly stress-testing its designs to output highly efficient, manufacturable physical geometries.

---

## ⚠️ The Engineering Challenge: Chaotic Physics
Standard optimization algorithms fail when applied to rigid-body physics engines. The physics of thousands of small parts colliding, wedging, and bouncing is inherently chaotic. A one-millimeter adjustment to a single peg can change a perfect, high-throughput funnel into a catastrophic jam. 

This creates a highly rugged "fitness landscape" where AI easily gets trapped in dead-ends (local optima) or over-optimizes for statistical flukes (a single lucky simulation run). 

To solve this, my engine is built on a novel **three-pillar architecture** that tightly couples raw evolutionary computation with deep statistical analysis and human intuition.

### 🎥 Full System Overview & Deep Dive
[![Full System Overview](https://img.youtube.com/vi/e0uPb7Tg9FI/maxresdefault.jpg)](https://youtu.be/e0uPb7Tg9FI)

---

## 🏛️ The Architecture (The Triad)

This repository is divided into three distinct but deeply interconnected subsystems:

### 1. The Simulator: Evolutionary Generation (`/ga`)
The core engine of S34. The GA generates thousands of unique machine layouts per minute, evaluating them headlessly across a multi-threaded Web Worker pool.
* **Heterogeneous Genome:** Explores continuous variables (heights, angles, vibration frequencies) alongside latent, binary structural genes (dormant ramps and peg matrices that can be toggled on/off across generations).
* **Multi-Objective Fitness:** AI is rewarded for high throughput and symmetrical distribution, but exponentially penalized for jams, simultaneous clump drops, and physics violations (overlapping geometries).
* **Stagnation Breakers:** Employs dynamic mutation scaling and mass extinction events to force the algorithm out of evolutionary dead-ends.

### 2. The Cartographer: Dimensionality Reduction (`/ca`)
The Genetic Algorithm explores a 60+ dimensional search space, making it a "black box." The Cartographer solves this by running Principal Component Analysis (PCA) on the GA's output logs.
* **Landscape Mapping:** Compresses the 60+ machine variables into a 3D, human-readable coordinate system to show exactly *how* the AI is solving the problem.
* **Human-in-the-Loop (HitL):** By viewing the interactive Cartographer dashboard, engineers can see which mathematical strategies yield the highest fitness. Humans can then update the GA parameters or issue live "Directives" to actively constrain the search space, supercharging the AI's ability to find optimal solutions.

### 3. The Validator: Statistical Robustness (`/va`)
Because chaotic physics engines occasionally produce "golden runs" (where a bad machine gets a high score purely by mathematical chance), the Validator acts as the final gatekeeper.
* **Large-$N$ Monte Carlo Testing:** When the GA claims to have found a "Champion" geometry, the Validator isolates it and runs 50 to 100 identical simulations in parallel.
* **Fluke Elimination:** By analyzing the median performance and standard deviation of these runs, the Validator proves whether the machine's success is due to brilliant mechanical design or just a statistical fluke. Only tight, highly reproducible bell curves pass validation.

---

## 🚀 Getting Started

To run the full pipeline, you will utilize the three subsystems in sequence:

1. **Evolve:** Launch the GA (`/ga/index_S34.html`) to begin searching the solution space.
2. **Map:** Feed the resulting `.jsonl` logs into the Cartographer (`python ca/cartographer.py data.jsonl`) to visualize the AI's strategies and identify optimal parameters.
3. **Validate:** Extract a champion seed from the GA and run it through the Validator (`/va/validator_S34.html`) to confirm its physical reliability.