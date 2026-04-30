# cartographer_v2.py - S34 Interactive Cartographer Dashboard
#
# Description:
#   This script launches an interactive web application for analyzing S34 survey data.
#   It allows for dynamic exploration of the fitness landscape through PCA.
#   Users can upload data, select principal components for plotting, switch between
#   2D and 3D views, and filter by fitness score to identify promising design regions.
#
# Dependencies:
#   pip install pandas scikit-learn plotly dash pyarrow
#
# Usage:
#   1. Run the S34 GA in the browser and download the survey data (.jsonl).
#   2. Run this script from your terminal: `python cartographer_v2.py`
#   3. Open your web browser and navigate to http://127.0.0.1:8050/
#   4. Upload your .jsonl file using the upload box in the dashboard.
#   5. Use the controls to explore the data.

import pandas as pd
import numpy as np
from sklearn.preprocessing import StandardScaler
from sklearn.decomposition import PCA
import plotly.express as px
import plotly.graph_objects as go
import json
import base64
import io
import random

import dash
from dash import dcc, html, Input, Output, State, no_update

# --- Constants ---
N_COMPONENTS = 10 # Number of principal components to calculate
DEFAULT_SAMPLE_SIZE = 75000 # Default number of records to sample from large files

# --- Data Processing Functions ---

def flatten_record(rec):
    """Flattens a single JSON record from the survey log into a 1D dictionary."""
    flat_rec = {}
    
    # Extract chromosome and result data, handling missing keys
    chromosome = rec.get('chromosome', {})
    result = rec.get('result', {})
    
    # Combine simple key-value pairs from both
    flat_rec.update(chromosome)
    flat_rec.update(result)

    # Flatten nested structures from the chromosome
    if 'funnel_profile' in chromosome and isinstance(chromosome['funnel_profile'], list):
        for i, slice_ in enumerate(chromosome['funnel_profile']):
            if isinstance(slice_, dict):
                flat_rec[f'funnel_{i}_width'] = slice_.get('width')
                flat_rec[f'funnel_{i}_offset'] = slice_.get('offset')

    if 'complexRamps' in chromosome and isinstance(chromosome['complexRamps'], list):
        for i, ramp in enumerate(chromosome['complexRamps']):
             if isinstance(ramp, dict):
                flat_rec[f'ramp_{i}_isActive'] = 1 if ramp.get('isActive') else 0
                flat_rec[f'ramp_{i}_x'] = ramp.get('x')
                flat_rec[f'ramp_{i}_y'] = ramp.get('y')
                flat_rec[f'ramp_{i}_rotation'] = ramp.get('rotation')

    if 'pegMatrices' in chromosome and isinstance(chromosome['pegMatrices'], list):
        for i, matrix in enumerate(chromosome['pegMatrices']):
            if isinstance(matrix, dict):
                flat_rec[f'peg_{i}_isActive'] = 1 if matrix.get('isActive') else 0
                flat_rec[f'peg_{i}_gridX'] = matrix.get('gridX')
                flat_rec[f'peg_{i}_gridY'] = matrix.get('gridY')

    # Remove non-numeric or problematic keys before analysis
    keys_to_remove = [
        'id', 'fitnessHistory', 'fullResult', 'intervals', 
        'clumpHistogram', 'exitReason', 'isEstimated', 'error', 
        'fitnessBreakdown', 'featureFlags', 'funnel_profile', 
        'complexRamps', 'pegMatrices'
    ]
    for key in keys_to_remove:
        flat_rec.pop(key, None)
        
    return flat_rec

def parse_jsonl_data(contents, sample_size):
    """
    Loads and preprocesses a sample of the .jsonl survey data using Reservoir Sampling
    to handle very large files without crashing.
    """
    content_type, content_string = contents.split(',')
    decoded = base64.b64decode(content_string)
    
    reservoir = []
    try:
        # Use a text stream to decode UTF-8 on the fly
        file_stream = io.TextIOWrapper(io.BytesIO(decoded), encoding='utf-8')
        
        # Reservoir Sampling Algorithm
        for i, line in enumerate(file_stream):
            if not line.strip():
                continue

            if i < sample_size:
                # Fill the reservoir initially
                reservoir.append(line)
            else:
                # Replace elements with decreasing probability
                j = random.randint(0, i)
                if j < sample_size:
                    reservoir[j] = line
        
        # Now, parse only the JSON from the sampled lines
        records = []
        for line in reservoir:
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                print(f"Warning: Skipping malformed line in sample: {line.strip()}")

    except Exception as e:
        print(f"Error reading file stream: {e}")
        return None, None, None, f"Error processing file: {e}"

    if not records:
        return pd.DataFrame(), None, None, "No valid records found in file."

    flat_records = [flatten_record(rec) for rec in records]
    df = pd.DataFrame(flat_records)
    
    if 'finalScore' not in df.columns:
        return pd.DataFrame(), None, None, "'finalScore' column not found."

    gene_cols = [col for col in df.columns if df[col].dtype in ['int64', 'float64'] and col != 'finalScore']
    df_genes = df[gene_cols].copy()
    
    df_genes.fillna(df_genes.mean(), inplace=True)
    
    scaler = StandardScaler()
    scaled_genes = scaler.fit_transform(df_genes)
    
    pca = PCA(n_components=N_COMPONENTS)
    principal_components = pca.fit_transform(scaled_genes)
    
    pc_df = pd.DataFrame(data=principal_components, columns=[f'PC{i+1}' for i in range(N_COMPONENTS)])
    pc_df['fitness'] = df['finalScore'].values
    
    return pc_df, pca, gene_cols, None

# --- Dash App Initialization ---
app = dash.Dash(__name__, title="S34 Cartographer")
server = app.server

# --- App Layout ---
app.layout = html.Div(style={'backgroundColor': '#111111', 'color': '#DDDDDD', 'fontFamily': 'sans-serif'}, children=[
    html.H1('S34 Interactive Cartographer', style={'textAlign': 'center', 'color': '#007BFF'}),
    
    html.Div(style={'width': '98%', 'margin': '10px auto', 'display': 'flex', 'alignItems': 'center', 'gap': '20px'}, children=[
        dcc.Upload(
            id='upload-data',
            children=html.Div(['Drag and Drop or ', html.A('Select Survey File (.jsonl)')]),
            style={
                'flexGrow': '1', 'height': '60px', 'lineHeight': '60px',
                'borderWidth': '1px', 'borderStyle': 'dashed', 'borderRadius': '5px',
                'textAlign': 'center'
            },
            multiple=False
        ),
        html.Div(style={'display': 'flex', 'flexDirection': 'column'}, children=[
            html.Label('Sample Size:', style={'marginBottom': '5px', 'fontSize': '14px'}),
            dcc.Input(
                id='sample-size-input',
                type='number',
                value=DEFAULT_SAMPLE_SIZE,
                style={'width': '120px'}
            )
        ])
    ]),
    
    html.Div(id='output-data-upload', style={'textAlign': 'center', 'padding': '10px'}),

    html.Div(id='dashboard-container', style={'display': 'none'}, children=[
        html.Div(className='row', style={'display': 'flex', 'padding': '10px'}, children=[
            html.Div(className='four columns', style={'width': '25%', 'padding': '10px'}, children=[
                html.H4('Plot Controls'),
                dcc.RadioItems(id='view-mode-selector', options=[{'label': '2D', 'value': '2D'}, {'label': '3D', 'value': '3D'}], value='3D', labelStyle={'display': 'inline-block', 'marginRight': '10px'}),
                html.Hr(),
                html.Label('X-Axis:'),
                dcc.Dropdown(id='xaxis-pc', options=[{'label': f'PC{i+1}', 'value': f'PC{i+1}'} for i in range(N_COMPONENTS)], value='PC1'),
                html.Label('Y-Axis:'),
                dcc.Dropdown(id='yaxis-pc', options=[{'label': f'PC{i+1}', 'value': f'PC{i+1}'} for i in range(N_COMPONENTS)], value='PC2'),
                html.Label('Z-Axis (3D only):'),
                dcc.Dropdown(id='zaxis-pc', options=[{'label': f'PC{i+1}', 'value': f'PC{i+1}'} for i in range(N_COMPONENTS)], value='PC3', disabled=False),
                html.Hr(),
                html.Label('Fitness Score Range:'),
                dcc.RangeSlider(id='fitness-slider', min=0, max=1, step=0.01, value=[0,1], marks=None, tooltip={"placement": "bottom", "always_visible": True}),
            ]),
            
            html.Div(className='eight columns', style={'width': '75%'}, children=[
                dcc.Graph(id='fitness-landscape-plot', style={'height': '80vh'})
            ])
        ]),
        
        html.Div(className='row', style={'display': 'flex', 'padding': '10px'}, children=[
            dcc.Graph(id='explained-variance-plot', style={'width': '50%'}),
            dcc.Graph(id='component-heatmap-plot', style={'width': '50%'})
        ])
    ]),
    
    dcc.Store(id='processed-data-store')
])

# --- Callbacks ---

@app.callback(
    [Output('processed-data-store', 'data'),
     Output('dashboard-container', 'style'),
     Output('output-data-upload', 'children'),
     Output('fitness-slider', 'min'),
     Output('fitness-slider', 'max'),
     Output('fitness-slider', 'value')],
    [Input('upload-data', 'contents')],
    [State('upload-data', 'filename'),
     State('sample-size-input', 'value')]
)
def process_uploaded_file(contents, filename, sample_size):
    """Callback to process uploaded data and store it."""
    if contents is None:
        return None, {'display': 'none'}, "", 0, 1, [0, 1]

    if not sample_size or sample_size <= 0:
        return None, {'display': 'none'}, html.Div('Error: Sample size must be a positive number.', style={'color': 'red'}), 0, 1, [0, 1]

    status_message = html.Div(f'Processing a random sample of {sample_size} records from {filename}... Please wait.')
    
    try:
        pc_df, pca, gene_cols, error_message = parse_jsonl_data(contents, sample_size)
        
        if error_message:
            return None, {'display': 'none'}, html.Div(f'Error: {error_message}', style={'color': 'red'}), 0, 1, [0, 1]

        if pc_df.empty:
             return None, {'display': 'none'}, html.Div('Error: No data could be processed from the file.', style={'color': 'red'}), 0, 1, [0, 1]

        stored_data = {
            'pc_df': pc_df.to_json(date_format='iso', orient='split'),
            'explained_variance_ratio': list(pca.explained_variance_ratio_),
            'components': pca.components_.tolist(),
            'gene_cols': gene_cols
        }
        
        min_fitness = pc_df['fitness'].min()
        max_fitness = pc_df['fitness'].max()
        
        success_message = html.Div(f'Successfully processed a sample of {len(pc_df)} records from {filename}.', style={'color': 'green'})
        return stored_data, {'display': 'block'}, success_message, min_fitness, max_fitness, [min_fitness, max_fitness]

    except Exception as e:
        print(f"An unexpected error occurred: {e}")
        error_div = html.Div(f'A critical error occurred during processing: {e}', style={'color': 'red'})
        return None, {'display': 'none'}, error_div, 0, 1, [0, 1]


@app.callback(
    Output('zaxis-pc', 'disabled'),
    [Input('view-mode-selector', 'value')]
)
def toggle_z_axis_dropdown(view_mode):
    return view_mode == '2D'

@app.callback(
    [Output('fitness-landscape-plot', 'figure'),
     Output('explained-variance-plot', 'figure'),
     Output('component-heatmap-plot', 'figure')],
    [Input('processed-data-store', 'data'),
     Input('xaxis-pc', 'value'),
     Input('yaxis-pc', 'value'),
     Input('zaxis-pc', 'value'),
     Input('view-mode-selector', 'value'),
     Input('fitness-slider', 'value')]
)
def update_graphs(stored_data, x_pc, y_pc, z_pc, view_mode, fitness_range):
    if stored_data is None:
        return go.Figure(), go.Figure(), go.Figure()

    pc_df = pd.read_json(stored_data['pc_df'], orient='split')
    explained_variance_ratio = stored_data['explained_variance_ratio']
    components = np.array(stored_data['components'])
    gene_cols = stored_data['gene_cols']
    
    if not fitness_range:
        return no_update, no_update, no_update
        
    dff = pc_df[(pc_df['fitness'] >= fitness_range[0]) & (pc_df['fitness'] <= fitness_range[1])]

    if view_mode == '3D':
        landscape_fig = px.scatter_3d(dff, x=x_pc, y=y_pc, z=z_pc, color='fitness', color_continuous_scale=px.colors.sequential.Viridis, hover_name=dff.index, title='3D Fitness Landscape')
        landscape_fig.update_traces(marker=dict(size=3))
    else:
        landscape_fig = px.scatter(dff, x=x_pc, y=y_pc, color='fitness', color_continuous_scale=px.colors.sequential.Viridis, hover_name=dff.index, title='2D Fitness Landscape')
    
    landscape_fig.update_layout(margin=dict(l=0, r=0, b=0, t=40), plot_bgcolor="#222222", paper_bgcolor="#111111", font_color="#DDDDDD")

    variance_fig = px.bar(x=[f'PC{i+1}' for i in range(N_COMPONENTS)], y=explained_variance_ratio, labels={'x': 'Principal Component', 'y': 'Explained Variance Ratio'}, title='Explained Variance by Principal Component')
    variance_fig.update_layout(plot_bgcolor="#222222", paper_bgcolor="#111111", font_color="#DDDDDD")

    heatmap_fig = go.Figure(data=go.Heatmap(z=components, x=[f'PC{i+1}' for i in range(N_COMPONENTS)], y=gene_cols, colorscale='RdBu', zmid=0))
    heatmap_fig.update_layout(title='PCA Component Loadings', plot_bgcolor="#222222", paper_bgcolor="#111111", font_color="#DDDDDD")
    
    return landscape_fig, variance_fig, heatmap_fig

# --- Main Execution Block ---
if __name__ == '__main__':
    app.run(debug=True)
