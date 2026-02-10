# Restaurant Test Data

This directory contains test Excel files for the restaurant business model template. These files can be uploaded to test the restaurant analytics KPIs.

## Generated Files

### Core Restaurant Data

1. **Tables.xlsx** (10 rows)
   - Restaurant table definitions with seating capacity
   - Includes Main Dining, Patio, and Private Room locations

2. **Menu Items.xlsx** (10 rows)
   - Menu items with COGS, pricing, and categories
   - Includes food, drinks, and desserts
   - COGS values included for margin calculations

3. **Orders.xlsx** (200 rows)
   - Orders from October-December 2024
   - Includes covers, total amount, channel (Dine-in/Takeaway/Delivery)
   - Linked to tables via Table ID

4. **Order Items.xlsx** (830 rows)
   - Individual items within each order
   - Links to Orders and Menu Items
   - Includes quantities and pricing

5. **Reservations.xlsx** (150 rows)
   - Reservation data for the same period
   - Includes party size, status (booked/seated/no-show/cancelled)
   - Links to tables

### Financial Data

6. **Invoices.xlsx** (161 rows)
   - Sales invoices linked to orders
   - Includes payment status and dates
   - Type: AR (Accounts Receivable)

7. **Transactions.xlsx** (179 rows)
   - Financial transactions including:
     - Revenue (from orders)
     - COGS (monthly food costs)
     - Labor (bi-weekly payroll)
     - Other expenses (rent, utilities, marketing)
   - Categorized for Prime Cost calculations

### Employee Data

8. **Employees.xlsx** (6 rows)
   - Staff information (chefs, servers, bartenders)
   - Includes roles, departments, employment types

9. **Employee Capacity.xlsx** (18 rows)
   - Monthly capacity/availability data
   - For October, November, December 2024
   - Links to Employees

### CRM Data

10. **CRM.xlsx** (4 rows)
    - Sample deals/opportunities
    - For pipeline analysis

## Data Relationships

The data is structured with proper relationships:

- **Order Items** → **Orders** (via Order ID)
- **Order Items** → **Menu Items** (via Item ID)
- **Orders** → **Tables** (via Table ID)
- **Reservations** → **Tables** (via Table ID)
- **Orders** → **Invoices** (via Order ID)
- **Employee Capacity** → **Employees** (via Employee ID)

## Testing KPIs

This test data supports all Priority 1 KPIs:

1. **Total Revenue** - Calculated from Orders/Transactions
2. **Covers (Guests Served)** - From Orders.Covers field
3. **Average Ticket Size** - Revenue / Covers
4. **Prime Cost %** - (COGS + Labor) / Revenue
   - COGS: Transactions with "Food Cost" category
   - Labor: Transactions with "Wages" category

## Date Range

All data spans **October 1, 2024 to December 31, 2024** (3 months), which allows testing:

- Monthly trends
- Weekly patterns
- Period-over-period comparisons

## Usage

1. Upload these files through the Milton upload interface
2. Map each file to its corresponding data table
3. The system will automatically detect relationships
4. View analytics in the Restaurant Analytics tabs

## Notes

- All amounts are in USD
- Dates are in YYYY-MM-DD format
- Order totals are calculated from Order Items
- Some orders may be marked as "void" for testing cancellation scenarios
- Reservations include various statuses (booked, seated, no-show, cancelled) for testing effectiveness metrics
