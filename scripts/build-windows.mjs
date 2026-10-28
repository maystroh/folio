import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const release = path.join(root, 'release');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = packageJson.version;
const electronBuilderCli = path.join(root, 'node_modules', 'electron-builder', 'cli.js');
const sevenZip = path.join(root, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');
const windowsScripts = path.join(root, 'scripts', 'windows');
const tempDir = path.join(root, '.tmp');

if (!fs.existsSync(sevenZip)) {
  throw new Error(`7-Zip was not found at ${sevenZip}`);
}

fs.mkdirSync(tempDir, { recursive: true });
const env = {
  ...process.env,
  TEMP: tempDir,
  TMP: tempDir,
  CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  ELECTRON_BUILDER_CACHE: path.join(root, '.builder-cache'),
  ELECTRON_CACHE: path.join(root, '.electron-cache'),
  electron_config_cache: path.join(root, '.electron-cache'),
};

console.log('\n[1/3] Packaging the Electron application');
for (const processName of ['FolioApp.exe']) {
  try {
    execFileSync('taskkill.exe', ['/F', '/IM', processName, '/T'], { stdio: 'ignore' });
  } catch {
    // The app is not running.
  }
}
for (const stale of [path.join(release, 'win-unpacked'), path.join(release, `Folio-${version}-Windows`)]) {
  if (fs.existsSync(stale)) fs.rmSync(stale, { recursive: true, force: true });
}
execFileSync(process.execPath, [electronBuilderCli, '--win', '--dir', '--x64', '--publish', 'never'], {
  cwd: root,
  env,
  stdio: 'inherit',
});

const unpacked = path.join(release, 'win-unpacked');
const originalExe = path.join(unpacked, 'Folio.exe');
const appExe = path.join(unpacked, 'FolioApp.exe');
if (!fs.existsSync(originalExe)) {
  throw new Error(`Expected packaged executable at ${originalExe}`);
}
if (fs.existsSync(appExe)) fs.rmSync(appExe, { force: true });
fs.renameSync(originalExe, appExe);

for (const file of [
  'Folio.vbs',
  'Folio.cmd',
  'Uninstall Folio.vbs',
  'uninstall-folio.ps1',
]) {
  fs.copyFileSync(path.join(windowsScripts, file), path.join(unpacked, file));
}
fs.copyFileSync(path.join(root, 'build', 'icon.ico'), path.join(unpacked, 'Folio.ico'));

console.log('\n[2/3] Creating the scripts-based setup folder');
const packageFolder = path.join(release, `Folio-${version}-Windows`);
fs.rmSync(packageFolder, { recursive: true, force: true });
fs.mkdirSync(packageFolder, { recursive: true });
fs.renameSync(unpacked, path.join(packageFolder, 'app'));

/**
 * The installer and its README are templates: the version in the banner and in
 * the uninstall registry entry always follows package.json, so a new release
 * can never ship with a stale version label.
 */
function copyTemplate(file, destination) {
  const contents = fs.readFileSync(path.join(windowsScripts, file), 'utf8');
  fs.writeFileSync(destination, contents.replaceAll('{{VERSION}}', version), 'utf8');
}

fs.copyFileSync(path.join(windowsScripts, 'Install Folio.cmd'), path.join(packageFolder, 'Install Folio.cmd'));
copyTemplate('install-folio.ps1', path.join(packageFolder, 'install-folio.ps1'));
copyTemplate('README.txt', path.join(packageFolder, 'README.txt'));

console.log('\n[3/3] Creating the shareable ZIP');
const archive = path.join(release, `Folio-${version}-Windows.zip`);
if (fs.existsSync(archive)) fs.rmSync(archive, { force: true });
execFileSync(sevenZip, ['a', '-tzip', '-mx=5', archive, '*'], {
  cwd: packageFolder,
  stdio: 'inherit',
});

for (const obsolete of [
  path.join(release, `Folio-Setup-${version}.exe`),
  path.join(release, `Folio-Setup-${version}.exe.blockmap`),
  path.join(release, `Folio-Setup-${version}.msi`),
  path.join(release, 'builder-debug.yml'),
  path.join(release, '__msi-x64'),
]) {
  if (fs.existsSync(obsolete)) fs.rmSync(obsolete, { recursive: true, force: true });
}

const bytes = fs.readFileSync(archive);
const hash = crypto.createHash('sha256').update(bytes).digest('hex');
console.log('');
console.log('Folio Windows package complete');
console.log(`  setup folder: ${packageFolder}`);
console.log(`  archive:      ${archive}`);
console.log(`  size:         ${(bytes.length / (1024 * 1024)).toFixed(1)} MB`);
console.log(`  sha256:       ${hash}`);
console.log('');
console.log('The end user extracts the ZIP and runs "Install Folio.cmd".');
