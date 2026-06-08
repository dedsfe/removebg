import { useState, useCallback, useRef, useEffect } from 'react';
import { removeBackground } from '@imgly/background-removal';
import { UploadCloud, Loader2, Image as ImageIcon, Eraser, PenTool, RotateCcw, Hand, ZoomIn, ZoomOut, Maximize, Wand2, Undo, Trash2, Home, Plus } from 'lucide-react';
import './App.css';

const floodFillErase = (ctx, startX, startY, tolerancePercent) => {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  startX = Math.floor(startX);
  startY = Math.floor(startY);
  
  if (startX < 0 || startX >= w || startY < 0 || startY >= h) return;
  
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  
  const startIdx = (startY * w + startX) * 4;
  const sr = data[startIdx];
  const sg = data[startIdx+1];
  const sb = data[startIdx+2];
  const sa = data[startIdx+3];
  
  if (sa === 0) return; 
  
  const maxToleranceDistance = 250; 
  const tolerance = (tolerancePercent / 100) * maxToleranceDistance;
  const edgeSoftness = 30; 
  
  const stackX = new Int32Array(w * h);
  const stackY = new Int32Array(w * h);
  let stackPtr = 0;
  
  stackX[stackPtr] = startX;
  stackY[stackPtr] = startY;
  stackPtr++;
  
  const visited = new Uint8Array(w * h);
  
  while(stackPtr > 0) {
    stackPtr--;
    const x = stackX[stackPtr];
    const y = stackY[stackPtr];
    
    const linearIdx = y * w + x;
    if (visited[linearIdx] === 1) continue;
    visited[linearIdx] = 1;
    
    const idx = linearIdx * 4;
    const a = data[idx+3];
    if (a === 0) continue;
    
    const r = data[idx];
    const g = data[idx+1];
    const b = data[idx+2];
    
    const rDiff = r - sr;
    const gDiff = g - sg;
    const bDiff = b - sb;
    const dist = Math.sqrt(2 * rDiff * rDiff + 4 * gDiff * gDiff + 3 * bDiff * bDiff);
    
    if (dist <= tolerance) {
      data[idx+3] = 0; 
      
      if (x > 0 && visited[linearIdx - 1] === 0) { stackX[stackPtr] = x - 1; stackY[stackPtr] = y; stackPtr++; }
      if (x < w - 1 && visited[linearIdx + 1] === 0) { stackX[stackPtr] = x + 1; stackY[stackPtr] = y; stackPtr++; }
      if (y > 0 && visited[linearIdx - w] === 0) { stackX[stackPtr] = x; stackY[stackPtr] = y - 1; stackPtr++; }
      if (y < h - 1 && visited[linearIdx + w] === 0) { stackX[stackPtr] = x; stackY[stackPtr] = y + 1; stackPtr++; }
    } else if (dist <= tolerance + edgeSoftness) {
      const ratio = (dist - tolerance) / edgeSoftness; 
      data[idx+3] = Math.floor(data[idx+3] * ratio); 
    }
  }
  
  ctx.putImageData(imageData, 0, 0);
};

function App() {
  const [images, setImages] = useState([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [processingQueue, setProcessingQueue] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDraggingGlobal, setIsDraggingGlobal] = useState(false);
  
  const [brushMode, setBrushMode] = useState('erase');
  const [brushSize, setBrushSize] = useState(40);
  const [magicTolerance, setMagicTolerance] = useState(30);
  const [isDrawing, setIsDrawing] = useState(false);
  
  const [viewState, setViewState] = useState({ zoom: 1, panX: 0, panY: 0 });
  const [undoHistoryCount, setUndoHistoryCount] = useState(0);
  
  const fileInputRef = useRef(null);
  const canvasRef = useRef(null);
  const imgSourceRef = useRef(null);
  const imgProcessedRef = useRef(null);
  const lastPosRef = useRef(null);
  const viewportRef = useRef(null);
  const undoStackRef = useRef([]);

  const activeImage = images[activeIndex];

  const updateImageState = (id, updates) => {
    setImages(prev => prev.map(img => img.id === id ? { ...img, ...updates } : img));
  };

  const processImage = async (id) => {
    const imgData = images.find(img => img.id === id);
    if (!imgData) {
      setProcessingQueue(prev => prev.filter(qId => qId !== id));
      setIsProcessing(false);
      return;
    }

    setIsProcessing(true);
    updateImageState(id, { status: 'processing', progress: 0 });

    try {
      const blob = await removeBackground(imgData.file, {
        model: 'isnet',
        rescale: false,
        progress: (key, current, total) => {
          const percentage = Math.round((current / total) * 100);
          updateImageState(id, { progress: percentage, statusText: `Carregando: ${key}...` });
        }
      });
      const resultUrl = URL.createObjectURL(blob);
      updateImageState(id, { status: 'done', processedUrl: resultUrl, progress: 100 });
    } catch (error) {
      console.error(error);
      updateImageState(id, { status: 'error', statusText: 'Erro ao processar' });
    } finally {
      setIsProcessing(false);
      setProcessingQueue(prev => prev.filter(qId => qId !== id));
    }
  };

  useEffect(() => {
    if (!isProcessing && processingQueue.length > 0) {
      processImage(processingQueue[0]);
    }
  }, [processingQueue, isProcessing, images]);

  const handleFiles = (filesList) => {
    const newFiles = Array.from(filesList).filter(f => f.type.startsWith('image/'));
    const allowedNewFiles = newFiles.slice(0, 10 - images.length);
    
    if (allowedNewFiles.length === 0) {
      if (newFiles.length > 0) alert('Limite de 10 imagens atingido.');
      return;
    }

    const newImgs = allowedNewFiles.map(file => {
      const id = Math.random().toString(36).substring(7);
      return {
        id,
        file,
        name: file.name,
        originalUrl: URL.createObjectURL(file),
        processedUrl: null,
        currentCanvasState: null,
        status: 'queued',
        progress: 0,
        statusText: 'Aguardando fila...'
      };
    });

    setImages(prev => {
      const updated = [...prev, ...newImgs];
      if (prev.length === 0) {
        setActiveIndex(0);
      }
      return updated;
    });
    setProcessingQueue(prev => [...prev, ...newImgs.map(i => i.id)]);
  };

  const saveCurrentCanvasState = () => {
    if (activeIndex >= 0 && images[activeIndex]?.status === 'done' && canvasRef.current) {
      const dataUrl = canvasRef.current.toDataURL();
      updateImageState(images[activeIndex].id, { currentCanvasState: dataUrl });
    }
  };

  const switchTab = (index) => {
    if (index === activeIndex) return;
    saveCurrentCanvasState();
    setActiveIndex(index);
    undoStackRef.current = [];
    setUndoHistoryCount(0);
    setViewState({ zoom: 1, panX: 0, panY: 0 });
  };

  const clearAll = () => {
    setImages([]);
    setActiveIndex(-1);
    setProcessingQueue([]);
    setIsProcessing(false);
  };

  const initCanvas = useCallback(() => {
    if (!canvasRef.current || !imgProcessedRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    canvas.width = imgProcessedRef.current.width;
    canvas.height = imgProcessedRef.current.height;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(imgProcessedRef.current, 0, 0);
    undoStackRef.current = [];
    setUndoHistoryCount(0);
  }, []);

  useEffect(() => {
    if (!activeImage || activeImage.status !== 'done') return;

    const imgOrig = new Image();
    imgOrig.src = activeImage.originalUrl;
    imgOrig.onload = () => { imgSourceRef.current = imgOrig; };

    const imgToLoad = new Image();
    // Load from manual edits if it exists, else load AI output
    imgToLoad.src = activeImage.currentCanvasState || activeImage.processedUrl;
    imgToLoad.onload = () => {
      imgProcessedRef.current = imgToLoad;
      initCanvas();
    };
  }, [activeIndex, activeImage?.status]); // Re-run when tab switches or when image finishes processing

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const handleWheel = (e) => {
      e.preventDefault();
      setViewState(old => {
        let newZoom = old.zoom;
        if (e.deltaY < 0) newZoom = Math.min(old.zoom + 0.2, 8);
        else newZoom = Math.max(old.zoom - 0.2, 0.2);
        
        if (newZoom === old.zoom) return old;
        
        const rect = viewport.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const intrinsicX = (mouseX - old.panX) / old.zoom;
        const intrinsicY = (mouseY - old.panY) / old.zoom;
        
        return { zoom: newZoom, panX: mouseX - intrinsicX * newZoom, panY: mouseY - intrinsicY * newZoom };
      });
    };
    viewport.addEventListener('wheel', handleWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', handleWheel);
  }, [activeImage?.status]);

  // Global Drag and Drop
  useEffect(() => {
    const handleDragOver = (e) => { e.preventDefault(); setIsDraggingGlobal(true); };
    const handleDragLeave = (e) => { 
      e.preventDefault(); 
      if (e.relatedTarget === null) setIsDraggingGlobal(false); 
    };
    const handleDrop = (e) => {
      e.preventDefault();
      setIsDraggingGlobal(false);
      if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
    };

    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);
    return () => {
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, [images]);

  const saveUndoState = useCallback(() => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    const data = ctx.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height);
    undoStackRef.current.push(data);
    if (undoStackRef.current.length > 20) undoStackRef.current.shift();
    setUndoHistoryCount(undoStackRef.current.length);
  }, []);

  const handleUndo = useCallback(() => {
    if (undoStackRef.current.length === 0 || !canvasRef.current) return;
    const lastState = undoStackRef.current.pop();
    const ctx = canvasRef.current.getContext('2d');
    ctx.putImageData(lastState, 0, 0);
    setUndoHistoryCount(undoStackRef.current.length);
  }, []);

  const getCanvasCoords = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    let clientX = e.touches ? e.touches[0].clientX : e.clientX;
    let clientY = e.touches ? e.touches[0].clientY : e.clientY;

    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY, clientX, clientY };
  };

  const drawRestoreStroke = (from, to) => {
    if (!canvasRef.current || !imgSourceRef.current) return;
    const w = canvasRef.current.width;
    const h = canvasRef.current.height;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = w; tempCanvas.height = h;
    const tCtx = tempCanvas.getContext('2d');

    tCtx.lineCap = 'round'; tCtx.lineJoin = 'round'; tCtx.lineWidth = brushSize;
    tCtx.beginPath(); tCtx.moveTo(from.x, from.y); tCtx.lineTo(to.x, to.y); tCtx.stroke();

    tCtx.globalCompositeOperation = 'source-in';
    tCtx.drawImage(imgSourceRef.current, 0, 0, w, h);

    const mainCtx = canvasRef.current.getContext('2d');
    mainCtx.globalCompositeOperation = 'source-over';
    mainCtx.drawImage(tempCanvas, 0, 0);
  };

  const startInteraction = (e) => {
    setIsDrawing(true);
    const { x, y, clientX, clientY } = getCanvasCoords(e);
    if (brushMode === 'pan') { lastPosRef.current = { clientX, clientY }; return; }

    saveUndoState();
    lastPosRef.current = { x, y };

    if (brushMode === 'magic') {
      floodFillErase(canvasRef.current.getContext('2d'), x, y, magicTolerance);
      setIsDrawing(false);
      return;
    }

    if (brushMode === 'erase') {
      const ctx = canvasRef.current.getContext('2d');
      ctx.beginPath(); ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
      ctx.globalCompositeOperation = 'destination-out'; ctx.fill();
    } else {
      drawRestoreStroke({x, y}, {x, y});
    }
  };

  const doInteraction = (e) => {
    if (!isDrawing || !canvasRef.current) return;
    const { x, y, clientX, clientY } = getCanvasCoords(e);
    
    if (brushMode === 'pan') {
      const dx = clientX - lastPosRef.current.clientX;
      const dy = clientY - lastPosRef.current.clientY;
      setViewState(v => ({ ...v, panX: v.panX + dx, panY: v.panY + dy }));
      lastPosRef.current = { clientX, clientY };
      return;
    }
    
    if (brushMode === 'magic') return;

    if (brushMode === 'erase') {
      const ctx = canvasRef.current.getContext('2d');
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = brushSize;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath(); ctx.moveTo(lastPosRef.current.x, lastPosRef.current.y); ctx.lineTo(x, y); ctx.stroke();
    } else if (brushMode === 'restore') {
      drawRestoreStroke(lastPosRef.current, {x, y});
    }
    lastPosRef.current = { x, y };
  };

  const stopInteraction = () => { setIsDrawing(false); lastPosRef.current = null; };

  const handleDownload = () => {
    if (!canvasRef.current || !activeImage) return;
    const dataUrl = canvasRef.current.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `refinada-${activeImage.name}.png`;
    link.click();
  };

  const resetCanvas = () => {
    if (activeImage) {
      updateImageState(activeImage.id, { currentCanvasState: null });
      initCanvas();
    }
    setViewState({ zoom: 1, panX: 0, panY: 0 });
  };

  return (
    <div className={`container ${isDraggingGlobal ? 'global-dragging' : ''}`}>
      {isDraggingGlobal && (
        <div className="global-drop-overlay">
          <UploadCloud size={64} className="icon-pulse" />
          <h2>Solte as fotos em qualquer lugar!</h2>
        </div>
      )}
      
      <header>
        <h1>Removedor de Fundo IA</h1>
        <p>Arraste até 10 imagens e limpe o fundo de todas de uma vez.</p>
        
        {images.length > 0 && (
          <div className="header-actions">
            <button className="reset-btn action-btn" onClick={() => fileInputRef.current?.click()}>
              <Plus size={18} /> Adicionar
            </button>
            <button className="reset-btn action-btn" onClick={clearAll}>
              <Trash2 size={18} /> Limpar Tudo
            </button>
            <button className="reset-btn action-btn" onClick={clearAll} title="Início">
              <Home size={18} /> Início
            </button>
          </div>
        )}
      </header>

      <main>
        {images.length === 0 ? (
          <div 
            className="dropzone"
            onClick={() => fileInputRef.current?.click()}
          >
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={(e) => handleFiles(e.target.files)} 
              accept="image/*" 
              multiple
              style={{ display: 'none' }} 
            />
            <UploadCloud size={48} className="icon" />
            <p>Arraste e solte até 10 imagens aqui<br/>ou clique para selecionar</p>
          </div>
        ) : (
          <div className="workspace">
            {/* Tabs / Thumbnails */}
            <div className="tabs-container">
              {images.map((img, idx) => (
                <div 
                  key={img.id} 
                  className={`tab-item ${activeIndex === idx ? 'active' : ''} ${img.status}`}
                  onClick={() => switchTab(idx)}
                >
                  <div className="tab-thumb">
                    {img.status === 'done' ? (
                       <img src={img.processedUrl} alt="thumb" />
                    ) : (
                       <img src={img.originalUrl} alt="thumb" className="opacity-50" />
                    )}
                    {img.status === 'processing' && <Loader2 size={16} className="spinner tab-spinner" />}
                  </div>
                  <div className="tab-info">
                    <span className="tab-name">{img.name}</span>
                    {img.status === 'queued' && <span className="tab-status text-muted">Na fila</span>}
                    {img.status === 'processing' && <span className="tab-status text-accent">{img.progress}%</span>}
                    {img.status === 'done' && <span className="tab-status text-success">Concluído</span>}
                  </div>
                </div>
              ))}
            </div>

            {activeImage && (
              <div className="results-container">
                <div className="image-card">
                  <h3>Original</h3>
                  <div className="image-wrapper">
                    <img src={activeImage.originalUrl} alt="Original" />
                  </div>
                </div>

                <div className="image-card">
                  <div className="card-header">
                    <h3>Edição Manual</h3>
                    {activeImage.status === 'done' && (
                      <div className="toolbar">
                        <button className={`tool-btn ${brushMode === 'pan' ? 'active' : ''}`} onClick={() => setBrushMode('pan')} title="Mover Imagem"><Hand size={18} /></button>
                        <button className={`tool-btn ${brushMode === 'magic' ? 'active' : ''}`} onClick={() => setBrushMode('magic')} title="Varinha: Apagar por cor"><Wand2 size={18} /> Varinha</button>
                        <button className={`tool-btn ${brushMode === 'erase' ? 'active' : ''}`} onClick={() => setBrushMode('erase')} title="Apagar fundo"><Eraser size={18} /> Apagar</button>
                        <button className={`tool-btn ${brushMode === 'restore' ? 'active' : ''}`} onClick={() => setBrushMode('restore')} title="Restaurar parte"><PenTool size={18} /> Restaurar</button>
                        
                        {brushMode === 'magic' ? (
                          <div className="slider-wrapper">
                            <label>Tol:</label>
                            <input type="range" min="0" max="100" value={magicTolerance} onChange={(e) => setMagicTolerance(parseInt(e.target.value))} style={{ width: '60px' }}/>
                          </div>
                        ) : (
                          <div className="slider-wrapper">
                            <label>Tam:</label>
                            <input type="range" min="5" max="200" value={brushSize} onChange={(e) => setBrushSize(parseInt(e.target.value))} style={{ width: '60px' }}/>
                          </div>
                        )}
                        
                        <div className="zoom-controls">
                          <button className="tool-btn-icon" onClick={() => setViewState(v => ({...v, zoom: Math.max(v.zoom - 0.2, 0.2)}))}><ZoomOut size={16} /></button>
                          <span className="zoom-label">{Math.round(viewState.zoom * 100)}%</span>
                          <button className="tool-btn-icon" onClick={() => setViewState(v => ({...v, zoom: Math.min(v.zoom + 0.2, 8)}))}><ZoomIn size={16} /></button>
                          <button className="tool-btn-icon" onClick={() => setViewState({zoom:1, panX:0, panY:0})}><Maximize size={16} /></button>
                        </div>

                        <button className="tool-btn-icon" onClick={handleUndo} disabled={undoHistoryCount === 0} style={{ opacity: undoHistoryCount === 0 ? 0.3 : 1, marginLeft: 'auto' }}><Undo size={18} /></button>
                        <button className="tool-btn-icon" onClick={resetCanvas} title="Limpar edições manuais"><RotateCcw size={18} /></button>
                      </div>
                    )}
                  </div>
                  
                  <div className="image-wrapper checkerboard" ref={viewportRef} style={{ overflow: 'hidden' }}>
                    {activeImage.status === 'processing' || activeImage.status === 'queued' ? (
                      <div className="processing-state">
                        <Loader2 size={48} className="spinner" />
                        <p className="status-text">{activeImage.statusText}</p>
                        {activeImage.progress > 0 && activeImage.progress <= 100 && (
                          <div className="progress-bar">
                            <div className="progress-fill" style={{ width: `${activeImage.progress}%` }}></div>
                          </div>
                        )}
                      </div>
                    ) : activeImage.status === 'done' ? (
                      <canvas 
                        ref={canvasRef}
                        className={`editor-canvas cursor-${brushMode} ${isDrawing && brushMode === 'pan' ? 'grabbing' : ''}`}
                        style={{
                          transform: `translate(${viewState.panX}px, ${viewState.panY}px) scale(${viewState.zoom})`,
                          transformOrigin: '0 0',
                          transition: isDrawing ? 'none' : 'transform 0.05s linear'
                        }}
                        onMouseDown={startInteraction}
                        onMouseMove={doInteraction}
                        onMouseUp={stopInteraction}
                        onMouseLeave={stopInteraction}
                        onTouchStart={startInteraction}
                        onTouchMove={doInteraction}
                        onTouchEnd={stopInteraction}
                        onTouchCancel={stopInteraction}
                      />
                    ) : (
                      <div className="empty-state">
                        <ImageIcon size={48} className="icon-muted" />
                      </div>
                    )}
                  </div>
                  {activeImage.status === 'done' && (
                    <button onClick={handleDownload} className="download-btn">
                      Baixar {activeImage.name}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
      {/* Hidden file input for header Add button */}
      <input type="file" ref={fileInputRef} onChange={(e) => handleFiles(e.target.files)} accept="image/*" multiple style={{ display: 'none' }} />
    </div>
  );
}

export default App;
