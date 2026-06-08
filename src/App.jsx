import { useState, useCallback, useRef, useEffect } from 'react';
import { removeBackground } from '@imgly/background-removal';
import { UploadCloud, Loader2, Image as ImageIcon, Eraser, PenTool, RotateCcw, Hand, ZoomIn, ZoomOut, Maximize, Wand2, Undo } from 'lucide-react';
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
  
  if (sa === 0) return; // Pixel original já está transparente
  
  // A distância perceptiva máxima é aprox sqrt(9 * 255^2) = 765
  // Reduzimos drasticamente a escala para que "100" no slider seja usável.
  const maxToleranceDistance = 250; 
  const tolerance = (tolerancePercent / 100) * maxToleranceDistance;
  
  // Zona de suavização (Feathering) em pixels matemáticos de cor
  // Define o quão "fino" é o degradê de transparência nas bordas da varinha
  const edgeSoftness = 30; 
  
  const stackX = new Int32Array(w * h);
  const stackY = new Int32Array(w * h);
  let stackPtr = 0;
  
  stackX[stackPtr] = startX;
  stackY[stackPtr] = startY;
  stackPtr++;
  
  // 0 = não visitado, 1 = visitado e apagado
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
    
    // Distância Perceptiva: Dá mais peso pro verde (4) e vermelho (2)
    // Isso simula como os olhos humanos e câmeras notam diferença de cores e sombras.
    const rDiff = r - sr;
    const gDiff = g - sg;
    const bDiff = b - sb;
    const dist = Math.sqrt(2 * rDiff * rDiff + 4 * gDiff * gDiff + 3 * bDiff * bDiff);
    
    if (dist <= tolerance) {
      data[idx+3] = 0; // Apaga 100%
      
      // Empilha os vizinhos
      if (x > 0 && visited[linearIdx - 1] === 0) {
        stackX[stackPtr] = x - 1; stackY[stackPtr] = y; stackPtr++;
      }
      if (x < w - 1 && visited[linearIdx + 1] === 0) {
        stackX[stackPtr] = x + 1; stackY[stackPtr] = y; stackPtr++;
      }
      if (y > 0 && visited[linearIdx - w] === 0) {
        stackX[stackPtr] = x; stackY[stackPtr] = y - 1; stackPtr++;
      }
      if (y < h - 1 && visited[linearIdx + w] === 0) {
        stackX[stackPtr] = x; stackY[stackPtr] = y + 1; stackPtr++;
      }
    } else if (dist <= tolerance + edgeSoftness) {
      // Borda Suave: Caiu fora da tolerância, mas ainda tá perto.
      // Vamos criar um degradê de transparência pra mesclar com o fundo!
      const ratio = (dist - tolerance) / edgeSoftness; // ratio vai de 0.0 (perto da tolerância) a 1.0 (longe)
      data[idx+3] = Math.floor(data[idx+3] * ratio); // Multiplica a opacidade atual pelo ratio (quanto mais perto, mais transparente)
    }
  }
  
  ctx.putImageData(imageData, 0, 0);
};

function App() {
  const [originalImage, setOriginalImage] = useState(null);
  const [processedImage, setProcessedImage] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  
  const [brushMode, setBrushMode] = useState('erase'); // 'erase' | 'restore' | 'pan' | 'magic'
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

  const saveState = useCallback(() => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    const data = ctx.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height);
    undoStackRef.current.push(data);
    if (undoStackRef.current.length > 20) {
      undoStackRef.current.shift();
    }
    setUndoHistoryCount(undoStackRef.current.length);
  }, []);

  const handleUndo = useCallback(() => {
    if (undoStackRef.current.length === 0 || !canvasRef.current) return;
    const lastState = undoStackRef.current.pop();
    const ctx = canvasRef.current.getContext('2d');
    ctx.putImageData(lastState, 0, 0);
    setUndoHistoryCount(undoStackRef.current.length);
  }, []);

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
    if (processedImage && originalImage) {
      const imgOrig = new Image();
      imgOrig.src = originalImage;
      imgOrig.onload = () => { imgSourceRef.current = imgOrig; };

      const imgProc = new Image();
      imgProc.src = processedImage;
      imgProc.onload = () => {
        imgProcessedRef.current = imgProc;
        initCanvas();
      };
    }
  }, [processedImage, originalImage, initCanvas]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const handleWheel = (e) => {
      e.preventDefault();
      
      setViewState(old => {
        let newZoom = old.zoom;
        if (e.deltaY < 0) {
          newZoom = Math.min(old.zoom + 0.2, 8);
        } else {
          newZoom = Math.max(old.zoom - 0.2, 0.2);
        }
        
        if (newZoom === old.zoom) return old;
        
        const rect = viewport.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        const intrinsicX = (mouseX - old.panX) / old.zoom;
        const intrinsicY = (mouseY - old.panY) / old.zoom;
        
        const newPanX = mouseX - intrinsicX * newZoom;
        const newPanY = mouseY - intrinsicY * newZoom;
        
        return { zoom: newZoom, panX: newPanX, panY: newPanY };
      });
    };
    viewport.addEventListener('wheel', handleWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', handleWheel);
  }, [processedImage]);

  const processFile = async (file) => {
    if (!file || !file.type.startsWith('image/')) {
      alert('Por favor, selecione uma imagem válida.');
      return;
    }

    setProcessedImage(null);
    setProgress(0);
    setStatusText('Iniciando processamento...');
    setIsProcessing(true);
    setViewState({ zoom: 1, panX: 0, panY: 0 });
    setBrushMode('erase');

    const objectUrl = URL.createObjectURL(file);
    setOriginalImage(objectUrl);

    try {
      const blob = await removeBackground(file, {
        model: 'isnet',
        rescale: false,
        progress: (key, current, total) => {
          setStatusText(`Carregando: ${key}...`);
          const percentage = Math.round((current / total) * 100);
          setProgress(percentage);
        }
      });
      
      setStatusText('Processamento concluído!');
      const resultUrl = URL.createObjectURL(blob);
      setProcessedImage(resultUrl);
    } catch (error) {
      console.error(error);
      setStatusText('Erro ao processar imagem.');
      alert('Ocorreu um erro ao remover o fundo da imagem.');
    } finally {
      setIsProcessing(false);
    }
  };

  const getCanvasCoords = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    let clientX, clientY;
    if (e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;
    return { x, y, clientX, clientY };
  };

  const drawRestoreStroke = (from, to) => {
    if (!canvasRef.current || !imgSourceRef.current) return;
    const w = canvasRef.current.width;
    const h = canvasRef.current.height;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = w;
    tempCanvas.height = h;
    const tCtx = tempCanvas.getContext('2d');

    tCtx.lineCap = 'round';
    tCtx.lineJoin = 'round';
    tCtx.lineWidth = brushSize;
    tCtx.beginPath();
    tCtx.moveTo(from.x, from.y);
    tCtx.lineTo(to.x, to.y);
    tCtx.stroke();

    tCtx.globalCompositeOperation = 'source-in';
    tCtx.drawImage(imgSourceRef.current, 0, 0, w, h);

    const mainCtx = canvasRef.current.getContext('2d');
    mainCtx.globalCompositeOperation = 'source-over';
    mainCtx.drawImage(tempCanvas, 0, 0);
  };

  const startInteraction = (e) => {
    setIsDrawing(true);
    const { x, y, clientX, clientY } = getCanvasCoords(e);
    
    if (brushMode === 'pan') {
      lastPosRef.current = { clientX, clientY };
      return;
    }

    // Drawing or Magic wand -> save state for Undo
    saveState();
    lastPosRef.current = { x, y };

    if (brushMode === 'magic') {
      const ctx = canvasRef.current.getContext('2d');
      floodFillErase(ctx, x, y, magicTolerance);
      setIsDrawing(false); // Magic wand is a single click
      return;
    }

    if (brushMode === 'erase') {
      const ctx = canvasRef.current.getContext('2d');
      ctx.beginPath();
      ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fill();
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
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = brushSize;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.moveTo(lastPosRef.current.x, lastPosRef.current.y);
      ctx.lineTo(x, y);
      ctx.stroke();
    } else if (brushMode === 'restore') {
      drawRestoreStroke(lastPosRef.current, {x, y});
    }
    
    lastPosRef.current = { x, y };
  };

  const stopInteraction = () => {
    setIsDrawing(false);
    lastPosRef.current = null;
  };

  const handleDownload = () => {
    if (!canvasRef.current) return;
    const dataUrl = canvasRef.current.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = 'imagem-refinada.png';
    link.click();
  };

  const resetCanvas = () => {
    initCanvas();
    setViewState({ zoom: 1, panX: 0, panY: 0 });
  };

  // Drag handles
  const onDragOver = useCallback((e) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);
  const onDragLeave = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);
  const onDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFile(e.dataTransfer.files[0]);
    }
  }, []);
  const onFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      processFile(e.target.files[0]);
    }
  };

  return (
    <div className="container">
      <header>
        <h1>Removedor de Fundo IA</h1>
        <p>Arraste uma imagem para remover o fundo automaticamente no seu navegador.</p>
      </header>

      <main>
        {!originalImage && (
          <div 
            className={`dropzone ${isDragging ? 'dragging' : ''}`}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={onFileChange} 
              accept="image/*" 
              style={{ display: 'none' }} 
            />
            <UploadCloud size={48} className="icon" />
            <p>Arraste e solte uma imagem aqui<br/>ou clique para selecionar</p>
          </div>
        )}

        {originalImage && (
          <div className="results-container">
            <div className="image-card">
              <h3>Original</h3>
              <div className="image-wrapper">
                <img src={originalImage} alt="Original" />
              </div>
            </div>

            <div className="image-card">
              <div className="card-header">
                <h3>Edição Manual</h3>
                {processedImage && (
                  <div className="toolbar">
                    <button 
                      className={`tool-btn ${brushMode === 'pan' ? 'active' : ''}`}
                      onClick={() => setBrushMode('pan')}
                      title="Mover Imagem"
                    >
                      <Hand size={18} />
                    </button>
                    <button 
                      className={`tool-btn ${brushMode === 'magic' ? 'active' : ''}`}
                      onClick={() => setBrushMode('magic')}
                      title="Varinha: Apagar por cor"
                    >
                      <Wand2 size={18} /> Varinha
                    </button>
                    <button 
                      className={`tool-btn ${brushMode === 'erase' ? 'active' : ''}`}
                      onClick={() => setBrushMode('erase')}
                      title="Apagar fundo que sobrou"
                    >
                      <Eraser size={18} /> Apagar
                    </button>
                    <button 
                      className={`tool-btn ${brushMode === 'restore' ? 'active' : ''}`}
                      onClick={() => setBrushMode('restore')}
                      title="Restaurar parte da imagem"
                    >
                      <PenTool size={18} /> Restaurar
                    </button>
                    
                    {brushMode === 'magic' ? (
                      <div className="slider-wrapper">
                        <label title="Tolerância de cor">Tol:</label>
                        <input 
                          type="range" 
                          min="0" 
                          max="100" 
                          value={magicTolerance} 
                          onChange={(e) => setMagicTolerance(parseInt(e.target.value))} 
                          style={{ width: '60px' }}
                        />
                      </div>
                    ) : (
                      <div className="slider-wrapper">
                        <label title="Tamanho do pincel">Tam:</label>
                        <input 
                          type="range" 
                          min="5" 
                          max="200" 
                          value={brushSize} 
                          onChange={(e) => setBrushSize(parseInt(e.target.value))} 
                          style={{ width: '60px' }}
                        />
                      </div>
                    )}
                    
                    <div className="zoom-controls">
                      <button className="tool-btn-icon" onClick={() => setViewState(v => ({...v, zoom: Math.max(v.zoom - 0.2, 0.2)}))} title="Menos Zoom"><ZoomOut size={16} /></button>
                      <span className="zoom-label">{Math.round(viewState.zoom * 100)}%</span>
                      <button className="tool-btn-icon" onClick={() => setViewState(v => ({...v, zoom: Math.min(v.zoom + 0.2, 8)}))} title="Mais Zoom"><ZoomIn size={16} /></button>
                      <button className="tool-btn-icon" onClick={() => setViewState({zoom:1, panX:0, panY:0})} title="Centralizar"><Maximize size={16} /></button>
                    </div>

                    <button 
                      className="tool-btn-icon" 
                      onClick={handleUndo} 
                      title="Desfazer"
                      disabled={undoHistoryCount === 0}
                      style={{ opacity: undoHistoryCount === 0 ? 0.3 : 1, marginLeft: 'auto' }}
                    >
                      <Undo size={18} />
                    </button>

                    <button className="tool-btn-icon" onClick={resetCanvas} title="Limpar todas edições">
                      <RotateCcw size={18} />
                    </button>
                  </div>
                )}
              </div>
              
              <div className="image-wrapper checkerboard" ref={viewportRef} style={{ overflow: 'hidden' }}>
                {isProcessing ? (
                  <div className="processing-state">
                    <Loader2 size={48} className="spinner" />
                    <p className="status-text">{statusText}</p>
                    {progress > 0 && progress <= 100 && (
                      <div className="progress-bar">
                        <div className="progress-fill" style={{ width: `${progress}%` }}></div>
                      </div>
                    )}
                  </div>
                ) : processedImage ? (
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
              {processedImage && (
                <button onClick={handleDownload} className="download-btn">
                  Baixar Imagem Final
                </button>
              )}
            </div>
          </div>
        )}

        {originalImage && !isProcessing && (
          <button 
            className="reset-btn" 
            onClick={() => {
              setOriginalImage(null);
              setProcessedImage(null);
            }}
          >
            Nova Imagem
          </button>
        )}
      </main>
    </div>
  );
}

export default App;
