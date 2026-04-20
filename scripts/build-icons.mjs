import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import https from 'https';
import path from 'path';

// Import datasets cleanly
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

async function fetchLucideBaseline() {
  const p = path.join(process.cwd(), 'scripts', 'lucide-baseline.json');
  if (existsSync(p)) {
    const data = await fs.readFile(p, 'utf8');
    const parsed = JSON.parse(data);
    if (parsed.length > 0) return parsed;
  }
  
  console.log('Downloading Lucide baseline...');
  
  function fetchUrl(url) {
    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          let redirectUrl = res.headers.location;
          if (!redirectUrl.startsWith('http')) {
            redirectUrl = new URL(redirectUrl, url).toString();
          }
          return fetchUrl(redirectUrl).then(resolve).catch(reject);
        }
        if (res.statusCode >= 400) {
          return reject(new Error(`HTTP Error ${res.statusCode}: ${url}`));
        }
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      }).on('error', reject);
    });
  }

  let data = "{}";
  try {
    data = await fetchUrl('https://unpkg.com/lucide-static@latest/tags.json');
  } catch (err) {
    try {
      data = await fetchUrl('https://unpkg.com/lucide@latest/tags.json');
    } catch (err2) {
      console.warn("Could not download Lucide baseline. Skipping deduplication.", err2.message);
    }
  }

  const parsed = JSON.parse(data);
  const keys = Object.keys(parsed).map(k => `lucide-${k}`);
  await fs.writeFile(p, JSON.stringify(keys, null, 2));
  return keys;
}

function normalizeName(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function run() {
  const lucideIds = await fetchLucideBaseline();
  const lucideNormalized = new Set(lucideIds.map(id => normalizeName(id.replace('lucide-', ''))));
  
  // Create output dir if missing
  const iconsDir = path.join(process.cwd(), 'src', 'icons');
  if (!existsSync(iconsDir)) {
    mkdirSync(iconsDir, { recursive: true });
  }

  // 1. Simple Icons (Brand Icons)
  try {
    const simpleIcons = require('simple-icons');
    const brandIconsData = [];
    
    let addedBrands = 0;
    for (const key of Object.keys(simpleIcons)) {
      const icon = simpleIcons[key];
      if (!icon || !icon.title) continue;
      
      const normalizedTitle = normalizeName(icon.title);
      // Deduplicate with Lucide
      if (lucideNormalized.has(normalizedTitle)) continue;
      
      const slug = icon.slug || normalizedTitle;
      const svgMatch = icon.svg.match(/<svg[^>]*>([\s\S]*?)<\/svg>/i);
      if (!svgMatch) continue;
      
      let innerSvg = svgMatch[1];
      innerSvg = innerSvg.replace(/fill="([^"]+)"/g, (match, p1) => {
        if (p1 === 'none') return match;
        return 'fill="currentColor"';
      });
      innerSvg = innerSvg.replace(/stroke="([^"]+)"/g, 'stroke="currentColor"');
      
      const id = `si-${slug}`;
      brandIconsData.push(`  ['${id}', { svg: \`${innerSvg.trim()}\`, brandColor: '#${icon.hex}', name: ${JSON.stringify(icon.title)} }]`);
      addedBrands++;
    }
    
    const brandTs = `// Auto-generated file\nexport interface BrandIconData {\n  svg: string;\n  brandColor: string;\n  name: string;\n}\n\nexport const BRAND_ICONS = new Map<string, BrandIconData>([\n${brandIconsData.join(',\n')}\n]);\n`;
    await fs.writeFile(path.join(iconsDir, 'BrandIcons.ts'), brandTs);
    console.log(`Added ${addedBrands} Brand Icons (Simple Icons)`);
    
  } catch (e) {
    console.warn('Failed to process simple-icons:', e.message);
    const fallbackTs = `export interface BrandIconData {\n  svg: string;\n  brandColor: string;\n  name: string;\n}\nexport const BRAND_ICONS = new Map<string, BrandIconData>();\n`;
    await fs.writeFile(path.join(iconsDir, 'BrandIcons.ts'), fallbackTs);
  }

  // 2. Extended Icons (Phosphor)
  try {
    let phosphorAssetsDir = path.join(process.cwd(), 'node_modules', '@phosphor-icons', 'core', 'assets', 'regular');
    
    if (existsSync(phosphorAssetsDir)) {
      const extendedIconsData = [];
      let addedExtended = 0;
      const files = await fs.readdir(phosphorAssetsDir);
      
      for (const file of files) {
        if (!file.endsWith('.svg')) continue;
        const name = file.replace('-regular.svg', '').replace('.svg', '');
        const normalizedName = normalizeName(name);
        
        // Deduplicate against Lucide
        if (lucideNormalized.has(normalizedName)) continue;
        
        const svgContent = await fs.readFile(path.join(phosphorAssetsDir, file), 'utf8');
        const svgMatch = svgContent.match(/<svg[^>]*>([\s\S]*?)<\/svg>/i);
        if (!svgMatch) continue;
        
        let innerSvg = svgMatch[1];
        innerSvg = innerSvg.replace(/fill="([^"]+)"/g, (match, p1) => {
          if (p1 === 'none') return match;
          return 'fill="currentColor"';
        });
        innerSvg = innerSvg.replace(/stroke="([^"]+)"/g, (match, p1) => {
          if (p1 === 'none') return match;
          return 'stroke="currentColor"';
        });
        
        const id = `ph-${name}`;
        extendedIconsData.push(`  ['${id}', \`${innerSvg.trim()}\`]`);
        addedExtended++;
      }
      
      const extendedTs = `// Auto-generated file\nexport const EXTENDED_ICONS = new Map<string, string>([\n${extendedIconsData.join(',\n')}\n]);\n`;
      await fs.writeFile(path.join(iconsDir, 'ExtendedIcons.ts'), extendedTs);
      console.log(`Added ${addedExtended} Extended Icons (Phosphor Icons)`);
    } else {
      throw new Error("Phosphor assets directory not found at " + phosphorAssetsDir);
    }
  } catch (e) {
    console.warn('Failed to process phosphor-icons:', e.message);
    const fallbackTs = `export const EXTENDED_ICONS = new Map<string, string>();\n`;
    await fs.writeFile(path.join(iconsDir, 'ExtendedIcons.ts'), fallbackTs);
  }
  
  process.exit(0);
}

run().catch(e => {
  console.error("Build failed:", e);
  process.exit(1);
});
