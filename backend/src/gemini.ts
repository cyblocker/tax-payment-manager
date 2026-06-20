import { GoogleGenAI, Type, Schema } from '@google/genai';

const TaxBillSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    tax_type: { type: Type.STRING, description: 'The type of tax (税目), e.g., "National Tax", "Residence Tax", "国民健康保険料", "住民税".' },
    tax_year: { type: Type.STRING, description: 'The year of the tax (年度), e.g., "令和5年度", "2023".' },
    pay_index: { type: Type.STRING, description: 'The specific term or index (期别), e.g., "第1期", "全期".' },
    amount: { type: Type.NUMBER, description: 'The payment amount in JPY, as an integer WITHOUT currency symbols or commas.' },
    agency_code: { type: Type.STRING, description: 'The agency code (収納機関番号), often 5 digits.' },
    payment_number: { type: Type.STRING, description: 'The payment number (納付番号).' },
    confirmation_number: { type: Type.STRING, description: 'The confirmation number (確認番号).' },
    payment_category: { type: Type.STRING, description: 'The payment category/classification (納付区分).' },
    due_date: { type: Type.STRING, description: 'The payment deadline formatted strictly as "YYYY-MM-DD". Look for phrases like "納期限".' }
  },
};

export async function extractTaxBillInfo(imageBuffer: ArrayBuffer, mimeType: string, apiKey: string) {
  const ai = new GoogleGenAI({ apiKey });

  // Convert ArrayBuffer to base64
  let binary = '';
  const bytes = new Uint8Array(imageBuffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64Image = btoa(binary);

  const primaryPrompt = `
    Please analyze this Japanese tax bill image. The image might be rotated 90, 180, or 270 degrees clockwise — read all text regardless of orientation.
    
    Return ONLY a valid JSON object with the following keys. If a value is not found, use null or omit it.
    - tax_type: The type of tax (税目), e.g., "National Tax", "Residence Tax", "国民健康保険料", "住民税".
    - tax_year: The year of the tax (年度), e.g., "令和5年度", "2023".
    - pay_index: The specific term or index (期别), e.g., "第1期", "全期".
    - amount: The payment amount in JPY, as an integer WITHOUT currency symbols or commas.
    - agency_code: The agency code (収納機関番号), often 5 digits.
    - payment_number: The payment number (納付番号).
    - confirmation_number: The confirmation number (確認番号).
    - payment_category: The payment category/classification (納付区分).
    - due_date: The payment deadline formatted strictly as "YYYY-MM-DD". Look for phrases like "納期限".
    
    Make sure your response strictly contains ONLY valid JSON without any markdown block wrapper like \`\`\`json.
  `;

  const retryPrompt = `
    Please analyze this Japanese tax bill image. A previous extraction attempt was incomplete (missing amount, due date, or payment term/index).
    
    Please examine the image extra carefully, paying special attention to locating:
    - amount: The payment amount (usually in Japanese Yen, look for a large number near characters like "¥", "円", "合計金額", or "納付金額").
    - due_date: The payment deadline/due date. Look for characters like "納期限", "期限", "納付期限" and format it strictly as YYYY-MM-DD.
    - pay_index: The specific term/index, e.g. "第1期", "第2期", "全期", "期別".
    
    The image might be rotated 90, 180, or 270 degrees clockwise — read all text regardless of orientation.
    
    Return ONLY a valid JSON object with the following keys. If a value is not found, use null or omit it.
    - tax_type: The type of tax (税目), e.g., "National Tax", "Residence Tax", "国民健康保険料", "住民税".
    - tax_year: The year of the tax (年度), e.g., "令和5年度", "2023".
    - pay_index: The specific term or index (期别), e.g., "第1期", "全期".
    - amount: The payment amount in JPY, as an integer WITHOUT currency symbols or commas.
    - agency_code: The agency code (収納機関番号), often 5 digits.
    - payment_number: The payment number (納付番号).
    - confirmation_number: The confirmation number (確認番号).
    - payment_category: The payment category/classification (納付区分).
    - due_date: The payment deadline formatted strictly as "YYYY-MM-DD". Look for phrases like "納期限".
    
    Make sure your response strictly contains ONLY valid JSON without any markdown block wrapper like \`\`\`json.
  `;

  const executeExtraction = async (promptText: string, temp: number = 0.1) => {
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-lite-preview',
      contents: [
        {
          role: 'user', parts: [
            { text: promptText },
            { inlineData: { data: base64Image, mimeType: mimeType } }
          ]
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: TaxBillSchema,
        temperature: temp,
      }
    });

    if (response.text) {
      let cleanText = response.text.trim();
      if (cleanText.startsWith("```json")) {
        cleanText = cleanText.substring(7);
      }
      if (cleanText.startsWith("```")) {
        cleanText = cleanText.substring(3);
      }
      if (cleanText.endsWith("```")) {
        cleanText = cleanText.substring(0, cleanText.length - 3);
      }
      return JSON.parse(cleanText.trim());
    }
    return null;
  };

  try {
    console.log("[GEMINI] Starting primary extraction attempt...");
    let result = await executeExtraction(primaryPrompt, 0.1);
    
    // Check if the extracted data is complete (specifically checking amount, due_date, and pay_index)
    const isComplete = result && result.amount && result.due_date && result.pay_index;
    
    if (!isComplete) {
      console.log("[GEMINI] Primary extraction incomplete (missing amount, due_date, or pay_index). Retrying with enhanced prompt...");
      try {
        const retryResult = await executeExtraction(retryPrompt, 0.2); // slight temp increase to encourage alternative parsing paths
        if (retryResult) {
          // Compare how many of the target fields (amount, due_date, pay_index) were successfully extracted
          const primaryScore = (result?.amount ? 1 : 0) + (result?.due_date ? 1 : 0) + (result?.pay_index ? 1 : 0);
          const retryScore = (retryResult.amount ? 1 : 0) + (retryResult.due_date ? 1 : 0) + (retryResult.pay_index ? 1 : 0);
          
          if (retryScore > primaryScore || (retryResult.amount && retryResult.due_date && retryResult.pay_index)) {
            console.log(`[GEMINI] Retry successful. Score increased from ${primaryScore} to ${retryScore}. Using retry results.`);
            result = retryResult;
          } else {
            console.log(`[GEMINI] Retry did not yield more complete data (primary: ${primaryScore}, retry: ${retryScore}). Keeping primary results.`);
          }
        }
      } catch (retryErr) {
        console.error("[GEMINI] Retry extraction failed:", retryErr);
        // Fall back to primary result if retry crashes
      }
    } else {
      console.log("[GEMINI] Primary extraction successful and complete.");
    }
    
    return result;
  } catch (error) {
    console.error('Gemini Extraction Error:', error);
    throw error;
  }
}
