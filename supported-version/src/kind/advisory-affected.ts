/**
 * Security advisories to ignore when installing a given released version.
 *
 * Composer 2.9+ drops advisory-affected packages from the solver pool, so a frozen release
 * becomes uninstallable as advisories accumulate against dependencies it pinned and can never
 * update. Listing the advisory here lets that one install proceed.
 *
 * Only the listed advisory IDs are ignored, so a version stays covered against every other
 * advisory, and a version absent from this map is not exempted at all. A new advisory against
 * any release therefore still surfaces as a failed install rather than passing silently.
 */
export const advisoryAffectedVersions: Record<string, string[]> = {
    // league/flysystem ^2.4 — the whole 2.4.0-2.5.0 range is affected, and the 2.4.7-based
    // releases cannot move to flysystem 3.x, so the pool for that requirement is empty.
    'mage-os/project-community-edition:1.0.2': ['PKSA-w9tt-7782-78jx'],
    'mage-os/project-community-edition:1.0.3': ['PKSA-w9tt-7782-78jx'],
    'mage-os/project-community-edition:1.0.4': ['PKSA-w9tt-7782-78jx'],
    'mage-os/project-community-edition:1.0.5': ['PKSA-w9tt-7782-78jx'],
    'mage-os/project-community-edition:1.0.6': ['PKSA-w9tt-7782-78jx'],
};

/**
 * The advisory IDs for a version as a single space separated string, which is the form the
 * matrix carries into the workflow and `composer config` takes as repeated argument values.
 */
export const advisoryIgnoreIdsFor = (version: string): string =>
    (advisoryAffectedVersions[version] ?? []).join(' ');
