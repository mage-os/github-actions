import { getMatrixForVersions } from "./get-matrix-for-versions";

describe('getMatrixForVersions advisory marking for mage-os', () => {
    const project = "mage-os";

    it('carries the advisory ids for a listed version', () => {
        const result = getMatrixForVersions(project, ['mage-os/project-community-edition:1.0.2']);

        expect(result.include[0].advisoryIgnoreIds).toBe('PKSA-w9tt-7782-78jx');
    });

    it('leaves the ids unset on a version that is not listed', () => {
        const result = getMatrixForVersions(project, ['mage-os/project-community-edition:1.0.1']);

        expect(result.include[0].advisoryIgnoreIds).toBeUndefined();
    });

    it('marks only the listed versions in a mixed matrix', () => {
        const versions = [
            'mage-os/project-community-edition:1.0.1',
            'mage-os/project-community-edition:1.0.2',
            'mage-os/project-community-edition:1.0.6',
            'mage-os/project-community-edition:3.3.0',
        ];

        const marked = getMatrixForVersions(project, versions)
            .include
            .filter(entry => entry.advisoryIgnoreIds !== undefined)
            .map(entry => entry.magento);

        expect(marked).toEqual([
            'mage-os/project-community-edition:1.0.2',
            'mage-os/project-community-edition:1.0.6',
        ]);
    });

    it('preserves the rest of the version metadata when marking', () => {
        const result = getMatrixForVersions(project, ['mage-os/project-community-edition:1.0.2']);

        expect(result.magento).toEqual(['mage-os/project-community-edition:1.0.2']);
        expect(result.include[0].magento).toBe('mage-os/project-community-edition:1.0.2');
        expect(result.include[0].composer).toBe('2.10.2');
    });
});
