'use strict';

const state = {
  genomes: [],
  families: new Map(),
  familyColors: new Map(),
  sourceColors: new Map(),
  search: '',
  reversed: new Set(),
  originStarts: new Map(),
};

const PALETTE = [
  '#4f46e5','#0891b2','#16a34a','#ca8a04','#dc2626','#9333ea','#ea580c','#0d9488',
  '#2563eb','#65a30d','#be123c','#7c3aed','#0284c7','#b45309','#059669','#c026d3',
  '#475569','#f59e0b','#10b981','#8b5cf6','#ef4444','#06b6d4','#84cc16','#ec4899'
];
const PRODUCT_COLORS = new Map([
  ['terminase','#7c3aed'], ['capsid','#2563eb'], ['portal','#0891b2'], ['tail','#16a34a'],
  ['tape measure','#65a30d'], ['holin','#ea580c'], ['lysin','#dc2626'], ['integrase','#9333ea'],
  ['repressor','#be123c'], ['polymerase','#0d9488'], ['helicase','#0284c7'], ['hypothetical','#94a3b8']
]);

const $ = id => document.getElementById(id);
const svgNS = 'http://www.w3.org/2000/svg';

function init() {
  $('fileInput').addEventListener('change', e => loadFiles([...e.target.files]));
  $('loadDemoBtn').addEventListener('click', loadDemo);
  $('exportSvgBtn').addEventListener('click', exportSvg);
  $('exportPngBtn').addEventListener('click', exportPng);
  $('exportHtmlBtn').addEventListener('click', exportHtmlFigure);
  ['sortSelect','scaleRange','labelMode','colorMode','ribbonRule','similarityRange','showRibbons','showUnmatched'].forEach(id => {
    $(id).addEventListener('input', () => { updateControlsText(); render(); });
    $(id).addEventListener('change', () => { updateControlsText(); render(); });
  });
  $('searchBox').addEventListener('input', e => { state.search = e.target.value.trim().toLowerCase(); render(); });
  $('clearSearchBtn').addEventListener('click', () => { $('searchBox').value = ''; state.search = ''; render(); });
  const dz = $('dropzone');
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('dragover'); loadFiles([...e.dataTransfer.files]); });
  updateControlsText();
  render();
}

function updateControlsText() {
  $('scaleValue').textContent = `${$('scaleRange').value} bp/px`;
  $('similarityValue').textContent = `${$('similarityRange').value}%`;
}

async function loadFiles(files) {
  const gbFiles = files.filter(f => /\.(gb|gbk|genbank|txt)$/i.test(f.name)).slice(0, 10);
  if (!gbFiles.length) {
    $('fileStatus').innerHTML = '<span class="warning">No GenBank-like files selected.</span>';
    return;
  }
  const parsed = [];
  for (const file of gbFiles) {
    const text = await file.text();
    try {
      const genome = parseGenBank(text, file.name);
      parsed.push(genome);
    } catch (err) {
      console.error(err);
      $('fileStatus').innerHTML = `<span class="warning">Could not parse ${escapeHtml(file.name)}: ${escapeHtml(err.message)}</span>`;
    }
  }
  state.genomes = parsed.slice(0, 10);
  state.reversed.clear();
  state.originStarts.clear();
  assignFamilies();
  $('fileStatus').textContent = `${state.genomes.length} genome${state.genomes.length === 1 ? '' : 's'} loaded.`;
  render();
}

async function loadDemo() {
  const paths = ['samples/demo-phage-alpha.gb','samples/demo-phage-beta.gb','samples/demo-phage-gamma.gb'];
  const parsed = [];
  for (const path of paths) {
    const res = await fetch(path);
    parsed.push(parseGenBank(await res.text(), path.split('/').pop()));
  }
  state.genomes = parsed;
  state.reversed.clear();
  state.originStarts.clear();
  assignFamilies();
  $('fileStatus').textContent = `${state.genomes.length} demo genomes loaded.`;
  render();
}

function parseGenBank(text, filename) {
  const lines = text.replace(/\r/g, '').split('\n');
  const locus = lines.find(l => l.startsWith('LOCUS')) || '';
  const locusParts = locus.trim().split(/\s+/);
  const locusName = locusParts[1] || filename.replace(/\.[^.]+$/, '');
  let length = Number((locus.match(/LOCUS\s+\S+\s+(\d+)/) || [])[1]) || 0;
  const definition = collectMultilineField(lines, 'DEFINITION') || '';
  const accession = (lines.find(l => l.startsWith('ACCESSION')) || '').replace('ACCESSION','').trim().split(/\s+/)[0] || '';
  const source = (lines.find(l => l.startsWith('  ORGANISM')) || '').replace('ORGANISM','').trim();
  const featuresStart = lines.findIndex(l => l.startsWith('FEATURES'));
  const originStart = lines.findIndex(l => l.startsWith('ORIGIN'));
  const sequence = originStart >= 0 ? lines.slice(originStart + 1).join('').replace(/[^a-zA-Z]/g, '').toUpperCase() : '';
  if (!length && sequence) length = sequence.length;
  if (featuresStart < 0) throw new Error('No FEATURES section found');
  const featureLines = lines.slice(featuresStart + 1, originStart >= 0 ? originStart : lines.length);
  const cdsFeatures = extractFeatures(featureLines).filter(f => f.key === 'CDS');
  const genes = cdsFeatures.map((f, index) => makeGene(f, index + 1)).filter(g => g.start && g.end);
  if (!genes.length) throw new Error('No CDS features found');
  return {
    id: `${filename}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    filename,
    name: cleanName(definition) || locusName,
    locusName,
    accession,
    source,
    length: length || Math.max(...genes.map(g => g.end)),
    sequence,
    genes,
    originalIndex: state.genomes.length,
  };
}

function collectMultilineField(lines, key) {
  const start = lines.findIndex(l => l.startsWith(key));
  if (start < 0) return '';
  const first = lines[start].slice(key.length).trim();
  const out = [first];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^[A-Z][A-Z_]+\s/.test(lines[i]) || lines[i].startsWith('FEATURES')) break;
    if (/^\s{12,}\S/.test(lines[i])) out.push(lines[i].trim()); else break;
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

function extractFeatures(lines) {
  const features = [];
  let current = null;
  for (const line of lines) {
    const start = line.match(/^\s{5}(\S+)\s+(.+)/);
    if (start) {
      if (current) features.push(current);
      current = { key: start[1], location: start[2].trim(), qualifiers: {}, raw: [] };
      continue;
    }
    if (!current) continue;
    current.raw.push(line);
    const q = line.match(/^\s{21}\/([^=]+)(?:=(.*))?/);
    if (q) {
      const name = q[1];
      let val = q[2] == null ? true : q[2].trim();
      if (typeof val === 'string') val = val.replace(/^"/, '').replace(/"$/, '');
      if (!current.qualifiers[name]) current.qualifiers[name] = [];
      current.qualifiers[name].push(val);
    } else if (/^\s{21}/.test(line)) {
      const keys = Object.keys(current.qualifiers);
      const lastKey = keys[keys.length - 1];
      if (lastKey && typeof current.qualifiers[lastKey][current.qualifiers[lastKey].length - 1] === 'string') {
        const idx = current.qualifiers[lastKey].length - 1;
        current.qualifiers[lastKey][idx] += line.trim().replace(/"$/, '');
      } else if (!line.includes('/')) {
        current.location += line.trim();
      }
    }
  }
  if (current) features.push(current);
  return features;
}

function makeGene(feature, number) {
  const loc = parseLocation(feature.location);
  const q = feature.qualifiers;
  const one = k => Array.isArray(q[k]) ? String(q[k][0]) : '';
  const translation = one('translation').replace(/[^A-Za-z*]/g, '').toUpperCase();
  const product = one('product') || one('function') || 'hypothetical protein';
  const locusTag = one('locus_tag');
  const geneName = one('gene') || locusTag || String(number);
  return {
    number, start: loc.start, end: loc.end, strand: loc.strand,
    location: feature.location, gene: geneName, locusTag, product,
    note: one('note'), proteinId: one('protein_id'), translation,
    aaLength: translation ? translation.replace(/\*/g, '').length : Math.round(Math.abs(loc.end - loc.start + 1) / 3),
    family: null,
  };
}

function parseLocation(location) {
  const strand = /complement/.test(location) ? -1 : 1;
  const nums = [...location.matchAll(/\d+/g)].map(m => Number(m[0]));
  return { start: Math.min(...nums), end: Math.max(...nums), strand };
}

function cleanName(s) {
  return s.replace(/,?\s*(complete|partial)?\s*genome\.?$/i, '').replace(/phage\s+/i, '').trim();
}

function assignFamilies() {
  const allGenes = state.genomes.flatMap((g, gi) => g.genes.map(gene => ({ genome: g, gi, gene })));
  let familyNo = 1;
  const seqMap = new Map();
  for (const item of allGenes) {
    const seq = item.gene.translation;
    if (seq && seq.length > 25) {
      if (!seqMap.has(seq)) seqMap.set(seq, `pham ${familyNo++}`);
      item.gene.family = seqMap.get(seq);
    }
  }
  for (let i = 0; i < allGenes.length; i++) {
    const a = allGenes[i].gene;
    if (a.family || !a.translation || a.translation.length < 25) continue;
    for (let j = 0; j < i; j++) {
      const b = allGenes[j].gene;
      if (!b.family || !b.translation) continue;
      if (proteinSimilarity(a.translation, b.translation) >= 0.55) { a.family = b.family; break; }
    }
    if (!a.family) a.family = `pham ${familyNo++}`;
  }
  const productMap = new Map();
  for (const item of allGenes) {
    if (item.gene.family) continue;
    const key = normalizeProduct(item.gene.product);
    if (!productMap.has(key)) productMap.set(key, `pham ${familyNo++}`);
    item.gene.family = productMap.get(key);
  }
  state.families = new Map();
  allGenes.forEach(({ gene }) => state.families.set(gene.family, (state.families.get(gene.family) || 0) + 1));
  state.familyColors = new Map([...state.families.keys()].sort().map((f, i) => [f, PALETTE[i % PALETTE.length]]));
  state.sourceColors = new Map(state.genomes.map((g, i) => [g.id, PALETTE[i % PALETTE.length]]));
}

function normalizeProduct(product) {
  return (product || 'hypothetical protein').toLowerCase()
    .replace(/putative|probable|possible|predicted|protein|orf|gene|domain/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim() || 'hypothetical';
}

function proteinSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (Math.min(a.length, b.length) < 18) return 0;
  const lenRatio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
  if (lenRatio < 0.45) return 0;
  const ak = kmers(a, 4), bk = kmers(b, 4);
  let inter = 0;
  for (const k of ak) if (bk.has(k)) inter++;
  const union = ak.size + bk.size - inter;
  return union ? (inter / union) * lenRatio : 0;
}

function kmers(seq, k) {
  const s = new Set();
  for (let i = 0; i <= seq.length - k; i++) s.add(seq.slice(i, i + k));
  return s;
}

function orderedGenomes() {
  const order = $('sortSelect').value;
  const gs = [...state.genomes];
  if (order === 'name') gs.sort((a,b) => a.name.localeCompare(b.name));
  if (order === 'length') gs.sort((a,b) => a.length - b.length);
  if (order === 'cds') gs.sort((a,b) => a.genes.length - b.genes.length);
  return gs;
}

function render() {
  renderGenomeList();
  renderSummary();
  const genomes = orderedGenomes();
  $('emptyState').style.display = genomes.length ? 'none' : 'grid';
  const svg = $('genomeMap');
  svg.replaceChildren();
  if (!genomes.length) { svg.setAttribute('height', '520'); renderColorHelp(); return; }
  const bpPerPx = Number($('scaleRange').value);
  const labelsVisible = $('labelMode').value !== 'none';
  const left = 190, right = 80;
  const top = labelsVisible ? 150 : 118;
  const trackGap = labelsVisible ? 225 : 170;
  const maxLen = Math.max(...genomes.map(g => g.length));
  const width = Math.max(900, left + Math.ceil(maxLen / bpPerPx) + right);
  const height = top + genomes.length * trackGap + (labelsVisible ? 150 : 120);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  const defs = el('defs');
  defs.appendChild(marker('arrowTip', '#111827'));
  svg.appendChild(defs);

  drawScale(svg, left, 34, maxLen, bpPerPx, width - right);
  const positions = new Map();
  genomes.forEach((g, i) => drawGenome(svg, g, i, left, top + i * trackGap, bpPerPx, positions));
  if ($('showRibbons').checked && genomes.length > 1) drawRibbons(svg, genomes, left, top, trackGap, bpPerPx, positions);
  drawSvgLegend(svg, width - 250, height - 112);
  renderColorHelp();
  applySearch();
}

function drawScale(svg, x, y, maxLen, bpPerPx, maxX) {
  const axis = el('g', { class: 'scale-axis' });
  axis.appendChild(el('line', { x1: x, y1: y, x2: maxX, y2: y, class: 'axis-line' }));
  const tickBp = niceTick(maxLen);
  for (let bp = 0; bp <= maxLen; bp += tickBp) {
    const tx = x + bp / bpPerPx;
    axis.appendChild(el('line', { x1: tx, y1: y - 6, x2: tx, y2: y + 6, class: 'tick' }));
    axis.appendChild(text(tx, y - 12, formatBp(bp), { class: 'tick-label', 'text-anchor': 'middle' }));
  }
  svg.appendChild(axis);
}

function niceTick(maxLen) {
  const raw = maxLen / 6;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const scaled = raw / pow;
  const nice = scaled < 2 ? 1 : scaled < 5 ? 2 : 5;
  return nice * pow;
}

function getOriginStart(genome) {
  const val = Number(state.originStarts.get(genome.id) || 1);
  if (!Number.isFinite(val)) return 1;
  return Math.min(Math.max(Math.round(val), 1), Math.max(1, genome.length));
}

function setOriginStart(genome, value) {
  const start = Math.min(Math.max(Math.round(Number(value) || 1), 1), Math.max(1, genome.length));
  if (start <= 1) state.originStarts.delete(genome.id);
  else state.originStarts.set(genome.id, start);
}

function shiftedCoordinate(bp, length, originStart) {
  if (!length) return bp;
  return ((bp - originStart + length) % length) + 1;
}

function displaySegments(genome, gene, reversed, originStart) {
  const length = Math.max(1, genome.length);
  const trueStart = Math.min(gene.start, gene.end);
  const trueEnd = Math.max(gene.start, gene.end);
  let start = reversed ? length - trueEnd + 1 : trueStart;
  let end = reversed ? length - trueStart + 1 : trueEnd;
  let strand = reversed ? -gene.strand : gene.strand;
  start = shiftedCoordinate(start, length, originStart);
  end = shiftedCoordinate(end, length, originStart);
  if (start <= end) return [{ start, end, strand }];
  return [{ start, end: length, strand }, { start: 1, end, strand }];
}

function drawGenome(svg, genome, index, x, y, bpPerPx, positions) {
  const group = el('g', { class: 'genome-track', 'data-genome': genome.id });
  const reversed = state.reversed.has(genome.id);
  const originStart = getOriginStart(genome);
  const originText = originStart > 1 ? ` · displayed start ${formatBp(originStart)}` : '';
  group.appendChild(text(16, y - 50, genome.name, { class: 'track-label' }));
  group.appendChild(text(16, y - 31, `${formatBp(genome.length)} · ${genome.genes.length} CDS · ${genome.filename}${originText}`, { class: 'track-meta' }));
  group.appendChild(el('line', { x1: x, y1: y, x2: x + genome.length / bpPerPx, y2: y, class: 'axis-line' }));
  group.appendChild(text(x, y - 12, originStart > 1 ? `${formatBp(originStart)} displayed as 1 bp` : '1 bp', { class: 'tick-label', 'text-anchor': 'start' }));

  const genes = $('showUnmatched').checked ? genome.genes : genome.genes.filter(g => (state.families.get(g.family) || 0) > 1);
  for (const gene of genes) {
    const segments = displaySegments(genome, gene, reversed, originStart);
    const drawn = [];
    for (const segment of segments) {
      const gx = x + segment.start / bpPerPx;
      const gw = Math.max(5, (segment.end - segment.start + 1) / bpPerPx);
      const lane = geneLane(segment.strand, gene.number);
      const gy = y + lane;
      const arrow = geneArrow(gx, gy, gw, 24, segment.strand, geneColor(gene, genome));
      arrow.setAttribute('data-search', `${genome.name} ${gene.gene} ${gene.locusTag} ${gene.product} ${gene.family} ${gene.proteinId}`.toLowerCase());
      arrow.setAttribute('data-family', gene.family);
      arrow.addEventListener('click', () => showGeneDetails(genome, gene));
      arrow.addEventListener('mousemove', e => showTooltip(e, `${escapeHtml(genome.name)}<br><strong>${escapeHtml(gene.gene)}</strong> ${escapeHtml(gene.product)}<br>${gene.start}-${gene.end} ${gene.strand > 0 ? '+' : '-'} · displayed origin ${formatBp(originStart)} · ${escapeHtml(gene.family)}`));
      arrow.addEventListener('mouseleave', hideTooltip);
      group.appendChild(arrow);
      drawn.push({ x1: gx, x2: gx + gw, y: gy + (lane < 0 ? 24 : 0), cx: gx + gw/2, width: gw });
      const labelMode = $('labelMode').value;
      const label = labelMode === 'none' ? '' : labelMode === 'product' ? shortProduct(gene.product) : labelMode === 'gene' ? gene.gene : (gw > 34 ? gene.gene : '');
      if (label) group.appendChild(geneLabel(gx + gw / 2, gy, lane, label));
    }
    if (drawn.length) {
      const primary = drawn.sort((a,b) => b.width - a.width)[0];
      positions.set(keyFor(genome, gene), primary);
    }
  }
  const flip = el('foreignObject', { x: 16, y: y + 2, width: 98, height: 32 });
  const div = document.createElement('div');
  div.innerHTML = `<button class="secondary" style="font-size:12px;padding:5px 8px">${reversed ? 'Unreverse' : 'Reverse'}</button>`;
  div.querySelector('button').addEventListener('click', () => { reversed ? state.reversed.delete(genome.id) : state.reversed.add(genome.id); render(); });
  flip.appendChild(div);
  group.appendChild(flip);
  svg.appendChild(group);
}

function geneLane(strand, geneNumber) {
  // Four compact lanes: two above the axis for forward genes and two just below for reverse genes.
  // Keeping the lower lanes close to the axis makes opposite-direction genes easier to compare.
  if (strand > 0) return geneNumber % 2 ? -34 : -60;
  return geneNumber % 2 ? 10 : 36;
}

function geneLabel(cx, arrowY, lane, label) {
  const above = lane < 0;
  const ly = above ? arrowY - 8 : arrowY + 36;
  const angle = above ? -35 : 35;
  return text(cx, ly, label, {
    class: 'gene-label',
    'text-anchor': 'middle',
    transform: `rotate(${angle} ${cx} ${ly})`
  });
}
function drawRibbons(svg, genomes, left, top, trackGap, bpPerPx, positions) {
  const layer = el('g', { class: 'ribbons' });
  svg.insertBefore(layer, svg.firstChild.nextSibling);
  const minSim = Number($('similarityRange').value) / 100;
  const rule = $('ribbonRule').value;
  for (let i = 0; i < genomes.length - 1; i++) {
    const a = genomes[i], b = genomes[i + 1];
    const matches = findMatches(a, b, rule, minSim).slice(0, 900);
    for (const m of matches) {
      const pa = positions.get(keyFor(a, m.a));
      const pb = positions.get(keyFor(b, m.b));
      if (!pa || !pb) continue;
      const path = ribbonPath(pa.x1, pa.x2, pa.y, pb.x1, pb.x2, pb.y);
      const r = el('path', { d: path, class: 'ribbon', fill: geneColor(m.a, a), 'data-search': `${a.name} ${b.name} ${m.a.product} ${m.b.product} ${m.a.family}`.toLowerCase() });
      r.addEventListener('mousemove', e => showTooltip(e, `<strong>${escapeHtml(m.a.family)}</strong><br>${escapeHtml(a.name)}: ${escapeHtml(m.a.gene)}<br>${escapeHtml(b.name)}: ${escapeHtml(m.b.gene)}<br>score: ${Math.round(m.score*100)}%`));
      r.addEventListener('mouseleave', hideTooltip);
      layer.appendChild(r);
    }
  }
}

function findMatches(a, b, rule, minSim) {
  const matches = [];
  for (const ga of a.genes) {
    let best = null;
    for (const gb of b.genes) {
      let score = 0;
      if (rule === 'family') score = ga.family === gb.family ? 1 : proteinSimilarity(ga.translation, gb.translation);
      else if (rule === 'exactTranslation') score = ga.translation && ga.translation === gb.translation ? 1 : 0;
      else if (rule === 'product') score = textSimilarity(normalizeProduct(ga.product), normalizeProduct(gb.product));
      if (score >= minSim && (!best || score > best.score)) best = { a: ga, b: gb, score };
    }
    if (best) matches.push(best);
  }
  matches.sort((x,y) => y.score - x.score);
  return matches;
}

function textSimilarity(a, b) {
  if (a === b) return 1;
  const as = new Set(a.split(/\s+/).filter(Boolean));
  const bs = new Set(b.split(/\s+/).filter(Boolean));
  let inter = 0; for (const t of as) if (bs.has(t)) inter++;
  const union = as.size + bs.size - inter;
  return union ? inter / union : 0;
}

function ribbonPath(x1, x2, y1, x3, x4, y2) {
  const c = Math.max(28, Math.abs(y2 - y1) * .42);
  return `M ${x1} ${y1} C ${x1} ${y1 + c}, ${x3} ${y2 - c}, ${x3} ${y2} L ${x4} ${y2} C ${x4} ${y2 - c}, ${x2} ${y1 + c}, ${x2} ${y1} Z`;
}

function geneArrow(x, y, w, h, strand, fill) {
  const head = Math.min(14, Math.max(5, w * .35));
  let pts;
  if (strand > 0) pts = [[x,y],[x+w-head,y],[x+w,y+h/2],[x+w-head,y+h],[x,y+h]];
  else pts = [[x+w,y],[x+head,y],[x,y+h/2],[x+head,y+h],[x+w,y+h]];
  return el('polygon', { points: pts.map(p => p.join(',')).join(' '), fill, class: 'gene-arrow' });
}

function geneColor(gene, genome) {
  const mode = $('colorMode').value;
  if (mode === 'strand') return gene.strand > 0 ? '#2563eb' : '#dc2626';
  if (mode === 'source') return state.sourceColors.get(genome.id) || '#64748b';
  if (mode === 'product') {
    const p = normalizeProduct(gene.product);
    for (const [key, color] of PRODUCT_COLORS) if (p.includes(key)) return color;
    return '#94a3b8';
  }
  return state.familyColors.get(gene.family) || '#94a3b8';
}

function drawSvgLegend(svg, x, y) {
  const group = el('g', { class: 'legend' });
  const entries = $('colorMode').value === 'product' ? [...PRODUCT_COLORS.entries()].slice(0, 8) : [...state.familyColors.entries()].filter(([f]) => (state.families.get(f)||0) > 1).slice(0, 8);
  group.appendChild(text(x, y - 12, $('colorMode').value === 'product' ? 'Product color hints' : 'Shared predicted families', { class: 'track-meta' }));
  entries.forEach(([name, color], i) => {
    const row = y + i * 18;
    group.appendChild(el('rect', { x, y: row, width: 12, height: 12, fill: color, class: 'legend-swatch' }));
    group.appendChild(text(x + 18, row + 10, `${name}${state.families.has(name) ? ` (${state.families.get(name)})` : ''}`, { class: 'track-meta' }));
  });
  svg.appendChild(group);
}

function renderColorHelp() {
  const panel = $('colorHelp');
  if (!panel) return;
  const mode = $('colorMode').value;
  if (!state.genomes.length) {
    panel.innerHTML = '<h2>Color legend</h2><p class="muted small">Load genomes to see the active color legend.</p>';
    return;
  }
  let title = 'Color legend';
  let intro = '';
  let entries = [];
  if (mode === 'family') {
    title = 'Color legend: predicted phams/families';
    intro = 'Genes with the same color are predicted to belong to the same protein family. The number in brackets is the number of CDS features assigned to that family across the loaded genomes.';
    entries = [...state.familyColors.entries()].filter(([f]) => (state.families.get(f) || 0) > 1).slice(0, 18).map(([name, color]) => [name, color, `${state.families.get(name)} genes`]);
    if (!entries.length) entries = [['No shared families above threshold', '#94a3b8', 'unique/unmatched genes']];
  } else if (mode === 'product') {
    title = 'Color legend: product keyword hints';
    intro = 'Colors are assigned from simple product-name keywords. Hypothetical or unrecognized products are grey.';
    entries = [...PRODUCT_COLORS.entries()].map(([name, color]) => [name, color, 'product keyword']);
  } else if (mode === 'strand') {
    title = 'Color legend: gene direction';
    intro = 'Colors show the annotated strand of each CDS after any map reversal.';
    entries = [['Forward strand', '#2563eb', '+ strand'], ['Reverse strand', '#dc2626', '- strand']];
  } else if (mode === 'source') {
    title = 'Color legend: source genome';
    intro = 'Each genome is assigned its own color so genes can be visually associated with their source track.';
    entries = orderedGenomes().map(g => [g.name, state.sourceColors.get(g.id) || '#64748b', `${g.genes.length} CDS`]);
  }
  panel.innerHTML = `<h2>${escapeHtml(title)}</h2><p class="muted small">${escapeHtml(intro)}</p><div class="legend-grid">${entries.map(([name, color, note]) => `<div class="legend-entry"><span class="legend-chip" style="background:${escapeHtml(color)}"></span><span>${escapeHtml(name)} <span class="muted">${escapeHtml(note)}</span></span></div>`).join('')}</div>`;
}

function renderGenomeList() {
  const box = $('genomeList');
  box.replaceChildren();
  if (!state.genomes.length) { box.innerHTML = '<p class="muted small">No genomes loaded yet.</p>'; return; }
  orderedGenomes().forEach(g => {
    const div = document.createElement('div');
    div.className = 'genome-item';
    const originStart = getOriginStart(g);
    div.innerHTML = `<strong>${escapeHtml(g.name)}</strong><span class="muted small">${formatBp(g.length)} · ${g.genes.length} CDS</span>`;

    const controls = document.createElement('div');
    controls.className = 'origin-controls';
    controls.innerHTML = `
      <label>Displayed start / origin</label>
      <div class="origin-row">
        <input type="range" min="1" max="${Math.max(1, g.length)}" value="${originStart}" step="1" aria-label="Displayed start for ${escapeHtml(g.name)}">
        <input type="number" min="1" max="${Math.max(1, g.length)}" value="${originStart}" step="1" aria-label="Displayed start bp for ${escapeHtml(g.name)}">
      </div>
      <div class="origin-note">${originStart === 1 ? 'Original GenBank coordinate order.' : `Original bp ${formatBp(originStart)} is displayed at the left edge.`}</div>`;
    const slider = controls.querySelector('input[type="range"]');
    const number = controls.querySelector('input[type="number"]');
    const applyOrigin = value => { setOriginStart(g, value); render(); };
    slider.addEventListener('input', e => applyOrigin(e.target.value));
    number.addEventListener('change', e => applyOrigin(e.target.value));
    div.appendChild(controls);

    const btn = document.createElement('button');
    btn.className = 'secondary';
    btn.textContent = state.reversed.has(g.id) ? 'Unreverse map orientation' : 'Reverse map orientation';
    btn.addEventListener('click', () => { state.reversed.has(g.id) ? state.reversed.delete(g.id) : state.reversed.add(g.id); render(); });
    div.appendChild(btn);

    const reset = document.createElement('button');
    reset.className = 'secondary';
    reset.textContent = 'Reset start';
    reset.style.marginLeft = '.4rem';
    reset.addEventListener('click', () => { state.originStarts.delete(g.id); render(); });
    div.appendChild(reset);
    box.appendChild(div);
  });
}
function renderSummary() {
  const genes = state.genomes.flatMap(g => g.genes);
  const sharedFamilies = [...state.families.values()].filter(n => n > 1).length;
  const cards = [
    ['Genomes', state.genomes.length], ['CDS features', genes.length], ['Predicted families', state.families.size], ['Shared families', sharedFamilies]
  ];
  $('summaryCards').innerHTML = cards.map(([label, num]) => `<div class="card"><div class="num">${num}</div><div class="label">${label}</div></div>`).join('');
}

function showGeneDetails(genome, gene) {
  $('geneDetails').innerHTML = `
    <strong>${escapeHtml(genome.name)} · ${escapeHtml(gene.gene)}</strong><br>
    <code>${escapeHtml(gene.location)}</code> (${gene.strand > 0 ? 'forward' : 'reverse'}; displayed start ${formatBp(getOriginStart(genome))})<br>
    <strong>Product:</strong> ${escapeHtml(gene.product)}<br>
    <strong>Predicted family:</strong> ${escapeHtml(gene.family)} · ${state.families.get(gene.family) || 1} member${(state.families.get(gene.family)||1) === 1 ? '' : 's'}<br>
    <strong>Protein:</strong> ${gene.aaLength || 'unknown'} aa ${gene.proteinId ? `· ${escapeHtml(gene.proteinId)}` : ''}<br>
    ${gene.note ? `<strong>Note:</strong> ${escapeHtml(gene.note)}<br>` : ''}
    <details><summary>Translation</summary><pre>${escapeHtml(gene.translation || 'No /translation qualifier found.')}</pre></details>
  `;
}

function applySearch() {
  const q = state.search;
  const svg = $('genomeMap');
  svg.querySelectorAll('.search-dim,.search-hit').forEach(n => n.classList.remove('search-dim','search-hit'));
  if (!q) return;
  svg.querySelectorAll('.gene-arrow,.ribbon').forEach(n => {
    const hit = (n.getAttribute('data-search') || '').includes(q);
    n.classList.add(hit ? 'search-hit' : 'search-dim');
  });
}

function showTooltip(evt, html) {
  const t = $('tooltip');
  t.hidden = false;
  t.innerHTML = html;
  t.style.left = `${Math.min(evt.clientX + 14, window.innerWidth - 380)}px`;
  t.style.top = `${evt.clientY + 16}px`;
}
function hideTooltip() { $('tooltip').hidden = true; }

function exportSvg() {
  const { svgText } = buildExportSvg();
  const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
  downloadBlob(blob, 'phage-map.svg');
}

function exportPng() {
  const { svgText, width, height } = buildExportSvg();
  const img = new Image();
  const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  img.onload = () => {
    const scale = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    canvas.toBlob(blob => {
      URL.revokeObjectURL(url);
      if (blob) downloadBlob(blob, 'phage-map.png');
      else alert('PNG export failed in this browser. Try Export SVG or Export HTML figure instead.');
    }, 'image/png');
  };

  img.onerror = () => {
    URL.revokeObjectURL(url);
    alert('PNG export failed while rendering the SVG. Try Export SVG or Export HTML figure instead.');
  };

  img.src = url;
}

function exportHtmlFigure() {
  const { svgText, width } = buildExportSvg();
  const legendHtml = $('colorHelp') ? $('colorHelp').innerHTML : '';
  const title = state.genomes.length ? orderedGenomes().map(g => g.name).join(' vs ') : 'Phage genome comparison';
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — PhageMap figure</title>
<style>
  body { margin: 0; padding: 24px; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #172033; background: #f5f7fb; }
  main { max-width: ${Math.max(1000, width + 48)}px; margin: 0 auto; }
  .figure-card { background: #fff; border: 1px solid #d9e0ea; border-radius: 18px; padding: 18px; box-shadow: 0 12px 36px rgba(26, 38, 66, 0.10); overflow: auto; }
  h1 { font-size: 20px; margin: 0 0 12px; }
  .meta { color: #637083; font-size: 13px; margin: 0 0 16px; }
  svg { display: block; max-width: none; background: #fff; }
  .legend { margin-top: 18px; background: #fff; border: 1px solid #d9e0ea; border-radius: 18px; padding: 16px; }
  .legend h2 { margin-top: 0; font-size: 15px; }
  .muted { color: #637083; }
  .small { font-size: 13px; line-height: 1.35; }
  .legend-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(185px, 1fr)); gap: 8px 14px; }
  .legend-entry { display: flex; gap: 7px; align-items: center; font-size: 13px; color: #637083; }
  .legend-chip { width: 14px; height: 14px; border-radius: 4px; border: 1px solid #1f2937; flex: 0 0 14px; }
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(title)}</h1>
  <p class="meta">Exported from PhageMap Pages. This figure is standalone HTML and does not need the dashboard JavaScript.</p>
  <section class="figure-card">${svgText}</section>
  <section class="legend">${legendHtml}</section>
</main>
</body>
</html>`;
  downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), 'phage-map-figure.html');
}

function buildExportSvg() {
  const source = $('genomeMap');
  const svg = source.cloneNode(true);
  svg.setAttribute('xmlns', svgNS);
  svg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  const width = Number(source.getAttribute('width')) || Math.ceil(source.getBoundingClientRect().width) || 1000;
  const height = Number(source.getAttribute('height')) || Math.ceil(source.getBoundingClientRect().height) || 600;
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

  // foreignObject controls are useful on-screen, but they commonly break SVG-to-canvas PNG export.
  svg.querySelectorAll('foreignObject').forEach(n => n.remove());
  svg.querySelectorAll('.search-dim,.search-hit').forEach(n => n.classList.remove('search-dim', 'search-hit'));

  const defs = svg.querySelector('defs') || svg.insertBefore(el('defs'), svg.firstChild);
  const style = document.createElementNS(svgNS, 'style');
  style.setAttribute('type', 'text/css');
  style.textContent = exportSvgCss();
  defs.insertBefore(style, defs.firstChild);

  const bg = el('rect', { x: 0, y: 0, width, height, fill: '#ffffff' });
  svg.insertBefore(bg, svg.firstChild);

  return { svgText: new XMLSerializer().serializeToString(svg), width, height };
}

function exportSvgCss() {
  return `
    .track-label { font: 800 14px Inter, Arial, sans-serif; fill: #111827; }
    .track-meta { font: 11px Inter, Arial, sans-serif; fill: #64748b; }
    .axis-line { stroke: #9aa8ba; stroke-width: 2; }
    .tick { stroke: #c8d2df; stroke-width: 1; }
    .tick-label { font: 10px Inter, Arial, sans-serif; fill: #7b8798; }
    .gene-arrow { stroke: #152033; stroke-width: 1; }
    .gene-label { font: 10px Inter, Arial, sans-serif; fill: #111827; dominant-baseline: middle; paint-order: stroke; stroke: rgba(255,255,255,.9); stroke-width: 3px; stroke-linecap: round; stroke-linejoin: round; }
    .ribbon { stroke: none; opacity: .22; }
    .legend-swatch { stroke: #111827; stroke-width: .5; }
  `;
}

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function keyFor(genome, gene) { return `${genome.id}::${gene.number}`; }
function formatBp(n) { return n >= 1000000 ? `${(n/1000000).toFixed(2)} Mb` : n >= 1000 ? `${(n/1000).toFixed(1)} kb` : `${n} bp`; }
function shortProduct(s) { return (s || '').replace(/hypothetical protein/i, 'hyp.').slice(0, 18); }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function el(name, attrs = {}) { const n = document.createElementNS(svgNS, name); for (const [k,v] of Object.entries(attrs)) n.setAttribute(k, v); return n; }
function text(x, y, content, attrs = {}) { const n = el('text', { x, y, ...attrs }); n.textContent = content; return n; }
function marker(id, color) {
  const m = el('marker', { id, markerWidth: 8, markerHeight: 8, refX: 8, refY: 4, orient: 'auto' });
  m.appendChild(el('path', { d: 'M 0 0 L 8 4 L 0 8 z', fill: color }));
  return m;
}

init();
