const { version } = require('./package.json');
const releaseTag = process.env.GITHUB_REF;

if (releaseTag !== `refs/tags/v${version}`) {
	console.error(
		`Error: GitHub Release '${releaseTag}' does not match the package.json version '${version}'.`,
	);
	process.exit(1);
}
