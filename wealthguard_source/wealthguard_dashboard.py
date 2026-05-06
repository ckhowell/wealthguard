#!/usr/bin/env python3
"""
WealthGuard Streamlit Dashboard
Interactive web interface for personal finance management
"""
import streamlit as st
import sqlite3
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from datetime import datetime, timedelta
import sys
sys.path.insert(0, '/root/.openclaw/workspace')

from wealthguard_ai_agents import generate_daily_briefing, get_budget_warnings, get_upcoming_events

DB_PATH = "/root/.openclaw/workspace/wealthguard.db"

# Page configuration
st.set_page_config(
    page_title="WealthGuard Dashboard",
    page_icon="💰",
    layout="wide",
    initial_sidebar_state="expanded"
)

# Custom CSS
st.markdown("""
<style>
    .main-header {
        font-size: 3rem;
        font-weight: bold;
        color: #1f77b4;
    }
    .metric-card {
        background-color: #f0f2f6;
        padding: 1rem;
        border-radius: 0.5rem;
    }
    .alert-box {
        padding: 1rem;
        border-radius: 0.5rem;
        margin: 0.5rem 0;
    }
    .alert-high {
        background-color: #ffcccc;
        border-left: 4px solid #ff0000;
    }
    .alert-medium {
        background-color: #fff3cd;
        border-left: 4px solid #ffc107;
    }
</style>
""", unsafe_allow_html=True)

def get_db_connection():
    """Get database connection"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

# Sidebar navigation
st.sidebar.title("💰 WealthGuard")
st.sidebar.markdown("---")

page = st.sidebar.radio(
    "Navigation",
    ["Dashboard", "Portfolio", "Transactions", "Budgets", "AI Briefing", "Reports"]
)

st.sidebar.markdown("---")
st.sidebar.markdown("### Quick Stats")

# Get summary stats for sidebar
try:
    conn = get_db_connection()
    
    # Net worth
    nw = conn.execute("SELECT net_worth FROM net_worth_history ORDER BY snapshot_date DESC LIMIT 1").fetchone()
    if nw:
        st.sidebar.metric("Net Worth", f"AUD ${nw['net_worth']:,.0f}")
    
    # Active alerts
    alert_count = conn.execute("SELECT COUNT(*) FROM alerts WHERE is_active = 1").fetchone()[0]
    st.sidebar.metric("Active Alerts", alert_count)
    
    conn.close()
except Exception as e:
    st.sidebar.error(f"DB Error: {e}")

# MAIN DASHBOARD PAGE
if page == "Dashboard":
    st.markdown('<div class="main-header">📊 WealthGuard Dashboard</div>', unsafe_allow_html=True)
    st.markdown(f"*Last updated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}*")
    
    # Top metrics row
    col1, col2, col3, col4 = st.columns(4)
    
    try:
        conn = get_db_connection()
        
        # Cash
        cash = conn.execute("""
            SELECT SUM(CASE WHEN currency = 'JPY' THEN current_balance * 0.009117 
                           ELSE current_balance END) as total
            FROM accounts WHERE type IN ('checking', 'savings')
        """).fetchone()['total'] or 0
        col1.metric("💵 Cash", f"AUD ${cash:,.0f}")
        
        # Investments
        investments = conn.execute("""
            SELECT SUM(shares * current_price) FROM holdings
        """).fetchone()[0] or 0
        col2.metric("📈 Investments", f"AUD ${investments:,.0f}")
        
        # Net Worth
        if nw:
            col3.metric("💰 Net Worth", f"AUD ${nw['net_worth']:,.0f}")
        
        # Monthly change (mock)
        col4.metric("📊 30-Day Change", "+2.4%", "+AUD $91,027")
        
        conn.close()
    except Exception as e:
        st.error(f"Error loading metrics: {e}")
    
    st.markdown("---")
    
    # Charts row
    col_left, col_right = st.columns(2)
    
    with col_left:
        st.subheader("Asset Allocation")
        
        # Asset allocation pie chart
        try:
            conn = get_db_connection()
            
            # Get holdings by type
            holdings = conn.execute("""
                SELECT asset_class, SUM(shares * current_price) as value
                FROM holdings GROUP BY asset_class
            """).fetchall()
            
            conn.close()
            
            labels = [h['asset_class'].upper() for h in holdings]
            values = [h['value'] for h in holdings]
            
            # Add cash
            labels.append('CASH')
            values.append(cash)
            
            fig = px.pie(
                names=labels, 
                values=values,
                title="Portfolio Composition",
                color_discrete_sequence=px.colors.qualitative.Set3
            )
            fig.update_traces(textposition='inside', textinfo='percent+label')
            st.plotly_chart(fig, use_container_width=True)
            
        except Exception as e:
            st.error(f"Error loading allocation: {e}")
    
    with col_right:
        st.subheader("⚠️ Active Alerts")
        
        # Budget warnings
        warnings = get_budget_warnings()
        if warnings:
            for warning in warnings:
                risk_class = "alert-high" if warning['risk_level'] == 'high' else "alert-medium"
                st.markdown(f"""
                <div class="alert-box {risk_class}">
                    <b>{warning['category']}</b><br>
                    Spent: AUD ${warning['spent']:,.0f} / ${warning['budget']:,.0f}<br>
                    <small>Projected: AUD ${warning['projected_monthly']:,.0f}</small>
                </div>
                """, unsafe_allow_html=True)
        else:
            st.success("✅ All budgets on track!")
        
        # Upcoming events
        st.subheader("📅 Upcoming Events")
        events = get_upcoming_events()
        for event in events:
            st.info(f"**{event['event']}**\n\n{event['description']}")

# PORTFOLIO PAGE
elif page == "Portfolio":
    st.header("📈 Portfolio Details")
    
    try:
        conn = get_db_connection()
        
        # Holdings table
        holdings = conn.execute("""
            SELECT 
                h.symbol,
                h.asset_name,
                h.asset_class,
                h.geography,
                h.shares,
                h.current_price,
                (h.shares * h.current_price) as value,
                h.cost_basis_per_share,
                CASE WHEN h.cost_basis_per_share > 0 
                     THEN ((h.current_price - h.cost_basis_per_share) / h.cost_basis_per_share * 100)
                     ELSE 0 END as gain_pct
            FROM holdings h
            WHERE h.shares > 0
            ORDER BY value DESC
        """).fetchall()
        
        conn.close()
        
        # Display as DataFrame
        df = pd.DataFrame(holdings)
        df['value'] = df['value'].apply(lambda x: f"AUD ${x:,.2f}")
        df['gain_pct'] = df['gain_pct'].apply(lambda x: f"{x:+.2f}%")
        
        st.dataframe(df, use_container_width=True)
        
        # Holdings bar chart
        st.subheader("Holdings by Value")
        fig = px.bar(
            df.head(10),
            x='asset_name',
            y='value',
            color='asset_class',
            title="Top 10 Holdings"
        )
        st.plotly_chart(fig, use_container_width=True)
        
    except Exception as e:
        st.error(f"Error loading portfolio: {e}")

# TRANSACTIONS PAGE
elif page == "Transactions":
    st.header("💳 Transaction History")
    
    try:
        conn = get_db_connection()
        
        # Filters
        col1, col2 = st.columns(2)
        with col1:
            accounts = conn.execute("SELECT id, name FROM accounts").fetchall()
            account_filter = st.selectbox(
                "Account",
                ["All"] + [a['name'] for a in accounts]
            )
        
        with col2:
            categories = conn.execute("SELECT DISTINCT category FROM transactions WHERE category IS NOT NULL").fetchall()
            category_filter = st.selectbox(
                "Category",
                ["All"] + [c['category'] for c in categories if c['category']]
            )
        
        # Build query
        query = """
            SELECT t.*, a.name as account_name
            FROM transactions t
            JOIN accounts a ON t.account_id = a.id
            WHERE 1=1
        """
        params = []
        
        if account_filter != "All":
            query += " AND a.name = ?"
            params.append(account_filter)
        
        if category_filter != "All":
            query += " AND t.category = ?"
            params.append(category_filter)
        
        query += " ORDER BY t.transaction_date DESC LIMIT 100"
        
        transactions = conn.execute(query, params).fetchall()
        conn.close()
        
        # Display
        df = pd.DataFrame(transactions)
        if not df.empty:
            st.dataframe(df[['transaction_date', 'account_name', 'description', 'amount', 'category']], 
                        use_container_width=True)
        else:
            st.info("No transactions found")
        
    except Exception as e:
        st.error(f"Error loading transactions: {e}")

# BUDGETS PAGE
elif page == "Budgets":
    st.header("💰 Budget Management")
    
    try:
        conn = get_db_connection()
        
        # Budget status
        budgets = conn.execute("""
            SELECT 
                b.category,
                b.budget_amount,
                COALESCE(SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END), 0) as spent
            FROM budgets b
            LEFT JOIN transactions t ON 
                b.category = t.category 
                AND strftime('%Y-%m', t.transaction_date) = strftime('%Y-%m', 'now')
            GROUP BY b.category
        """).fetchall()
        
        conn.close()
        
        # Display budget bars
        for b in budgets:
            pct = (b['spent'] / b['budget_amount'] * 100) if b['budget_amount'] > 0 else 0
            status_color = "red" if pct > 100 else "orange" if pct > 80 else "green"
            
            st.markdown(f"**{b['category']}**")
            st.progress(min(pct / 100, 1.0), text=f"AUD ${b['spent']:,.0f} / ${b['budget_amount']:,.0f} ({pct:.0f}%)")
        
    except Exception as e:
        st.error(f"Error loading budgets: {e}")

# AI BRIEFING PAGE
elif page == "AI Briefing":
    st.header("🤖 AI Market Intelligence")
    
    if st.button("🔄 Generate Daily Briefing"):
        with st.spinner("Analyzing market data..."):
            briefing = generate_daily_briefing()
            st.text(briefing)
    
    st.markdown("---")
    
    # AI Agents status
    st.subheader("AI Agents Status")
    
    col1, col2, col3 = st.columns(3)
    
    with col1:
        st.markdown("""
        ### 📰 Market Intelligence
        - Multi-source news aggregation
        - Portfolio-specific filtering
        - Relevance scoring
        **Status:** ✅ Active
        """)
    
    with col2:
        st.markdown("""
        ### 📊 Predictive Analytics
        - Spending forecasts
        - Budget overrun warnings
        - Trend analysis
        **Status:** ✅ Active
        """)
    
    with col3:
        st.markdown("""
        ### 🌍 Geopolitical Monitor
        - Event impact analysis
        - Market volatility tracking
        - Proactive alerts
        **Status:** ✅ Active
        """)

# REPORTS PAGE
elif page == "Reports":
    st.header("📄 Reports")
    
    import os
    reports_dir = "/root/.openclaw/workspace/Reports/Daily"
    
    if os.path.exists(reports_dir):
        reports = sorted(os.listdir(reports_dir), reverse=True)
        
        if reports:
            selected_report = st.selectbox("Select Report", reports)
            
            if selected_report:
                with open(os.path.join(reports_dir, selected_report)) as f:
                    content = f.read()
                    st.text(content)
        else:
            st.info("No reports generated yet")
    else:
        st.error("Reports directory not found")

# Footer
st.sidebar.markdown("---")
st.sidebar.markdown("*WealthGuard v1.0 - AI-Powered Finance*")
