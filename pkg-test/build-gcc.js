const { PkgConfig } = require('espkg-config');
const { spawnSync } = require('node:child_process');

async function build() {
	const pkg = new PkgConfig({ searchPaths: ['pkgconfig'] });

	const { flags: cflags } = await pkg.cflags(['hard_math']);
	spawnSync('gcc', [...cflags, '-c', 'main.c', '-o', 'bin/main.o'], { stdio: 'inherit' });

	const { flags: libs } = await pkg.staticLibs(['hard_math']);
	spawnSync('gcc', ['bin/main.o', '-o', 'bin/main', ...libs], { stdio: 'inherit' });
}

build();
