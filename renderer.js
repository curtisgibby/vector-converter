window.addEventListener('DOMContentLoaded', () => {
  let svgPath = null;
  let bgImagePath = null;

  const selectSvgBtn = document.getElementById('selectSvgBtn');
  const selectBgBtn = document.getElementById('selectBgBtn');
  const svgFilePathSpan = document.getElementById('svgFilePath');
  const bgImagePathSpan = document.getElementById('bgImagePath');
  const colorPicker = document.getElementById('colorPicker');
  const colorPalette = document.getElementById('colorPalette');
  const customColorBtn = document.getElementById('customColorBtn');
  const generateBtn = document.getElementById('generateBtn');

  selectSvgBtn.addEventListener('click', async () => {
    svgPath = await window.api.invoke('open-file-dialog', {
      properties: ['openFile'],
      filters: [{ name: 'SVG Files', extensions: ['svg'] }],
    });
    svgFilePathSpan.textContent = svgPath ? svgPath.split('/').pop() : '';
  });

  selectBgBtn.addEventListener('click', async () => {
    bgImagePath = await window.api.invoke('open-file-dialog', {
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'png', 'gif'] }],
    });
    bgImagePathSpan.textContent = bgImagePath ? bgImagePath.split('/').pop() : '';
  });

  // ----- Color palette setup -----
  const paletteColors = [
    '#000000', '#ffffff', '#888888', '#ff0000', '#ffa500', '#ffff00', '#008000', '#0000ff', '#4b0082', '#ee82ee'
  ];
  let selectedSwatch = null;

  function selectColor(color, swatchElement = null) {
    colorPicker.value = color;
    if (selectedSwatch) selectedSwatch.style.outline = 'none';
    if (swatchElement) {
      swatchElement.style.outline = '2px solid #007aff';
      selectedSwatch = swatchElement;
    } else {
      selectedSwatch = null;
    }
  }

  // Build swatches
  paletteColors.forEach(c => {
    const sw = document.createElement('div');
    sw.style.width = '24px';
    sw.style.height = '24px';
    sw.style.borderRadius = '4px';
    sw.style.backgroundColor = c;
    sw.style.cursor = 'pointer';
    sw.addEventListener('click', () => selectColor(c, sw));
    colorPalette.appendChild(sw);
  });
  // Default select white
  selectColor('#ffffff', colorPalette.firstChild.nextSibling); // because first swatch is black

  // Custom color button
  customColorBtn.addEventListener('click', () => {
    colorPicker.click();
  });

  colorPicker.addEventListener('input', () => {
    // Clear swatch highlight when custom color chosen
    if (selectedSwatch) selectedSwatch.style.outline = 'none';
    selectedSwatch = null;
  });

  generateBtn.addEventListener('click', () => {
    if (!svgPath) {
      alert('Please select a source SVG file.');
      return;
    }

    window.api.send('generate-files', {
      svgPath,
      bgImagePath,
      color: colorPicker.value,
    });
  });

  window.api.receive('generation-complete', (message) => {
    if (message === 'INKSCAPE_NOT_FOUND') {
      const confirmed = confirm(
        'DXF conversion requires Inkscape to be installed.\n\n' +
        'Please install it from the official website and make sure it is in your Applications folder.\n\n' +
        'Click OK to open the Inkscape download page.'
      );
      if (confirmed) {
        window.api.invoke('open-external-link', 'https://inkscape.org/release/inkscape-1.3.2/');
      }
    } else {
      alert(message);
    }
  });
});
