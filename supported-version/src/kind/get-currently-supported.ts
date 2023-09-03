import { MagentoMatrixVersion } from '../matrix/matrix-type';
import { getIndividualVersionsForProject } from "../versions/get-versions-for-project";

export const getCurrentlySupportedVersions = (date: Date): string[] => {
    const project = "magento-open-source"
    const allVersions = getIndividualVersionsForProject(project)
    return Object.entries(<Record<string,MagentoMatrixVersion>>allVersions)
        .filter(([key, value]) => {
            const dayAfterRelease = new Date(value.release);
            dayAfterRelease.setDate(dayAfterRelease.getDate() + 1);
            return date >= dayAfterRelease && new Date(value.eol) >= date;
        })
        .map(([key, value]) => key);
}