/**
 * Where the Help menu sends people: the source, and the documentation.
 *
 * The documentation site is published from the repository's `docs/` folder.
 * Until a deployment has been checked, {@link DOCS_SITE_URL} stays null, which
 * is what keeps Help > Source Docs out of the menu (`noDocsSite`); the run that
 * verifies the deployment sets it. The pages themselves also ship with the
 * app, so Help > Verbose and the Tool Types rows open them with no network.
 */

/** The repository, which Help > Source Code opens and the site links its sources to. */
export const REPO_URL = 'https://github.com/isocialPractice/napkin-sketch';

/**
 * Where GitHub Pages publishes the documentation site, whether or not it is
 * up yet. The owner is folded to lower case in the host, as Pages serves it.
 */
export const DOCS_SITE_ADDRESS = 'https://isocialpractice.github.io/napkin-sketch/';

/**
 * The published documentation site, which Help > Source Docs opens, or null
 * while no deployment has been checked. The run that checks one sets it to
 * {@link DOCS_SITE_ADDRESS}.
 */
export const DOCS_SITE_URL: string | null = null;

/** The page Help > Verbose opens: the manual's reading order. */
export const DOCS_INDEX_PAGE = 'guide/index';

/** A documentation page's file, relative to the site's root: `quickstart/draw` is `quickstart/draw.html`. */
export function docsPageFile(page: string): string {
  return `${page}.html`;
}
