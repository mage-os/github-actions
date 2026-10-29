import { advisoryIgnoreIdsFor } from "./advisory-affected";

describe('advisoryIgnoreIdsFor', () => {
    it('returns the advisory ids for a listed version', () => {
        expect(advisoryIgnoreIdsFor('mage-os/project-community-edition:1.0.2'))
            .toBe('PKSA-w9tt-7782-78jx');
    });

    it('returns an empty string for a version that is not listed', () => {
        expect(advisoryIgnoreIdsFor('mage-os/project-community-edition:1.0.1')).toBe('');
    });

    it('returns the advisory ids for an affected magento-open-source version', () => {
        expect(advisoryIgnoreIdsFor('magento/project-community-edition:2.4.7-p10'))
            .toBe('PKSA-w9tt-7782-78jx');
    });

    it('leaves currently supported magento versions that resolve on their own unlisted', () => {
        expect(advisoryIgnoreIdsFor('magento/project-community-edition:2.4.8-p5')).toBe('');
        expect(advisoryIgnoreIdsFor('magento/project-community-edition:2.4.9')).toBe('');
    });

    it('returns an empty string for an unknown version', () => {
        expect(advisoryIgnoreIdsFor('mage-os/project-community-edition:9.9.9')).toBe('');
    });
});
