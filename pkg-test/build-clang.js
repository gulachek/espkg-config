const { PkgConfig } = require('espkg-config');
const { spawnSync } = require('node:child_process');

async function build() {
	const pkg = new PkgConfig({ searchPaths: ['pkgconfig'] });

	const { flags: cflags } = await pkg.cflags(['hard_math']);
	spawnSync('clang', [...cflags, '-c', 'main.c', '-o', 'bin/main.o']);

	const { flags: libs } = await pkg.staticLibs(['hard_math']);
	spawnSync('clang', [...libs, 'bin/main.o', '-o', 'bin/main']);
}

build();
