import { validateProject } from "./validate-projects";
import {validateKind} from "../kind/validate-kinds";

describe('validateProject', () => {
    it('returns `true` if its a valid project', () => {
        expect(validateProject("magento-open-source")).toBe(true);
        expect(validateProject("mage-os")).toBe(true);
    });
    
    it('throws a helprul exception if it is an invalid project', () => {
        expect(() => validateKind(<any>"quark")).toThrowError();
    })
})