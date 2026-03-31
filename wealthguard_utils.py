import pandas as pd
import sqlite3
from datetime import datetime
import re

DB_PATH = "/root/.openclaw/workspace/wealthguard.db"

def import_csv_transactions(file_path, account_name, date_format=None):
    """
    Import CSV bank statements with auto-detection
    """
    conn = sqlite3.connect(DB_PATH)
    
    # Auto-detect account or create
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM accounts WHERE name = ?", (account_name,))
    result = cursor.fetchone()
    
    if result:
        account_id = result[0]
    else:
        print(f"Creating new account: {account_name}")
        cursor.execute("""
            INSERT INTO accounts (name, type) VALUES (?, ?)
        """, (account_name, 'checking'))
        account_id = cursor.lastrowid
        conn.commit()
    
    # Read CSV with auto-detection
    try:
        df = pd.read_csv(file_path)
    except UnicodeDecodeError:
        df = pd.read_csv(file_path, encoding='latin-1')
    
    # Smart column mapping
    column_mapping = {
        'date': ['Date', 'Transaction Date', 'Posted Date', 'date', 'Date Posted', 'Transaction Date'],
        'payee': ['Description', 'Payee', 'Merchant', 'description', 'Transaction Description', 'Name'],
        'amount': ['Amount', 'amount', 'Transaction Amount', 'Debit', 'Credit', 'Amount (USD)'],
        'category': ['Category', 'category', 'Type', 'Transaction Category']
    }
    
    # Find actual columns
    actual_mapping = {}
    for key, possible_names in column_mapping.items():
        for col in df.columns:
            if col in possible_names:
                actual_mapping[key] = col
                break
    
    print(f"Detected columns: {actual_mapping}")
    print(f"Total rows in CSV: {len(df)}")
    
    # Process transactions
    imported_count = 0
    skipped_count = 0
    
    for idx, row in df.iterrows():
        try:
            date_val = row[actual_mapping.get('date', df.columns[0])]
            payee_val = row[actual_mapping.get('payee', df.columns[1])]
            amount_val = row[actual_mapping.get('amount', df.columns[2])]
            
            # Parse amount (handle debits/credits)
            if isinstance(amount_val, str):
                amount_val = amount_val.replace('$', '').replace(',', '').replace(' ', '')
                if '(' in amount_val and ')' in amount_val:  # (100.00) = negative
                    amount_val = -abs(float(amount_val.replace('(', '').replace(')', '')))
                elif amount_val.startswith('-'):
                    amount_val = float(amount_val)
                elif 'debit' in str(amount_val).lower() or 'dr' in str(amount_val).lower():
                    amount_val = -abs(float(re.sub(r'[^0-9.-]', '', amount_val)))
                else:
                    amount_val = float(amount_val)
            
            amount = float(amount_val)
            
            # Parse date
            parsed_date = None
            if date_format:
                parsed_date = datetime.strptime(str(date_val), date_format)
            else:
                # Auto-parse common formats
                for fmt in ['%Y-%m-%d', '%m/%d/%Y', '%d/%m/%Y', '%m-%d-%Y', '%Y/%m/%d', '%d-%m-%Y']:
                    try:
                        parsed_date = datetime.strptime(str(date_val).split()[0], fmt)
                        break
                    except:
                        continue
            
            if not parsed_date:
                print(f"Warning: Could not parse date '{date_val}' on row {idx}")
                skipped_count += 1
                continue
            
            # Auto-categorize based on payee patterns
            category = auto_categorize(payee_val)
            
            # Determine transaction type
            if amount < 0:
                tx_type = 'debit'
                amount = abs(amount)  # Store as positive
            else:
                tx_type = 'credit'
            
            # Insert transaction
            cursor.execute("""
                INSERT OR IGNORE INTO transactions 
                (account_id, transaction_date, payee, amount, category, transaction_type, import_source, description)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (account_id, parsed_date.strftime('%Y-%m-%d'), str(payee_val), 
                  amount, category, tx_type, 'csv_import', str(payee_val)))
            
            if cursor.rowcount > 0:
                imported_count += 1
            else:
                skipped_count += 1
                
        except Exception as e:
            print(f"Error on row {idx}: {e}")
            skipped_count += 1
            continue
    
    conn.commit()
    conn.close()
    print(f"✅ Imported {imported_count} transactions to {account_name}")
    print(f"⚠️ Skipped {skipped_count} rows")
    return imported_count

def auto_categorize(payee):
    """Auto-categorize based on merchant patterns"""
    payee_lower = str(payee).lower()
    
    patterns = {
        'Food & Dining': ['restaurant', 'cafe', 'coffee', 'starbucks', 'mcdonald', 'doordash', 'uber eats', 'grubhub', 'chipotle', 'subway', 'pizza', 'sushi', 'thai', 'chinese', 'indian', 'burger'],
        'Transportation': ['uber', 'lyft', 'gas', 'shell', 'exxon', 'chevron', 'bp', 'parking', 'toll', 'transit', 'metro', 'bus', 'train', 'airline', 'flight'],
        'Shopping': ['amazon', 'walmart', 'target', 'costco', 'best buy', 'ebay', 'etsy', 'shopify', 'nike', 'adidas', 'zara', 'h&m', 'mall'],
        'Entertainment': ['netflix', 'spotify', 'hulu', 'disney', 'hbo', 'apple tv', 'youtube', 'theater', 'cinema', 'movie', 'concert', 'ticket', 'game', 'steam', 'playstation', 'xbox'],
        'Utilities': ['electric', 'gas bill', 'water', 'sewer', 'internet', 'phone', 'verizon', 'att', 'at&t', 'comcast', 'spectrum', 'fios'],
        'Income': ['deposit', 'payroll', 'salary', 'direct deposit', 'dividend', 'interest', 'refund', 'reimbursement'],
        'Investment': ['vanguard', 'fidelity', 'schwab', 'etrade', 'robinhood', 'td ameritrade', 'merrill', 'brokerage', '401k', 'ira'],
        'Healthcare': ['hospital', 'clinic', 'doctor', 'pharmacy', 'cvs', 'walgreens', 'rite aid', 'dental', 'medical', 'health'],
        'Education': ['tuition', 'school', 'university', 'college', 'bookstore', 'coursera', 'udemy', 'linkedin learning'],
        'Travel': ['hotel', 'airbnb', 'booking.com', 'expedia', 'travelocity', 'tripadvisor', 'rental car', 'airline'],
        'Insurance': ['insurance', 'geico', 'state farm', 'allstate', 'progressive', 'liberty mutual', 'aetna', 'blue cross'],
        'Subscriptions': ['subscription', 'membership', 'monthly', 'annual fee', 'renewal'],
        'Fees': ['fee', 'late fee', 'overdraft', 'atm fee', 'service charge', 'maintenance fee']
    }
    
    for category, keywords in patterns.items():
        if any(keyword in payee_lower for keyword in keywords):
            return category
    
    return 'Uncategorized'

def get_account_summary(account_name=None):
    """Get summary of accounts and balances"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    if account_name:
        cursor.execute("""
            SELECT a.*, 
                   COUNT(t.id) as transaction_count,
                   SUM(CASE WHEN t.transaction_type = 'credit' THEN t.amount ELSE 0 END) as total_income,
                   SUM(CASE WHEN t.transaction_type = 'debit' THEN t.amount ELSE 0 END) as total_spent
            FROM accounts a
            LEFT JOIN transactions t ON a.id = t.account_id
            WHERE a.name = ?
            GROUP BY a.id
        """, (account_name,))
    else:
        cursor.execute("""
            SELECT a.*, 
                   COUNT(t.id) as transaction_count,
                   SUM(CASE WHEN t.transaction_type = 'credit' THEN t.amount ELSE 0 END) as total_income,
                   SUM(CASE WHEN t.transaction_type = 'debit' THEN t.amount ELSE 0 END) as total_spent
            FROM accounts a
            LEFT JOIN transactions t ON a.id = t.account_id
            WHERE a.is_active = 1
            GROUP BY a.id
        """)
    
    results = cursor.fetchall()
    conn.close()
    return results

def get_spending_by_category(days=30):
    """Get spending breakdown by category"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT category, 
               SUM(amount) as total,
               COUNT(*) as transaction_count,
               AVG(amount) as avg_amount
        FROM transactions
        WHERE transaction_type = 'debit'
          AND transaction_date >= date('now', '-{} days')
          AND category != 'Uncategorized'
        GROUP BY category
        ORDER BY total DESC
    """.format(days))
    
    results = cursor.fetchall()
    conn.close()
    return results

def add_holding(account_name, symbol, shares, cost_basis, asset_name=None, asset_class='equity'):
    """Add or update a holding"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Get account_id
    cursor.execute("SELECT id FROM accounts WHERE name = ?", (account_name,))
    result = cursor.fetchone()
    
    if not result:
        print(f"Account {account_name} not found. Creating investment account...")
        cursor.execute("""
            INSERT INTO accounts (name, type) VALUES (?, ?)
        """, (account_name, 'investment'))
        account_id = cursor.lastrowid
    else:
        account_id = result[0]
    
    # Check if holding exists
    cursor.execute("""
        SELECT id FROM holdings WHERE account_id = ? AND symbol = ?
    """, (account_id, symbol))
    
    existing = cursor.fetchone()
    
    if existing:
        # Update existing holding (add shares)
        cursor.execute("""
            UPDATE holdings 
            SET shares = shares + ?,
                cost_basis_per_share = ((cost_basis_per_share * shares) + (? * ?)) / (shares + ?)
            WHERE id = ?
        """, (shares, cost_basis, shares, shares, existing[0]))
        print(f"Updated {symbol}: added {shares} shares at ${cost_basis:.2f}")
    else:
        # Insert new holding
        cursor.execute("""
            INSERT INTO holdings (account_id, symbol, asset_name, shares, cost_basis_per_share, asset_class)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (account_id, symbol.upper(), asset_name or symbol.upper(), shares, cost_basis, asset_class))
        print(f"Added {symbol}: {shares} shares at ${cost_basis:.2f}")
    
    conn.commit()
    conn.close()

def get_portfolio_summary():
    """Get complete portfolio summary with P&L"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT 
            h.symbol,
            h.asset_name,
            h.shares,
            h.cost_basis_per_share,
            h.current_price,
            h.asset_class,
            h.sector,
            a.name as account_name,
            (h.shares * h.cost_basis_per_share) as cost_basis_total,
            (h.shares * COALESCE(h.current_price, h.cost_basis_per_share)) as current_value,
            (h.shares * COALESCE(h.current_price, h.cost_basis_per_share)) - (h.shares * h.cost_basis_per_share) as unrealized_pnl,
            CASE 
                WHEN h.cost_basis_per_share > 0 
                THEN ((COALESCE(h.current_price, h.cost_basis_per_share) - h.cost_basis_per_share) / h.cost_basis_per_share * 100)
                ELSE 0 
            END as return_pct
        FROM holdings h
        JOIN accounts a ON h.account_id = a.id
        WHERE h.shares > 0
        ORDER BY current_value DESC
    """)
    
    results = cursor.fetchall()
    conn.close()
    return results

# ============================================
# PORTFOLIO PRICE UPDATER (yfinance)
# ============================================

try:
    import yfinance as yf
    YFINANCE_AVAILABLE = True
except ImportError:
    YFINANCE_AVAILABLE = False
    print("Warning: yfinance not available. Install with: pip install yfinance")

def update_portfolio_prices():
    """
    Fetch current prices for all holdings using yfinance
    """
    if not YFINANCE_AVAILABLE:
        print("❌ yfinance not installed. Cannot update prices.")
        return
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Get all unique symbols
    cursor.execute("SELECT DISTINCT symbol FROM holdings WHERE asset_class='crypto'")
    symbols = [row[0] for row in cursor.fetchall()]
    
    print(f"Updating prices for {len(symbols)} crypto symbols...")
    
    for symbol in symbols:
        try:
            # For crypto, try different ticker formats
            ticker_formats = [f"{symbol}-AUD", f"{symbol}-USD", symbol]
            current_price = None
            
            for ticker_format in ticker_formats:
                try:
                    ticker = yf.Ticker(ticker_format)
                    info = ticker.info
                    current_price = info.get('regularMarketPrice') or info.get('previousClose')
                    if current_price:
                        # If using USD ticker, we'd need FX conversion
                        if '-USD' in ticker_format:
                            # Approximate conversion (should use real FX rate)
                            current_price = current_price * 0.65  # AUD/USD ~0.65
                        break
                except:
                    continue
            
            if current_price:
                cursor.execute("""
                    UPDATE holdings 
                    SET current_price = ?, last_price_update = ?
                    WHERE symbol = ?
                """, (current_price, datetime.now().isoformat(), symbol))
                print(f"  {symbol}: AUD ${current_price:.2f}")
        except Exception as e:
            print(f"  ⚠️ Error fetching {symbol}: {e}")
    
    conn.commit()
    conn.close()
    print("✅ Portfolio prices updated")

def get_portfolio_valuation():
    """
    Generate complete portfolio analysis with current prices
    """
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT 
            h.symbol,
            h.asset_name,
            h.shares,
            h.cost_basis_per_share,
            h.current_price,
            h.asset_class,
            a.name as account_name,
            (h.shares * COALESCE(h.cost_basis_per_share, 0)) as cost_basis_total,
            (h.shares * COALESCE(h.current_price, 0)) as market_value
        FROM holdings h
        JOIN accounts a ON h.account_id = a.id
        WHERE h.shares > 0
        ORDER BY market_value DESC
    """)
    
    holdings = cursor.fetchall()
    conn.close()
    
    if not holdings:
        return "No holdings found"
    
    total_cost = sum(h['cost_basis_total'] or 0 for h in holdings)
    total_value = sum(h['market_value'] or 0 for h in holdings)
    total_pnl = total_value - total_cost
    pnl_pct = (total_pnl / total_cost) * 100 if total_cost > 0 else 0
    
    report = f"""
📊 PORTFOLIO VALUATION ({datetime.now().strftime('%Y-%m-%d %H:%M')})

💰 Total Market Value: AUD ${total_value:,.2f}
📈 Unrealized P&L: AUD ${total_pnl:,.2f} ({pnl_pct:+.2f}%)
🎯 Total Cost Basis: AUD ${total_cost:,.2f}

📋 HOLDINGS:
"""
    for h in holdings:
        pnl = (h['market_value'] or 0) - (h['cost_basis_total'] or 0)
        pnl_pct_h = ((h['current_price'] or 0) - (h['cost_basis_per_share'] or 0)) / (h['cost_basis_per_share'] or 1) * 100
        report += f"  {h['symbol']:6} | {h['shares']:>12,.4f} units | AUD ${h['market_value'] or 0:>12,.2f} | {pnl_pct_h:+6.1f}%\n"
    
    return report

# ============================================
# BUDGET TRACKING SYSTEM
# ============================================

def add_budget(category, amount, period='monthly', alert_at=80):
    """
    Add a budget for a spending category
    """
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Check if budget exists for this category/month
    cursor.execute("""
        SELECT id FROM budgets 
        WHERE category = ? AND (created_month = ? OR created_month IS NULL)
    """, (category, datetime.now().strftime('%Y-%m')))
    
    existing = cursor.fetchone()
    
    if existing:
        cursor.execute("""
            UPDATE budgets 
            SET budget_amount = ?, period = ?, alert_threshold_percent = ?
            WHERE id = ?
        """, (amount, period, alert_at, existing[0]))
        print(f"🔄 Updated budget: ${amount} for {category} ({period})")
    else:
        cursor.execute("""
            INSERT INTO budgets (category, budget_amount, period, alert_threshold_percent, created_month)
            VALUES (?, ?, ?, ?, ?)
        """, (category, amount, period, alert_at, datetime.now().strftime('%Y-%m')))
        print(f"✅ Added budget: ${amount} for {category} ({period})")
    
    conn.commit()
    conn.close()

def check_budget_status(month=None):
    """
    Check all budgets vs actual spending with alerts
    """
    if month is None:
        month = datetime.now().strftime('%Y-%m')
    
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # Get all spending categories with budgets
    cursor.execute("""
        SELECT 
            b.category,
            b.budget_amount,
            b.alert_threshold_percent,
            COALESCE(SUM(CASE WHEN t.transaction_type = 'debit' THEN t.amount ELSE 0 END), 0) as spent
        FROM budgets b
        LEFT JOIN transactions t ON 
            (b.category = t.category OR b.category = t.subcategory)
            AND strftime('%Y-%m', t.transaction_date) = ?
        WHERE b.created_month = ? OR b.created_month IS NULL
        GROUP BY b.category, b.budget_amount, b.alert_threshold_percent
    """, (month, month))
    
    budgets = cursor.fetchall()
    conn.close()
    
    if not budgets:
        return f"📭 No budgets configured for {month}"
    
    report = f"""
💰 BUDGET STATUS - {month}
{'='*70}
{'Category':<25} {'Budget':>10} {'Spent':>10} {'Remaining':>12} {'Status':>8}
{'='*70}
"""
    
    alerts = []
    total_budget = 0
    total_spent = 0
    
    for row in budgets:
        budget = row['budget_amount']
        spent = row['spent']
        remaining = budget - spent
        pct_used = (spent / budget) * 100 if budget > 0 else 0
        threshold = row['alert_threshold_percent']
        
        # Status indicator
        if pct_used > 100:
            status = '🔴 OVER'
            alerts.append((row['category'], pct_used, spent, budget, 'CRITICAL'))
        elif pct_used > threshold:
            status = '🟠 WARN'
            alerts.append((row['category'], pct_used, spent, budget, 'WARNING'))
        else:
            status = '🟢 OK'
        
        total_budget += budget
        total_spent += spent
        
        report += f"{row['category']:<25} ${budget:>9,.0f} ${spent:>9,.0f} ${remaining:>11,.0f} {status:>8}\n"
    
    report += f"{'='*70}\n"
    report += f"{'TOTAL':<25} ${total_budget:>9,.0f} ${total_spent:>9,.0f} ${total_budget-total_spent:>11,.0f}\n"
    
    # Alert section
    if alerts:
        report += f"\n🚨 ALERTS ({len(alerts)}):\n"
        for cat, pct, spent, budget, level in alerts:
            report += f"   [{level}] {cat}: {pct:.1f}% used (AUD ${spent:,.0f} of ${budget:,.0f})\n"
    else:
        report += "\n✅ All budgets on track!\n"
    
    return report

def get_spending_trends(months=6):
    """
    Analyze spending trends over time
    """
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT 
            strftime('%Y-%m', transaction_date) as month,
            category,
            COUNT(*) as txn_count,
            SUM(amount) as total
        FROM transactions
        WHERE transaction_type = 'debit'
          AND transaction_date >= date('now', '-{} months')
        GROUP BY month, category
        ORDER BY month DESC, total DESC
    """.format(months))
    
    results = cursor.fetchall()
    conn.close()
    
    if not results:
        return "No spending data available"
    
    # Organize by month
    trends = {}
    for row in results:
        month = row['month']
        if month not in trends:
            trends[month] = []
        trends[month].append({
            'category': row['category'],
            'count': row['txn_count'],
            'total': row['total']
        })
    
    report = f"📈 SPENDING TRENDS (Last {months} Months)\n{'='*70}\n"
    
    for month in sorted(trends.keys(), reverse=True):
        report += f"\n{month}:\n"
        month_total = sum(item['total'] for item in trends[month])
        report += f"  Total: AUD ${month_total:,.2f}\n"
        for item in trends[month][:5]:  # Top 5 categories
            pct = (item['total'] / month_total) * 100 if month_total > 0 else 0
            report += f"  - {item['category']}: ${item['total']:,.0f} ({pct:.1f}%)\n"
    
    return report

# ============================================
# NET WORTH TRACKING
# ============================================

def update_net_worth():
    """
    Record current net worth snapshot
    """
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Get total assets from CASH accounts only (checking, savings)
    # Investment accounts are handled via holdings
    cursor.execute("""
        SELECT 
            SUM(CASE 
                WHEN currency = 'JPY' THEN current_balance * 0.009117
                ELSE current_balance 
            END) as total_assets
        FROM accounts
        WHERE is_active = 1
          AND type IN ('checking', 'savings')
    """)
    assets = cursor.fetchone()[0] or 0
    
    # Get total investments value from holdings (crypto, real estate, etc.)
    cursor.execute("""
        SELECT SUM(shares * COALESCE(current_price, 0)) 
        FROM holdings
    """)
    investments = cursor.fetchone()[0] or 0
    
    total_assets = assets + investments
    
    # Get credit card liabilities (use account balance, not transaction sum)
    cursor.execute("""
        SELECT SUM(current_balance) FROM accounts WHERE type = 'credit'
    """)
    liabilities = cursor.fetchone()[0] or 0
    
    net_worth = total_assets - liabilities
    
    # Record snapshot
    cursor.execute("""
        INSERT INTO net_worth_history 
        (snapshot_date, total_assets, total_liabilities, net_worth, investment_value, cash_value)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (
        datetime.now().strftime('%Y-%m-%d'),
        total_assets,
        liabilities,
        net_worth,
        investments,
        assets
    ))
    
    conn.commit()
    conn.close()
    
    print(f"✅ Net worth snapshot recorded: AUD ${net_worth:,.2f}")
    return net_worth

def get_net_worth_history():
    """
    Get net worth over time
    """
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT * FROM net_worth_history 
        ORDER BY snapshot_date DESC 
        LIMIT 12
    """)
    
    results = cursor.fetchall()
    conn.close()
    return results

# Example usage:
# import_csv_transactions('/path/to/bank_statement.csv', 'Primary Checking')
# add_holding('Investment Account', 'AAPL', 50, 150.00)
# add_budget('Food & Dining', 800, 'monthly', 80)
# update_portfolio_prices()
# print(get_portfolio_valuation())
# print(check_budget_status())
# update_net_worth()
