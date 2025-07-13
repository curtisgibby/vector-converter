import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

// ES Module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;

app.use(express.json({ limit: '50mb' })); // Increase payload limit for large SVGs

app.post('/convert', async (req, res) => {
    try {
        const { svgContent, outputDir, baseName } = req.body;

        if (!svgContent || !outputDir || !baseName) {
            return res.status(400).json({ error: 'Missing required parameters.' });
        }

        const aspose = await import('aspose-cad');
        const outputPath = path.join(outputDir, `${baseName}.dxf`);

        // Aspose needs to load from a buffer, not a path, when dealing with content directly
        const svgBuffer = Buffer.from(svgContent, 'utf-8');
        const image = await aspose.Image.load(svgBuffer);
        
        const options = new aspose.cad.imageoptions.DxfOptions();
        await image.save(outputPath, options);

        res.json({ message: 'Conversion successful.', outputPath });
    } catch (error) {
        console.error('[Conversion Server] Conversion failed:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/shutdown', (req, res) => {
    res.json({ message: 'Server shutting down.' });
    server.close(() => {
        console.log('[Conversion Server] Server has been shut down.');
        process.exit(0);
    });
});

const server = app.listen(port, () => {
    console.log(`[Conversion Server] Listening on port ${port}`);
});
