import { advisoryIgnoreIdsFor } from "./advisory-affected";

describe('advisoryIgnoreIdsFor', () => {
    it('returns the advisory ids for a listed version', () => {
        expect(advisoryIgnoreIdsFor('mage-os/project-community-edition:1.0.2'))
            .toBe('PKSA-w9tt-7782-78jx');
    });

    it('returns an empty string for a version that is not listed', () => {
        expect(advisoryIgnoreIdsFor('mage-os/project-community-edition:1.0.1')).toBe('');
    });

    it('returns an empty string for an unknown version', () => {
        expect(advisoryIgnoreIdsFor('mage-os/project-community-edition:9.9.9')).toBe('');
    });
});
