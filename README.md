# PhageMap Pages

A static, GitHub Pages-ready phage genome comparison dashboard inspired by Phamerator-style comparative phage maps.

This version is intentionally browser-only: there is no Ubuntu requirement, no database, no server, and no installation step for users. Open `index.html` locally or publish the folder with GitHub Pages.

## What it does

- Upload up to 10 annotated `.gb`, `.gbk`, `.genbank`, or text GenBank files.
- Parse `CDS` features, coordinates, strand, gene/locus tags, product names, protein IDs, notes, and `/translation` sequences.
- Draw stacked linear phage genome maps with directional CDS arrows.
- Alternate gene lanes above and below the genome backbone, similar to Phamerator-style maps.
- Predict local “pham-like” gene families from exact protein sequences, approximate protein k-mer similarity, and product names.
- Color genes by predicted family, product category, strand, or source genome.
- Draw translucent similarity ribbons between adjacent genomes.
- Reverse individual genome orientation to manually improve collinearity.
- Search across genome names, gene IDs, products, predicted families, and protein IDs.
- Export the current map as SVG or PNG.

## Important limitation

Phamerator’s strongest comparisons are based on database-backed pham assignments and BLAST/HSP alignments. GitHub Pages cannot run BLAST by itself. This dashboard therefore uses browser-side approximations:

1. Exact `/translation` sequence match.
2. Approximate amino-acid 4-mer similarity.
3. Normalized product-name similarity.

That is useful for quick visual comparison of your own phage annotations, but it is not a replacement for a backend BLAST/MMseqs2 pipeline if you need publication-grade similarity tracks.

A natural future upgrade would be to add a small preprocessing script or Cloudflare Worker/backend that calculates real nucleotide/protein alignments and writes a JSON file consumed by this static viewer.

## How to publish on GitHub Pages

1. Create a new GitHub repository.
2. Upload all files and folders from this repo.
3. Go to **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select branch `main` and folder `/root`.
6. Save. GitHub will provide the Pages URL.

## Local use

You can usually open `index.html` directly in a browser. The built-in demo files are loaded with `fetch`, so some browsers may block the demo when opened from the filesystem. Uploading your own files still works locally. For the demo, use GitHub Pages or run a tiny local server:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## File expectations

The parser expects standard GenBank formatting with a `FEATURES` section and annotated `CDS` features. It works best when CDS entries include:

- `/gene` or `/locus_tag`
- `/product`
- `/translation`
- `/protein_id` when available

Files without `/translation` still render, but family assignment becomes more dependent on product names.

## Repo structure

```text
.
├── index.html
├── assets/
│   ├── css/styles.css
│   └── js/app.js
└── samples/
    ├── demo-phage-alpha.gb
    ├── demo-phage-beta.gb
    └── demo-phage-gamma.gb
```

## Suggested next development steps

- Add optional JSON import for precomputed BLASTN/BLASTP/MMseqs alignments.
- Add pangenome/family table export.
- Add drag-and-drop reordering of genome tracks.
- Add circular genome option.
- Add persistent projects with browser local storage.
