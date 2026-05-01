import pandas as pd
import numpy as np
import json
import argparse
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler
import plotly.express as px
import plotly.graph_objects as go
import dash
from dash import dcc, html, dash_table
from dash.dependencies import Input, Output
from dash.dash_table.Format import Format, Scheme
import webbrowser
from threading import Timer

# --- Data Loading and Processing Functions ---

def load_data_from_jsonl(file_path):
    """Loads data from a JSONL file, handling potential errors."""
    records = []
    try:
        with open(file_path, 'r') as f:
            for line in f:
                try:
                    records.append(json.loads(line))
                except json.JSONDecodeError:
                    print(f"Warning: Skipping a malformed line in {file_path}")
    except FileNotFoundError:
        print(f"Error: File not found at {file_path}")
    return records

def flatten_data(records):
    """
    Flattens the nested JSON data into a pandas DataFrame, unpacking
    funnel profiles, latent genes, and S34 functional annotations.
    """
    flat_data = []
    for record in records:
        chromosome = record.get('chromosome', {})
        result = record.get('result', {})
        
        row = {
            'id': chromosome.get('id'),
            'fitness': chromosome.get('fitness'),
            'finalScore': result.get('finalScore'),
            'throughput': result.get('throughputScore'),
            'jamPenalty': result.get('jamPenalty'),
            'simultaneousPenalty': result.get('simultaneousPenalty'),
            'consistencyRewardRatio': result.get('consistencyRewardRatio'),
            'symmetryRewardRatio': result.get('symmetryRewardRatio'),
            'normalizedIQR': result.get('normalizedIQR'),
            'physicsViolationCount': result.get('physicsViolationCount'),
            'intervalZonePenalty': result.get('intervalZonePenalty'),
            'preferredIntervalCount': result.get('preferredIntervalCount'),
            'preferredIntervalRatio': result.get('preferredIntervalRatio'),
            'rejectCount': result.get('rejectCount'),
            'lowCount': result.get('lowCount'),
            'highCount': result.get('highCount'),
            'jamCount': result.get('jamCount'),
            'isEstimated': 1 if result.get('isEstimated') else 0,
            
            'boardAngle': chromosome.get('boardAngle'),
            'machineHeight': chromosome.get('machineHeight'),
            'detectorOffset': chromosome.get('detectorOffset'),
            'batchSize': chromosome.get('batchSize'),
            'numBatches': chromosome.get('numBatches'),
            'dropDelayTime': chromosome.get('dropDelayTime'),
            'batchDropDuration': chromosome.get('batchDropDuration'),
            'freeFallTime': chromosome.get('freeFallTime'),
            'conveyorDropX': chromosome.get('conveyorDropX'),
            'conveyorDropWidth': chromosome.get('conveyorDropWidth'),
            'shakeAmplitude': chromosome.get('shakeAmplitude'),
            'shakeTimeOn': chromosome.get('shakeTimeOn'),
            'shakeTimeOff': chromosome.get('shakeTimeOff'),
            'shakeAmplitude_harsh': chromosome.get('shakeAmplitude_harsh'),
            'shakeTimeOn_harsh': chromosome.get('shakeTimeOn_harsh'),
            'shakeTimeOff_harsh': chromosome.get('shakeTimeOff_harsh'),
        }

        # Aggregate counts for latent structural genes
        complex_ramps = chromosome.get('complexRamps', [])
        row['active_complex_ramps'] = sum(1 for r in complex_ramps if r.get('isActive'))

        peg_matrices = chromosome.get('pegMatrices', [])
        row['active_peg_matrices'] = sum(1 for p in peg_matrices if p.get('isActive'))

        # Flatten Funnel Profile (Now tracking Y position alongside width/offset)
        funnel_profile = chromosome.get('funnel_profile', [])
        for i, slice_data in enumerate(funnel_profile):
            row[f'funnel_width_{i}'] = slice_data.get('width')
            row[f'funnel_offset_{i}'] = slice_data.get('offset')
            row[f'funnel_y_position_{i}'] = slice_data.get('y_position')

        # Flatten River of Flow Annotations
        annotations = result.get('functionalAnnotations', {})
        components = annotations.get('components', [])
        for i, comp_data in enumerate(components):
            row[f'component_dist_from_center_{i}'] = comp_data.get('distanceFromCenterline')
            row[f'component_in_river_prop_{i}'] = comp_data.get('inRiverProportion')
            
        flat_data.append(row)
        
    return pd.DataFrame(flat_data)

def prepare_data_for_pca(df):
    """Prepares the DataFrame for PCA, separating machine variables from results."""
    # Updated to capture all relevant machine configuration genes including latent components
    machine_cols = [col for col in df.columns if 'funnel_' in col or 
                    'component_' in col or 
                    col in ['boardAngle', 'machineHeight', 'detectorOffset', 'batchSize', 
                            'numBatches', 'dropDelayTime', 'batchDropDuration', 'freeFallTime', 
                            'conveyorDropX', 'conveyorDropWidth', 'shakeAmplitude', 'shakeTimeOn', 
                            'shakeTimeOff', 'shakeAmplitude_harsh', 'shakeTimeOn_harsh', 'shakeTimeOff_harsh',
                            'active_complex_ramps', 'active_peg_matrices']]
    
    # Updated to capture the expansive S34 reward/penalty suite
    result_cols = ['fitness', 'finalScore', 'throughput', 'jamPenalty', 'simultaneousPenalty', 
                   'consistencyRewardRatio', 'symmetryRewardRatio', 'normalizedIQR', 
                   'physicsViolationCount', 'intervalZonePenalty', 'preferredIntervalCount',
                   'preferredIntervalRatio', 'rejectCount', 'lowCount', 'highCount', 'jamCount']
                   
    machine_df = df[machine_cols].select_dtypes(include=np.number)
    
    print(f"Selected {len(machine_df.columns)} machine features for PCA.")

    for col in machine_df.columns:
        if machine_df[col].isnull().sum() > 0:
            mean_val = machine_df[col].mean()
            # Fills NA values in a way that avoids the Pandas FutureWarning
            machine_df.fillna({col: mean_val}, inplace=True)
            print(f"  - Imputed {machine_df[col].isnull().sum()} missing values in '{col}' with mean ({mean_val:.2f})")

    return machine_df, result_cols

def perform_pca(data, n_components=10):
    """Performs PCA and returns PCs and transposed component loadings."""
    scaler = StandardScaler()
    scaled_data = scaler.fit_transform(data)
    
    pca = PCA(n_components=n_components)
    principal_components = pca.fit_transform(scaled_data)
    
    pc_df = pd.DataFrame(data=principal_components, columns=[f'PC{i+1}' for i in range(n_components)])
    
    print("\nPCA complete. Explained variance by component:")
    total_variance = 0
    for i, variance in enumerate(pca.explained_variance_ratio_):
        total_variance += variance
        print(f"  - PC{i+1}: {variance:.2%} (Cumulative: {total_variance:.2%})")
    
    components_df = pd.DataFrame(pca.components_, columns=data.columns, index=[f'PC{i+1}' for i in range(n_components)])
    
    return pc_df, components_df.T

def generate_summary_report(components_df):
    """Generates a markdown string summarizing the top 10 factors for each PC."""
    report_parts = ["# PCA Summary Report\n\nThis report shows the top 10 most influential variables for each Principal Component.\n"]
    for pc in components_df.columns:
        report_parts.append(f"\n---\n\n### **{pc}**\n")
        top_factors = components_df[pc].abs().nlargest(10).index
        for factor in top_factors:
            value = components_df.loc[factor, pc]
            report_parts.append(f"- **{factor}:** {value:.3f}\n")
    return "".join(report_parts)

def create_trend_analysis_layout(df):
    """Generates the layout for the Trend Analysis tab."""
    plots = []
    for i in range(1, 11):
        pc = f'PC{i}'
        fig = px.scatter(df, x='succession', y=pc, title=f'Trend for {pc}', trendline="ols", trendline_color_override="red")
        fig.update_traces(marker=dict(size=3, opacity=0.5))
        
        # Get regression results
        results = px.get_trendline_results(fig)
        model = results.iloc[0]["px_fit_results"]
        r_squared = model.rsquared
        slope = model.params[1]
        
        stats_text = f"Slope: {slope:.4f} | R²: {r_squared:.3f}"
        
        plots.append(
            html.Div([
                html.H4(f"{pc} Trend", style={'textAlign': 'center'}),
                dcc.Graph(figure=fig),
                html.P(stats_text, style={'textAlign': 'center', 'fontWeight': 'bold'})
            ], style={'width': '48%', 'display': 'inline-block', 'padding': '10px'})
        )
    return html.Div(plots)

# --- Dash App Initialization ---
app = dash.Dash(__name__, title="PCA Fitness Landscape Explorer")

# --- Main execution block ---
if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Analyze and visualize GA data with PCA.')
    parser.add_argument('files', nargs='+', help='Path(s) to the JSONL file(s).')
    args = parser.parse_args()

    # --- Data Loading and Processing ---
    print(f"Loading data from {len(args.files)} file(s)...")
    all_records = load_data_from_jsonl(args.files[0])
    if not all_records:
        print("No records loaded. Exiting.")
        exit()
    print(f"Loaded a total of {len(all_records)} records.")

    df = flatten_data(all_records)
    machine_df, result_cols = prepare_data_for_pca(df.copy())
    pc_df, components_df = perform_pca(machine_df)
    full_analysis_df = pd.concat([df, pc_df], axis=1)
    full_analysis_df['succession'] = range(len(full_analysis_df))
    full_analysis_df['generation'] = full_analysis_df['succession'] // 120

    # --- UI Component Generation ---
    summary_report_text = generate_summary_report(components_df)
    trend_analysis_layout = create_trend_analysis_layout(full_analysis_df)
    
    all_options = []
    
    # --- The succession/timeline parameters added here ---
    all_options.append({'label': 'Timeline (Individual Order)', 'value': 'succession'})
    all_options.append({'label': 'Timeline (Discrete Generation)', 'value': 'generation'})
    
    all_options.extend([{'label': f'PC{i+1}', 'value': f'PC{i+1}'} for i in range(10)])
    all_options.extend([{'label': col, 'value': col} for col in result_cols if col in full_analysis_df.columns])
    all_options.extend([{'label': col, 'value': col} for col in sorted(machine_df.columns)])
    
    unique_options = []
    seen_values = set()
    for option in all_options:
        if option['value'] not in seen_values:
            unique_options.append(option)
            seen_values.add(option['value'])

    z_axis_options = [{'label': 'None (2D Plot)', 'value': 'None'}] + unique_options

    table_columns = [{"name": i, "id": i, "type": "numeric", "format": Format(precision=3, scheme=Scheme.fixed)} for i in components_df.columns]
    table_columns.insert(0, {"name": "Feature", "id": "Feature", "type": "text"})
    
    style_data_conditional = []
    for pc in components_df.columns:
        styles = [
            {'if': {'filter_query': f'{{{pc}}} <= -0.3', 'column_id': pc}, 'backgroundColor': '#d73027', 'color': 'white'},
            {'if': {'filter_query': f'{{{pc}}} > -0.3 && {{{pc}}} <= -0.1', 'column_id': pc}, 'backgroundColor': '#fc8d59', 'color': 'black'},
            {'if': {'filter_query': f'{{{pc}}} > -0.1 && {{{pc}}} < 0.1', 'column_id': pc}, 'backgroundColor': '#fee090', 'color': 'black'},
            {'if': {'filter_query': f'{{{pc}}} >= 0.1 && {{{pc}}} < 0.3', 'column_id': pc}, 'backgroundColor': '#91bfdb', 'color': 'black'},
            {'if': {'filter_query': f'{{{pc}}} >= 0.3', 'column_id': pc}, 'backgroundColor': '#4575b4', 'color': 'white'},
        ]
        style_data_conditional.extend(styles)

    # --- App Layout ---
    app.layout = html.Div([
        html.H1("Interactive PCA Fitness Landscape Explorer", style={'textAlign': 'center', 'fontFamily': 'Arial'}),
        dcc.Tabs(id="tabs-main", children=[
            dcc.Tab(label='Plotting', children=[
                html.Div([
                    html.Div([html.Label("X-Axis"), dcc.Dropdown(id='xaxis-column', options=unique_options, value='succession')], style={'width': '24%', 'display': 'inline-block'}),
                    html.Div([html.Label("Y-Axis"), dcc.Dropdown(id='yaxis-column', options=unique_options, value='fitness')], style={'width': '24%', 'display': 'inline-block', 'padding': '0 10px'}),
                    html.Div([html.Label("Z-Axis"), dcc.Dropdown(id='zaxis-column', options=z_axis_options, value='None')], style={'width': '24%', 'display': 'inline-block'}),
                    html.Div([html.Label("Color"), dcc.Dropdown(id='color-column', options=unique_options, value='PC1')], style={'width': '24%', 'display': 'inline-block', 'padding': '0 10px'}),
                ], style={'padding': '20px 0'}),
                dcc.Graph(id='main-plot', style={'height': '70vh'}),
            ]),
            dcc.Tab(label='PCA Components Table', children=[
                html.H3("Principal Component Loadings"),
                html.P("This table shows how much each machine variable contributes to the principal components. Click column headers to sort."),
                dash_table.DataTable(
                    id='pca-table',
                    columns=table_columns,
                    data=components_df.reset_index().rename(columns={'index': 'Feature'}).to_dict('records'),
                    sort_action="native",
                    style_table={'overflowX': 'auto'},
                    style_cell={'textAlign': 'left'},
                    style_header={'fontWeight': 'bold'},
                    style_cell_conditional=[{'if': {'column_id': 'Feature'}, 'minWidth': '300px', 'width': '300px', 'maxWidth': '300px'}],
                    style_data_conditional=style_data_conditional
                )
            ]),
            dcc.Tab(label='Summary Report', children=[
                dcc.Markdown(summary_report_text, style={'padding': '20px', 'whiteSpace': 'pre-wrap'})
            ]),
            dcc.Tab(label='Trend Analysis', children=[
                trend_analysis_layout
            ]),
        ]),
    ], style={'padding': '10px', 'fontFamily': 'Arial'})

    # --- Callbacks ---
    @app.callback(Output('main-plot', 'figure'), [Input('xaxis-column', 'value'), Input('yaxis-column', 'value'), Input('zaxis-column', 'value'), Input('color-column', 'value')])
    def update_main_plot(xaxis, yaxis, zaxis, color):
        if not all([xaxis, yaxis, zaxis, color]):
            return go.Figure().update_layout(title_text="Please select values for all dropdowns.")

        if zaxis == 'None': # 2D Plot
            fig = px.scatter(full_analysis_df, x=xaxis, y=yaxis, color=color, hover_name='id', color_continuous_scale=px.colors.sequential.Viridis, title=f"2D Scatter: {xaxis} vs. {yaxis}")
        else: # 3D Plot
            fig = px.scatter_3d(full_analysis_df, x=xaxis, y=yaxis, z=zaxis, color=color, hover_name='id', color_continuous_scale=px.colors.sequential.Viridis, title=f"3D Scatter: {xaxis} vs. {yaxis} vs. {zaxis}")
            fig.update_traces(marker=dict(size=2, opacity=0.8))
            fig.update_layout(scene=dict(xaxis_title=xaxis, yaxis_title=yaxis, zaxis_title=zaxis))
        
        fig.update_layout(margin=dict(l=0, r=0, b=0, t=40))
        return fig

    # --- Run Server & Auto-Open Browser ---
    def open_browser():
        webbrowser.open_new("http://127.0.0.1:8050/")

    # Wait 1 second for the server to start, then open the browser
    Timer(1, open_browser).start()
    
    # use_reloader=False prevents the browser from opening twice
    app.run(debug=True, use_reloader=False)