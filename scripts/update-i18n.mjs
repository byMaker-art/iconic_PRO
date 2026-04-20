import fs from 'fs/promises';
import path from 'path';

async function run() {
  const dir = path.join(process.cwd(), 'i18n');
  const files = await fs.readdir(dir);
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const p = path.join(dir, file);
    const content = JSON.parse(await fs.readFile(p, 'utf8'));
    
    if (!content.iconPicker) content.iconPicker = {};
    if (!content.iconPicker.toggleBrands) content.iconPicker.toggleBrands = 'Toggle brand icons';
    if (!content.iconPicker.toggleExtended) content.iconPicker.toggleExtended = 'Toggle extended icons';
    if (!content.iconPicker.history) content.iconPicker.history = 'History';
    if (!content.iconPicker.clearHistory) content.iconPicker.clearHistory = 'Clear history';
    if (!content.iconPicker.brands) content.iconPicker.brands = 'Brands';
    if (!content.iconPicker.extended) content.iconPicker.extended = 'Extended';

    if (!content.settings) content.settings = {};
    if (!content.settings.headingIconLibraries) content.settings.headingIconLibraries = 'Icon libraries';
    
    if (!content.settings.enableBrandIcons) content.settings.enableBrandIcons = {};
    if (!content.settings.enableBrandIcons.name) content.settings.enableBrandIcons.name = 'Enable brand icons';
    if (!content.settings.enableBrandIcons.desc) content.settings.enableBrandIcons.desc = 'Show icons for services like GitHub, Stripe, Discord, etc.';
    
    if (!content.settings.enableExtendedIcons) content.settings.enableExtendedIcons = {};
    if (!content.settings.enableExtendedIcons.name) content.settings.enableExtendedIcons.name = 'Enable extended icons';
    if (!content.settings.enableExtendedIcons.desc) content.settings.enableExtendedIcons.desc = 'Show an extended set of general-purpose icons (Phosphor).';
    
    if (!content.settings.maxIconHistory) content.settings.maxIconHistory = {};
    if (!content.settings.maxIconHistory.name) content.settings.maxIconHistory.name = 'Icon history size';
    if (!content.settings.maxIconHistory.desc) content.settings.maxIconHistory.desc = 'Choose how many recently used icons to remember.';

    await fs.writeFile(p, JSON.stringify(content, null, '\t') + '\n');
  }
}
run();
