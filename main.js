const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const sharp = require('sharp');
const cheerio = require('cheerio');
const makerjs = require('makerjs');
const { transformPath, pathToString } = require('svg-path-commander');

// Parse SVG transform attribute into svg-path-commander format
function parseSvgTransform(transformStr) {
  const result = {};

  // Match scale(x, y) or scale(x)
  const scaleMatch = /scale\s*\(\s*([0-9.e+-]+)(?:\s*,\s*([0-9.e+-]+))?\s*\)/i.exec(transformStr);
  if (scaleMatch) {
    const sx = parseFloat(scaleMatch[1]);
    const sy = scaleMatch[2] ? parseFloat(scaleMatch[2]) : sx;
    result.scale = [sx, sy];
  }

  // Match translate(x, y) or translate(x)
  const translateMatch = /translate\s*\(\s*([0-9.e+-]+)(?:\s*,\s*([0-9.e+-]+))?\s*\)/i.exec(transformStr);
  if (translateMatch) {
    const tx = parseFloat(translateMatch[1]);
    const ty = translateMatch[2] ? parseFloat(translateMatch[2]) : 0;
    result.translate = [tx, ty];
  }

  // Match rotate(angle) or rotate(angle, cx, cy)
  const rotateMatch = /rotate\s*\(\s*([0-9.e+-]+)(?:\s*,\s*([0-9.e+-]+)\s*,\s*([0-9.e+-]+))?\s*\)/i.exec(transformStr);
  if (rotateMatch) {
    result.rotate = parseFloat(rotateMatch[1]);
    if (rotateMatch[2] && rotateMatch[3]) {
      result.origin = [parseFloat(rotateMatch[2]), parseFloat(rotateMatch[3])];
    }
  }

  // Match matrix(a, b, c, d, e, f)
  const matrixMatch = /matrix\s*\(\s*([0-9.e+-]+)\s*,\s*([0-9.e+-]+)\s*,\s*([0-9.e+-]+)\s*,\s*([0-9.e+-]+)\s*,\s*([0-9.e+-]+)\s*,\s*([0-9.e+-]+)\s*\)/i.exec(transformStr);
  if (matrixMatch) {
    // For matrix, we need to decompose or apply directly
    // svg-path-commander doesn't have direct matrix support via object, so we use scale + translate approximation
    // This is a simplification - full matrix support would need more work
    const a = parseFloat(matrixMatch[1]);
    const d = parseFloat(matrixMatch[4]);
    const e = parseFloat(matrixMatch[5]);
    const f = parseFloat(matrixMatch[6]);
    result.scale = [a, d];
    result.translate = [e, f];
  }

  return Object.keys(result).length > 0 ? result : null;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 700,
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

ipcMain.handle('open-file-dialog', async (_, options) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(options);
  if (canceled || !filePaths || filePaths.length === 0) return null;
  return filePaths[0];
});

ipcMain.handle('open-external-link', (_, url) => {
  shell.openExternal(url);
});

async function createDxf(svgPath, outputDir, baseName) {
  // Create DXF with dimensions matching the SVG's declared physical size.
  // Uses svg-path-commander to apply transforms and makerjs for DXF export.
  const outputPath = path.join(outputDir, `${baseName}.dxf`);
  const svgContent = await fs.readFile(svgPath, 'utf-8');

  // Parse SVG
  const $ = cheerio.load(svgContent, { xmlMode: true });
  const $svgRoot = $('svg');

  // Calculate scale factor from SVG declared dimensions vs viewBox
  const scaleToInches = getSvgScaleToInches($svgRoot);

  // Collect all paths with their transforms applied
  const allPaths = [];

  $('path').each(function () {
    const $el = $(this);
    const d = $el.attr('d');
    if (!d) return;

    // Get transform attribute
    const transform = $el.attr('transform');

    // Apply transform to path data using svg-path-commander
    let transformedD = d;
    if (transform) {
      try {
        const transformObj = parseSvgTransform(transform);
        if (transformObj) {
          const transformed = transformPath(d, transformObj);
          transformedD = pathToString(transformed);
        }
      } catch (err) {
        console.warn('Failed to apply transform to path:', err.message);
      }
    }

    allPaths.push(transformedD);
  });

  // Convert paths to makerjs model
  const models = {};
  allPaths.forEach((pathD, index) => {
    try {
      const pathModel = makerjs.importer.fromSVGPathData(pathD);
      models[`path_${index}`] = pathModel;
    } catch (err) {
      console.warn(`Failed to import path ${index}:`, err.message);
    }
  });

  const combinedModel = { models };

  // Scale model to inches
  if (scaleToInches && scaleToInches !== 1) {
    makerjs.model.scale(combinedModel, scaleToInches);
  }

  // Flip Y axis (SVG Y-down to DXF Y-up)
  makerjs.model.scale(combinedModel, 1, { scaleY: -1 });

  // Export to DXF
  const dxf = makerjs.exporter.toDXF(combinedModel, { units: 'inch' });

  await fs.writeFile(outputPath, dxf);
}

// Helper: calculate scale factor from SVG declared dimensions vs viewBox (to inches).
function getSvgScaleToInches($svgRoot) {
  const vb = $svgRoot.attr('viewBox');
  if (!vb) return 1;

  const parts = vb.trim().split(/\s+/);
  if (parts.length !== 4) return 1;

  const vbWidth = parseFloat(parts[2]);
  const vbHeight = parseFloat(parts[3]);
  if (!vbWidth || !vbHeight) return 1;

  const wAttr = $svgRoot.attr('width');
  const hAttr = $svgRoot.attr('height');

  // Parse width to inches
  if (wAttr) {
    if (/in$/i.test(wAttr)) return parseFloat(wAttr) / vbWidth;
    if (/mm$/i.test(wAttr)) return (parseFloat(wAttr) / 25.4) / vbWidth;
  }

  // Parse height to inches
  if (hAttr) {
    if (/in$/i.test(hAttr)) return parseFloat(hAttr) / vbHeight;
    if (/mm$/i.test(hAttr)) return (parseFloat(hAttr) / 25.4) / vbHeight;
  }

  return 1;
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
