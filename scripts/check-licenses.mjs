import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
// Reports are review artifacts, not an assertion that all dependencies are permissive.
const destination = new URL('../artifacts/licenses/', import.meta.url);
mkdirSync(destination, { recursive: true });
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const frontend = execFileSync(pnpm, ['licenses', 'list', '--json'], { encoding: 'utf8', shell: process.platform === 'win32' });
writeFileSync(new URL('frontend.json', destination), frontend);
const cargo = process.env.CARGO ?? 'cargo';
const metadata = JSON.parse(execFileSync(cargo, ['metadata', '--locked', '--format-version', '1', '--filter-platform', 'x86_64-pc-windows-msvc'], { encoding: 'utf8', maxBuffer:64*1024*1024 }));
const nodes=new Map(metadata.resolve.nodes.map(node=>[node.id,node]));
const selected=new Set();
function visit(id){if(selected.has(id))return;selected.add(id);for(const dep of nodes.get(id)?.deps??[])visit(dep.pkg);}
for(const id of metadata.workspace_members)visit(id);
const report = metadata.packages.filter(pkg=>selected.has(pkg.id)).map(({name,version,license,repository}) => ({name,version,license,repository}));
writeFileSync(new URL('rust.json', destination), JSON.stringify(report, null, 2));
if (report.some(item => !item.license)) {
  console.error('Some Rust packages have no machine-readable license; review artifacts/licenses/rust.json.');
  process.exitCode = 1;
}
console.log('Review frontend.json and rust.json before distributing binaries.');
