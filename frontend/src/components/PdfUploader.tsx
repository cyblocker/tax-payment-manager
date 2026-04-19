import React, { useState, useRef, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { RotateCw, UploadCloud, CheckCircle2, Trash2, FileText, Image as ImageIcon } from 'lucide-react';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface PageData {
  pageIndex: number;
  pdfPage: pdfjsLib.PDFPageProxy | null;
  rotation: number;
  imageUrl: string; 
  isPdf: boolean;
  file?: File;
}

export function PdfUploader({ onPagesProcessed }: { onPagesProcessed: (pages: PageData[]) => void }) {
  const [pages, setPages] = useState<PageData[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeTab, setActiveTab] = useState<'upload' | 'review'>('upload');

  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = async (file: File) => {
    setIsProcessing(true);
    try {
      if (file.type === 'application/pdf') {
        const arrayBuffer = await file.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument(new Uint8Array(arrayBuffer));
        const pdf = await loadingTask.promise;
        
        const newPages: PageData[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          newPages.push({
            pageIndex: i,
            pdfPage: page,
            rotation: 0,
            imageUrl: '',
            isPdf: true,
          });
        }
        setPages(newPages);
        setActiveTab('review');
      } else if (file.type.startsWith('image/')) {
         // Direct image upload support
         setPages([{
           pageIndex: 1,
           pdfPage: null,
           rotation: 0,
           imageUrl: URL.createObjectURL(file),
           isPdf: false,
           file: file
         }]);
         setActiveTab('review');
      } else {
        alert('Please upload a valid PDF or Image file.');
      }
    } catch (err) {
      console.error('Error processing file:', err);
      alert('Failed to process the document.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleRotation = (index: number) => {
    setPages(prev => {
      const updated = [...prev];
      updated[index] = { 
        ...updated[index], 
        rotation: (updated[index].rotation + 90) % 360 
      };
      return updated;
    });
  };

  const handleBatchRotate = () => {
    setPages(prev => prev.map(page => ({
      ...page,
      rotation: (page.rotation + 90) % 360
    })));
  };

  const handleRemove = () => {
    setPages([]);
    setActiveTab('upload');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = () => {
    onPagesProcessed(pages);
  };

  return (
    <div className="w-full max-w-4xl mx-auto rounded-3xl overflow-hidden shadow-2xl bg-white border border-gray-100/50 backdrop-blur-xl">
      <div className="bg-gradient-to-r from-blue-600 to-indigo-700 px-8 py-6 flex justify-between items-center text-white">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Document Input</h2>
          <p className="text-blue-100/80 text-sm mt-1">Upload and refine your tax payslips securely.</p>
        </div>
        <div className="flex bg-white/10 rounded-full p-1 backdrop-blur-md">
          <button 
            className={`px-4 py-2 rounded-full text-sm font-semibold transition-all ${activeTab === 'upload' ? 'bg-white text-indigo-700 shadow-md' : 'text-white hover:bg-white/20'}`}
            onClick={() => setActiveTab('upload')}
          >
            Upload
          </button>
          <button 
             className={`px-4 py-2 rounded-full text-sm font-semibold transition-all ${activeTab === 'review' ? 'bg-white text-indigo-700 shadow-md' : 'text-white hover:bg-white/20'} ${pages.length === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
             onClick={() => pages.length > 0 && setActiveTab('review')}
          >
            Review & Edit
          </button>
        </div>
      </div>

      <div className="p-8">
        {activeTab === 'upload' && (
          <div 
            className={`border-3 border-dashed rounded-2xl flex flex-col items-center justify-center py-20 px-6 transition-all cursor-pointer relative overflow-hidden group
              ${isProcessing ? 'border-gray-200 bg-gray-50' : 'border-indigo-200 hover:border-indigo-400 hover:bg-indigo-50/50 bg-gray-50/50'}`}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onClick={() => !isProcessing && fileInputRef.current?.click()}
          >
             <div className="absolute inset-0 bg-gradient-to-b from-transparent to-indigo-50/20 pointer-events-none" />
             
             {isProcessing ? (
               <div className="flex flex-col items-center animate-pulse">
                  <div className="w-16 h-16 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4 shadow-lg" />
                  <p className="text-indigo-600 font-medium">Processing Document Engine...</p>
               </div>
             ) : (
               <>
                 <div className="w-20 h-20 bg-white shadow-xl shadow-indigo-100/50 rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                    <UploadCloud className="w-10 h-10 text-indigo-600" />
                 </div>
                 <h3 className="text-xl font-bold text-gray-800 mb-2">Drag & Drop your file here</h3>
                 <p className="text-gray-500 text-sm mb-6 text-center max-w-sm">
                   Supports High-Res PDF or Image elements. Pages will be automatically split for Gemini extraction.
                 </p>
                 <button className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-3 rounded-full font-semibold shadow-md shadow-indigo-200 transition-colors">
                   Browse Files
                 </button>
                 <input 
                   type="file" 
                   className="hidden" 
                   ref={fileInputRef}
                   accept=".pdf,image/*" 
                   onChange={(e) => {
                     if (e.target.files && e.target.files[0]) processFile(e.target.files[0]);
                   }}
                 />
               </>
             )}
          </div>
        )}

        {activeTab === 'review' && pages.length > 0 && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex justify-between items-end mb-6 border-b border-gray-100 pb-4">
               <div>
                 <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                   <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                   {pages.length} Pages Extracted
                 </h3>
                 <p className="text-sm text-gray-500 mt-1">Rotate pages to ensure they are upright before submission.</p>
               </div>
               <div className="flex items-center gap-4">
                 <button onClick={handleBatchRotate} className="text-indigo-600 hover:text-indigo-800 text-sm flex items-center gap-1.5 font-semibold transition-colors bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-full">
                    <RotateCw className="w-4 h-4" /> Rotate All
                 </button>
                 <button onClick={handleRemove} className="text-rose-500 hover:text-rose-700 text-sm flex items-center gap-1.5 font-medium transition-colors bg-rose-50 hover:bg-rose-100 px-3 py-1.5 rounded-full">
                    <Trash2 className="w-4 h-4" /> Start Over
                 </button>
               </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {pages.map((p, index) => (
                <div key={index} className="flex flex-col items-center bg-gray-50 rounded-2xl p-4 shadow-inner border border-gray-100 transition-all hover:shadow-lg hover:-translate-y-1">
                  <div className="flex justify-between items-center w-full mb-3 px-1">
                     <span className="text-xs font-bold uppercase tracking-wider text-gray-500 flex items-center gap-1">
                       {p.isPdf ? <FileText className="w-3 h-3"/> : <ImageIcon className="w-3 h-3"/>}
                       Page {index + 1}
                     </span>
                     <button 
                       onClick={() => handleRotation(index)}
                       className="p-2 bg-indigo-100 hover:bg-indigo-200 text-indigo-700 rounded-full transition-colors group"
                       title="Rotate 90 degrees"
                     >
                       <RotateCw className="w-4 h-4 group-hover:rotate-90 transition-transform duration-300" />
                     </button>
                  </div>
                  
                  <div className="relative w-full aspect-[3/4] bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex items-center justify-center">
                    {p.isPdf && p.pdfPage ? (
                      <PdfCanvasViewer pdfPage={p.pdfPage} rotation={p.rotation} onRender={(url) => {
                        // Keep the latest rendered Blob URL if we need to send it later
                        p.imageUrl = url;
                      }}/>
                    ) : (
                      <img 
                        src={p.imageUrl} 
                        alt={`Page ${index + 1}`} 
                        className="max-w-full max-h-full object-contain transition-transform duration-300"
                        style={{ transform: `rotate(${p.rotation}deg)` }} 
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-10 flex justify-end">
               <button 
                 onClick={handleSubmit}
                 className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white px-10 py-3.5 rounded-full font-bold shadow-lg shadow-emerald-200 hover:shadow-emerald-300 transition-all transform hover:-translate-y-0.5 flex items-center gap-2"
               >
                 Confirm & Extract Data
               </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Subcomponent to handle the complex canvas rendering logic for PDFJS
function PdfCanvasViewer({ pdfPage, rotation, onRender }: { pdfPage: pdfjsLib.PDFPageProxy, rotation: number, onRender: (url: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let renderTask: pdfjsLib.RenderTask | null = null;
    
    const renderPage = async () => {
      if (!canvasRef.current || !pdfPage) return;
      
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      if (!context) return;

      // High DPI scaling (Scale 2.0 for clear extraction and viewing)
      const viewport = pdfPage.getViewport({ scale: 2.0, rotation: rotation });
      
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      
      // Calculate CSS scaling to fit container while maintaining aspect ratio
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.objectFit = 'contain';

      renderTask = pdfPage.render({
        canvasContext: context,
        viewport: viewport,
      });

      try {
        await renderTask.promise;
        // Output blob url for submitting to API
        canvas.toBlob((blob) => {
          if (blob) onRender(URL.createObjectURL(blob));
        }, 'image/png');
      } catch (err: any) {
        if (err.name !== 'RenderingCancelledException') {
          console.error("PDF Render error:", err);
        }
      }
    };

    renderPage();

    return () => {
      if (renderTask) renderTask.cancel();
    };
  }, [pdfPage, rotation, onRender]);

  return <canvas ref={canvasRef} className="max-w-full max-h-full" />;
}
