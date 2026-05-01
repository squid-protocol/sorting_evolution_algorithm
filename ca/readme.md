# 🗺️ Cartographer: High-Dimensional Fitness Landscape Mapping

## The Problem: The "Black Box" of Infinite Search Spaces
Project S34's Genetic Algorithm (GA) is capable of exploring a near-infinite solution space. Between the continuous variables (heights, angles, speeds), the multi-point funnel geometries, and the latent binary states of internal ramps and peg matrices, the number of possible mechanical configurations exceeds billions. 

While the GA is highly effective at navigating this space, it presents a classic Machine Learning problem: **it is a black box**. When the algorithm discovers a highly successful sorting mechanism, it is incredibly difficult to know *why* it works, *what* genetic traits actually drove the success, or *where* the algorithm should focus next. 

If left completely blind, even advanced GAs can waste massive amounts of computational power exploring dead-end branches of a rugged fitness landscape.

## The Solution: Supercharging Evolution via Cartography
**Cartographer** is a custom Python-based dimensionality reduction and visualization pipeline designed to solve the black-box problem. It takes the massive serialized outputs of the GA (`.jsonl` log files) and uses Principal Component Analysis (PCA) to compress the 60+ dimensional genetic hyperspace into a human-readable 3D coordinate system.

By visualizing these abstract math vectors, **Cartographer supercharges our ability to find optimal solutions through an iterative Human-in-the-Loop (HitL) refinement cycle:**

1. **Unfettered Exploration:** The GA is deployed with wide, unconstrained parameters, freely exploring the near-infinite physical geometries.
2. **Dimensional Reduction:** Cartographer ingests the generation data, mathematically identifying which variables move in tandem to create the highest variance in fitness (e.g., discovering that "Funnel Asymmetry" and "High Drop Rates" are linked).
3. **Landscape Mapping:** The interactive dashboard plots the population over time (Generations) against these Principal Components and their resulting Fitness Scores. 
4. **Iterative Refinement:** By looking at the 3D landscape, the engineer can clearly see where the "peaks" of high fitness are clustering within the PC coordinate space. We then update the GA's base configuration or issue live Directives to actively constrain the search space around those specific peaks.

Instead of waiting days for a blind algorithm to stumble upon a global optimum, this continuous feedback loop allows us to actively sculpt the search parameters, accelerating convergence by orders of magnitude.

---

## ⚙️ Core Architecture & Features

### 1. Dynamic Data Flattening
The Cartographer pipeline begins by parsing the highly nested, heterogeneous output of the GA. It dynamically flattens the structural arrays (e.g., parsing the individual `x/y` coordinates of the multi-slice `funnel_profile`) and extracts the activation states of the latent genes (`active_complex_ramps`, `active_peg_matrices`) to ensure the PCA math receives a standardized, continuous matrix without sparse data gaps.

### 2. Principal Component Extraction (`scikit-learn`)
Using `StandardScaler` and `PCA`, the system analyzes dozens of independent machine variables alongside the S34 penalty/reward suite (throughput, jam penalties, IQR consistency). It automatically calculates and prints the explained variance, grouping the raw variables into overarching "Strategies" (e.g., PC1 might represent "Vertical Scale", while PC2 represents "Bilateral Asymmetry").

### 3. Interactive Visualization Engine (`Plotly Dash`)
Cartographer bypasses static plotting in favor of a locally hosted, interactive web application. 
* **3D Landscape Exploration:** Users can map any Principal Component, raw physical variable, or GA generation to the X, Y, and Z axes, colored by Fitness or Jam Penalties.
* **Temporal Tracking:** The pipeline explicitly calculates both the continuous `succession` (individual evaluation order) and the discrete `generation` order, allowing engineers to visualize exactly how the population drifts through the mathematical space over time.
* **Live Component Analysis:** Features a dynamic data table outlining the exact weighting of every physical variable against the calculated Principal Components, complete with conditional heatmap styling to instantly identify dominating genetic traits.

### 4. Statistical Trend Analysis
The dashboard includes an automated OLS (Ordinary Least Squares) regression suite. It plots the trajectory of every Principal Component across the evolutionary timeline, outputting $R^2$ values and slopes. This tells the engineer precisely which physical strategies the AI is abandoning, and which ones it is aggressively pursuing.