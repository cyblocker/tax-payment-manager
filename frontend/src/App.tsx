import React, { useState, useEffect } from 'react';
import { PdfUploader } from './components/PdfUploader';
import { Receipt, Loader2, FileText, CalendarDays, Wallet, X, Upload, Maximize } from 'lucide-react';

function App() {
  const [bills, setBills] = useState<any[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isLoadingBills, setIsLoadingBills] = useState(true);
  const [selectedBill, setSelectedBill] = useState<any | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingReceipt, setIsUploadingReceipt] = useState(false);
  const [activeTab, setActiveTab] = useState<'PENDING' | 'ARCHIVED'>('PENDING');
  const [enlargedImage, setEnlargedImage] = useState<string | null>(null);

  const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8787';

  const fetchBills = async () => {
    setIsLoadingBills(true);
    try {
      const res = await fetch(`${API_BASE}/api/taxbills`);
      if (res.ok) {
        const data = await res.json();
        setBills(data);
      }
    } catch (err) {
      console.error('Failed to fetch tax bills:', err);
    } finally {
      setIsLoadingBills(false);
    }
  };

  useEffect(() => {
    fetchBills();
  }, []);

  const handleDocumentExtraction = async (pages: any[]) => {
    setIsExtracting(true);
    try {
      const results = [];
      for (const page of pages) {
        const response = await fetch(page.imageUrl);
        const blob = await response.blob();

        const formData = new FormData();
        const filename = page.file ? page.file.name : `extracted_page_${page.pageIndex}.png`;
        formData.append('file', blob, filename);

        const uploadRes = await fetch(`${API_BASE}/api/upload`, {
          method: 'POST',
          body: formData,
        });

        if (!uploadRes.ok) {
          const errText = await uploadRes.text();
          throw new Error(`API Upload Failed for page ${page.pageIndex}: ${errText}`);
        }

        results.push(await uploadRes.json());
      }

      await fetchBills();
      alert(`✅ Successfully extracted and processed ${results.length} tax document(s)!`);

    } catch (err) {
      console.error(err);
      alert('Failed to connect to the Extraction Server. Make sure your local Hono server is running on Port 8787.');
    } finally {
      setIsExtracting(false);
    }
  };

  const openEditor = (bill: any) => {
    setSelectedBill(bill);
    setEditForm({ ...bill });
  };

  const closeEditor = () => {
    setSelectedBill(null);
    setEditForm({});
  };

  const handleEditorSave = async () => {
    setIsSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/taxbills/${selectedBill.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      if (res.ok) {
        await fetchBills();
        closeEditor();
      } else {
        alert("Failed to save changes.");
      }
    } catch (err) {
      console.error(err);
      alert("Error saving: " + err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReceiptUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingReceipt(true);
    try {
      const fd = new FormData();
      fd.append('file', file);

      const res = await fetch(`${API_BASE}/api/taxbills/${selectedBill.id}/receipt`, {
        method: 'POST',
        body: fd,
      });

      if (res.ok) {
        const data = await res.json();
        setEditForm({ ...editForm, paymentScreenshot: data.url, status: 'PAID' });
        alert("Receipt uploaded! Remember to click Save.");
      } else {
        alert("Failed to upload receipt.");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsUploadingReceipt(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans selection:bg-indigo-100 selection:text-indigo-900 pb-20">
      <header className="bg-white border-b border-gray-200/60 sticky top-0 z-40 backdrop-blur-lg bg-white/80">
        <div className="max-w-6xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 p-2.5 rounded-xl shadow-lg shadow-indigo-200">
              <Receipt className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">
              TaxManager<span className="text-indigo-600">.</span>
            </h1>
          </div>
          <div className="flex bg-gray-100 items-center justify-center px-4 py-2 rounded-full font-medium text-sm text-gray-600">
            Admin View
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 pt-12 space-y-16">
        <section>
          <div className="text-center mb-10 max-w-2xl mx-auto">
            <h2 className="text-4xl font-extrabold text-gray-900 mb-4 tracking-tight">Import your documents</h2>
            <p className="text-lg text-gray-500">Upload tax payslips directly into the cloud. Our intelligent engine will execute data-extraction automatically.</p>
          </div>

          {isExtracting ? (
            <div className="flex flex-col items-center justify-center p-20 bg-white rounded-3xl shadow-sm border border-indigo-100">
              <Loader2 className="w-16 h-16 text-indigo-600 animate-spin mb-6" />
              <h3 className="text-2xl font-bold text-gray-800">Transmitting to Gemini</h3>
              <p className="text-gray-500 mt-2 text-center max-w-sm">We are packaging the rotated images and communicating with the backend APIs to extract the structured Tax Data natively...</p>
            </div>
          ) : (
            <PdfUploader onPagesProcessed={handleDocumentExtraction} />
          )}
        </section>

        <section className="bg-white rounded-3xl p-8 shadow-sm border border-gray-100 relative">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-2xl font-bold text-gray-800">Recent Bills Dashboard</h3>
            <button onClick={fetchBills} className="text-sm font-semibold text-indigo-600 hover:text-indigo-800 transition-colors">
              Refresh
            </button>
          </div>

          {/* Tab Navigation */}
          <div className="flex border-b border-gray-200 mb-6 gap-6">
            <button
              onClick={() => setActiveTab('PENDING')}
              className={`pb-3 font-semibold text-sm transition-colors border-b-2 ${activeTab === 'PENDING' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            >
              Action Needed
            </button>
            <button
              onClick={() => setActiveTab('ARCHIVED')}
              className={`pb-3 font-semibold text-sm transition-colors border-b-2 ${activeTab === 'ARCHIVED' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            >
              Scheduled & Paid
            </button>
          </div>

          {isLoadingBills ? (
            <div className="py-20 flex justify-center">
              <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
            </div>
          ) : (() => {
            const filteredBills = bills.filter(b =>
              activeTab === 'PENDING' ? (b.status === 'PENDING' || !b.status) : (b.status === 'SCHEDULED' || b.status === 'PAID')
            );

            if (filteredBills.length === 0) {
              return (
                <div className="text-center py-16 bg-slate-50 rounded-2xl border-2 border-dashed border-gray-200">
                  <p className="text-gray-500 font-medium tracking-wide">Your queue is empty.</p>
                  <p className="text-gray-400 text-sm mt-2">No {activeTab === 'PENDING' ? 'pending' : 'scheduled/paid'} bills found in the database.</p>
                </div>
              );
            }

            return (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {filteredBills.map((bill, i) => (
                  <div
                    key={i}
                    onClick={() => openEditor(bill)}
                    className="flex bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden hover:shadow-md transition-all cursor-pointer group hover:border-indigo-200"
                  >
                    <div className="w-32 bg-gray-50 relative overflow-hidden flex-shrink-0 border-r border-gray-100">
                      {bill.originalImage ? (
                        <img src={`${API_BASE}${bill.originalImage}`} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" alt="Bill" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <FileText className="w-8 h-8 text-gray-300" />
                        </div>
                      )}
                    </div>
                    <div className="p-5 flex-1 pl-6">
                      <div className="flex justify-between items-start">
                        <div>
                          <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider mb-2 ${bill.status === 'PAID' ? 'bg-emerald-100 text-emerald-700' : bill.status === 'SCHEDULED' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                            {bill.status || 'PENDING'}
                          </span>
                          <h4 className="text-lg font-bold text-gray-900 leading-tight">
                            {bill.taxType || "Unknown Tax Document"}
                          </h4>
                          <p className="text-sm font-medium text-gray-500 mt-0.5">
                            {bill.taxYear || ''} {bill.payIndex || ''}
                          </p>
                        </div>
                        <div className="text-right">
                          <span className="text-2xl font-black text-indigo-600">¥{(bill.amount || 0).toLocaleString()}</span>
                        </div>
                      </div>

                      <div className="mt-4 flex gap-4 text-sm font-medium text-gray-600">
                        <div className="flex items-center gap-1.5"><CalendarDays className="w-4 h-4 text-gray-400" /> Due: {bill.dueDate || 'N/A'}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </section>
      </main>

      {/* Editor Modal Overlay */}
      {selectedBill && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm transition-opacity cursor-pointer"
          onClick={closeEditor}
        >
          <div
            className="bg-white rounded-3xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] cursor-default"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <h3 className="text-xl font-bold text-gray-800">Edit Details</h3>
              <button onClick={closeEditor} className="p-2 hover:bg-gray-200 rounded-full text-gray-500 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 md:flex gap-8">
              {/* Image Preview Side */}
              <div className="md:w-1/2 flex flex-col gap-4 mb-6 md:mb-0">
                <div className="bg-gray-100 rounded-2xl overflow-hidden shadow-inner flex items-center justify-center min-h-[300px] relative group border border-gray-200">
                  {editForm.originalImage ? (
                    <>
                      <img
                        src={`${API_BASE}${editForm.originalImage}`}
                        className="w-full h-auto object-contain max-h-[500px] cursor-zoom-in transition-transform duration-300 group-hover:scale-[1.02]"
                        alt="Original"
                        onClick={() => setEnlargedImage(`${API_BASE}${editForm.originalImage}`)}
                      />
                      <div className="absolute top-3 right-3 bg-white/90 backdrop-blur-sm px-3 py-1.5 rounded-full text-xs font-bold text-gray-600 shadow-sm pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
                        Click to Enlarge
                      </div>
                    </>
                  ) : (
                    <span className="text-gray-400">No Document Attached</span>
                  )}
                </div>

                {/* Receipt Upload/Display Box */}
                <div className="mt-4 p-4 border-2 border-dashed border-gray-200 rounded-2xl">
                  <h4 className="font-semibold text-gray-700 mb-3 flex items-center gap-2"><Receipt className="w-4 h-4" /> Proof of Payment</h4>
                  {editForm.paymentScreenshot ? (
                    <div className="relative group rounded-xl overflow-hidden h-32 flex">
                      <img src={`${API_BASE}${editForm.paymentScreenshot}`} className="w-full h-full object-cover opacity-90" alt="Receipt" />
                      <div className="absolute inset-0 bg-black/60 flex items-center justify-center gap-6 text-white opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => setEnlargedImage(`${API_BASE}${editForm.paymentScreenshot}`)}
                          className="flex flex-col items-center hover:text-indigo-300 transition-colors"
                        >
                          <Maximize className="w-5 h-5 mb-1" />
                          <span className="text-xs font-medium">Enlarge</span>
                        </button>

                        <label className="flex flex-col items-center hover:text-indigo-300 transition-colors cursor-pointer">
                          <Upload className="w-5 h-5 mb-1" />
                          <span className="text-xs font-medium">Replace</span>
                          <input type="file" className="hidden" accept="image/*" onChange={handleReceiptUpload} disabled={isUploadingReceipt} />
                        </label>
                      </div>
                    </div>
                  ) : (
                    <label className="flex flex-col items-center justify-center h-32 bg-slate-50 hover:bg-slate-100 cursor-pointer rounded-xl transition-colors">
                      {isUploadingReceipt ? <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" /> : <Upload className="w-6 h-6 text-indigo-400 mb-2" />}
                      <span className="text-sm font-medium text-indigo-600">Upload Receipt</span>
                      <input type="file" className="hidden" accept="image/*" onChange={handleReceiptUpload} disabled={isUploadingReceipt} />
                    </label>
                  )}
                </div>
              </div>

              {/* Editor Form Side */}
              <div className="md:w-1/2 flex flex-col gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Status</label>
                  <select
                    className="w-full border-gray-200 rounded-xl focus:ring-indigo-500 focus:border-indigo-500 bg-gray-50 px-4 py-2.5"
                    value={editForm.status || 'PENDING'}
                    onChange={e => setEditForm({ ...editForm, status: e.target.value })}
                  >
                    <option value="PENDING">Pending</option>
                    <option value="SCHEDULED">Scheduled</option>
                    <option value="PAID">Paid</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Tax Type</label>
                    <input type="text" className="w-full border-gray-200 rounded-xl px-4 py-2.5 bg-gray-50" value={editForm.taxType || ''} onChange={e => setEditForm({ ...editForm, taxType: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Amount (¥)</label>
                    <input type="number" className="w-full border-gray-200 rounded-xl px-4 py-2.5 bg-gray-50" value={editForm.amount || ''} onChange={e => setEditForm({ ...editForm, amount: parseInt(e.target.value) || 0 })} />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Tax Year</label>
                    <input type="text" className="w-full border-gray-200 rounded-xl px-4 py-2.5 bg-gray-50" value={editForm.taxYear || ''} onChange={e => setEditForm({ ...editForm, taxYear: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Index / Term</label>
                    <input type="text" className="w-full border-gray-200 rounded-xl px-4 py-2.5 bg-gray-50" value={editForm.payIndex || ''} onChange={e => setEditForm({ ...editForm, payIndex: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Due Date</label>
                    <input type="date" className="w-full border-gray-200 rounded-xl px-4 py-2.5 bg-gray-50" value={editForm.dueDate || ''} onChange={e => setEditForm({ ...editForm, dueDate: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Sched. Date</label>
                    <input type="date" className="w-full border-gray-200 rounded-xl px-4 py-2.5 bg-gray-50" value={editForm.scheduledDate || ''} onChange={e => setEditForm({ ...editForm, scheduledDate: e.target.value })} />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Agency Code</label>
                  <input type="text" className="w-full border-gray-200 rounded-xl px-4 py-2.5 bg-gray-50" value={editForm.agencyCode || ''} onChange={e => setEditForm({ ...editForm, agencyCode: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Payment / Reference Number</label>
                  <input type="text" className="w-full border-gray-200 rounded-xl px-4 py-2.5 bg-gray-50" value={editForm.paymentNumber || ''} onChange={e => setEditForm({ ...editForm, paymentNumber: e.target.value })} />
                </div>
              </div>
            </div>

            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
              <button onClick={closeEditor} className="px-5 py-2.5 text-gray-600 font-medium hover:bg-gray-200 rounded-xl transition-colors">
                Cancel
              </button>
              <button onClick={handleEditorSave} disabled={isSaving} className="px-6 py-2.5 bg-indigo-600 text-white font-medium hover:bg-indigo-700 rounded-xl transition-colors shadow-md shadow-indigo-200 disabled:opacity-70 flex items-center gap-2">
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fullscreen Image Overlay */}
      {enlargedImage && (
        <div
          className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-4 cursor-zoom-out backdrop-blur-md transition-all"
          onClick={() => setEnlargedImage(null)}
        >
          <button
            className="absolute top-6 right-6 p-3 bg-white/10 hover:bg-white/20 transition-colors rounded-full text-white backdrop-blur-md"
            onClick={(e) => { e.stopPropagation(); setEnlargedImage(null); }}
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={enlargedImage}
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
            alt="Enlarged Document"
          />
        </div>
      )}
    </div>
  );
}

export default App;
