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
  const oracalColors = [
    { name: 'Black', hex: '#1f1e1c' },
    { name: 'White', hex: '#fafcf7' },
    { name: 'Gold', hex: '#643d1e' },
    { name: 'Silver', hex: '#bababa' },
    { name: 'Red', hex: '#cc2f28' },
    { name: 'Pastel Orange', hex: '#fe701c' },
    { name: 'Yellow', hex: '#ffcc01' },
    { name: 'Green', hex: '#00774a' },
    { name: 'Blue', hex: '#003978' },
    { name: 'Purple', hex: '#402572' },
    { name: 'Pink', hex: '#cb3d79' },
    { name: 'Soft Pink', hex: '#f08bb7' }
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

  // Build swatches with labels
  oracalColors.forEach(colorObj => {
    // Create container for swatch and label
    const swatchContainer = document.createElement('div');
    swatchContainer.style.display = 'flex';
    swatchContainer.style.flexDirection = 'column';
    swatchContainer.style.alignItems = 'center';
    swatchContainer.style.margin = '4px';
    
    // Create swatch
    const sw = document.createElement('div');
    sw.style.width = '32px';
    sw.style.height = '32px';
    sw.style.borderRadius = '4px';
    sw.style.backgroundColor = colorObj.hex;
    sw.style.cursor = 'pointer';
    sw.style.border = '1px solid #ccc';
    sw.addEventListener('click', () => selectColor(colorObj.hex, sw));
    
    // Create label
    const label = document.createElement('div');
    label.textContent = colorObj.name;
    label.style.fontSize = '10px';
    label.style.marginTop = '2px';
    label.style.textAlign = 'center';
    label.style.color = '#333';
    label.style.maxWidth = '50px';
    label.style.lineHeight = '1.1';
    
    swatchContainer.appendChild(sw);
    swatchContainer.appendChild(label);
    colorPalette.appendChild(swatchContainer);
  });
  
  // Default select white (second swatch)
  const whiteSwatchContainer = colorPalette.children[1];
  const whiteSwatch = whiteSwatchContainer.querySelector('div');
  selectColor('#fafcf7', whiteSwatch);

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
