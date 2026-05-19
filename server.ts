/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import * as IFC from 'web-ifc';
import fs from 'fs';

const app = express();
const PORT = 3000;

// Multer setup for file uploads
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit to match proxy
});

// Store project data in-memory for this example (in real app, use Firestore)
const projects: Record<string, any> = {};

// Gemini AI setup
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Logger middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// IFC Parser Helper
async function parseIFC(buffer: Buffer) {
  console.log("Starting IFC parsing...");
  const ifcApi = new IFC.IfcAPI();
  try {
    await ifcApi.Init();
    console.log("IFC API initialized");
    
    const modelID = ifcApi.OpenModel(new Uint8Array(buffer));
    console.log(`Model opened with ID: ${modelID}`);
    
    const summary: any = {
      metadata: {},
      structure: {
        floors: [],
      },
      elements: {
        total: 0,
        types: {} as Record<string, number>,
      }
    };

    // Get Project
    const projectIds = ifcApi.GetLineIDsWithType(modelID, IFC.IFCPROJECT);
    if (projectIds.size() > 0) {
      const proj = ifcApi.GetLine(modelID, projectIds.get(0));
      summary.metadata = { name: proj.Name?.value, description: proj.Description?.value };
    }

    // Extract basic counts
    const allLines = ifcApi.GetAllLines(modelID);
    summary.elements.total = allLines.size();

    // Specific types we care about for the chatbot
    const typesToExtract = [
      { name: 'Walls', type: IFC.IFCWALL },
      { name: 'StandardWalls', type: IFC.IFCWALLSTANDARDCASE },
      { name: 'Doors', type: IFC.IFCDOOR },
      { name: 'Windows', type: IFC.IFCWINDOW },
      { name: 'Slabs', type: IFC.IFCSLAB },
      { name: 'Spaces', type: IFC.IFCSPACE },
      { name: 'Columns', type: IFC.IFCCOLUMN },
      { name: 'Beams', type: IFC.IFCBEAM },
    ];

    // Map element IDs to storeys
    const elementStoreyMap: Record<number, number> = {};
    const relContainedIds = ifcApi.GetLineIDsWithType(modelID, IFC.IFCRELCONTAINEDINSPATIALSTRUCTURE);
    for (let i = 0; i < relContainedIds.size(); i++) {
        const rel = ifcApi.GetLine(modelID, relContainedIds.get(i));
        const storeyId = rel.RelatingStructure?.value;
        if (storeyId && rel.RelatedElements) {
            for (const el of rel.RelatedElements) {
                elementStoreyMap[el.value] = storeyId;
            }
        }
    }

    const elementDetails: any[] = [];

    for (const t of typesToExtract) {
      try {
        const ids = ifcApi.GetLineIDsWithType(modelID, t.type);
        const count = ids.size();
        
        // Merge Wall counts for simplicity in summary
        const categoryName = (t.name === 'StandardWalls') ? 'Walls' : t.name;
        summary.elements.types[categoryName] = (summary.elements.types[categoryName] || 0) + count;
        
        // Extract basic placement for walls and spaces to improve 3D view
        if (t.name === 'Walls' || t.name === 'StandardWalls' || t.name === 'Spaces' || t.name === 'Windows' || t.name === 'Doors' || t.name === 'Columns') {
            for (let i = 0; i < Math.min(count, 50); i++) {
                const id = ids.get(i);
                const props = ifcApi.GetLine(modelID, id);
                
                elementDetails.push({
                    type: categoryName,
                    id,
                    name: props.Name?.value || `${t.name} ${id}`,
                    storeyId: elementStoreyMap[id]
                });
            }
        }
      } catch (e) {
        summary.elements.types[t.name] = 0;
      }
    }
    summary.elements.details = elementDetails;

    // Get Storeys (Floors) with better elevation extraction
    const storeyIds = ifcApi.GetLineIDsWithType(modelID, IFC.IFCBUILDINGSTOREY);
    for (let i = 0; i < storeyIds.size(); i++) {
        const id = storeyIds.get(i);
        const storey = ifcApi.GetLine(modelID, id);
        
        // Look for spaces contained in this storey
        summary.structure.floors.push({
            id,
            name: storey.Name?.value || `Floor ${i+1}`,
            elevation: typeof storey.Elevation?.value === 'number' ? storey.Elevation.value : i * 4,
            description: storey.Description?.value
        });
    }

    ifcApi.CloseModel(modelID);
    console.log("IFC parsing complete");
    return summary;
  } catch (err) {
    console.error("Critical error during IFC parsing:", err);
    return { error: "Failed to parse IFC file" };
  }
}

// API Routes
app.post('/api/projects/upload', upload.single('file'), async (req, res) => {
  console.log("Received upload request");
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const projectId = uuidv4();
    const summary = await parseIFC(req.file.buffer);

    if (summary.error) {
      return res.status(422).json({ error: summary.error });
    }

    projects[projectId] = {
      id: projectId,
      name: req.file.originalname,
      summary,
      uploadedAt: new Date().toISOString(),
      fileBuffer: req.file.buffer // Store buffer for the 3D viewer
    };

    console.log(`Project created: ${projectId}`);
    res.json({ projectId, name: req.file.originalname });
  } catch (error: any) {
    console.error("Upload route error:", error);
    res.status(500).json({ error: error.message || "Internal server error during upload" });
  }
});

app.get('/api/projects/:id', (req, res) => {
  const project = projects[req.params.id];
  if (!project) return res.status(404).json({ error: 'Project not found' });
  // Don't send the buffer in the summary
  const { fileBuffer, ...rest } = project;
  res.json(rest);
});

app.get('/api/projects/:id/file', (req, res) => {
  const project = projects[req.params.id];
  if (!project || !project.fileBuffer) return res.status(404).json({ error: 'File not found' });
  
  res.setHeader('Content-Disposition', `attachment; filename="${project.name}"`);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.send(project.fileBuffer);
});

app.post('/api/chat', async (req, res) => {
  const { projectId, message, history } = req.body;
  const project = projects[projectId];

  if (!project) {
     return res.status(404).json({ error: 'Project not found' });
  }

  const systemInstruction = `
    You are ConstructMind AI, an expert BIM and Construction assistant.
    The user has uploaded a building project: "${project.name}".
    
    Building Data Summary:
    ${JSON.stringify(project.summary, null, 2)}

    Your role:
    1. Answer questions about the building using the provided data.
    2. Be precise and professional.
    3. If data is missing (e.g. dimensions of a specific window), explain that while you know they exist, specific geometric details might be limited in the summary.
    4. Use construction terminology correctly.
    5. Be helpful and guide the user on how to use BuildAI.
  `;

  try {
    const chat = ai.chats.create({
      model: 'gemini-3-flash-preview',
      config: {
        systemInstruction,
      },
      history: history || [],
    });

    const response = await chat.sendMessage({ message });
    res.json({ text: response.text });
  } catch (error: any) {
    console.error('Gemini API error:', error);
    res.status(500).json({ error: 'Failed to generate response' });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Error handling middleware for Multer and other errors
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File size too large. Max 50MB.' });
      }
      return res.status(400).json({ error: `Upload error: ${err.message}` });
    }
    console.error('Unhandled server error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

startServer();
