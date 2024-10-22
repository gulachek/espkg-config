# espkg-config

This package is intended to be a JavaScript utility for parsing pkg-config
files.

## License

This software is heavily inspired by the implementation of pkg-config. Beware
this has a GPL license, so for proprietary software, it's only appropriate to
use as a build tool (and not shipped with your distribution).

## Features

The 3 target use cases this package exposes are equivalents for:

```bash
pkg-config --cflags <mod1> <mod2> ...
pkg-config --libs <mod1> <mod2> ...
pkg-config --libs --static <mod1> <mod2> ...
```

The `PKG_CONFIG_PATH` search path configuration is supported via `searchPaths`.

## Limitations

### Encoding

One fundamental difference between pkg-config and this package is that the `.pc`
files are parsed as ASCII in pkg-config and as UTF-8 in this package. This is
not expected to be an issue for users. If a `.pc` file has non-ASCII characters
and is relying on the default behavior of pkg-config to treat it as ASCII, then
the behavior is undefined in this package. If this is important and disruptive,
a user may file an issue documenting the use case.

One consequence from the above is that some string operations like trimming strings
may behave differently between the implementations, since the unicode-aware
implementation of this package may split or trim non-ASCII whitespace characters
differently than the canonical pkg-config implementation. Again, this is not
anticipated to be disruptive for normal usage of pkg-config.

### `pkg-config` Features

This implementation makes no attempt to remove -I flags that might include
directories known to gcc or msvc (like `CPATH`, `C_INCLUDE_PATH`, etc). This is
equivalent to having the `PKG_CONFIG_ALLOW_SYSTEM_CFLAGS` environment variable
set.

There is also no feature to override package variables like `pkg-config` allows
with `PKG_CONFIG_$PACKAGENAME_$VARIABLE`.

The `pc_sysrootdir` global variable is not supported. This is documented to be
intended for cross compiling to another sysroot. The author has a hard time
believing that this feature is better than installing `.pc` files in that
sysroot with the correctly configured metadata for the library that's installed
in that sysroot.

The `pc_top_builddir` variable is also not supported. This is documented as
being useful for projects that aren't installed. If something is referencing a
pc file that's under development that already has a temporary hack of a
`pc_top_builddir`, it seems like the pc file can define this variable itself.
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
a directory in the `searchPath` and hand-write fixes that are compatible with
this implementation. This is not expected to be a common scenario, and if it
proves to be significantly limiting for using this package for the intended
functionality, then the reader should submit an issue.
