import { PkgConfig, PkgResult, PkgOptions } from 'espkg-config';

const pkg = new PkgConfig({ searchPaths: ['/my/path']} as PkgOptions);

export function cflags(): Promise<PkgResult> {
	return pkg.cflags(['foo']);
}
