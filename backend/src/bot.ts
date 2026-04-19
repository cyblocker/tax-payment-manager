import { drizzle } from 'drizzle-orm/d1';
import { eq, desc } from 'drizzle-orm';
import { taxBills } from './db/schema';
import { extractTaxBillInfo } from './gemini';

export class TelegramBot {
  private token: string;
  private db: any;
  private bucket: R2Bucket;
  private geminiKey: string;

  constructor(token: string, d1: D1Database, bucket: R2Bucket, geminiKey: string) {
    this.token = token;
    this.db = drizzle(d1);
    this.bucket = bucket;
    this.geminiKey = geminiKey;
  }

  async callApi(method: string, payload: any) {
    const url = `https://api.telegram.org/bot${this.token}/${method}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data: any = await res.json();
    if (!data.ok) {
      console.error(`TELEGRAM API ERROR (${method}):`, data.description);
    }
    return data;
  }

  async sendText(chatId: number, text: string, replyMarkup?: any) {
    return this.callApi('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      reply_markup: replyMarkup
    });
  }

  async sendPhoto(chatId: number, photoBlob: Blob, caption: string, replyMarkup?: any) {
    const url = `https://api.telegram.org/bot${this.token}/sendPhoto`;
    const form = new FormData();
    form.append('chat_id', chatId.toString());
    form.append('photo', new File([photoBlob], 'image.jpg', { type: 'image/jpeg' }));
    form.append('caption', caption);
    form.append('parse_mode', 'Markdown');
    if (replyMarkup) {
      form.append('reply_markup', JSON.stringify(replyMarkup));
    }

    const res = await fetch(url, { method: 'POST', body: form });
    const data: any = await res.json();
    if (!data.ok) console.error("SendPhoto Error:", data.description);
    return data;
  }

  async handleUpdate(update: any) {
    if (update.message) {
      await this.handleMessage(update.message);
    } else if (update.callback_query) {
      await this.handleCallbackQuery(update.callback_query);
    }
  }

  async handleMessage(message: any) {
    const chatId = message.chat.id;
    const text = message.text || '';

    if (text === '/start' || text.includes('/login')) {
      return this.sendText(chatId, "Welcome back! What would you like to do?", {
        inline_keyboard: [
          [{ text: "📤 Upload Tax Payslip", callback_data: "upload_payslip" }],
          [{ text: "📝 Manage Pending Payslips", callback_data: "manage_pending" }]
        ]
      });
    }

    const replyContext = message.reply_to_message?.text || '';

    if (replyContext.includes("Please send the photo of your tax payslip") && message.photo) {
      await this.sendText(chatId, "Processing image via Gemini... (Serverless processing)");
      await this.processPayslipPhoto(message.photo, chatId);
      return;
    }

    if (replyContext.includes("Please reply with the scheduled date (YYYY-MM-DD)") && text) {
      const match = replyContext.match(/Bill ID: (\d+)/);
      if (match) {
        const billId = parseInt(match[1]);
        const dateStr = text.trim();
        await this.db.update(taxBills).set({ status: 'SCHEDULED', scheduledDate: dateStr }).where(eq(taxBills.id, billId));

        await this.sendText(chatId, `✅ Payslip scheduled for ${dateStr}! Do you want to upload a proof/receipt photo?`, {
          inline_keyboard: [
            [{ text: "Yes, upload proof", callback_data: `bill_yes_receipt:${billId}` }, { text: "No, skip", callback_data: `bill_skip_receipt` }]
          ]
        });
        return;
      }
    }

    if (replyContext.includes("Please upload the receipt photo for Bill ID:") && (message.photo || message.document)) {
      const match = replyContext.match(/Bill ID: (\d+)/);
      if (match) {
        const billId = parseInt(match[1]);
        await this.sendText(chatId, "Uploading receipt... (Attachment Storage)");

        // Find best photo or doc file_id
        let fileId = "";
        if (message.photo) fileId = message.photo[message.photo.length - 1].file_id;
        else fileId = message.document.file_id;

        const fileRes: any = await this.callApi('getFile', { file_id: fileId });
        const filePath = fileRes.result.file_path;

        const fileUrl = `https://api.telegram.org/file/bot${this.token}/${filePath}`;
        const downRes = await fetch(fileUrl);
        const arrayBuffer = await downRes.arrayBuffer();

        const ext = message.document?.file_name ? message.document.file_name.split('.').pop() : 'jpg';
        const uuid = crypto.randomUUID();
        const objectKey = `receipts/${uuid}.${ext}`;
        await this.bucket.put(objectKey, arrayBuffer);

        await this.db.update(taxBills).set({ paymentScreenshot: `/assets/${objectKey}` }).where(eq(taxBills.id, billId));

        await this.sendText(chatId, "✅ Receipt uploaded successfully!");
        return;
      }
    }

    if (message.photo) {
      await this.sendText(chatId, "If you are uploading a payslip, please use the 📤 Upload Tax Payslip button first so I know what to do!");
    }
  }

  async processPayslipPhoto(photos: any[], chatId: number) {
    try {
      const photo = photos[photos.length - 1];
      const fileId = photo.file_id;

      const fileRes: any = await this.callApi('getFile', { file_id: fileId });
      const filePath = fileRes.result.file_path;

      const fileUrl = `https://api.telegram.org/file/bot${this.token}/${filePath}`;
      const downRes = await fetch(fileUrl);
      const arrayBuffer = await downRes.arrayBuffer();

      const uuid = crypto.randomUUID();
      const objectKey = `taxbills/${uuid}.jpg`;
      await this.bucket.put(objectKey, arrayBuffer, { httpMetadata: { contentType: 'image/jpeg' } });

      const extractedData = await extractTaxBillInfo(arrayBuffer, 'image/jpeg', this.geminiKey);

      if (!extractedData) {
        return this.sendText(chatId, "❌ Failed to read data via Gemini.");
      }

      await this.db.insert(taxBills).values({
        originalImage: `/assets/${objectKey}`,
        taxType: extractedData.tax_type,
        taxYear: extractedData.tax_year,
        payIndex: String(extractedData.pay_index || ''),
        amount: extractedData.amount,
        agencyCode: extractedData.agency_code,
        paymentNumber: extractedData.payment_number,
        confirmationNumber: extractedData.confirmation_number,
        paymentCategory: extractedData.payment_category,
        dueDate: extractedData.due_date,
        status: 'PENDING'
      });

      const msg = `✅ *Extracted Successfully!*\n\n` +
        `Tax: ${extractedData.tax_type}\n` +
        `Amount: ¥${extractedData.amount}\n` +
        `Due: ${extractedData.due_date}\n\nIt is now in your Dashboard!.`;

      await this.sendText(chatId, msg);

    } catch (e) {
      console.error(e);
      await this.sendText(chatId, "❌ An error occurred during internal parsing.");
    }
  }

  async handleCallbackQuery(cb: any) {
    const data = cb.data;
    const chatId = cb.message.chat.id;

    await this.callApi('answerCallbackQuery', { callback_query_id: cb.id });

    if (data === "upload_payslip") {
      await this.callApi('sendMessage', {
        chat_id: chatId,
        text: "Please send the photo of your tax payslip. (I will force a reply to this message)",
        reply_markup: { force_reply: true, input_field_placeholder: "Upload photo..." }
      });
      return;
    }

    if (data === "manage_pending") {
      const q = await this.db.select().from(taxBills).where(eq(taxBills.status, 'PENDING'));
      if (q.length === 0) {
        await this.sendText(chatId, "You have no pending payslips.");
        return;
      }

      // Sort closest due limits to the top
      q.sort((a: any, b: any) => {
        const dA = a.dueDate ? new Date(a.dueDate).getTime() : 9999999999999;
        const dB = b.dueDate ? new Date(b.dueDate).getTime() : 9999999999999;
        return dA - dB;
      });

      const kb = q.map((b: any) => {
        let t_type = "单";
        if (b.taxType && b.taxType.trim().length > 0) t_type = b.taxType.trim()[0];

        let t_year = "";
        const raw_year = b.taxYear || "";
        const first_c_match = raw_year.match(/^[^\d\s]/);
        const digits_match = raw_year.match(/\d+/);
        if (first_c_match && digits_match) t_year = first_c_match[0] + digits_match[0];
        else if (digits_match) t_year = digits_match[0];
        else t_year = raw_year.substring(0, 2);

        const title = `${t_type} ${t_year} ${b.payIndex || ""}`.replace(/\s+/g, ' ').trim();

        let days_str = "?";
        if (b.dueDate) {
          const due = new Date(b.dueDate);
          if (!isNaN(due.getTime())) {
            const diff = Math.ceil((due.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
            days_str = String(diff);
          }
        }

        return [{ text: `${title} (${days_str})`, callback_data: `bill_act:${b.id}` }];
      });

      await this.sendText(chatId, "Select a pending payslip:", { inline_keyboard: kb });
      return;
    }

    if (data.startsWith("bill_act:")) {
      const id = parseInt(data.split(":")[1]);
      const res = await this.db.select().from(taxBills).where(eq(taxBills.id, id));
      const b = res[0];
      if (!b) return this.sendText(chatId, "Bill not found.");

      const msg = `📋 *Bill Details*\n------------------\n` +
        `🔸 *Tax Type:* ${b.taxType || 'N/A'}\n` +
        `🔸 *Year:* ${b.taxYear || 'N/A'}\n` +
        `🔸 *Index:* ${b.payIndex || 'N/A'}\n` +
        `💰 *Amount:* ¥${(b.amount || 0).toLocaleString()}\n` +
        `📅 *Due Date:* ${b.dueDate || 'N/A'}\n` +
        `🏢 *Agency Code:* ${b.agencyCode || 'N/A'}\n` +
        `🔢 *Payment No:* ${b.paymentNumber || 'N/A'}\n` +
        `🔑 *Conf. No:* ${b.confirmationNumber || 'N/A'}\n`;

      const keyboard = {
        inline_keyboard: [
          [
            { text: "✅ Mark Paid", callback_data: `bill_req_paid:${b.id}` },
            { text: "⏱ Mark Scheduled", callback_data: `bill_req_sched:${b.id}` }
          ]
        ]
      };

      // Mirror legacy logic: retrieve image if exists instead of pure text
      if (b.originalImage) {
        let key = '';
        if (b.originalImage.startsWith("/assets/taxbills/")) key = b.originalImage.substring(17);
        else if (b.originalImage.startsWith("/taxbills/")) key = b.originalImage.substring(10);

        if (key) {
          const obj = await this.bucket.get(`taxbills/${key}`);
          if (obj) {
            const blob = await new Response(obj.body).blob();
            await this.sendPhoto(chatId, blob, msg, keyboard);
            return;
          }
        }
      }

      await this.sendText(chatId, msg, keyboard);
      return;
    }

    if (data.startsWith("bill_req_paid:")) {
      const id = parseInt(data.split(":")[1]);
      await this.db.update(taxBills).set({ status: 'PAID' }).where(eq(taxBills.id, id));

      await this.sendText(chatId, `Payslip marked as PAID! Do you want to upload a receipt photo?`, {
        inline_keyboard: [
          [{ text: "Yes, upload proof", callback_data: `bill_yes_receipt:${id}` }, { text: "No, skip", callback_data: `bill_skip_receipt` }]
        ]
      });
      return;
    }

    if (data.startsWith("bill_req_sched:")) {
      const id = data.split(":")[1];
      await this.callApi('sendMessage', {
        chat_id: chatId,
        text: `Please reply with the scheduled date (YYYY-MM-DD) for Bill ID: ${id}`,
        reply_markup: { force_reply: true }
      });
      return;
    }

    if (data.startsWith("bill_yes_receipt:")) {
      const id = data.split(":")[1];
      await this.callApi('sendMessage', {
        chat_id: chatId,
        text: `Please upload the receipt photo for Bill ID: ${id}. I will listen for your reply!`,
        reply_markup: { force_reply: true, input_field_placeholder: "Upload receipt..." }
      });
      return;
    }

    if (data === "bill_skip_receipt") {
      await this.sendText(chatId, "Done. Skipped receipt logic.");
      return;
    }

  }

}
