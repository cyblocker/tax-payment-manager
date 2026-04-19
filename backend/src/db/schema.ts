import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const taxBills = sqliteTable('tax_bills', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  taxType: text('tax_type'),
  taxYear: text('tax_year'),
  payIndex: text('pay_index'),
  amount: integer('amount'),
  agencyCode: text('agency_code'),
  paymentNumber: text('payment_number'),
  confirmationNumber: text('confirmation_number'),
  paymentCategory: text('payment_category'),
  dueDate: text('due_date'), // YYYY-MM-DD
  originalImage: text('original_image'),
  paymentScreenshot: text('payment_screenshot'),
  status: text('status').default('PENDING'), // PENDING, SCHEDULED, PAID
  scheduledDate: text('scheduled_date'),
  createdAt: integer('created_at', { mode: 'timestamp' })
});
