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

// Helper function to parse SVG transform attributes (matrix, translate, scale)
function parseTransform(transformString) {
    const result = { translateX: 0, translateY: 0, scaleX: 1, scaleY: 1 };

    // Handle matrix(a, b, c, d, e, f) transforms
    // Matrix: | a c e |  where e,f are translation and a,d are scale (when b,c are 0)
    //         | b d f |
    const matrixMatch = /matrix\(\s*([^,\s]+)[\s,]+([^,\s]+)[\s,]+([^,\s]+)[\s,]+([^,\s]+)[\s,]+([^,\s]+)[\s,]+([^,\s]+)\s*\)/.exec(transformString);
    if (matrixMatch) {
        const a = parseFloat(matrixMatch[1]);
        const b = parseFloat(matrixMatch[2]);
        const c = parseFloat(matrixMatch[3]);
        const d = parseFloat(matrixMatch[4]);
        const e = parseFloat(matrixMatch[5]);
        const f = parseFloat(matrixMatch[6]);

        // Extract scale (works correctly when there's no rotation/skew, i.e., b=c=0)
        result.scaleX = Math.sqrt(a * a + b * b);
        result.scaleY = Math.sqrt(c * c + d * d);
        // Preserve sign of scale
        if (a < 0) result.scaleX = -result.scaleX;
        if (d < 0) result.scaleY = -result.scaleY;

        result.translateX = e;
        result.translateY = f;
        return result;
    }

    // Handle translate(x, y) transforms
    const translateMatch = /translate\(\s*([^,\s)]+)[\s,]*([^,\s)]*)?\s*\)/.exec(transformString);
    if (translateMatch) {
        result.translateX = parseFloat(translateMatch[1]) || 0;
        result.translateY = parseFloat(translateMatch[2]) || 0;
    }

    // Handle scale(sx, sy) transforms
    const scaleMatch = /scale\(\s*([^,\s)]+)[\s,]*([^,\s)]*)?\s*\)/.exec(transformString);
    if (scaleMatch) {
        result.scaleX = parseFloat(scaleMatch[1]) || 1;
        result.scaleY = parseFloat(scaleMatch[2]) || result.scaleX; // If sy not provided, use sx
    }

    return result;
}

// Helper function to apply non-uniform scaling to a makerjs model
function applyNonUniformScale(model, scaleX, scaleY) {
    // Scale all paths in the model
    if (model.paths) {
        for (const pathId in model.paths) {
            const path = model.paths[pathId];
            if (path.origin) {
                path.origin[0] *= scaleX;
                path.origin[1] *= scaleY;
            }
            if (path.type === 'line') {
                // Lines have origin and end
                if (path.end) {
                    path.end[0] *= scaleX;
                    path.end[1] *= scaleY;
                }
            } else if (path.type === 'arc') {
                // Arcs need radius scaled (use average for non-uniform)
                // This is an approximation - true non-uniform scaling of arcs is complex
                path.radius *= (scaleX + scaleY) / 2;
            } else if (path.type === 'circle') {
                path.radius *= (scaleX + scaleY) / 2;
            }
        }
    }
    // Recursively scale nested models
    if (model.models) {
        for (const modelId in model.models) {
            applyNonUniformScale(model.models[modelId], scaleX, scaleY);
        }
    }
    // Scale the model's own origin if it has one
    if (model.origin) {
        model.origin[0] *= scaleX;
        model.origin[1] *= scaleY;
    }
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
    let finalModel = model;

    // Check for and apply transformations from the SVG element
    const transform = $(element).attr('transform');
    if (transform) {
        const t = parseTransform(transform);

        // Apply scale first (before translation)
        // Note: makerjs only supports uniform scaling with a single number
        // For non-uniform scaling, we scale X and Y separately by manipulating paths
        if (t.scaleX !== 1 || t.scaleY !== 1) {
            if (Math.abs(t.scaleX - t.scaleY) / Math.max(t.scaleX, t.scaleY) < 0.1) {
                // Nearly uniform scaling - use average for best approximation
                const avgScale = (t.scaleX + t.scaleY) / 2;
                finalModel = makerjs.model.scale(finalModel, avgScale);
            } else {
                // Non-uniform scaling - apply to all points manually
                applyNonUniformScale(finalModel, t.scaleX, t.scaleY);
            }
        }

        // Apply translation
        // Note: Y translation is negated because makerjs inverts Y when importing SVG paths
        // (SVG Y increases downward, DXF/makerjs Y increases upward)
        if (t.translateX !== 0 || t.translateY !== 0) {
            finalModel = makerjs.model.move(finalModel, [t.translateX, -t.translateY]);
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
  
  $('path, polyline, polygon, text, tspan, rect, circle, ellipse').each(function() {
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

// Helper function to convert text to kebab-case
function toKebabCase(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

ipcMain.on('generate-files', async (event, { svgPath, bgImagePath, color, colorName }) => {
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
        const kebabBaseName = toKebabCase(baseName);
        const kebabBgBase = toKebabCase(bgBase);
        const kebabColorName = toKebabCase(colorName || 'custom');
        const mockupName = `${kebabBaseName}-${kebabBgBase}-${kebabColorName}-mockup.png`;
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
