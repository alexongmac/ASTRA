import streamlit as st
import pandas as pd
import numpy as np
import plotly.express as px
import plotly.graph_objects as go
from sqlalchemy import create_engine

# --- PAGE CONFIG ---
st.set_page_config(
    page_title="R2-D2 OEE & Telemetry Control Center",
    page_icon="🏭",
    layout="wide"
)

# --- CONFIGURATION CONSTANTS ---
IDEAL_CYCLE_TIME_S = 2.0  # Theoretical speed: 1 part every 2.0 seconds (30 parts/min)

# --- DATABASE CONNECTION ---
DB_URI = "mysql+pymysql://root:@127.0.0.1:3306/r2d2"

@st.cache_resource
def get_db_engine():
    return create_engine(DB_URI)

engine = get_db_engine()

# --- HELPER FUNCTIONS ---
def compute_performance(total_parts: int, runtime_s: int, ideal_cycle_time_s: float = IDEAL_CYCLE_TIME_S) -> float:
    """
    Calculates Performance % based on actual parts vs theoretical max capacity.
    Performance % = (Total Parts / (Runtime / Ideal Cycle Time)) * 100
    """
    if runtime_s <= 0 or ideal_cycle_time_s <= 0:
        return 100.0 if total_parts > 0 else 0.0
    
    theoretical_parts = runtime_s / ideal_cycle_time_s
    if theoretical_parts <= 0:
        return 0.0
        
    perf = (total_parts / theoretical_parts) * 100.0
    return round(min(perf, 100.0), 2)  # Cap at 100%

def compute_oee(avail_pct: float, perf_pct: float, qual_pct: float) -> float:
    """Calculates OEE % = (Avail % / 100) * (Perf % / 100) * (Qual % / 100) * 100"""
    return round((avail_pct / 100.0) * (perf_pct / 100.0) * (qual_pct / 100.0) * 100.0, 2)

def format_time(seconds: int) -> str:
    """Formats seconds into human-readable duration strings."""
    mins, secs = divmod(seconds, 60)
    hrs, mins = divmod(mins, 60)
    if hrs > 0:
        return f"{hrs}h {mins}m {secs}s"
    return f"{mins}m {secs}s"

# --- DATA FETCHING FUNCTIONS ---
def fetch_latest_snapshot():
    query = """
    SELECT availability, performance, quality, oee, total_parts, good_parts, defect_parts, created_at
    FROM oee_snapshots 
    ORDER BY created_at DESC LIMIT 1;
    """
    try:
        return pd.read_sql(query, engine)
    except Exception:
        return pd.DataFrame()

def fetch_oee_history(limit=200):
    query = f"""
    SELECT created_at, availability, performance, quality, oee, total_parts, good_parts, defect_parts 
    FROM oee_snapshots 
    ORDER BY created_at DESC LIMIT {limit};
    """
    try:
        df = pd.read_sql(query, engine)
        if not df.empty:
            df['created_at'] = pd.to_datetime(df['created_at'])
            df = df.sort_values('created_at').reset_index(drop=True)
        return df
    except Exception:
        return pd.DataFrame()

def fetch_recent_events():
    query = """
    SELECT id, run_id, machine_name, event, event_type, event_value, detail, created_at 
    FROM oee_events 
    ORDER BY created_at DESC LIMIT 50;
    """
    try:
        return pd.read_sql(query, engine)
    except Exception:
        return pd.DataFrame()

def fetch_run_summary():
    query = """
    SELECT * FROM oee_summary 
    ORDER BY updated_at DESC LIMIT 1;
    """
    try:
        return pd.read_sql(query, engine)
    except Exception:
        return pd.DataFrame()

# --- HEADER & REFRESH ---
col_head1, col_head2 = st.columns([3, 1])
with col_head1:
    st.title("🏭 R2-D2 Smart Production & OEE Control Center")
    st.caption("Real-Time Telemetry Analytics | Automated Anomaly Detection | MySQL Integration")

with col_head2:
    st.write(" ")
    if st.button("🔄 Refresh Data", use_container_width=True):
        st.rerun()

# --- FETCH DATA ---
df_latest = fetch_latest_snapshot()
df_history = fetch_oee_history(200)
df_events = fetch_recent_events()
df_summary = fetch_run_summary()

# Extract run times for performance calculation
runtime_s = 0
downtime_s = 0
setup_s = 0
elapsed_s = 0

if not df_summary.empty:
    summary_row = df_summary.iloc[0]
    runtime_s = int(summary_row.get('runtime_s', 0))
    downtime_s = int(summary_row.get('downtime_s', 0))
    setup_s = int(summary_row.get('setup_s', 0))
    elapsed_s = int(summary_row.get('elapsed_s', 0))

# --- TOP SUMMARY CARDS & HEALTH STATUS ---
if not df_latest.empty:
    latest = df_latest.iloc[0]
    total_parts = int(latest.get('total_parts', 0))
    
    current_avail = float(latest.get('availability', 0))
    current_qual = float(latest.get('quality', 0))
    db_perf = float(latest.get('performance', 0))
    
    # Calculate Performance dynamic fallback if DB returns 0.0 while parts exist
    if db_perf > 0:
        current_perf = db_perf
    else:
        current_perf = compute_performance(total_parts, runtime_s)

    # Compute overall OEE percentage
    current_oee = compute_oee(current_avail, current_perf, current_qual)
    
    # Machine Health Classifier
    if current_oee >= 85:
        health_status = "🟢 Optimal Operation"
    elif current_oee >= 65:
        health_status = "🟡 Operational Warning"
    else:
        health_status = "🔴 Critical Degradation"

    st.markdown(f"### Machine Health Status: **{health_status}**")
    
    m1, m2, m3, m4, m5 = st.columns(5)
    m1.metric("Availability (A)", f"{current_avail:.1f}%")
    m2.metric("Performance (P)", f"{current_perf:.1f}%")
    m3.metric("Quality (Q)", f"{current_qual:.1f}%")
    m4.metric("Overall OEE (A×P×Q)", f"{current_oee:.1f}%")
    m5.metric("Total Output", f"{total_parts} units")
else:
    st.warning("No live telemetry snapshots found in `oee_snapshots`.")

st.markdown("---")

# --- SECTION 1: DOWNTIME ANALYTICS & DURATION BREAKDOWN ---
st.subheader("⏱️ Downtime & Operational Duration Tracking")

col_dt1, col_dt2, col_dt3, col_dt4 = st.columns(4)
col_dt1.metric("Total Downtime", format_time(downtime_s), f"{downtime_s} sec total")
col_dt2.metric("Active Runtime", format_time(runtime_s), f"{runtime_s} sec active")
col_dt3.metric("Setup / Changeover", format_time(setup_s), f"{setup_s} sec setup")
col_dt4.metric("Total Elapsed Time", format_time(elapsed_s), f"{elapsed_s} sec elapsed")

col_dt_chart, col_dt_events = st.columns([1, 1])

with col_dt_chart:
    if runtime_s + downtime_s + setup_s > 0:
        df_time_split = pd.DataFrame({
            'Category': ['Active Runtime', 'Downtime Stoppage', 'Setup Duration'],
            'Duration (s)': [runtime_s, downtime_s, setup_s]
        })
        fig_dt_bar = px.bar(
            df_time_split,
            x='Duration (s)',
            y='Category',
            orientation='h',
            color='Category',
            text='Duration (s)',
            color_discrete_map={
                'Active Runtime': '#10B981',
                'Downtime Stoppage': '#EF4444',
                'Setup Duration': '#F59E0B'
            },
            title="Operational Time Allocation (Seconds)"
        )
        fig_dt_bar.update_layout(height=240, showlegend=False, margin=dict(l=20, r=20, t=40, b=20))
        st.plotly_chart(fig_dt_bar, use_container_width=True)
    else:
        st.info("No active operational time logged in `oee_summary`.")

with col_dt_events:
    st.markdown("**Recent Machine Event Log**")
    if not df_events.empty:
        df_events['search_text'] = (
            df_events['event'].fillna('') + ' ' + 
            df_events['event_type'].fillna('') + ' ' + 
            df_events['event_value'].fillna('')
        )
        df_downtime_evts = df_events[
            df_events['search_text'].str.contains('down|stop|gear|start|setup|pause|idle', case=False, na=False)
        ]
        
        display_cols = [c for c in ['created_at', 'event', 'event_type', 'event_value', 'detail'] if c in df_events.columns]
        if not df_downtime_evts.empty:
            st.dataframe(df_downtime_evts[display_cols], use_container_width=True, height=190)
        else:
            st.dataframe(df_events[display_cols], use_container_width=True, height=190)
    else:
        st.info("No event logs recorded in `oee_events`.")

st.markdown("---")

# --- SECTION 2: GAUGE & REAL-TIME TREND LINES ---
col_gauge, col_trend = st.columns([1, 2])

with col_gauge:
    st.subheader("🎯 OEE Gauge Indicator")
    val_oee = current_oee if not df_latest.empty else 0
    
    fig_gauge = go.Figure(go.Indicator(
        mode="gauge+number",
        value=val_oee,
        domain={'x': [0, 1], 'y': [0, 1]},
        gauge={
            'axis': {'range': [0, 100]},
            'bar': {'color': "#2563EB"},
            'steps': [
                {'range': [0, 65], 'color': "#FCA5A5"},
                {'range': [65, 85], 'color': "#FDE047"},
                {'range': [85, 100], 'color': "#86EFAC"}
            ],
            'threshold': {
                'line': {'color': "black", 'width': 4},
                'thickness': 0.75,
                'value': 85
            }
        }
    ))
    fig_gauge.update_layout(height=320, margin=dict(l=20, r=20, t=20, b=20))
    st.plotly_chart(fig_gauge, use_container_width=True)

with col_trend:
    st.subheader("📈 Multi-Metric OEE Time-Series Trend")
    if not df_history.empty:
        # Dynamically evaluate performance and OEE across history if zeroed in DB
        df_history['calc_perf'] = df_history.apply(
            lambda r: r['performance'] if r['performance'] > 0 else compute_performance(int(r['total_parts']), runtime_s),
            axis=1
        )
        df_history['calc_oee'] = df_history.apply(
            lambda r: compute_oee(r['availability'], r['calc_perf'], r['quality']),
            axis=1
        )

        fig_line = px.line(
            df_history,
            x='created_at',
            y=['availability', 'calc_perf', 'quality', 'calc_oee'],
            labels={'value': 'Percentage (%)', 'created_at': 'Time', 'variable': 'Metric'},
            color_discrete_map={
                'availability': '#3B82F6',
                'calc_perf': '#EAB308',
                'quality': '#10B981',
                'calc_oee': '#8B5CF6'
            }
        )
        fig_line.update_layout(height=320, margin=dict(l=20, r=20, t=20, b=20), hovermode="x unified")
        st.plotly_chart(fig_line, use_container_width=True)
    else:
        st.info("Awaiting historical telemetry data...")

st.markdown("---")

# --- SECTION 3: PRODUCTION OUTPUT & QUALITY DISTRIBUTION ---
col_bar, col_pie = st.columns([1, 1])

with col_bar:
    st.subheader("📊 Production Yield Breakdown (Good vs Defect)")
    if not df_history.empty:
        df_production = df_history.tail(30).copy()
        fig_bar = go.Figure()
        fig_bar.add_trace(go.Bar(
            x=df_production['created_at'],
            y=df_production['good_parts'],
            name='Good Parts',
            marker_color='#10B981'
        ))
        fig_bar.add_trace(go.Bar(
            x=df_production['created_at'],
            y=df_production['defect_parts'],
            name='Defect Parts',
            marker_color='#EF4444'
        ))
        fig_bar.update_layout(
            barmode='stack',
            height=300,
            margin=dict(l=20, r=20, t=20, b=20),
            xaxis_title="Timestamp",
            yaxis_title="Units"
        )
        st.plotly_chart(fig_bar, use_container_width=True)
    else:
        st.info("No yield records available.")

with col_pie:
    st.subheader("🍩 Overall Quality Share")
    if not df_latest.empty:
        total_good = int(df_latest.iloc[0].get('good_parts', 0))
        total_defect = int(df_latest.iloc[0].get('defect_parts', 0))
        
        if total_good + total_defect > 0:
            df_pie_data = pd.DataFrame({
                'Status': ['Good Units', 'Defective Units'],
                'Count': [total_good, total_defect]
            })
            fig_pie = px.pie(
                df_pie_data,
                values='Count',
                names='Status',
                hole=0.4,
                color='Status',
                color_discrete_map={'Good Units': '#10B981', 'Defective Units': '#EF4444'}
            )
            fig_pie.update_layout(height=300, margin=dict(l=20, r=20, t=20, b=20))
            st.plotly_chart(fig_pie, use_container_width=True)
        else:
            st.info("Zero output recorded so far.")
    else:
        st.info("No yield records available.")

st.markdown("---")

# --- SECTION 4: AUTOMATED ANOMALY DETECTION & AUDIT LOGS ---
col_anom, col_evt = st.columns([1, 1])

with col_anom:
    st.subheader("🚨 Automated Anomaly & Threshold Alerts")
    
    anomalies = []
    if not df_history.empty:
        # Rule 1: Calculated OEE drops below critical benchmark (65%)
        low_oee = df_history[df_history['calc_oee'] < 65]
        for _, row in low_oee.iterrows():
            anomalies.append({
                'Timestamp': row['created_at'],
                'Anomaly Type': 'Critical Low OEE',
                'Value': f"OEE: {row['calc_oee']:.1f}%",
                'Severity': 'HIGH'
            })
            
        # Rule 2: Sudden Availability Drop / Excessive Downtime
        low_avail = df_history[df_history['availability'] < 70]
        for _, row in low_avail.iterrows():
            anomalies.append({
                'Timestamp': row['created_at'],
                'Anomaly Type': 'Downtime / Stoppage Spike',
                'Value': f"Avail: {row['availability']}%",
                'Severity': 'MEDIUM'
            })
            
        # Rule 3: High Defect Ratio Spike
        high_defect = df_history[df_history['defect_parts'] > 5]
        for _, row in high_defect.iterrows():
            anomalies.append({
                'Timestamp': row['created_at'],
                'Anomaly Type': 'Defect Spike Detected',
                'Value': f"Defects: {row['defect_parts']} units",
                'Severity': 'HIGH'
            })

    if anomalies:
        df_anomalies = pd.DataFrame(anomalies).sort_values('Timestamp', ascending=False)
        st.dataframe(df_anomalies, use_container_width=True, height=250)
    else:
        st.success("✅ System Operating Normally — Zero anomalies detected in recent telemetry.")

with col_evt:
    st.subheader("📋 Machine Event & State Transition Logs")
    if not df_events.empty:
        display_cols = [c for c in ['created_at', 'event', 'event_type', 'event_value', 'detail', 'run_id'] if c in df_events.columns]
        st.dataframe(df_events[display_cols], use_container_width=True, height=250)
    else:
        st.info("No discrete events recorded in `oee_events`.")