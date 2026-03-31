import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';

// Database configuration
const DB_PATH = '/root/.openclaw/workspace/wealthguard.db';

let db: Database | null = null;

// Initialize database connection
export async function initDatabase(): Promise<Database> {
  if (db) return db;
  
  db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database,
  });
  
  return db;
}

// Get all holdings
export async function getHoldings(): Promise<any[]> {
  const database = await initDatabase();
  return database.all('SELECT * FROM holdings ORDER BY type, name');
}

// Get holdings by type
export async function getHoldingsByType(type: string): Promise<any[]> {
  const database = await initDatabase();
  return database.all('SELECT * FROM holdings WHERE type = ? ORDER BY name', [type]);
}

// Add/update holding
export async function saveHolding(holding: any): Promise<void> {
  const database = await initDatabase();
  
  if (holding.id) {
    await database.run(
      `UPDATE holdings SET name = ?, value = ?, type = ?, symbol = ?, units = ?, 
       avg_buy_price = ?, location = ?, institution = ?, apy = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [holding.name, holding.value, holding.type, holding.symbol, holding.units,
       holding.avgBuyPrice, holding.location, holding.institution, holding.apy, holding.id]
    );
  } else {
    await database.run(
      `INSERT INTO holdings (name, value, type, symbol, units, avg_buy_price, 
       location, institution, apy, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [holding.name, holding.value, holding.type, holding.symbol, holding.units,
       holding.avgBuyPrice, holding.location, holding.institution, holding.apy]
    );
  }
}

// Delete holding
export async function deleteHolding(id: number): Promise<void> {
  const database = await initDatabase();
  await database.run('DELETE FROM holdings WHERE id = ?', [id]);
}

// Get all transactions
export async function getTransactions(limit: number = 100): Promise<any[]> {
  const database = await initDatabase();
  return database.all(
    'SELECT * FROM transactions ORDER BY date DESC LIMIT ?',
    [limit]
  );
}

// Get transactions by category
export async function getTransactionsByCategory(category: string): Promise<any[]> {
  const database = await initDatabase();
  return database.all(
    'SELECT * FROM transactions WHERE category = ? ORDER BY date DESC',
    [category]
  );
}

// Get budget data
export async function getBudgets(): Promise<any[]> {
  const database = await initDatabase();
  return database.all('SELECT * FROM budgets ORDER BY category');
}

// Get net worth history
export async function getNetWorthHistory(): Promise<any[]> {
  const database = await initDatabase();
  return database.all(
    'SELECT * FROM net_worth_history ORDER BY date ASC'
  );
}

// Add net worth entry
export async function addNetWorthEntry(value: number, notes?: string): Promise<void> {
  const database = await initDatabase();
  await database.run(
    'INSERT INTO net_worth_history (date, value, notes) VALUES (date("now"), ?, ?)',
    [value, notes]
  );
}

// Get FX rates
export async function getFXRates(): Promise<any[]> {
  const database = await initDatabase();
  return database.all('SELECT * FROM fx_rates ORDER BY pair');
}

// Update FX rate
export async function updateFXRate(pair: string, rate: number): Promise<void> {
  const database = await initDatabase();
  await database.run(
    'UPDATE fx_rates SET rate = ?, updated_at = datetime("now") WHERE pair = ?',
    [rate, pair]
  );
}

// Get alerts
export async function getAlerts(unreadOnly: boolean = false): Promise<any[]> {
  const database = await initDatabase();
  if (unreadOnly) {
    return database.all('SELECT * FROM alerts WHERE read = 0 ORDER BY created_at DESC');
  }
  return database.all('SELECT * FROM alerts ORDER BY created_at DESC');
}

// Mark alert as read
export async function markAlertRead(id: number): Promise<void> {
  const database = await initDatabase();
  await database.run(
    'UPDATE alerts SET read = 1, read_at = datetime("now") WHERE id = ?',
    [id]
  );
}

// Calculate total net worth
export async function calculateNetWorth(): Promise<number> {
  const database = await initDatabase();
  const result = await database.get('SELECT SUM(value) as total FROM holdings');
  return result?.total || 0;
}

// Get portfolio summary by type
export async function getPortfolioSummary(): Promise<Record<string, number>> {
  const database = await initDatabase();
  const rows = await database.all(
    'SELECT type, SUM(value) as total FROM holdings GROUP BY type'
  );
  
  const summary: Record<string, number> = {};
  rows.forEach((row: any) => {
    summary[row.type] = row.total;
  });
  
  return summary;
}
