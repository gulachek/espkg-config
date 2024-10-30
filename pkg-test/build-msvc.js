const { PkgConfig } = require('espkg-config');
const { spawnSync } = require('node:child_process');

async function build() {
	const pkg = new PkgConfig({ searchPaths: ['pkgconfig'] });

	const { flags: cflags } = await pkg.cflags(['hard_math']);
	spawnSync('cl.exe', [...cflags, '/c', 'main.c', '/Fo.\\bin\\main.obj'], { stdio: 'inherit' });

	const { flags: libs } = await pkg.staticLibs(['hard_math']);
	spawnSync('link.exe', ['.\\bin\\main.obj', '/OUT:.\\bin\\main.exe', ...libs], { stdio: 'inherit' });
}

build();
