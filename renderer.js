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
    { name: 'Silver', hex: '#bababa' },
    { name: 'Gold', hex: '#643d1e' },
    { name: 'Red', hex: '#cc2f28' },
    { name: 'Pastel Orange', hex: '#fe701c' },
    { name: 'Yellow', hex: '#ffcc01' },
    { name: 'Green', hex: '#00774a' },
    { name: 'Blue', hex: '#003978' },
    { name: 'Purple', hex: '#402572' },
    { name: 'Pink', hex: '#cb3d79' },
    { name: 'Soft Pink', hex: '#f08bb7' }
  ];

  const siserColors = [
    { name: 'Black', hex: '#010101' },
    { name: 'White', hex: '#ffffff' },
    { name: 'Silver', hex: '#9e9fa3' },
    { name: 'Brown', hex: '#4c201f' },
    { name: 'Red', hex: '#cc2129' },
    { name: 'Orange', hex: '#ef8122' },
    { name: 'Yellow', hex: '#fecb10' },
    { name: 'Green', hex: '#14703d' },
    { name: 'Royal Blue', hex: '#204282' },
    { name: 'Purple', hex: '#482851' }
  ];
  let selectedSwatch = null;
  let selectedColorName = 'Custom'; // Default for custom colors

  function selectColor(color, swatchElement = null, colorName = 'Custom') {
    colorPicker.value = color;
    selectedColorName = colorName;
    if (selectedSwatch) selectedSwatch.style.outline = 'none';
    if (swatchElement) {
      swatchElement.style.outline = '2px solid #007aff';
      selectedSwatch = swatchElement;
    } else {
      selectedSwatch = null;
    }
  }

  // Helper function to create color section
  function createColorSection(title, subtitle, colors) {
    // Create section header
    const sectionHeader = document.createElement('div');
    sectionHeader.style.width = '100%';
    sectionHeader.style.marginBottom = '8px';
    sectionHeader.style.marginTop = '12px';
    
    const titleEl = document.createElement('div');
    titleEl.textContent = title;
    titleEl.style.fontWeight = 'bold';
    titleEl.style.fontSize = '14px';
    titleEl.style.color = '#333';
    
    const subtitleEl = document.createElement('div');
    subtitleEl.textContent = subtitle;
    subtitleEl.style.fontSize = '12px';
    subtitleEl.style.color = '#666';
    subtitleEl.style.fontStyle = 'italic';
    
    sectionHeader.appendChild(titleEl);
    sectionHeader.appendChild(subtitleEl);
    colorPalette.appendChild(sectionHeader);
    
    // Create swatches container for this section
    const swatchesContainer = document.createElement('div');
    swatchesContainer.style.display = 'flex';
    swatchesContainer.style.flexWrap = 'wrap';
    swatchesContainer.style.gap = '6px';
    swatchesContainer.style.marginBottom = '8px';
    
    colors.forEach(colorObj => {
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
      sw.addEventListener('click', () => selectColor(colorObj.hex, sw, colorObj.name));
      
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
      swatchesContainer.appendChild(swatchContainer);
    });
    
    colorPalette.appendChild(swatchesContainer);
  }
  
  // Build color sections
  createColorSection('Oracal', 'Car decal', oracalColors);
  createColorSection('Siser', 'Clothing', siserColors);
  
  // Default select white from Oracal section (second swatch in first section)
  const firstSection = colorPalette.children[1]; // Skip header, get swatches container
  const whiteSwatchContainer = firstSection.children[1]; // Second swatch (white)
  const whiteSwatch = whiteSwatchContainer.querySelector('div');
  selectColor('#fafcf7', whiteSwatch, 'White');

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
      colorName: selectedColorName,
    });
  });

  window.api.receive('generation-complete', (message) => {
    alert(message);
  });
});
