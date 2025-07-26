const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const sharp = require('sharp');
const cheerio = require('cheerio');
const makerjs = require('makerjs');

function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// --- IPC Handlers ---

ipcMain.handle('open-file-dialog', async (event, options) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(options);
  if (canceled || !filePaths || filePaths.length === 0) return null;
  return filePaths[0];
});

ipcMain.handle('open-external-link', (event, url) => {
  shell.openExternal(url);
});

// Helper function to parse the SVG transform attribute for translations
function parseTransform(transformString) {
    const translateMatch = /translate\(([^,)]+),?\s*([^,)]+)?\)/.exec(transformString);
    if (translateMatch) {
        const x = parseFloat(translateMatch[1]) || 0;
        const y = parseFloat(translateMatch[2]) || 0;
        return { x, y };
    }
    return { x: 0, y: 0 };
}

async function createDxf(svgPath, outputDir, baseName) {
  // Create DXF whose model height equals the SVG's declared physical height (if any)
  // and mark the units as inches via $INSUNITS header.
  const outputPath = path.join(outputDir, `${baseName}.dxf`);
  const svgContent = await fs.readFile(svgPath, 'utf-8');

  const $ = cheerio.load(svgContent, { xmlMode: true });

  const combinedModel = { models: {} };

  // Helper: get nominal SVG height in millimetres.
  // Priority: explicit mm -> use; explicit in -> convert; otherwise viewBox height as mm (assumption).
  function getNominalHeightMm($svgRoot) {
    const hAttr = $svgRoot.attr('height');
    if (hAttr) {
      if (/mm$/i.test(hAttr)) return parseFloat(hAttr);
      if (/in$/i.test(hAttr)) return parseFloat(hAttr) * 25.4;
    }
    const wAttr = $svgRoot.attr('width');
    if (wAttr) {
      if (/mm$/i.test(wAttr)) return parseFloat(wAttr);
      if (/in$/i.test(wAttr)) return parseFloat(wAttr) * 25.4;
    }
    // Fallback to viewBox
    const vb = $svgRoot.attr('viewBox');
    if (vb) {
      const parts = vb.trim().split(/\s+/);
      if (parts.length === 4) return parseFloat(parts[3]); // height component
    }
    return null;
  }

  let i = 0;

  const processElement = (element, model) => {
    // Mirror the model on the Y-axis to correct for SVG coordinate system
    // Mirror the model on the X-axis to correct for SVG's inverted Y coordinate system
    let finalModel = makerjs.model.mirror(model, false, false);

    // Check for and apply transformations from the SVG element
    const transform = $(element).attr('transform');
    if (transform) {
        const translation = parseTransform(transform);
        if (translation.x !== 0 || translation.y !== 0) {
            finalModel = makerjs.model.move(finalModel, [translation.x, translation.y]);
        }
    }
    
    combinedModel.models[`shape${i++}`] = finalModel;
  };

  $('path, polyline, polygon').each((index, element) => {
    const $element = $(element);
    if (element.tagName === 'path') {
      const pathData = $element.attr('d');
      if (pathData) processElement(element, makerjs.importer.fromSVGPathData(pathData));
    } else if (element.tagName === 'polyline') {
      const pointsData = $element.attr('points');
      if (pointsData) processElement(element, new makerjs.models.ConnectTheDots(false, pointsData));
    } else if (element.tagName === 'polygon') {
      const pointsData = $element.attr('points');
      if (pointsData) processElement(element, new makerjs.models.ConnectTheDots(true, pointsData));
    }
  });

  // --- Scale model if SVG declares an inch-based height ---
  const $svgRoot = $('svg');
  const targetHeightMm = getNominalHeightMm($svgRoot);
  if (targetHeightMm) {
    const ext = makerjs.measure.modelExtents(combinedModel);
    const currentHeight = ext.high[1] - ext.low[1];
    if (currentHeight > 0) {
      const scale = targetHeightMm / currentHeight;
      makerjs.model.scale(combinedModel, scale);
    }
  }

  let dxf = makerjs.exporter.toDXF(combinedModel);

  // --- Inject $INSUNITS header to signal millimetres (4) if targetHeightMm detected ---
  if (targetHeightMm) {
    // Insert INSUNITS just before the ENDSEC following HEADER section
    dxf = dxf.replace(/(2\nHEADER[\s\S]*?)0\nENDSEC/, (match) => {
      return match.replace('0\nENDSEC', '  9\n$INSUNITS\n 70\n     4\n0\nENDSEC');
    });
  }

  await fs.writeFile(outputPath, dxf);
}

function colorizeSvg(svgContent, color) {
  const $ = cheerio.load(svgContent, { xmlMode: true });
  
  $('path, polyline, polygon').each(function() {
    const $el = $(this);
    
    // Set the fill attribute
    $el.attr('fill', color);
    
    // Handle style attribute if it exists
    const styleAttr = $el.attr('style');
    if (styleAttr) {
      // Replace any existing fill declaration in the style attribute
      const newStyle = styleAttr.replace(/fill:\s*[^;]+/gi, `fill:${color}`);
      // If no fill was found in style, add it
      if (!styleAttr.match(/fill:/i)) {
        $el.attr('style', `${styleAttr};fill:${color}`);
      } else {
        $el.attr('style', newStyle);
      }
    }
  });
  
  return $.html();
}

ipcMain.on('generate-files', async (event, { svgPath, bgImagePath, color }) => {
  try {
    if (!svgPath) throw new Error('SVG path is missing.');

    const outputDir = app.getPath('downloads');
    await fs.mkdir(outputDir, { recursive: true });
    const baseName = path.basename(svgPath, '.svg');
    const svgContent = await fs.readFile(svgPath, 'utf-8');

    // 1. Create DXF
    await createDxf(svgPath, outputDir, baseName);

    // 2. Create black and white raster image
    const whiteSvg = colorizeSvg(svgContent, 'white');
    await sharp(Buffer.from(whiteSvg))
      .flatten({ background: '#000000' })
      .toFile(path.join(outputDir, `${baseName}_bw.png`));

    // 3. Create composite image
    if (bgImagePath) {
      const coloredSvg = colorizeSvg(svgContent, color);

      // --- Scale overlay so that its physical size matches the background's scale ---
      let overlayBuffer;
      try {
        // Expect something like "_10in" in the background filename → width in inches of the photo
        const bgInchMatch = /([0-9]+(?:\.[0-9]+)?)\s*(?:in|inch|inches)/i.exec(path.basename(bgImagePath));
        if (bgInchMatch) {
          const bgWidthIn = parseFloat(bgInchMatch[1]);
          // Pixel width of the background photo
          const bgMeta = await sharp(bgImagePath).metadata();
          if (bgMeta.width && bgWidthIn > 0) {
            const pxPerInch = bgMeta.width / bgWidthIn;

            // Determine the physical width of the SVG (inches)
            const $root = cheerio.load(svgContent, { xmlMode: true })('svg');
            let svgWidthIn = null;
            const widthAttr = $root.attr('width');
            if (widthAttr && /in$/i.test(widthAttr)) {
              svgWidthIn = parseFloat(widthAttr);
            } else if ($root.attr('viewBox')) {
              // Fall-back: viewBox width – assume 1 SVG unit == 1 inch
              const vbParts = $root.attr('viewBox').trim().split(/\s+/);
              if (vbParts.length === 4) svgWidthIn = parseFloat(vbParts[2]);
            }

            if (svgWidthIn && svgWidthIn > 0) {
              let desiredPx = Math.round(svgWidthIn * pxPerInch);
              // Ensure overlay not larger than background to avoid Sharp errors
              if (desiredPx > bgMeta.width) {
                desiredPx = bgMeta.width;
              }
              overlayBuffer = await sharp(Buffer.from(coloredSvg)).resize({ width: desiredPx }).png().toBuffer();
            }
          }
        }
      } catch (scaleErr) {
        console.warn('Overlay scaling failed; using original size', scaleErr);
      }
      if (!overlayBuffer) {
        overlayBuffer = await sharp(Buffer.from(coloredSvg)).png().toBuffer();
      }

      await sharp(bgImagePath)
        .composite([{ input: overlayBuffer, gravity: 'center' }])
                const bgBase = path.basename(bgImagePath, path.extname(bgImagePath));
        const mockupName = `${baseName}_on_${bgBase}_mockup.png`;
        await sharp(bgImagePath)
          .composite([{ input: overlayBuffer, gravity: 'center' }])
          .toFile(path.join(outputDir, mockupName));
    }

    event.sender.send('generation-complete', 'Files generated successfully!');
  } catch (error) {
    console.error('File generation failed:', error);
    event.sender.send('generation-complete', `Error: ${error.message}`);
  }
});
