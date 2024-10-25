# espkg-config

This package is intended to be a JavaScript utility for parsing `pkg-config`
`.pc` files.

## License

`espkg-config` is a derivative work of `pkg-config` and `glib`, licensed under
the GNU GLPv2. This work directly translated several code fragments to
TypeScript to be run in a Node.js environment.

In being a derivative work, `espkg-config` is also licensed under GNU GPLv2.
Please refer to the `COPYING` file in this distribution to understand your rights
to use, modify, copy, and distribute this software.

## Source Code

### Reference `pkg-config` Source

You can find the source code for `pkg-config` and `glib` on
[gitlab](https://gitlab.freedesktop.org/pkg-config/pkg-config.git). Please
note that the version of `glib` that was ported was the bundled source in the
linked `pkg-config` repo. The specific commit from the `pkg-config` repo that
was forked was `d97db4fae4c1cd099b506970b285dc2afd818ea2` on version `0.29.2`.

### Obtaining Source Code

If you've already cloned a git repository for this package, it's assumed that
you already have the source code. If you'd like to obtain it directly from a
packaged distribution, look for a `source.tgz` file which you can extract
using the following command.

```bash
tar xfvz source.tgz
```

## Features

### Compiling C/C++ Programs

The 3 target use cases this package exposes are equivalents for:

```bash
pkg-config --cflags <mod1> <mod2> ...
pkg-config --libs <mod1> <mod2> ...
pkg-config --libs --static <mod1> <mod2> ...
```

The `PKG_CONFIG_PATH` search path configuration is supported via `searchPaths`
option when constructing `PkgConfig`.

The supported functions on the `PkgConfig` object are `cflags`, `libs`, and
`staticLibs`.

Usage is demonstrated in the following example.

```javascript
const { PkgConfig } = require('espkg-config');
const { spawn } = require('node:child_process');

const pkg = new PkgConfig({
	searchPaths: ['/path/to/pc/files', '...'],
});

async function example() {
	// pkg-config --cflags foo bar
	const { flags: cflags } = await pkg.cflags(['foo', 'bar']);
	// cflags: ['-I/include/foo', '-I/include/bar']

	// pkg-config --libs foo bar > 1.2.3
	const { flags: libs } = await pkg.libs(['foo', 'bar > 1.2.3']);
	// libs: ['-L/lib/foo', '-L/lib/bar', '-lfoo', '-lbar']

	// pkg-config --libs --static foo bar
	const { flags: staticLibs } = await pkg.staticLibs(['foo', 'bar']);
	// staticLibs: ['-L/lib/foo', '-L/lib/bar', '-L/lib/dependency', '-lfoo', '-lbar', '-ldependency']

	// Flags are parsed to be passed to functions like spawn
	spawn('cc', [...cflags, '-c', 'file.c', '-o', 'file.o']);
	// ...
}
```

### Error Handling

If an error is encountered while parsing a `.pc` file, an exception will be thrown
with an error message resembling the error message you'd get from running `pkg-config`
to parse the module. This implementation does not guarantee the error messages
will be the same as `pkg-config`, nor that they'll continue to be consistent
across versions. For example, if a user is doing some clever matching on error
messages, the user's code may break when he updates to another minor/patch version.

### Dependency Files

If a user needs to know _which_ `.pc` files were loaded while parsing the given modules
to `cflags`, `libs`, or `staticLibs`, then the `files` property of the result object of
these functions can be used.

```javascript
async function example() {
	const { files } = pkg.cflags(['foo', 'bar']);
	// files: ['/path/to/foo.pc', '/path/to/bar.pc', '/path/to/dep.pc']
}
```

### Further Documentation

To learn more about the syntax of `.pc` files, please consult the guides on
[freedesktop.org](https://www.freedesktop.org/wiki/Software/pkg-config/).

The public APIs and TypeScript typings for this package have tsdoc comments in
the source code.

You may find the automated tests useful for understanding edge cases in this
implementation.

If you need an extremely precise understanding of how the implementation parses
`.pc` files, then stepping through the source code for what you're looking for
is your best bet.

## Limitations

### Encoding

One fundamental difference between `pkg-config` and this package is that the `.pc`
files are parsed as ASCII in `pkg-config` and as UTF-8 in this package. This is
not expected to be an issue for users. If a `.pc` file has non-ASCII characters
and is relying on the default behavior of `pkg-config` to treat it as ASCII, then
the behavior is undefined in this package. If this is important and disruptive,
a user may file an issue documenting the use case.

One consequence from the above is that some string operations like trimming strings
may behave differently between the implementations, since the unicode-aware
implementation of this package may split or trim non-ASCII whitespace characters
differently than the canonical `pkg-config` implementation. Again, this is not
anticipated to be disruptive for normal usage of `pkg-config`.

### Shell Expansion

`pkg-config` is typically used in a `Makefile` which will capture the output of
the program in a variable like the following example.

```Makefile
FOO_CFLAGS := $(shell pkg-config --cflags foo)

bar.o: bar.c
    $(CC) $(CFLAGS) $(FOO_CFLAGS) -o bar.o -c bar.c
```

This package does not implement a POSIX-compatible shell or assume the user has
one installed (Windows😥). This means that if a loaded `.pc` file has
shell-specific features like expanding `~` or environment variable expansions,
then those will not work. The author does not anticipate this to be disruptive.
It would be a rather large undertaking to implement the components of a shell
necessary to evaluate this type of input, but it _could_ be done, so if this is
very important for a compelling use case, then an issue should be documented.

### Absent `pkg-config` Features

This implementation makes no attempt to remove `-I` flags that might include
directories known to gcc or msvc (like `CPATH`, `C_INCLUDE_PATH`, etc). This is
equivalent to having the `PKG_CONFIG_ALLOW_SYSTEM_CFLAGS` environment variable
set. `PKG_CONFIG_ALLOW_SYSTEM_LIBS` is implied in a similar fashion.

There is also no feature to override package variables like `pkg-config` allows
with `PKG_CONFIG_$PACKAGENAME_$VARIABLE`.

The `pc_sysrootdir` global variable is not supported. This is documented to be
intended for cross compiling to another sysroot. The author has a hard time
believing that this feature is better than installing `.pc` files in that
sysroot with the correctly configured metadata for the library that's installed
in that sysroot.

The `pc_top_builddir` variable is also not supported. This is documented as
being useful for projects that aren't installed. If something is referencing a
`.pc` file that's under development that already has a temporary hack of a
`pc_top_builddir`, it seems like the `.pc` file can define this variable itself.
If the author is misunderstanding this use case and the reader believes this
functionality is critical to the `pkg-config` system, then please submit an
issue.

`pkg-config` seemingly by default on Windows has an `ENABLE_DEFINE_PREFIX`
configuration variable. When enabled, it seems to attempt to override the
`prefix` variable defined in the `.pc` file with the file's grandparent
directory only if the `.pc` file's parent directory's basename is `pkgconfig`.
Then, subsequent variable definitions that begin with the prefix as the
beginning of the variable substitute with this overriden prefix as well. This
is not currently supported by this package because behavior should be
consistent between platforms. An opt-in feature can be requested if there is a
very compelling case for this that the user can choose to set if running on
Windows.

For all of the above, if the reader would like to use this package and is
running into some limitations that prevent using some installed packages, the
recommended workaround is to copy the installed `.pc` files that don't work to
a directory in the `searchPaths` and hand-write fixes that are compatible with
this implementation. This is not expected to be a common scenario, and if it
proves to be significantly limiting for using this package for the intended
functionality, then the reader should submit an issue.
