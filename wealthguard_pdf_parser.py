#!/usr/bin/env python3
"""
WealthGuard Document Parser
AI-powered extraction of transactions from PDF bank statements
"""
import sqlite3
import re
from datetime import datetime
from typing import List, Dict, Optional
import pdfplumber
import os

DB_PATH = "/root/.openclaw/workspace/wealthguard.db"

class PDFTransactionExtractor:
    """
    Extract transactions from PDF bank statements
    """
    
    def __init__(self):
        self.conn = sqlite3.connect(DB_PATH)
        self.conn.row_factory = sqlite3.Row
    
    def detect_bank_format(self, pdf_path: str) -> str:
        """Detect the bank based on PDF content patterns"""
        try:
            with pdfplumber.open(pdf_path) as pdf:
                # Check first few pages for bank identifiers
                for i, page in enumerate(pdf.pages[:3]):
                    text = page.extract_text() or ""
                    text_lower = text.lower()
                    
                    if 'rabobank' in text_lower or 'rabo' in text_lower:
                        return 'rabobank'
                    elif 'anz' in text_lower or 'australia and new zealand' in text_lower:
                        return 'anz'
                    elif 'wise' in text_lower or 'transferwise' in text_lower:
                        return 'wise'
                    elif 'commonwealth' in text_lower or 'commbank' in text_lower:
                        return 'commbank'
                    elif 'nab' in text_lower or 'national australia bank' in text_lower:
                        return 'nab'
                    elif 'westpac' in text_lower:
                        return 'westpac'
        except Exception as e:
            print(f"Error detecting format: {e}")
        
        return 'generic'
    
    def extract_rabobank_transactions(self, pdf_path: str) -> List[Dict]:
        """Extract transactions from Rabobank statements"""
        transactions = []
        
        try:
            with pdfplumber.open(pdf_path) as pdf:
                for page in pdf.pages:
                    text = page.extract_text() or ""
                    lines = text.split('\n')
                    
                    for line in lines:
                        # Rabobank pattern: Date Description Amount Balance
                        # Example: 01 Jan 2024 TRANSFER FROM 1234 1,000.00 5,000.00
                        match = re.match(
                            r'(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})\s+'  # Date
                            r'(.+?)\s+'  # Description
                            r'([\d,]+\.\d{2})\s+'  # Amount
                            r'([\d,]+\.\d{2})',  # Balance
                            line.strip()
                        )
                        
                        if match:
                            date_str = match.group(1)
                            description = match.group(2).strip()
                            amount_str = match.group(3).replace(',', '')
                            
                            # Determine debit/credit from context
                            # Rabobank: positive amounts are credits, negative are debits
                            transaction_type = 'credit' if 'TRANSFER FROM' in description.upper() or 'INTEREST' in description.upper() else 'debit'
                            
                            transactions.append({
                                'date': datetime.strptime(date_str, '%d %b %Y').strftime('%Y-%m-%d'),
                                'description': description,
                                'amount': float(amount_str),
                                'transaction_type': transaction_type,
                                'raw_line': line
                            })
        except Exception as e:
            print(f"Error extracting Rabobank transactions: {e}")
        
        return transactions
    
    def extract_generic_transactions(self, pdf_path: str) -> List[Dict]:
        """Generic extraction for unknown bank formats"""
        transactions = []
        
        try:
            with pdfplumber.open(pdf_path) as pdf:
                for page in pdf.pages:
                    text = page.extract_text() or ""
                    lines = text.split('\n')
                    
                    for line in lines:
                        # Generic patterns to try
                        patterns = [
                            # DD/MM/YYYY Description Amount
                            r'(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\s+(.+?)\s+([\d,]+\.\d{2})',
                            # YYYY-MM-DD Description Amount
                            r'(\d{4}-\d{2}-\d{2})\s+(.+?)\s+([\d,]+\.\d{2})',
                        ]
                        
                        for pattern in patterns:
                            match = re.match(pattern, line.strip())
                            if match:
                                date_str = match.group(1)
                                description = match.group(2).strip()
                                amount_str = match.group(3).replace(',', '')
                                
                                # Try to parse date
                                try:
                                    if '-' in date_str and len(date_str.split('-')[0]) == 4:
                                        parsed_date = datetime.strptime(date_str, '%Y-%m-%d')
                                    elif '/' in date_str:
                                        parsed_date = datetime.strptime(date_str, '%d/%m/%Y')
                                    else:
                                        continue
                                    
                                    transactions.append({
                                        'date': parsed_date.strftime('%Y-%m-%d'),
                                        'description': description,
                                        'amount': float(amount_str),
                                        'transaction_type': 'debit',  # Default
                                        'raw_line': line
                                    })
                                    break
                                except ValueError:
                                    continue
        except Exception as e:
            print(f"Error extracting generic transactions: {e}")
        
        return transactions
    
    def import_pdf_transactions(self, pdf_path: str, account_id: int, 
                                 auto_categorize: bool = True) -> Dict:
        """Import transactions from PDF to database"""
        from wealthguard_utils import auto_categorize as categorize_func
        
        # Detect format
        bank_format = self.detect_bank_format(pdf_path)
        print(f"Detected format: {bank_format}")
        
        # Extract transactions
        if bank_format == 'rabobank':
            transactions = self.extract_rabobank_transactions(pdf_path)
        else:
            transactions = self.extract_generic_transactions(pdf_path)
        
        if not transactions:
            return {
                'success': False,
                'message': 'No transactions found in PDF',
                'count': 0
            }
        
        # Import to database
        cursor = self.conn.cursor()
        imported_count = 0
        duplicate_count = 0
        
        for txn in transactions:
            # Check for duplicates
            cursor.execute("""
                SELECT COUNT(*) FROM transactions 
                WHERE account_id = ? 
                  AND transaction_date = ?
                  AND description = ?
                  AND amount = ?
            """, (account_id, txn['date'], txn['description'], txn['amount']))
            
            if cursor.fetchone()[0] > 0:
                duplicate_count += 1
                continue
            
            # Auto-categorize
            category = None
            if auto_categorize:
                category = categorize_func(txn['description'])
            
            # Insert transaction
            cursor.execute("""
                INSERT INTO transactions 
                (account_id, transaction_date, description, amount, transaction_type, category, raw_data)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                account_id,
                txn['date'],
                txn['description'],
                txn['amount'],
                txn['transaction_type'],
                category,
                txn.get('raw_line', '')
            ))
            
            imported_count += 1
        
        self.conn.commit()
        
        return {
            'success': True,
            'message': f'Imported {imported_count} transactions ({duplicate_count} duplicates skipped)',
            'count': imported_count,
            'duplicates': duplicate_count,
            'format': bank_format
        }
    
    def close(self):
        self.conn.close()


def import_pdf_statement(pdf_path: str, account_id: int) -> Dict:
    """
    Convenience function to import PDF statement
    
    Usage:
        result = import_pdf_statement('/path/to/statement.pdf', account_id=1)
        print(result['message'])
    """
    extractor = PDFTransactionExtractor()
    try:
        result = extractor.import_pdf_transactions(pdf_path, account_id)
        return result
    finally:
        extractor.close()


if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python3 wealthguard_pdf_parser.py <pdf_path> [account_id]")
        sys.exit(1)
    
    pdf_path = sys.argv[1]
    account_id = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    
    if not os.path.exists(pdf_path):
        print(f"Error: File not found: {pdf_path}")
        sys.exit(1)
    
    result = import_pdf_statement(pdf_path, account_id)
    print(json.dumps(result, indent=2))
